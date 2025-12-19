# backend-python/routes/patterns.py
# =========================================================
# PASO 8 — Endpoints para patrones persistentes
# GET  /ai/patterns/index
# POST /ai/patterns/sync   { merge: bool, index: {...} }
# =========================================================

from __future__ import annotations
from fastapi import APIRouter
from pydantic import BaseModel, Field
from typing import Any, Dict, Optional

from ..pattern_store import get_index_threadsafe, sync_index_threadsafe

router = APIRouter()

class SyncReq(BaseModel):
    merge: bool = True
    index: Dict[str, Any] = Field(default_factory=dict)

@router.get("/ai/patterns/index")
def get_index():
    return get_index_threadsafe()

@router.post("/ai/patterns/sync")
def sync(req: SyncReq):
    merged = sync_index_threadsafe(req.index, merge=req.merge)
    return {
        "ok": True,
        "merge": req.merge,
        "patternsCount": len((merged or {}).get("patterns") or {}),
        "v": (merged or {}).get("v", "v1"),
        "updatedAt": (merged or {}).get("_meta", {}).get("updatedAt"),
    }
