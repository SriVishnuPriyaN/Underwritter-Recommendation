# Underwriter Recommendation

A separate application where underwriters review Actuvara submissions and make
their decisions. It connects to Actuvara as a third-party integration and keeps
its own database.

- **Backend:** Python (FastAPI) in [backend/](backend/).
- **Frontend:** Angular 21 in [frontend/](frontend/).
- **Database:** a new Azure Cosmos DB for MongoDB database (`underwriter_recommendation`), not Actuvara's.

## What it does

| Who | Where | What they do |
|---|---|---|
| Underwriter | **Needs review** | Sees the submission's documents (viewer), the extracted values with confidence, and the underwriting results (completeness, reconciliation, exposure & loss, rating breakdown). Then chooses **Accept** or **Refer to senior underwriter**. |
| Senior underwriter | **Referrals** | Sees the referral reason, then chooses **Accept** or **Decline**. Can also view every other case, including ones an underwriter accepted. |
| Underwriter | **Counter-offers** | When the broker counters a quote, recommends one of: **hold** at the quoted premium, **match** the broker, a **custom** premium, or **decline**. A premium below their authority floor must be referred to a senior. |
| Senior underwriter | **Counter-offers** | Decides referred counter-offers and may go below the floor. |

Roles come from **Actuvara**. A user needs the domain role `Underwriter` or
`Senior Underwriter` (see `UNDERWRITER_ROLE_NAMES` and
`SENIOR_UNDERWRITER_ROLE_NAMES`). Users without either role can't sign in.

## How it connects to Actuvara

```
Actuvara workflow                                         Underwriter Recommendation app
─────────────────                                         ──────────────────────────────
… → Exposure & Loss → Rating & Pricing
   → API Connector ── POST /api/intake/actuvara {ref_id} ──▶ creates the case
   → Human Approval "Underwriter Review"   (run pauses)       pulls the submission package ◀─ partner API
        ◀── POST partner/…/decision  accept | decline ─────── Accept / senior Accept / senior Decline
   → [approved] Quote Generation → Negotiation (pauses for broker)
        broker counter recorded in Actuvara (step 1) ───────▶ shown under Counter-offers (sync)
        ◀── POST partner/…/negotiation/recommendation ────── underwriter / senior recommendation (step 2)
   → revised quote → Negotiation … → [accepted] Bind
```

- **App to Actuvara:** the app calls Actuvara's partner API
  (`/api/partner/underwriting/*` on the Function App), authenticated with the
  `x-partner-key` header.
- **Actuvara to app:** only the API Connector's intake call. Everything else is
  pulled by the app's sync worker every `SYNC_INTERVAL_SECONDS` seconds, and on
  **Refresh**.
- **Delivering decisions:** a decision is saved in the app first, then sent to
  Actuvara. If Actuvara hasn't reached the waiting step yet, the case shows
  "Sending decision to Actuvara…" and the sync worker keeps retrying.

### Changes made in Actuvara for this

| File | Change |
|---|---|
| `idp-api/inteli-doc-funapp/functions/http_trigger/integrations/partner_underwriting_api.py` | **New.** Partner API: submission package, documents, accept/decline decision, counter-offer recommendation, user roles. |
| `idp-api/inteli-doc-funapp/functions/http_trigger/actions/negotiation_engine.py` | Two-step counter-offers when `underwriter_review` is on (`apply_underwriter_recommendation`). One-step behaviour is unchanged when it's off. |
| `idp-api/inteli-doc-funapp/config/config.py` | `PARTNER_API_KEY` setting. |
| `idp-api/inteli-doc-funapp/functions/__init__.py` | Registers the partner API. |
| `idp-ui/.../node-registry.service.ts` | New Negotiation setting: **Underwriter Review of Counter-offers**. |
| `idp-ui/.../node-status-panel.component.*`, `underwriting-result-card.component.ts` | With underwriter review on, Actuvara's counter-offer form records only the broker's counter, and the screen shows "with the underwriter". |
| `idp-api/inteli-doc-funapp/tests/test_negotiation_underwriter_review.py` | **New.** Tests for the above. |

## Set up the Actuvara process

1. **Function App setting:** `PARTNER_API_KEY=<secret>`. Use the same value as `ACTUVARA_PARTNER_KEY` in the app.
2. **Workflow:** after **Rating & Pricing**, add:
   - **API Connector**
     - Endpoint: `https://<app-backend>/api/intake/actuvara`
     - Method: `POST`
     - Header: `x-intake-key: <INTAKE_API_KEY>`
     - Request body: `{"ref_id": "{{ref_id}}"}`
   - **Human Approval** (label it e.g. *Underwriter Review*)
     - Leave **assignment** off. Approvals with an assignment strategy can only be decided inside Actuvara.
     - Reviewer emails are still required by the node; use the underwriting team mailbox.
     - Approved output → **Quote Generation** → **Negotiation**.
     - Rejected output → your decline path.
   - **Negotiation:** turn on **Underwriter Review of Counter-offers**. Wire its Counter-offer output back to **Quote Generation**, or leave it unwired, which does the same.
     - Don't loop it back through the API Connector. The connector skips repeat calls for the same run, so the app would never be notified.
3. **Roles:** in Actuvara, create the domain roles `Underwriter` and `Senior Underwriter` and assign users to them.

## Run locally

**Backend**

```bash
cd backend
python -m venv .venv
.venv\Scripts\pip install -r requirements-dev.txt
copy .env.example .env      # fill in the values
.venv\Scripts\uvicorn app.main:app --port 8010 --reload
.venv\Scripts\python -m pytest
```

- `COSMOS_MONGO_URI` can point at a local MongoDB for development.
- `AUTH_MODE=dev` gives an email-only sign-in. Roles are still read from Actuvara.
- To work without Actuvara, list test users in `DEV_USERS`, e.g. `uw@x.com=underwriter;sr@x.com=senior_underwriter`.

**Frontend**

```bash
cd frontend
npm install
npm start            # http://localhost:4210
```

The backend URL is set in `frontend/public/config.js` and is read at runtime, so you can change it without rebuilding.

**Microsoft sign-in**

1. Set `AUTH_MODE=azure_ad`, `AAD_TENANT_ID` and `AAD_CLIENT_ID`.
2. In Entra ID, register the frontend origin as a **SPA redirect URI** on that app.

## Backend API (for the frontend)

- **Auth:** `GET /api/auth/config` · `POST /api/auth/dev-login` · `POST /api/auth/exchange` · `GET /api/auth/me`
- **Cases:** `GET /api/stats` · `GET /api/cases?status=&q=` · `GET /api/cases/{id}` · `POST /api/cases/{id}/refresh`
- **Decisions:** `POST /api/cases/{id}/accept` · `/refer` · `/referral/decision` · `/counter/recommendation` · `/counter/refer`
- **Documents:** `GET /api/cases/{id}/documents/{file_id}`
- **Actuvara intake:** `POST /api/intake/actuvara`, with the `x-intake-key` header.

## Limits

- **Single instance.** The sync worker and per-case locks run inside one process. Run one backend instance, or move the sync worker to a separate job before scaling out.
- **Polling, not push.** Counter-offers and quote updates appear within one sync interval (30 s by default), or straight away on **Refresh**.
- **Decisions made inside Actuvara.** If someone approves or rejects the Human Approval step in Actuvara, the app follows on its next sync and records "Accepted / Rejected inside Actuvara".
