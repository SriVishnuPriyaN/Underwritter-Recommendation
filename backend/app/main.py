"""
Underwriter Recommendation — backend.

Run:  uvicorn app.main:app --port 8010 --reload   (from the backend folder)
"""
import asyncio
import hmac
import logging
from contextlib import asynccontextmanager
from typing import Any, Dict, Literal, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app import actuvara, auth, db, service
from app import workflow as wf
from app.config import get_settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("uw-recommendation")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await db.ensure_indexes()
    worker = asyncio.create_task(service.sync_worker(get_settings().sync_interval_seconds))
    try:
        yield
    finally:
        worker.cancel()
        db.close()


app = FastAPI(title="Underwriter Recommendation", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)


# ── Request bodies ───────────────────────────────────────────────────────────

class DevLogin(BaseModel):
    email: str


class AcceptBody(BaseModel):
    notes: Optional[str] = None


class ReferBody(BaseModel):
    reason: str = Field(min_length=1)


class ReferralDecisionBody(BaseModel):
    decision: Literal["accept", "decline"]
    notes: Optional[str] = None


class CounterRecommendationBody(BaseModel):
    recommendation: Literal["hold", "match", "custom", "decline"]
    agreed_premium: Optional[float] = None
    notes: Optional[str] = None


def clean(text: Optional[str]) -> Optional[str]:
    text = (text or "").strip()
    return text or None


# ── Health ───────────────────────────────────────────────────────────────────

@app.get("/api/health")
async def health() -> Dict[str, str]:
    return {"status": "ok"}


# ── Auth ─────────────────────────────────────────────────────────────────────

@app.get("/api/auth/config")
async def auth_config() -> Dict[str, Any]:
    s = get_settings()
    if s.auth_mode == "azure_ad":
        return {"mode": "azure_ad", "tenant_id": s.aad_tenant_id, "client_id": s.aad_client_id}
    return {"mode": "dev"}


@app.post("/api/auth/dev-login")
async def dev_login(body: DevLogin) -> Dict[str, Any]:
    if get_settings().auth_mode != "dev":
        raise HTTPException(404, "Not found")
    if "@" not in body.email:
        raise HTTPException(400, "Enter a valid email address")
    user = await auth.resolve_user(body.email)
    return {"token": auth.issue_token(user), "user": user}


@app.post("/api/auth/exchange")
async def exchange(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    if get_settings().auth_mode != "azure_ad":
        raise HTTPException(404, "Not found")
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Microsoft ID token required")
    claims = auth.validate_azure_id_token(authorization.split(" ", 1)[1])
    email = claims.get("email") or claims.get("preferred_username") or claims.get("upn")
    if not email:
        raise HTTPException(401, "The Microsoft token carries no email")
    user = await auth.resolve_user(email, claims.get("name"))
    return {"token": auth.issue_token(user), "user": user}


@app.get("/api/auth/me")
async def me(user=Depends(auth.current_user)) -> Dict[str, Any]:
    return user


# ── Intake (called by Actuvara's API Connector node) ─────────────────────────

@app.post("/api/intake/actuvara")
async def intake(request: Request, x_intake_key: Optional[str] = Header(None)) -> Dict[str, Any]:
    expected = get_settings().intake_api_key
    if not expected or not hmac.compare_digest((x_intake_key or "").encode(), expected.encode()):
        raise HTTPException(401, "Invalid intake key")
    try:
        body = await request.json()
    except ValueError:
        raise HTTPException(400, "Body must be JSON")
    ref_id = (body.get("ref_id") or body.get("refId")) if isinstance(body, dict) else None
    if not ref_id or not isinstance(ref_id, str):
        raise HTTPException(400, 'ref_id is required — set the API Connector body to {"ref_id": "{{ref_id}}"}')
    case = await service.intake(ref_id.strip())
    return {"status": "received", "case_id": str(case["_id"]), "case_status": case["status"]}


# ── Cases ────────────────────────────────────────────────────────────────────

@app.get("/api/stats")
async def stats(_user=Depends(auth.current_user)) -> Dict[str, int]:
    return await service.stats()


@app.get("/api/cases")
async def list_cases(status: Optional[str] = Query(None), q: Optional[str] = Query(None),
                     _user=Depends(auth.current_user)):
    statuses = [s for s in (status or "").split(",") if s in wf.STATUSES] or None
    return await service.list_cases(statuses, clean(q))


@app.get("/api/cases/{case_id}")
async def get_case(case_id: str, user=Depends(auth.current_user)):
    return await service.detail(await service.get_case(case_id), user)


@app.post("/api/cases/{case_id}/refresh")
async def refresh_case(case_id: str, user=Depends(auth.current_user)):
    case = await service.get_case(case_id)
    return await service.detail(await service.refresh(case["_id"]), user)


@app.post("/api/cases/{case_id}/accept")
async def accept(case_id: str, body: AcceptBody, user=Depends(auth.current_user)):
    return await service.detail(await service.accept(case_id, user, clean(body.notes)), user)


@app.post("/api/cases/{case_id}/refer")
async def refer(case_id: str, body: ReferBody, user=Depends(auth.current_user)):
    reason = clean(body.reason)
    if not reason:
        raise HTTPException(400, "A reason is required to refer a case")
    return await service.detail(await service.refer(case_id, user, reason), user)


@app.post("/api/cases/{case_id}/referral/decision")
async def referral_decision(case_id: str, body: ReferralDecisionBody, user=Depends(auth.current_user)):
    notes = clean(body.notes)
    if body.decision == "decline" and not notes:
        raise HTTPException(400, "Notes are required to decline a referral")
    return await service.detail(await service.decide_referral(case_id, user, body.decision, notes), user)


@app.post("/api/cases/{case_id}/counter/recommendation")
async def counter_recommendation(case_id: str, body: CounterRecommendationBody, user=Depends(auth.current_user)):
    case = await service.recommend_counter(case_id, user, body.recommendation, body.agreed_premium, clean(body.notes))
    return await service.detail(case, user)


@app.post("/api/cases/{case_id}/counter/refer")
async def counter_refer(case_id: str, body: ReferBody, user=Depends(auth.current_user)):
    reason = clean(body.reason)
    if not reason:
        raise HTTPException(400, "A reason is required to refer a counter-offer")
    return await service.detail(await service.refer_counter(case_id, user, reason), user)


@app.get("/api/cases/{case_id}/documents/{file_id}")
async def document(case_id: str, file_id: str, _user=Depends(auth.current_user)):
    case = await service.get_case(case_id)
    known = {d.get("file_id") for d in ((case.get("snapshot") or {}).get("documents") or [])}
    if file_id not in known:
        raise HTTPException(404, "Document not found on this case")
    try:
        content, content_type, disposition = await actuvara.get_document(case["ref_id"], file_id)
    except actuvara.ActuvaraError as e:
        raise HTTPException(502 if e.status_code >= 500 else e.status_code, e.message)
    headers = {"Content-Disposition": disposition} if disposition else {}
    return Response(content=content, media_type=content_type, headers=headers)
