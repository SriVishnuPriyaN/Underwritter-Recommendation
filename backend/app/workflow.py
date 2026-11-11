"""
Case status rules — pure functions, no I/O.

Statuses
  awaiting_review    new submission; an underwriter accepts or refers it
  referred           referred to a senior underwriter, who accepts or declines
  accepted           accepted; Actuvara resumes the run into Quote Generation
  declined           declined by a senior underwriter (or rejected inside Actuvara)
  quoted             a quote is with the broker (Negotiation waiting for the broker)
  counter_pending    the broker countered; an underwriter must recommend
  counter_referred   that counter was referred to a senior underwriter
  quote_accepted     the broker accepted the quote — case closed
  quote_declined     negotiation ended without agreement — case closed

The app's own decisions are made here first and then sent to Actuvara
(`pending_action`); Actuvara's state is pulled back with each sync and can move
a case on its own (the broker answered, someone decided inside Actuvara).
"""
from typing import Any, Dict, Optional, Tuple

from app.auth import SENIOR_UNDERWRITER, UNDERWRITER

AWAITING_REVIEW = "awaiting_review"
REFERRED = "referred"
ACCEPTED = "accepted"
DECLINED = "declined"
QUOTED = "quoted"
COUNTER_PENDING = "counter_pending"
COUNTER_REFERRED = "counter_referred"
QUOTE_ACCEPTED = "quote_accepted"
QUOTE_DECLINED = "quote_declined"

STATUSES = (AWAITING_REVIEW, REFERRED, ACCEPTED, DECLINED, QUOTED, COUNTER_PENDING, COUNTER_REFERRED,
            QUOTE_ACCEPTED, QUOTE_DECLINED)
TERMINAL = (DECLINED, QUOTE_ACCEPTED, QUOTE_DECLINED)

RECOMMENDATIONS = ("hold", "match", "custom", "decline")


def allowed_actions(case: Dict[str, Any], role: str) -> Dict[str, bool]:
    status = case.get("status")
    busy = bool(case.get("pending_action"))
    senior = role == SENIOR_UNDERWRITER
    return {
        "accept": not busy and status == AWAITING_REVIEW,
        "refer": not busy and status == AWAITING_REVIEW and role == UNDERWRITER,
        "referral_decision": not busy and status == REFERRED and senior,
        "counter_recommend": not busy and (status == COUNTER_PENDING or (status == COUNTER_REFERRED and senior)),
        "counter_refer": not busy and status == COUNTER_PENDING and role == UNDERWRITER,
        "senior_authority": senior,
    }


def negotiation_view(snapshot: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    gate = (snapshot or {}).get("negotiation_gate")
    if not gate or not gate.get("status"):
        return None
    return {k: gate.get(k) for k in ("status", "round", "max_rounds", "quoted_premium", "rated_premium",
                                     "max_discount_pct", "floor_premium", "pending_counter", "rounds",
                                     "agreed_premium", "closed_reason", "quote_number")}


def resolve_premium(recommendation: str, agreed_premium: Optional[float],
                    negotiation: Optional[Dict[str, Any]]) -> Tuple[Optional[float], Optional[str]]:
    """(premium the recommendation leads to, error). Decline leads to no premium."""
    pending = (negotiation or {}).get("pending_counter") or {}
    if recommendation == "decline":
        return None, None
    if recommendation == "hold":
        value = pending.get("quoted_premium") or (negotiation or {}).get("quoted_premium")
        return (float(value), None) if value is not None else (None, "The quoted premium is not known yet")
    if recommendation == "match":
        value = pending.get("counter_premium")
        return (float(value), None) if value is not None else (None, "The broker's counter has no premium to match")
    if agreed_premium is None or agreed_premium <= 0:
        return None, "Enter the premium for a custom recommendation"
    return float(agreed_premium), None


def below_authority(premium: Optional[float], negotiation: Optional[Dict[str, Any]]) -> bool:
    floor = (negotiation or {}).get("floor_premium")
    return premium is not None and floor is not None and premium < float(floor)


def status_from_actuvara(case: Dict[str, Any], snapshot: Dict[str, Any]) -> Tuple[str, Optional[str]]:
    """
    The status a case should have given Actuvara's latest state, and a history note
    when Actuvara moved it by itself. Local decisions still being sent
    (pending_action) are never overridden.
    """
    status = case.get("status") or AWAITING_REVIEW
    if case.get("pending_action"):
        return status, None

    negotiation = snapshot.get("negotiation_gate") or {}
    neg_status = negotiation.get("status")
    if neg_status:
        if neg_status == "awaiting_underwriter" and negotiation.get("awaiting_underwriter"):
            referral = case.get("counter_referral") or {}
            if status == COUNTER_REFERRED and referral.get("round") == negotiation.get("round"):
                return COUNTER_REFERRED, None
            return COUNTER_PENDING, (None if status == COUNTER_PENDING else "Broker sent a counter-offer")
        if neg_status == "accepted":
            return QUOTE_ACCEPTED, (None if status == QUOTE_ACCEPTED else "Broker accepted the quote")
        if neg_status == "declined":
            reason = negotiation.get("closed_reason") or "Negotiation declined"
            return QUOTE_DECLINED, (None if status == QUOTE_DECLINED else reason)
        if neg_status in ("awaiting_response", "counter"):
            return QUOTED, (None if status == QUOTED else "Quote sent to the broker")

    gate = snapshot.get("review_gate") or {}
    if status in (AWAITING_REVIEW, REFERRED):
        if gate.get("decision") == "approved" and not gate.get("waiting"):
            return ACCEPTED, "Accepted inside Actuvara"
        if gate.get("decision") == "rejected" and not gate.get("waiting"):
            return DECLINED, "Rejected inside Actuvara"
        if snapshot.get("run_status") == "rejected":
            return DECLINED, snapshot.get("error_message") or "The run was rejected in Actuvara"
    return status, None


def summary_fields(snapshot: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    uw = (snapshot or {}).get("underwriting") or {}
    rating = uw.get("rating") or {}
    quote = uw.get("quote") or {}
    ela = uw.get("exposure_loss_analysis") or {}
    brokers = (snapshot or {}).get("broker_emails") or []
    return {
        "insured_name": (snapshot or {}).get("insured_name"),
        "process_name": (snapshot or {}).get("process_name"),
        "broker_email": brokers[0] if brokers else None,
        "premium": quote.get("premium") if quote.get("premium") is not None else rating.get("premium"),
        "risk_category": ela.get("risk_category"),
        "rating_status": rating.get("status"),
    }
