# main.py
from fastapi import FastAPI, HTTPException, Body
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, validator, root_validator
from typing import Optional, List, Any, Dict
from uuid import uuid4
from pathlib import Path
import json
import time
import os
import inspect
import traceback

import smtplib
from email.mime.text import MIMEText

# Motor IA (minimax + experiencia)
from ai_engine import (
    choose_best_move,
    board_to_key,
    get_learned_move_by_key,
)

from routes.patterns import router as patterns_router

# =========================
# CONFIG DEBUG
# =========================
DEBUG_AI = True  # pon False cuando ya funcione


def dprint(*args):
    if DEBUG_AI:
        print(*args)


app = FastAPI(
    title="Backend Damas10x10",
    description="API de usuarios para Damas10x10 (versión inicial)",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # luego afinamos esto; por ahora es para desarrollo
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(patterns_router)


# -------------------------------------------------------------------
# "Base de datos" simple: archivo JSON
# -------------------------------------------------------------------
USERS_FILE = Path("users.json")

# -------------------------------------------------------------------
# ✅ Ruta ABSOLUTA donde guardaremos los logs de jugadas de IA
# -------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

AI_MOVES_LOG = DATA_DIR / "ai_moves.jsonl"

# -------------------------------------------------------------------
# ✅ TEACH: overrides persistentes (enseñar a la IA)
# -------------------------------------------------------------------
AI_TEACH_OVERRIDES = DATA_DIR / "ai_teach_overrides.json"
AI_TEACH_LOG = DATA_DIR / "ai_teach_log.jsonl"

def _load_json_file(path: Path, default):
    try:
        if not path.exists():
            return default
        text = path.read_text(encoding="utf-8").strip()
        if not text:
            return default
        return json.loads(text)
    except Exception:
        return default

def _atomic_save_json(path: Path, obj: Any) -> None:
    """
    Guardado atómico para evitar archivos corruptos si se corta el proceso.
    """
    try:
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(path)
    except Exception:
        # fallback best-effort
        path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")

# Estructura:
# OVERRIDES_BY_K = { "<k>": { "move": "c3-d4", "ts": 123, "count": 2, "note": "" } }
OVERRIDES_BY_K: Dict[str, Dict[str, Any]] = _load_json_file(AI_TEACH_OVERRIDES, default={})

def _teach_log_append(row: Dict[str, Any]) -> None:
    try:
        row["ts"] = int(row.get("ts") or time.time() * 1000)
        AI_TEACH_LOG.parent.mkdir(parents=True, exist_ok=True)
        with AI_TEACH_LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    except Exception:
        pass


# -------------------------------------------------------------------
# Configuración de correo (SMTP) - (si no lo usas, no afecta)
# -------------------------------------------------------------------
SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587
SMTP_USER = "TU_CORREO_GMAIL@gmail.com"          # <-- CAMBIAR
SMTP_PASSWORD = "TU_CONTRASENA_DE_APLICACION"    # <-- CAMBIAR
SENDER_NAME = "Reino de las Damas"
SENDER_EMAIL = SMTP_USER


def send_email(to_email: str, subject: str, body: str) -> None:
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = f"{SENDER_NAME} <{SENDER_EMAIL}>"
    msg["To"] = to_email
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
        server.starttls()
        server.login(SMTP_USER, SMTP_PASSWORD)
        server.send_message(msg)


# -------------------------------------------------------------------
# Modelos Pydantic (Usuarios)
# -------------------------------------------------------------------
class UserBase(BaseModel):
    name: str
    city: Optional[str] = None
    province: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    profile_photo_url: Optional[str] = None

    @validator("phone")
    def normalize_phone(cls, v):
        if v is None:
            return v
        v = v.strip()
        if v == "":
            return None
        if v and not any(ch.isdigit() for ch in v):
            raise ValueError("El teléfono debe contener al menos un dígito")
        return v

    @root_validator(skip_on_failure=True)
    def at_least_email_or_phone(cls, values):
        email = values.get("email")
        phone = values.get("phone")

        if isinstance(email, str):
            email = email.strip() or None
        if isinstance(phone, str):
            phone = phone.strip() or None

        if not email and not phone:
            raise ValueError("Debes ingresar email o teléfono (al menos uno)")

        values["email"] = email
        values["phone"] = phone
        return values


class UserCreate(UserBase):
    password: str


class UserPublic(UserBase):
    id: str


class UserInDB(UserBase):
    id: str
    password_hash: str


# -------------------------------------------------------------------
# Modelos para IA
# -------------------------------------------------------------------
class AIMoveRequest(BaseModel):
    """
    Petición de jugada IA.

    Compatible:
    - {fen: ..., side: "R"/"N"}     (legacy)
    - {board: ..., side_to_move: "R"/"N"}
    """
    fen: Optional[Any] = None
    board: Optional[Any] = None
    side: Optional[str] = None
    side_to_move: Optional[str] = None

    @root_validator(pre=True)
    def _normalize(cls, values):
        if not isinstance(values, dict):
            return values

        # si mandan board, duplicamos a fen para compat
        if "fen" not in values and "board" in values:
            values["fen"] = values.get("board")

        # side alias
        if "side" not in values:
            for k in ("side_to_move", "sideToMove", "turn", "color", "lado"):
                if k in values:
                    values["side"] = values.get(k)
                    break
        return values


class AIMoveResponse(BaseModel):
    ok: bool = True
    move: str
    reason: Optional[str] = None
    meta: Optional[Dict[str, Any]] = None


# ==========================
# ✅ DEBUG KEY: Schema + Endpoint Swagger
# ==========================
class AIDebugKeyRequest(BaseModel):
    board: List[List[Optional[str]]]  # 10x10 con 'r','n','R','N' o None
    side: str                         # "R" o "N"


# -------------------------------------------------------------------
# ✅ TEACH: request/response (enseñar jugada correcta)
# -------------------------------------------------------------------
class AITeachRequest(BaseModel):
    """
    Enseñar una jugada correcta para una posición específica.
    Compatible con:
      - {fen: board10x10, side: "R"/"N", correct_move: "c3-d4"}
      - {board: board10x10, side_to_move: ..., correctMove: ...} etc.
    """
    fen: Optional[Any] = None
    board: Optional[Any] = None
    side: Optional[str] = None
    side_to_move: Optional[str] = None

    correct_move: Optional[str] = None
    correctMove: Optional[str] = None  # alias por si llega así

    note: Optional[str] = None
    ts: Optional[int] = None

    @root_validator(pre=True)
    def _normalize(cls, values):
        if not isinstance(values, dict):
            return values

        # board/fen compat
        if "fen" not in values and "board" in values:
            values["fen"] = values.get("board")

        # side alias
        if "side" not in values:
            for k in ("side_to_move", "sideToMove", "turn", "color", "lado"):
                if k in values:
                    values["side"] = values.get(k)
                    break

        # correct_move alias
        if "correct_move" not in values and "correctMove" in values:
            values["correct_move"] = values.get("correctMove")

        return values


class AITeachResponse(BaseModel):
    ok: bool = True
    stored: bool = True
    move: str
    k: str
    side: str
    count: int
    reason: Optional[str] = None


# -------------------------------------------------------------------
# Utilidades usuarios
# -------------------------------------------------------------------
def fake_hash_password(password: str) -> str:
    return "fakehashed_" + password


def load_users() -> List[UserInDB]:
    if not USERS_FILE.exists():
        return []
    text = USERS_FILE.read_text(encoding="utf-8").strip()
    if not text:
        return []
    data = json.loads(text)
    return [UserInDB(**item) for item in data]


def save_users(users: List[UserInDB]) -> None:
    data = [u.dict() for u in users]
    USERS_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def user_to_public(u: UserInDB) -> UserPublic:
    return UserPublic(
        id=u.id,
        name=u.name,
        city=u.city,
        province=u.province,
        email=u.email,
        phone=u.phone,
        profile_photo_url=u.profile_photo_url,
    )


# -------------------------------------------------------------------
# Health
# -------------------------------------------------------------------
@app.get("/health")
def health():
    return {"status": "ok", "message": "Backend Damas10x10 funcionando"}


@app.get("/ai")
def ai_root():
    return {"ok": True, "hint": "Use POST /ai/move, POST /ai/train, POST /ai/log-moves, POST /ai/teach"}


# -------------------------------------------------------------------
# Helpers: payload logs
# -------------------------------------------------------------------
def _normalize_log_payload(payload: Any) -> List[dict]:
    if payload is None:
        return []
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for k in ("entries", "moves", "data", "logs", "items"):
            v = payload.get(k)
            if isinstance(v, list):
                return v
        return [payload]
    return []


def _safe_stat_size(p: Path) -> int:
    try:
        return p.stat().st_size
    except Exception:
        return 0


def _append_jsonl_line(path: Path, row: Dict[str, Any]) -> None:
    """
    ✅ Append seguro a JSONL:
    - crea data/ si no existe
    - escribe 1 línea JSON (UTF-8)
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


# -------------------------------------------------------------------
# ✅ LIMPIEZA/Canonización 10×10 (CRÍTICO)
# -------------------------------------------------------------------
_ALLOWED = {"r", "n", "R", "N"}


def _try_json_load_if_str(x: Any) -> Any:
    if isinstance(x, str):
        s = x.strip()
        if s.startswith("[") and s.endswith("]"):
            try:
                return json.loads(s)
            except Exception:
                return None
    return x


def _clean_cell(cell: Any) -> Any:
    if cell is None:
        return None
    if isinstance(cell, dict):
        return None
    if isinstance(cell, (list, tuple)):
        return None
    if isinstance(cell, str):
        s = cell.strip()
        if s in _ALLOWED:
            return s
        if s.lower() in ("null", "none", ""):
            return None
        return None
    return None


def _normalize_board_10x10(x: Any) -> Optional[List[List[Any]]]:
    x = _try_json_load_if_str(x)
    if not isinstance(x, list) or len(x) != 10:
        return None
    out: List[List[Any]] = []
    for r in range(10):
        row = x[r]
        if not isinstance(row, list) or len(row) != 10:
            return None
        out_row = [_clean_cell(row[c]) for c in range(10)]
        out.append(out_row)
    return out


def _canon_board_key_json(board_10: List[List[Any]]) -> str:
    # Legacy: JSON compactado del board (lo mantenemos para compat)
    return json.dumps(board_10, ensure_ascii=False, separators=(",", ":"))


def _normalize_side(side_raw: Any) -> str:
    s = str(side_raw or "R").strip().upper()
    if s in ("ROJO", "R", "WHITE", "W", "BLANCO", "BLANCAS"):
        return "R"
    if s in ("NEGRO", "N", "BLACK", "B", "NEGRAS"):
        return "N"
    return "R" if s.startswith("R") else "N"


# -------------------------------------------------------------------
# Stats de log
# -------------------------------------------------------------------
@app.get("/ai/log-stats")
def ai_log_stats():
    try:
        abs_path = AI_MOVES_LOG.resolve()
        exists = AI_MOVES_LOG.exists()
        size = _safe_stat_size(AI_MOVES_LOG) if exists else 0
        return {
            "cwd": os.getcwd(),
            "file": str(AI_MOVES_LOG),
            "abs": str(abs_path),
            "exists": exists,
            "bytes": size
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"log-stats error: {repr(e)}")


# -------------------------------------------------------------------
# ✅ DEBUG: KEY CANÓNICA + lookup directo
# -------------------------------------------------------------------
@app.post("/ai/debug-key")
def ai_debug_key(req: AIDebugKeyRequest) -> Any:
    side = _normalize_side(req.side)

    board_10 = _normalize_board_10x10(req.board)
    if board_10 is None:
        return JSONResponse(
            status_code=200,
            content={"ok": False, "error": "invalid_board", "detail": "Se esperaba board 10x10 (lista de listas)."},
        )

    try:
        k = board_to_key(board_10, side)
    except Exception as e:
        return JSONResponse(
            status_code=200,
            content={"ok": False, "error": f"no se pudo generar key: {repr(e)}"},
        )

    learned = None
    try:
        learned = get_learned_move_by_key(k, max_lines=6000)
    except Exception:
        learned = None

    teach = OVERRIDES_BY_K.get(k)

    return {
        "ok": True,
        "side": side,
        "k": k,
        "learnedMove": learned,
        "teachOverride": teach.get("move") if isinstance(teach, dict) else None,
    }


# -------------------------------------------------------------------
# ✅ TEACH endpoint: /ai/teach
# -------------------------------------------------------------------
@app.post("/ai/teach", response_model=AITeachResponse)
def ai_teach(req: AITeachRequest):
    side = _normalize_side(req.side or req.side_to_move or "R")

    board_raw = req.board if req.board is not None else req.fen
    board_10 = _normalize_board_10x10(board_raw)
    if board_10 is None:
        return JSONResponse(
            status_code=200,
            content={
                "ok": False,
                "stored": False,
                "move": "",
                "k": "",
                "side": side,
                "count": 0,
                "reason": "invalid_board",
                "detail": "Board inválido: se esperaba lista 10x10 (o string JSON de lista 10x10).",
            },
        )

    move = (req.correct_move or "").strip()
    if not move:
        return JSONResponse(
            status_code=200,
            content={
                "ok": False,
                "stored": False,
                "move": "",
                "k": "",
                "side": side,
                "count": 0,
                "reason": "missing_correct_move",
                "detail": "Falta correct_move (ej: 'c3-d4').",
            },
        )

    try:
        k = board_to_key(board_10, side)
    except Exception as e:
        return JSONResponse(
            status_code=200,
            content={
                "ok": False,
                "stored": False,
                "move": "",
                "k": "",
                "side": side,
                "count": 0,
                "reason": f"key_error: {repr(e)}",
            },
        )

    prev = OVERRIDES_BY_K.get(k) if isinstance(OVERRIDES_BY_K, dict) else None
    prev_count = int(prev.get("count", 0)) if isinstance(prev, dict) else 0
    count = prev_count + 1

    OVERRIDES_BY_K[k] = {
        "move": move,
        "ts": int(req.ts or time.time() * 1000),
        "count": count,
        "note": (req.note or "").strip()[:240],
    }
    _atomic_save_json(AI_TEACH_OVERRIDES, OVERRIDES_BY_K)

    _teach_log_append({
        "t": "teach",
        "k": k,
        "side": side,
        "move": move,
        "note": req.note,
        "count": count,
        "ts": req.ts,
    })

    dprint(f"[AI.TEACH] stored override k(len={len(k)}) side={side} move={move} count={count}")

    return AITeachResponse(
        ok=True,
        stored=True,
        move=move,
        k=k,
        side=side,
        count=count,
        reason="stored_override",
    )


# -------------------------------------------------------------------
# Guardar logs (guardamos 'k' REAL + legacy)
# -------------------------------------------------------------------
def _append_moves_to_jsonl(entries_raw: List[Any]) -> Dict[str, Any]:
    if not entries_raw:
        return {
            "status": "ok",
            "saved": 0,
            "skipped": 0,
            "bytes": _safe_stat_size(AI_MOVES_LOG) if AI_MOVES_LOG.exists() else 0,
            "file": str(AI_MOVES_LOG),
            "abs": str(AI_MOVES_LOG.resolve()),
            "reason": "empty",
        }

    saved = 0
    skipped = 0

    for item in entries_raw:
        if not isinstance(item, dict):
            skipped += 1
            continue

        board_raw = item.get("board", None)
        if board_raw is None:
            board_raw = item.get("fen", None)

        board_10 = _normalize_board_10x10(board_raw)
        if board_10 is None:
            skipped += 1
            continue

        move = item.get("move", None)
        if move is None or (isinstance(move, str) and not move.strip()):
            skipped += 1
            continue

        ts = item.get("ts", None)
        score = item.get("score", 0)
        side = _normalize_side(item.get("side", None))

        try:
            ts = int(ts) if ts is not None else int(time.time() * 1000)
        except Exception:
            ts = int(time.time() * 1000)

        try:
            score = float(score) if score is not None else 0.0
        except Exception:
            score = 0.0

        k = board_to_key(board_10, side)
        legacy_json = _canon_board_key_json(board_10)

        row = {
            "ts": ts,
            "k": k,  # ✅ CLAVE OFICIAL PARA MATCH
            "move": str(move).strip(),
            "score": score,
            "side": side,
            "fen": legacy_json,  # compat
            "key": legacy_json,  # compat
        }

        _append_jsonl_line(AI_MOVES_LOG, row)
        saved += 1

    return {
        "status": "ok",
        "saved": saved,
        "skipped": skipped,
        "bytes": _safe_stat_size(AI_MOVES_LOG),
        "file": str(AI_MOVES_LOG),
        "abs": str(AI_MOVES_LOG.resolve()),
    }


# -------------------------------------------------------------------
# ✅ ENDPOINT ÚNICO /ai/log-moves + alias /ai/train
# -------------------------------------------------------------------
@app.post("/ai/log-moves")
def ai_log_moves(payload: Any = Body(...)):
    try:
        entries_raw = _normalize_log_payload(payload)
        return _append_moves_to_jsonl(entries_raw)
    except Exception as e:
        print("[AI-LOG] Error guardando logs:", repr(e))
        print(traceback.format_exc())
        return JSONResponse(
            status_code=500,
            content={"ok": False, "where": "/ai/log-moves", "error": repr(e)},
        )


@app.post("/ai/train")
def ai_train(batch: Any = Body(...)):
    """
    Trainer del frontend te está pegando aquí.
    Lo dejamos como alias de guardado de logs para que NO reviente.
    """
    try:
        moves_raw = _normalize_log_payload(batch)
        return _append_moves_to_jsonl(moves_raw)
    except Exception as e:
        print("[AI-TRAIN] Error:", repr(e))
        print(traceback.format_exc())
        return JSONResponse(
            status_code=500,
            content={"ok": False, "where": "/ai/train", "error": repr(e)},
        )


# -------------------------------------------------------------------
# /ai/move — ✅ ahora usa:
# 1) TEACH override inmediato
# 2) choose_best_move con experiencia completa
# -------------------------------------------------------------------
@app.post("/ai/move", response_model=AIMoveResponse)
def ai_move(req: AIMoveRequest):
    side = _normalize_side(req.side or req.side_to_move or "R")
    dprint(f"[AI.DEBUG] /ai/move side_norm={side!r}")

    board_raw = req.board if req.board is not None else req.fen
    dprint(f"[AI.DEBUG] /ai/move board_raw type={type(board_raw).__name__}")

    board_10 = _normalize_board_10x10(board_raw)
    if board_10 is None:
        dprint("[AI.DEBUG] invalid_board: board inválido o no 10x10. head:", str(board_raw)[:180])
        return JSONResponse(
            status_code=200,
            content={
                "ok": False,
                "move": "",
                "reason": "invalid_board",
                "detail": "Board inválido: se esperaba lista 10x10 (o string JSON de lista 10x10).",
            },
        )

    # key canónica (solo meta/debug)
    k = board_to_key(board_10, side)
    dprint("[AI.DEBUG] key(k) len=", len(k))

    # ✅ DEBUG EXTREMO: imprimir key completa y base_key
    try:
        base_k = k.split("|side:")[0] if "|side:" in k else k
    except Exception:
        base_k = k

    dprint("[AI.DEBUG] k FULL =", k)
    dprint("[AI.DEBUG] base_k =", base_k)

    # ---------------------------------------------------------
    # ✅ 1) TEACH OVERRIDE (prioridad máxima)
    # ---------------------------------------------------------
    try:
        override = OVERRIDES_BY_K.get(k) if isinstance(OVERRIDES_BY_K, dict) else None
        if isinstance(override, dict):
            om = str(override.get("move", "")).strip()
            if om:
                dprint(f"[AI.TEACH] override HIT -> {om}")
                return AIMoveResponse(
                    ok=True,
                    move=om,
                    reason="teach_override",
                    meta={"side": side, "k": k, "base_k": base_k, "source": "teach_override"},
                )
    except Exception as e:
        dprint("[AI.TEACH] override check error:", repr(e))

    # ---------------------------------------------------------
    # ✅ 2) EXPERIENCIA + MINIMAX (tu flujo actual)
    # ---------------------------------------------------------
    try:
        move_str = choose_best_move(
            board_10,
            side,
            depth=4,
            fen=None,
            use_learned=True,         # ✅ activar experiencia
            learned_max_lines=6000,
        )
    except Exception as e:
        dprint("[AI.DEBUG] choose_best_move ERROR:", repr(e))
        move_str = None

    if not move_str or not isinstance(move_str, str) or not move_str.strip():
        return JSONResponse(
            status_code=200,
            content={
                "ok": False,
                "move": "",
                "reason": "no_legal_move",
                "detail": "La IA no encontró jugada legal (ni por experiencia ni por minimax).",
            },
        )

    return AIMoveResponse(
        ok=True,
        move=move_str.strip(),
        reason="choose_best_move",
        meta={"side": side, "k": k, "base_k": base_k},
    )
