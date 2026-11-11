"""
Database: Azure Cosmos DB for MongoDB (the app's own database — never Actuvara's).

Collections
  cases         one document per Actuvara submission (keyed by ref_id)
  audit_events  every action taken on a case, in order
"""
import logging
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.config import get_settings

logger = logging.getLogger(__name__)

_client: Optional[AsyncIOMotorClient] = None


def get_db() -> AsyncIOMotorDatabase:
    global _client
    settings = get_settings()
    if _client is None:
        _client = AsyncIOMotorClient(settings.cosmos_mongo_uri, tz_aware=True)
    return _client[settings.cosmos_db_name]


def cases():
    return get_db()["cases"]


def audit_events():
    return get_db()["audit_events"]


async def ensure_indexes() -> None:
    """Best-effort: Cosmos DB only builds a unique index on an empty collection."""
    try:
        await cases().create_index("ref_id", unique=True)
        await cases().create_index("status")
        await cases().create_index("updated_at")
        await audit_events().create_index("case_id")
    except Exception as e:  # pragma: no cover - depends on the server
        logger.warning(f"Index creation skipped: {e}")


def close() -> None:
    global _client
    if _client is not None:
        _client.close()
        _client = None
