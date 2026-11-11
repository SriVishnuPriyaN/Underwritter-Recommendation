"""
Sign-in and roles.

Who a user is comes from Microsoft sign-in (AUTH_MODE=azure_ad) or, for local
development only, a typed email (AUTH_MODE=dev). What they may do comes from
Actuvara: their domain roles are looked up through the partner API and mapped
to the app's two roles —

    underwriter         Actuvara role in UNDERWRITER_ROLE_NAMES
    senior_underwriter  Actuvara role in SENIOR_UNDERWRITER_ROLE_NAMES (wins when both)

The app then issues its own short-lived token carrying email, name and role.
"""
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app import actuvara
from app.config import get_settings

UNDERWRITER = "underwriter"
SENIOR_UNDERWRITER = "senior_underwriter"
ROLES = (UNDERWRITER, SENIOR_UNDERWRITER)

bearer = HTTPBearer(auto_error=False)
_jwks_client: Optional[jwt.PyJWKClient] = None


def map_role(actuvara_role_names: List[str]) -> Optional[str]:
    s = get_settings()
    names = {n.strip().lower() for n in actuvara_role_names if n}
    if names & set(s.senior_roles):
        return SENIOR_UNDERWRITER
    if names & set(s.underwriter_roles):
        return UNDERWRITER
    return None


async def resolve_user(email: str, name: Optional[str] = None) -> Dict[str, Any]:
    """The app user for an authenticated email, or 403 when they hold no underwriting role."""
    s = get_settings()
    email = email.strip().lower()

    if s.auth_mode == "dev" and email in s.dev_user_roles:
        role = s.dev_user_roles[email]
        if role not in ROLES:
            raise HTTPException(500, f"DEV_USERS role for {email} must be one of {', '.join(ROLES)}")
        return {"email": email, "name": name or email, "role": role, "actuvara_roles": ["(DEV_USERS)"]}

    try:
        info = await actuvara.get_user_roles(email)
    except actuvara.ActuvaraError as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            f"Could not read your roles from Actuvara: {e.message}") from e
    if info.get("active") is False:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Your Actuvara account is inactive")
    role_names = [r.get("role_name") for r in info.get("roles") or []]
    role = map_role(role_names)
    if not role:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "You do not have the Underwriter or Senior Underwriter role in Actuvara")
    return {"email": email, "name": name or info.get("name") or email, "role": role,
            "actuvara_roles": sorted({n for n in role_names if n})}


def issue_token(user: Dict[str, Any]) -> str:
    s = get_settings()
    now = datetime.now(timezone.utc)
    claims = {**user, "sub": user["email"], "iat": now, "exp": now + timedelta(minutes=s.app_jwt_ttl_minutes)}
    return jwt.encode(claims, s.app_jwt_secret, algorithm="HS256")


def validate_azure_id_token(token: str) -> Dict[str, Any]:
    """Validate a Microsoft Entra ID token issued to this app's client id."""
    global _jwks_client
    s = get_settings()
    if not s.aad_tenant_id or not s.aad_client_id:
        raise HTTPException(500, "AAD_TENANT_ID and AAD_CLIENT_ID must be set for AUTH_MODE=azure_ad")
    if _jwks_client is None:
        _jwks_client = jwt.PyJWKClient(f"https://login.microsoftonline.com/{s.aad_tenant_id}/discovery/v2.0/keys")
    try:
        key = _jwks_client.get_signing_key_from_jwt(token).key
        return jwt.decode(token, key, algorithms=["RS256"], audience=s.aad_client_id,
                          issuer=f"https://login.microsoftonline.com/{s.aad_tenant_id}/v2.0")
    except jwt.PyJWTError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Microsoft sign-in token rejected: {e}") from e


async def current_user(creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer)) -> Dict[str, Any]:
    if not creds:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in required")
    try:
        claims = jwt.decode(creds.credentials, get_settings().app_jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired — sign in again") from e
    if claims.get("role") not in ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No underwriting role")
    return {k: claims.get(k) for k in ("email", "name", "role", "actuvara_roles")}
