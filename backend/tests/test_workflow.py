from app import workflow as wf
from app.auth import SENIOR_UNDERWRITER, UNDERWRITER


def case(status, **extra):
    return {"status": status, "pending_action": None, **extra}


def test_underwriter_can_accept_or_refer_new_case():
    actions = wf.allowed_actions(case(wf.AWAITING_REVIEW), UNDERWRITER)
    assert actions["accept"] and actions["refer"]
    assert not actions["referral_decision"] and not actions["senior_authority"]


def test_only_senior_decides_referrals():
    assert not wf.allowed_actions(case(wf.REFERRED), UNDERWRITER)["referral_decision"]
    assert wf.allowed_actions(case(wf.REFERRED), SENIOR_UNDERWRITER)["referral_decision"]


def test_pending_delivery_blocks_actions():
    busy = {"status": wf.AWAITING_REVIEW, "pending_action": {"type": "decision"}}
    assert not any(v for k, v in wf.allowed_actions(busy, SENIOR_UNDERWRITER).items() if k != "senior_authority")


def test_counter_referred_only_for_senior():
    assert not wf.allowed_actions(case(wf.COUNTER_REFERRED), UNDERWRITER)["counter_recommend"]
    assert wf.allowed_actions(case(wf.COUNTER_REFERRED), SENIOR_UNDERWRITER)["counter_recommend"]
    assert wf.allowed_actions(case(wf.COUNTER_PENDING), UNDERWRITER)["counter_refer"]
    assert not wf.allowed_actions(case(wf.COUNTER_PENDING), SENIOR_UNDERWRITER)["counter_refer"]


NEG = {"quoted_premium": 10000, "floor_premium": 9000,
       "pending_counter": {"quoted_premium": 10000, "counter_premium": 8500}}


def test_resolve_premium():
    assert wf.resolve_premium("hold", None, NEG) == (10000.0, None)
    assert wf.resolve_premium("match", None, NEG) == (8500.0, None)
    assert wf.resolve_premium("custom", 9200, NEG) == (9200.0, None)
    assert wf.resolve_premium("custom", None, NEG)[1]
    assert wf.resolve_premium("decline", None, NEG) == (None, None)


def test_authority_floor():
    assert wf.below_authority(8500, NEG)
    assert not wf.below_authority(9000, NEG)
    assert not wf.below_authority(None, NEG)
    assert not wf.below_authority(1, {"floor_premium": None})


def snap(neg=None, gate=None, run_status="pending_review"):
    return {"negotiation_gate": neg, "review_gate": gate, "run_status": run_status}


def test_broker_counter_moves_case_to_counter_pending():
    status, note = wf.status_from_actuvara(case(wf.QUOTED), snap(
        {"status": "awaiting_underwriter", "awaiting_underwriter": True, "round": 1}))
    assert status == wf.COUNTER_PENDING and note


def test_counter_referral_survives_sync_in_same_round():
    c = case(wf.COUNTER_REFERRED, counter_referral={"round": 2})
    s = snap({"status": "awaiting_underwriter", "awaiting_underwriter": True, "round": 2})
    assert wf.status_from_actuvara(c, s) == (wf.COUNTER_REFERRED, None)


def test_quote_outcomes():
    assert wf.status_from_actuvara(case(wf.ACCEPTED), snap({"status": "awaiting_response"}))[0] == wf.QUOTED
    assert wf.status_from_actuvara(case(wf.QUOTED), snap({"status": "accepted"}))[0] == wf.QUOTE_ACCEPTED
    assert wf.status_from_actuvara(case(wf.QUOTED), snap({"status": "declined"}))[0] == wf.QUOTE_DECLINED


def test_decision_made_inside_actuvara_is_reflected():
    gate = {"decision": "approved", "waiting": False, "status": "completed"}
    assert wf.status_from_actuvara(case(wf.AWAITING_REVIEW), snap(gate=gate))[0] == wf.ACCEPTED
    gate = {"decision": "rejected", "waiting": False, "status": "completed"}
    assert wf.status_from_actuvara(case(wf.REFERRED), snap(gate=gate))[0] == wf.DECLINED


def test_pending_action_is_never_overridden():
    c = {"status": wf.ACCEPTED, "pending_action": {"type": "decision"}}
    assert wf.status_from_actuvara(c, snap(gate={"decision": "rejected", "waiting": False}))[0] == wf.ACCEPTED


def test_waiting_gate_keeps_review_status():
    gate = {"decision": None, "waiting": True, "status": "inprogress"}
    assert wf.status_from_actuvara(case(wf.AWAITING_REVIEW), snap(gate=gate)) == (wf.AWAITING_REVIEW, None)
