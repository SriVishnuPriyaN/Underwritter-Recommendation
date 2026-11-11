"""
End-to-end flow against an in-memory database and a fake Actuvara partner API:
intake → review → refer → senior accept → quote → broker counter → recommendation.
"""
import asyncio
import copy

import pytest
from fastapi.testclient import TestClient
from mongomock_motor import AsyncMongoMockClient

from app import actuvara, db, service
from app.config import get_settings


class FakeActuvara:
    """Mimics /api/partner/underwriting/* for one run."""

    def __init__(self):
        self.gate = {"node_id": "ha1", "label": "Underwriter Review", "status": "not_started",
                     "waiting": False, "decision": None, "assigned": False}
        self.negotiation = None
        self.calls = []

    def package(self, ref_id):
        return {
            "ref_id": ref_id, "process_name": "Commercial Property", "run_status": "in_progress",
            "insured_name": "ABC Ltd", "broker_emails": ["broker@example.com"],
            "documents": [{"file_id": "f1", "filename": "acord.pdf", "mime_type": "application/pdf",
                           "pages": 4, "is_primary": True}],
            "segments": [{"name": "Applicant", "source_filename": "acord.pdf", "is_list": False,
                          "fields": [{"name": "insured_name", "value": "ABC Ltd", "confidence": 0.95, "page": 1}],
                          "items": []}],
            "underwriting": {"rating": {"status": "rated", "premium": 10000.0},
                             "exposure_loss_analysis": {"risk_category": "medium"}},
            "review_gate": copy.deepcopy(self.gate),
            "negotiation_gate": copy.deepcopy(self.negotiation),
        }

    async def get_submission(self, ref_id):
        return self.package(ref_id)

    async def post_decision(self, ref_id, body):
        self.calls.append(("decision", body))
        if not self.gate["waiting"]:
            raise actuvara.ActuvaraError(409, "not waiting", {"code": "not_waiting", "gate": self.gate})
        self.gate.update(waiting=False, status="completed",
                         decision="approved" if body["decision"] == "accept" else "rejected")
        return {"status": "success"}

    async def post_recommendation(self, ref_id, body):
        self.calls.append(("recommendation", body))
        if (self.negotiation or {}).get("status") != "awaiting_underwriter":
            raise actuvara.ActuvaraError(409, "not waiting", {"code": "not_waiting", "gate": self.negotiation})
        self.negotiation.update(status="counter", awaiting_underwriter=False, pending_counter=None)
        return {"status": "success", "outcome": "counter"}

    async def get_user_roles(self, email):
        names = {"uw@example.com": ["Underwriter"], "senior@example.com": ["Senior Underwriter"]}
        return {"email": email, "name": email.split("@")[0], "active": True,
                "roles": [{"role_name": n} for n in names.get(email, [])]}


@pytest.fixture()
def env(monkeypatch):
    fake = FakeActuvara()
    for name in ("get_submission", "post_decision", "post_recommendation", "get_user_roles"):
        monkeypatch.setattr(actuvara, name, getattr(fake, name))
    mock_client = AsyncMongoMockClient()
    monkeypatch.setattr(db, "get_db", lambda: mock_client["test"])
    monkeypatch.setattr(db, "ensure_indexes", lambda: asyncio.sleep(0))
    s = get_settings()
    monkeypatch.setattr(s, "intake_api_key", "intake")
    monkeypatch.setattr(s, "auth_mode", "dev")
    monkeypatch.setattr(s, "sync_interval_seconds", 3600)
    from app.main import app
    with TestClient(app) as client:
        yield client, fake


def login(client, email):
    r = client.post("/api/auth/dev-login", json={"email": email})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_full_flow(env):
    client, fake = env
    assert client.post("/api/intake/actuvara", json={"ref_id": "R1"}).status_code == 401
    r = client.post("/api/intake/actuvara", json={"ref_id": "R1"}, headers={"x-intake-key": "intake"})
    assert r.status_code == 200
    case_id = r.json()["case_id"]

    uw = login(client, "uw@example.com")
    senior = login(client, "senior@example.com")
    assert client.post("/api/auth/dev-login", json={"email": "nobody@example.com"}).status_code == 403

    d = client.post(f"/api/cases/{case_id}/refresh", headers=uw).json()
    assert d["status"] == "awaiting_review"
    assert d["insured_name"] == "ABC Ltd" and d["submission"]["documents"][0]["file_id"] == "f1"
    assert d["actions"]["accept"] and d["actions"]["refer"]

    # Underwriter refers; only the senior can decide.
    d = client.post(f"/api/cases/{case_id}/refer", json={"reason": "TIV above my authority"}, headers=uw).json()
    assert d["status"] == "referred" and not d["actions"]["referral_decision"]
    assert client.post(f"/api/cases/{case_id}/referral/decision", json={"decision": "accept"},
                       headers=uw).status_code == 409

    # Senior accepts before Actuvara reaches the gate: decision is held and retried.
    d = client.post(f"/api/cases/{case_id}/referral/decision", json={"decision": "accept", "notes": "OK"},
                    headers=senior).json()
    assert d["status"] == "accepted" and d["pending_sync"]["attempts"] == 1

    fake.gate.update(waiting=True, status="inprogress")
    d = client.post(f"/api/cases/{case_id}/refresh", headers=senior).json()
    assert d["pending_sync"] is None and fake.calls[-1][1]["senior_authority"] is True

    # Quote goes to the broker, then the broker counters.
    fake.negotiation = {"status": "awaiting_response", "round": 1, "max_rounds": 3, "quoted_premium": 10000.0,
                        "rated_premium": 10000.0, "max_discount_pct": 10, "floor_premium": 9000.0,
                        "pending_counter": None, "rounds": []}
    assert client.post(f"/api/cases/{case_id}/refresh", headers=uw).json()["status"] == "quoted"
    fake.negotiation.update(status="awaiting_underwriter", awaiting_underwriter=True,
                            pending_counter={"round": 1, "quoted_premium": 10000.0, "counter_premium": 8500.0})
    d = client.post(f"/api/cases/{case_id}/refresh", headers=uw).json()
    assert d["status"] == "counter_pending" and d["negotiation"]["pending_counter"]["counter_premium"] == 8500.0

    # Matching 8,500 is below the underwriter's floor of 9,000.
    r = client.post(f"/api/cases/{case_id}/counter/recommendation", json={"recommendation": "match"}, headers=uw)
    assert r.status_code == 400 and "authority" in r.json()["detail"]

    d = client.post(f"/api/cases/{case_id}/counter/refer", json={"reason": "Broker wants 15% off"}, headers=uw).json()
    assert d["status"] == "counter_referred"
    # A sync in the same round keeps the referral.
    assert client.post(f"/api/cases/{case_id}/refresh", headers=uw).json()["status"] == "counter_referred"

    d = client.post(f"/api/cases/{case_id}/counter/recommendation", json={"recommendation": "match"},
                    headers=senior).json()
    assert d["status"] == "quoted" and d["pending_sync"] is None
    assert fake.calls[-1] == ("recommendation", {"recommendation": "match", "agreed_premium": None, "notes": None,
                                                 "user": "senior@example.com", "senior_authority": True})

    # Broker accepts the revised quote → closed.
    fake.negotiation.update(status="accepted")
    d = client.post(f"/api/cases/{case_id}/refresh", headers=uw).json()
    assert d["status"] == "quote_accepted"
    assert client.get("/api/stats", headers=uw).json()["quote_accepted"] == 1
    types = [h["type"] for h in d["history"]]
    assert types[:3] == ["received", "referred", "referral_accepted"] and "counter_referred" in types


def test_intake_is_idempotent(env):
    client, _fake = env
    a = client.post("/api/intake/actuvara", json={"refId": "R2"}, headers={"x-intake-key": "intake"}).json()
    b = client.post("/api/intake/actuvara", json={"ref_id": "R2"}, headers={"x-intake-key": "intake"}).json()
    assert a["case_id"] == b["case_id"]
