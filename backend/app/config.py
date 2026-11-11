from functools import lru_cache
from typing import Dict, List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    cosmos_mongo_uri: str = "mongodb://localhost:27017"
    cosmos_db_name: str = "underwriter_recommendation"

    actuvara_functions_base_url: str = "http://localhost:7071"
    actuvara_partner_key: str = ""
    actuvara_timeout_seconds: float = 30.0

    intake_api_key: str = ""

    auth_mode: str = "dev"  # dev | azure_ad
    aad_tenant_id: str = ""
    aad_client_id: str = ""
    app_jwt_secret: str = "dev-only-secret-change-me"
    app_jwt_ttl_minutes: int = 480
    dev_users: str = ""

    underwriter_role_names: str = "Underwriter"
    senior_underwriter_role_names: str = "Senior Underwriter"

    cors_origins: str = "http://localhost:4210"
    sync_interval_seconds: int = 30

    @staticmethod
    def _names(value: str) -> List[str]:
        return [v.strip().lower() for v in value.split(",") if v.strip()]

    @property
    def underwriter_roles(self) -> List[str]:
        return self._names(self.underwriter_role_names)

    @property
    def senior_roles(self) -> List[str]:
        return self._names(self.senior_underwriter_role_names)

    @property
    def cors_origin_list(self) -> List[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def dev_user_roles(self) -> Dict[str, str]:
        out: Dict[str, str] = {}
        for pair in self.dev_users.split(";"):
            if "=" in pair:
                email, role = pair.split("=", 1)
                out[email.strip().lower()] = role.strip().lower()
        return out


@lru_cache
def get_settings() -> Settings:
    return Settings()
