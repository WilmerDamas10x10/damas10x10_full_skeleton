# backend-python/pattern_store.py
# =========================================================
# PASO 8 — Persistencia de patrones en backend (FastAPI)
# Guarda/lee un índice de patrones para que NO dependa del navegador.
# Archivo: backend-python/data/pattern_index.json
# =========================================================

from __future__ import annotations
import json
import os
import threading
import time
from typing import Any, Dict

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
DEFAULT_PATH = os.path.join(DATA_DIR, "pattern_index.json")

_LOCK = threading.Lock()

def _now_ms() -> int:
    return int(time.time() * 1000)

def _ensure_dirs(path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)

def _empty_index() -> Dict[str, Any]:
    return {"v": "v1", "patterns": {}, "_meta": {"updatedAt": _now_ms()}}

def load_index(path: str = DEFAULT_PATH) -> Dict[str, Any]:
    _ensure_dirs(path)
    if not os.path.exists(path):
        return _empty_index()
    try:
        with open(path, "r", encoding="utf-8") as f:
            obj = json.load(f)
        if not isinstance(obj, dict):
            return _empty_index()
        if "patterns" not in obj or not isinstance(obj["patterns"], dict):
            obj["patterns"] = {}
        if "v" not in obj:
            obj["v"] = "v1"
        if "_meta" not in obj or not isinstance(obj["_meta"], dict):
            obj["_meta"] = {}
        return obj
    except Exception:
        return _empty_index()

def save_index(idx: Dict[str, Any], path: str = DEFAULT_PATH) -> None:
    _ensure_dirs(path)
    idx = idx if isinstance(idx, dict) else _empty_index()
    if "patterns" not in idx or not isinstance(idx["patterns"], dict):
        idx["patterns"] = {}
    if "v" not in idx:
        idx["v"] = "v1"
    meta = idx.get("_meta") if isinstance(idx.get("_meta"), dict) else {}
    meta["updatedAt"] = _now_ms()
    idx["_meta"] = meta

    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(idx, f, ensure_ascii=False)
    os.replace(tmp, path)

def merge_indexes(a: Dict[str, Any], b: Dict[str, Any]) -> Dict[str, Any]:
    """
    Merge simple:
    - Une patrones por clave.
    - Suma n, suma moveCounts, lastTs = max
    """
    out = _empty_index()
    pa = (a or {}).get("patterns") or {}
    pb = (b or {}).get("patterns") or {}

    # Copia A
    for k, node in pa.items():
        out["patterns"][k] = _clone_node(node)

    # Merge B
    for k, nodeB in pb.items():
        nodeA = out["patterns"].get(k)
        if not nodeA:
            out["patterns"][k] = _clone_node(nodeB)
            continue

        nodeA["n"] = int(nodeA.get("n") or 0) + int(nodeB.get("n") or 0)
        nodeA["lastTs"] = max(int(nodeA.get("lastTs") or 0), int(nodeB.get("lastTs") or 0))

        mcA = nodeA.get("moveCounts") if isinstance(nodeA.get("moveCounts"), dict) else {}
        mcB = nodeB.get("moveCounts") if isinstance(nodeB.get("moveCounts"), dict) else {}
        for mv, cnt in mcB.items():
            mcA[mv] = int(mcA.get(mv) or 0) + int(cnt or 0)
        nodeA["moveCounts"] = mcA

    return out

def _clone_node(node: Any) -> Dict[str, Any]:
    node = node if isinstance(node, dict) else {}
    mc = node.get("moveCounts") if isinstance(node.get("moveCounts"), dict) else {}
    return {
        "n": int(node.get("n") or 0),
        "lastTs": int(node.get("lastTs") or 0),
        "moveCounts": {str(k): int(v or 0) for k, v in mc.items()},
    }

def get_index_threadsafe(path: str = DEFAULT_PATH) -> Dict[str, Any]:
    with _LOCK:
        return load_index(path)

def sync_index_threadsafe(payload_index: Dict[str, Any], merge: bool = True, path: str = DEFAULT_PATH) -> Dict[str, Any]:
    with _LOCK:
        current = load_index(path)
        if merge:
            merged = merge_indexes(current, payload_index)
            save_index(merged, path)
            return merged
        else:
            save_index(payload_index, path)
            return payload_index
