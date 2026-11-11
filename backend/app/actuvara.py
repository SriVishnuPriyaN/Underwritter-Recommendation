"""Client for Actuvara's partner API (/api/partner/underwriting/*)."""
from typing import Any, Dict, Optional, Tuple

import httpx

from app.config import get_settings

PREFIX = "/api/partner/underwriting"


class ActuvaraError(Exception):
    def __init__(self, status_code: int, message: str, payload: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        self.payload = payload or {}

    @property
    def code(self) -> Optional[str]:
        return self.payload.get("code")


def _client() -> httpx.AsyncClient:
    s = get_settings()
    return httpx.AsyncClient(
        base_url=s.actuvara_functions_base_url.rstrip("/"),
        headers={"x-partner-key": s.actuvara_partner_key},
        timeout=s.actuvara_timeout_seconds,
    )


def _raise_for(resp: httpx.Response) -> None:
    if resp.status_code < 300:
        return
    try:
        payload = resp.json()
    except ValueError:
        payload = {}
    message = payload.get("error") if isinstance(payload, dict) else None
    raise ActuvaraError(resp.status_code, message or f"Actuvara returned HTTP {resp.status_code}",
                        payload if isinstance(payload, dict) else {})


async def _request(method: str, path: str, **kwargs) -> httpx.Response:
    try:
        async with _client() as client:
            resp = await client.request(method, PREFIX + path, **kwargs)
    except httpx.HTTPError as e:
        raise ActuvaraError(503, f"Actuvara is unreachable: {e.__class__.__name__}") from e
    _raise_for(resp)
    return resp


async def get_submission(ref_id: str) -> Dict[str, Any]:
    return (await _request("GET", f"/submissions/{ref_id}")).json()


async def get_document(ref_id: str, file_id: str) -> Tuple[bytes, str, Optional[str]]:
    resp = await _request("GET", f"/submissions/{ref_id}/documents/{file_id}")
    return (resp.content, resp.headers.get("content-type", "application/octet-stream"),
            resp.headers.get("content-disposition"))


async def post_decision(ref_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
    return (await _request("POST", f"/submissions/{ref_id}/decision", json=body)).json()


async def post_recommendation(ref_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
    return (await _request("POST", f"/submissions/{ref_id}/negotiation/recommendation", json=body)).json()


async def get_user_roles(email: str) -> Dict[str, Any]:
    return (await _request("GET", "/users/roles", params={"email": email})).json()
