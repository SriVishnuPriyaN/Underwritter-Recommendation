"""
Case service: intake, sync with Actuvara, decisions, and the API shapes.

Decisions are recorded here first, then delivered to Actuvara as the case's
`pending_action`. Delivery is tried immediately and then by the sync worker
until Actuvara takes it — Actuvara may not have reached the waiting step yet
(the API Connector notifies the app just BEFORE the run pauses at Human
Approval), or be briefly unreachable.
"""
import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from bson import ObjectId
from fastapi import HTTPException
from pymongo import ReturnDocument

from app import actuvara, db
from app import workflow as wf

logger = logging.getLogger(__name__)

_locks: Dict[str, asyncio.Lock] = {}
_background: set = set()


def in_background(coro) -> None:
    """Run a coroutine after the response, keeping a reference so it is not garbage-collected."""
    task = asyncio.create_task(coro)
    _background.add(task)
    task.add_done_callback(_background.discard)


def now() -> datetime:
    return datetime.now(timezone.utc)


def iso(value: Any) -> Any:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat().replace("+00:00", "Z")
    return value


def lock_for(case_id: str) -> asyncio.Lock:
    return _locks.setdefault(case_id, asyncio.Lock())


async def audit(case: Dict[str, Any], type_: str, user: Optional[Dict[str, Any]] = None,
                data: Optional[Dict[str, Any]] = None) -> None:
    await db.audit_events().insert_one({
        "case_id": case["_id"], "ref_id": case["ref_id"], "type": type_,
        "actor_email": (user or {}).get("email"), "actor_name": (user or {}).get("name"),
        "actor_role": (user or {}).get("role"), "data": data or {}, "at": now(),
    })


# ── Lookup ───────────────────────────────────────────────────────────────────

async def get_case(case_id: str) -> Dict[str, Any]:
    if not ObjectId.is_valid(case_id):
        raise HTTPException(404, "Case not found")
    case = await db.cases().find_one({"_id": ObjectId(case_id)})
    if not case:
        raise HTTPException(404, "Case not found")
    return case


# ── Intake ───────────────────────────────────────────────────────────────────

async def intake(ref_id: str) -> Dict[str, Any]:
    """Create the case for an Actuvara submission (idempotent) and pull it in the background."""
    existing = await db.cases().find_one({"ref_id": ref_id})
    if existing:
        in_background(refresh_safely(existing["_id"]))
        return existing
    case = {
        "ref_id": ref_id, "status": wf.AWAITING_REVIEW, "received_at": now(), "updated_at": now(),
        "snapshot": None, "snapshot_at": None, "sync_error": None, "pending_action": None,
        "decision": None, "referral": None, "counter_referral": None,
        **wf.summary_fields(None),
    }
    try:
        result = await db.cases().insert_one(case)
        case["_id"] = result.inserted_id
    except Exception:
        # Two intake calls raced; the other one created it.
        case = await db.cases().find_one({"ref_id": ref_id})
        if not case:
            raise
    await audit(case, "received", data={"source": "actuvara_api_connector"})
    # Never pull inline: Actuvara's API Connector is waiting on this response and
    # the pull calls back into the same Actuvara Function App.
    in_background(refresh_safely(case["_id"]))
    return case


# ── Sync ─────────────────────────────────────────────────────────────────────

async def refresh_safely(case_id: ObjectId) -> None:
    try:
        await refresh(case_id)
    except Exception as e:  # background task: log, never raise
        logger.error(f"Refresh of case {case_id} failed: {e}", exc_info=True)


async def refresh(case_id: ObjectId) -> Dict[str, Any]:
    """Pull Actuvara's state, move the case accordingly, and deliver any pending action."""
    async with lock_for(str(case_id)):
        case = await db.cases().find_one({"_id": case_id})
        if not case:
            raise HTTPException(404, "Case not found")
        try:
            snapshot = await actuvara.get_submission(case["ref_id"])
        except actuvara.ActuvaraError as e:
            await db.cases().update_one({"_id": case_id}, {"$set": {"sync_error": e.message}})
            case["sync_error"] = e.message
            return case

        case = await apply_snapshot(case, snapshot)
        if case.get("pending_action"):
            case = await deliver_pending(case)
        return case


async def apply_snapshot(case: Dict[str, Any], snapshot: Dict[str, Any]) -> Dict[str, Any]:
    status, note = wf.status_from_actuvara(case, snapshot)
    update = {"snapshot": snapshot, "snapshot_at": now(), "sync_error": None, **wf.summary_fields(snapshot)}
    if status != case.get("status"):
        update["status"] = status
        update["updated_at"] = now()
    case = await db.cases().find_one_and_update({"_id": case["_id"]}, {"$set": update},
                                                return_document=ReturnDocument.AFTER)
    if note:
        await audit(case, "actuvara_update", data={"message": note, "status": status})
    return case


async def deliver_pending(case: Dict[str, Any]) -> Dict[str, Any]:
    action = case["pending_action"]
    snapshot = case.get("snapshot") or {}
    try:
        if action["type"] == "decision":
            await actuvara.post_decision(case["ref_id"], {
                "decision": action["decision"], "user": action["user_email"], "notes": action.get("notes"),
                "senior_authority": action.get("senior_authority", False)})
        else:
            await actuvara.post_recommendation(case["ref_id"], {
                "recommendation": action["recommendation"], "agreed_premium": action.get("agreed_premium"),
                "notes": action.get("notes"), "user": action["user_email"],
                "senior_authority": action.get("senior_authority", False)})
    except actuvara.ActuvaraError as e:
        return await delivery_failed(case, action, e, snapshot)

    after = wf.QUOTED if action["type"] == "counter_recommendation" else case["status"]
    if action["type"] == "counter_recommendation" and action["recommendation"] == "decline":
        after = wf.QUOTE_DECLINED
    case = await db.cases().find_one_and_update(
        {"_id": case["_id"]},
        {"$set": {"pending_action": None, "status": after, "updated_at": now()}},
        return_document=ReturnDocument.AFTER)
    await audit(case, "sent_to_actuvara", data={"action": action["type"], **_action_summary(action)})
    return case


async def delivery_failed(case: Dict[str, Any], action: Dict[str, Any], e: actuvara.ActuvaraError,
                          snapshot: Dict[str, Any]) -> Dict[str, Any]:
    gate = e.payload.get("gate") or {}
    superseded = False
    if e.status_code == 409 and e.code == "not_waiting":
        if action["type"] == "decision":
            # Not reached the gate yet → keep trying; already past it → decided elsewhere.
            superseded = gate.get("status") in ("completed", "failed", "skipped")
        else:
            superseded = gate.get("status") not in (None, "awaiting_underwriter")
    rejected = e.status_code == 400  # Actuvara refused the content (e.g. below the authority floor)

    if superseded or rejected:
        revert = action.get("revert_status") if rejected else case["status"]
        case = await db.cases().find_one_and_update(
            {"_id": case["_id"]},
            {"$set": {"pending_action": None, "status": revert, "sync_error": e.message, "updated_at": now()}},
            return_document=ReturnDocument.AFTER)
        await audit(case, "rejected_by_actuvara" if rejected else "superseded_in_actuvara",
                    data={"action": action["type"], "message": e.message})
        if superseded and snapshot:
            case = await apply_snapshot(case, snapshot)
        return case

    attempts = int(action.get("attempts", 0)) + 1
    waiting_msg = "Waiting for Actuvara to reach the underwriter step" if e.code == "not_waiting" else e.message
    return await db.cases().find_one_and_update(
        {"_id": case["_id"]},
        {"$set": {"pending_action.attempts": attempts, "pending_action.last_error": waiting_msg}},
        return_document=ReturnDocument.AFTER)


def _action_summary(action: Dict[str, Any]) -> Dict[str, Any]:
    return {k: action.get(k) for k in ("decision", "recommendation", "agreed_premium", "notes", "senior_authority")
            if action.get(k) is not None}


async def sync_active_cases() -> None:
    cursor = db.cases().find({"status": {"$nin": list(wf.TERMINAL)}}, {"_id": 1})
    async for doc in cursor:
        await refresh_safely(doc["_id"])


async def sync_worker(interval: int) -> None:
    while True:
        try:
            await sync_active_cases()
        except Exception as e:
            logger.error(f"Sync pass failed: {e}", exc_info=True)
        await asyncio.sleep(max(5, interval))


# ── Decisions ────────────────────────────────────────────────────────────────

async def transition(case_id: str, user: Dict[str, Any], action_name: str, update: Dict[str, Any],
                     event: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """Apply a user decision if the case still allows it (checked atomically on status)."""
    case = await get_case(case_id)
    if not wf.allowed_actions(case, user["role"]).get(action_name):
        raise HTTPException(409, "This action is not available for the case any more — refresh to see its current state")
    update = {**update, "updated_at": now()}
    changed = await db.cases().find_one_and_update(
        {"_id": case["_id"], "status": case["status"], "pending_action": None},
        {"$set": update}, return_document=ReturnDocument.AFTER)
    if not changed:
        raise HTTPException(409, "Someone else acted on this case first — refresh to see its current state")
    await audit(changed, event, user, data)
    if changed.get("pending_action"):
        try:
            changed = await refresh(changed["_id"])
        except Exception as e:
            logger.warning(f"Immediate delivery for case {case_id} deferred to the sync worker: {e}")
    return changed


def pending(type_: str, user: Dict[str, Any], revert_status: str, **fields) -> Dict[str, Any]:
    return {"type": type_, "user_email": user["email"], "user_name": user["name"], "role": user["role"],
            "senior_authority": user["role"] == "senior_underwriter", "attempts": 0, "last_error": None,
            "created_at": now(), "revert_status": revert_status, **fields}


def decision_record(user: Dict[str, Any], decision: str, notes: Optional[str]) -> Dict[str, Any]:
    return {"decision": decision, "by_email": user["email"], "by_name": user["name"], "role": user["role"],
            "notes": notes, "at": now()}


async def accept(case_id: str, user: Dict[str, Any], notes: Optional[str]) -> Dict[str, Any]:
    return await transition(case_id, user, "accept", {
        "status": wf.ACCEPTED,
        "decision": decision_record(user, "accept", notes),
        "pending_action": pending("decision", user, wf.AWAITING_REVIEW, decision="accept", notes=notes),
    }, "accepted", {"notes": notes})


async def refer(case_id: str, user: Dict[str, Any], reason: str) -> Dict[str, Any]:
    return await transition(case_id, user, "refer", {
        "status": wf.REFERRED,
        "referral": {"reason": reason, "by_email": user["email"], "by_name": user["name"], "at": now(),
                     "resolved": False, "resolution": None, "resolved_by_name": None, "resolved_at": None,
                     "notes": None},
    }, "referred", {"reason": reason})


async def decide_referral(case_id: str, user: Dict[str, Any], decision: str, notes: Optional[str]) -> Dict[str, Any]:
    case = await get_case(case_id)
    referral = {**(case.get("referral") or {}), "resolved": True, "resolution": decision,
                "resolved_by_name": user["name"], "resolved_at": now(), "notes": notes}
    return await transition(case_id, user, "referral_decision", {
        "status": wf.ACCEPTED if decision == "accept" else wf.DECLINED,
        "referral": referral,
        "decision": decision_record(user, decision, notes),
        "pending_action": pending("decision", user, wf.REFERRED, decision=decision, notes=notes),
    }, "referral_accepted" if decision == "accept" else "referral_declined", {"notes": notes})


async def recommend_counter(case_id: str, user: Dict[str, Any], recommendation: str,
                            agreed_premium: Optional[float], notes: Optional[str]) -> Dict[str, Any]:
    case = await get_case(case_id)
    negotiation = wf.negotiation_view(case.get("snapshot"))
    premium, problem = wf.resolve_premium(recommendation, agreed_premium, negotiation)
    if problem:
        raise HTTPException(400, problem)
    if user["role"] != "senior_underwriter" and wf.below_authority(premium, negotiation):
        raise HTTPException(400, f"A premium of {premium:,.2f} is below your authority floor of "
                                 f"{float(negotiation['floor_premium']):,.2f} — refer the counter-offer to a "
                                 f"senior underwriter")
    return await transition(case_id, user, "counter_recommend", {
        "pending_action": pending("counter_recommendation", user, case["status"], recommendation=recommendation,
                                  agreed_premium=premium if recommendation == "custom" else None, notes=notes,
                                  resulting_premium=premium,
                                  round=(negotiation or {}).get("round")),
    }, "counter_recommended", {"recommendation": recommendation, "premium": premium, "notes": notes})


async def refer_counter(case_id: str, user: Dict[str, Any], reason: str) -> Dict[str, Any]:
    case = await get_case(case_id)
    negotiation = wf.negotiation_view(case.get("snapshot")) or {}
    return await transition(case_id, user, "counter_refer", {
        "status": wf.COUNTER_REFERRED,
        "counter_referral": {"reason": reason, "by_email": user["email"], "by_name": user["name"], "at": now(),
                             "round": negotiation.get("round")},
    }, "counter_referred", {"reason": reason, "round": negotiation.get("round")})


# ── API shapes ───────────────────────────────────────────────────────────────

def _dates(obj: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    return {k: iso(v) for k, v in obj.items()} if isinstance(obj, dict) else obj


def summary(case: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": str(case["_id"]), "ref_id": case["ref_id"], "status": case["status"],
        "insured_name": case.get("insured_name"), "process_name": case.get("process_name"),
        "broker_email": case.get("broker_email"), "premium": case.get("premium"),
        "risk_category": case.get("risk_category"), "rating_status": case.get("rating_status"),
        "received_at": iso(case.get("received_at")), "updated_at": iso(case.get("updated_at")),
        "pending_sync": bool(case.get("pending_action")),
    }


async def detail(case: Dict[str, Any], user: Dict[str, Any]) -> Dict[str, Any]:
    snapshot = case.get("snapshot")
    history: List[Dict[str, Any]] = []
    async for ev in db.audit_events().find({"case_id": case["_id"]}).sort("at", 1):
        history.append({"type": ev["type"], "actor_email": ev.get("actor_email"), "actor_name": ev.get("actor_name"),
                        "actor_role": ev.get("actor_role"), "data": ev.get("data") or {}, "at": iso(ev["at"])})
    action = case.get("pending_action")
    underwriting = dict((snapshot or {}).get("underwriting") or {})
    underwriting.pop("negotiation", None)
    return {
        **summary(case),
        "snapshot_at": iso(case.get("snapshot_at")),
        "pending_sync": None if not action else {
            "type": action["type"], "attempts": action.get("attempts", 0), "last_error": action.get("last_error"),
            "created_at": iso(action.get("created_at"))},
        "sync_error": case.get("sync_error"),
        "decision": _dates(case.get("decision")),
        "referral": _dates(case.get("referral")),
        "counter_referral": _dates(case.get("counter_referral")),
        "submission": None if not snapshot else {
            "run_status": snapshot.get("run_status"), "process_name": snapshot.get("process_name"),
            "created_at": snapshot.get("created_at"), "documents": snapshot.get("documents") or [],
            "segments": snapshot.get("segments") or []},
        "underwriting": underwriting,
        "negotiation": wf.negotiation_view(snapshot),
        "review_gate": (snapshot or {}).get("review_gate"),
        "history": history,
        "actions": wf.allowed_actions(case, user["role"]),
    }


async def stats() -> Dict[str, int]:
    counts = {s: 0 for s in wf.STATUSES}
    async for row in db.cases().aggregate([{"$group": {"_id": "$status", "n": {"$sum": 1}}}]):
        if row["_id"] in counts:
            counts[row["_id"]] = row["n"]
    return counts


async def list_cases(statuses: Optional[List[str]], q: Optional[str]) -> List[Dict[str, Any]]:
    query: Dict[str, Any] = {}
    if statuses:
        query["status"] = {"$in": statuses}
    if q:
        import re
        pattern = {"$regex": re.escape(q.strip()), "$options": "i"}
        query["$or"] = [{"insured_name": pattern}, {"ref_id": pattern}, {"process_name": pattern},
                        {"broker_email": pattern}]
    cursor = db.cases().find(query, {"snapshot": 0}).sort("updated_at", -1).limit(500)
    return [summary(c) async for c in cursor]
