# main.py
from fastapi import FastAPI, HTTPException, Body
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, validator, root_validator
from typing import Optional, List, Any, Dict
from uuid import uuid4
from pathlib import Path
import json
import re
import time
import os
import inspect

import smtplib
from email.mime.text import MIMEText

# Motor fuerte (minimax u otro) definido en ai_engine.py
from ai_engine import choose_best_move


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

# -------------------------------------------------------------------
# "Base de datos" simple: archivo JSON
# -------------------------------------------------------------------
USERS_FILE = Path("users.json")

# -------------------------------------------------------------------
# ✅ Ruta ABSOLUTA donde guardaremos los logs de jugadas de IA
# -------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
AI_MOVES_LOG = DATA_DIR / "ai_moves.jsonl"

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
    - {fen: ..., side: "R"/"N"}
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
    return {"ok": True, "hint": "Use POST /ai/move, POST /ai/train, POST /ai/log-moves"}


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


def _canon_board_key(board_10: List[List[Any]]) -> str:
    return json.dumps(board_10, ensure_ascii=False, separators=(",", ":"))


def _normalize_side(side_raw: Any) -> str:
    s = str(side_raw or "R").strip().upper()
    if s in ("ROJO", "R", "WHITE", "W", "BLANCO", "BLANCAS"):
        return "R"
    if s in ("NEGRO", "N", "BLACK", "B", "NEGRAS"):
        return "N"
    return "R" if s.startswith("R") else "N"


def _canon_key_any(x: Any) -> Optional[str]:
    if x is None:
        return None
    if isinstance(x, list):
        b = _normalize_board_10x10(x)
        if b is None:
            return None
        return _canon_board_key(b)
    if isinstance(x, str):
        s = x.strip()
        if s.startswith("[") and s.endswith("]"):
            try:
                tmp = json.loads(s)
            except Exception:
                return None
            b = _normalize_board_10x10(tmp)
            if b is None:
                return None
            return _canon_board_key(b)
        return None
    return None


def _append_jsonl_line(path: Path, row: dict) -> None:
    line = json.dumps(row, ensure_ascii=False)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8", newline="\n") as f:
        f.write(line + "\n")
        f.flush()
        os.fsync(f.fileno())


# -------------------------------------------------------------------
# Stats de log
# -------------------------------------------------------------------
@app.get("/ai/log-stats")
def ai_log_stats():
    try:
        abs_path = AI_MOVES_LOG.resolve()
        exists = AI_MOVES_LOG.exists()
        size = _safe_stat_size(AI_MOVES_LOG) if exists else 0
        return {"cwd": os.getcwd(), "file": str(AI_MOVES_LOG), "abs": str(abs_path), "exists": exists, "bytes": size}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"log-stats error: {repr(e)}")


# -------------------------------------------------------------------
# Guardar logs
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

        key = _canon_board_key(board_10)
        row = {"ts": ts, "fen": key, "key": key, "move": str(move).strip(), "score": score, "side": side}
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


@app.post("/ai/log-moves")
def ai_log_moves(payload: Any = Body(...)):
    try:
        entries_raw = _normalize_log_payload(payload)
        return _append_moves_to_jsonl(entries_raw)
    except Exception as e:
        print("[AI-LOG] Error guardando logs:", repr(e))
        raise HTTPException(status_code=500, detail="Error guardando logs de IA (ver consola backend)")


@app.post("/ai/train")
def ai_train(batch: Any = Body(...)):
    try:
        moves_raw = _normalize_log_payload(batch)
        return _append_moves_to_jsonl(moves_raw)
    except Exception as e:
        print("[AI-TRAIN] Error:", repr(e))
        raise HTTPException(status_code=500, detail="Error en /ai/train (ver consola backend)")


# -------------------------------------------------------------------
# Adaptador choose_best_move
# -------------------------------------------------------------------
def _choose_best_move_safe(board_obj: Any, side: str, level: int = 3):
    try:
        sig = inspect.signature(choose_best_move)
        params = set(sig.parameters.keys())
    except Exception:
        params = set()

    for name in ("side_to_move", "to_move", "turn", "color", "player", "side"):
        if name in params:
            try:
                if "level" in params:
                    return choose_best_move(board_obj, **{name: side}, level=level)
                return choose_best_move(board_obj, **{name: side})
            except TypeError:
                break

    try:
        return choose_best_move(board_obj, side, level=level)
    except TypeError:
        return choose_best_move(board_obj, side)


# -------------------------------------------------------------------
# /ai/move — experiencia (match por key canon) + fallback
# -------------------------------------------------------------------
@app.post("/ai/move", response_model=AIMoveResponse)
def ai_move(req: AIMoveRequest):
    side = _normalize_side(req.side or req.side_to_move or "R")
    dprint(f"[AI.DEBUG] /ai/move side_norm={side!r}")

    board_raw = req.board if req.board is not None else req.fen
    dprint(f"[AI.DEBUG] /ai/move board_raw type={type(board_raw).__name__}")

    board_10 = _normalize_board_10x10(board_raw)
    if board_10 is None:
        dprint("[AI.DEBUG] invalid_board: board inválido o no 10x10. Ejemplo head:", str(board_raw)[:180])
        return JSONResponse(
            status_code=200,
            content={
                "ok": False,
                "move": "",
                "reason": "invalid_board",
                "detail": "Board inválido: se esperaba lista 10x10 (o string JSON de lista 10x10).",
            },
        )

    key = _canon_board_key(board_10)
    dprint("[AI.DEBUG] key(len)=", len(key))

    # 1) experiencia exacta por key + side
    def normalize_move_to_algebra(move_val: Any) -> Optional[str]:
        if move_val is None:
            return None
        if isinstance(move_val, str):
            s2 = move_val.strip().lower()
            if re.match(r"^[a-j]\d{1,2}(-[a-j]\d{1,2})+$", s2):
                return s2
        return None

    def find_experience_move_exact(key_local: str, side_local: str, max_scan: int = 6000) -> Optional[Dict[str, Any]]:
        try:
            if not AI_MOVES_LOG.exists():
                dprint("[AI.DEBUG] experience: log no existe:", AI_MOVES_LOG)
                return None

            lines = AI_MOVES_LOG.read_text(encoding="utf-8", errors="ignore").splitlines()
            dprint(f"[AI.DEBUG] experience: total_lines={len(lines)} scan_last={min(max_scan, len(lines))}")

            for line in reversed(lines[-max_scan:]):
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except Exception:
                    continue

                # ✅ CANONIZAR row_key venga como string o lista
                row_key = _canon_key_any(row.get("key")) or _canon_key_any(row.get("fen"))
                if not row_key or row_key != key_local:
                    continue

                row_side = _normalize_side(row.get("side") or side_local)
                if row_side != side_local:
                    continue

                mv = normalize_move_to_algebra(row.get("move"))
                if mv:
                    dprint("[AI.DEBUG] experience HIT ✅", mv)
                    return {"move": mv, "row": row}

            dprint("[AI.DEBUG] experience MISS ❌")
            return None
        except Exception as e:
            dprint("[AI.DEBUG] experience ERROR:", repr(e))
            return None

    exp = find_experience_move_exact(key, side)
    if exp:
        return AIMoveResponse(
            ok=True,
            move=exp["move"],
            reason="experiencia_exacta",
            meta={"source": "ai_moves.jsonl", "ts": exp["row"].get("ts"), "side": side},
        )

    # 2) fallback minimax
    try:
        dprint("[AI.DEBUG] fallback minimax (sin experiencia)")
        move_str = _choose_best_move_safe(board_10, side=side, level=3)

        # Si no hay jugada con side actual, probamos el lado contrario
        if not move_str or not isinstance(move_str, str) or not move_str.strip():
            other = "N" if side == "R" else "R"
            dprint(f"[AI.DEBUG] minimax no encontró jugada con side={side}. Reintentando con side={other}...")
            move_str2 = _choose_best_move_safe(board_10, side=other, level=3)

            if move_str2 and isinstance(move_str2, str) and move_str2.strip():
                return AIMoveResponse(
                    ok=True,
                    move=move_str2.strip(),
                    reason="minimax_side_flip",
                    meta={"side": other},
                )

            # ❗ Ninguno de los dos lados encontró jugada
            return JSONResponse(
                status_code=200,
                content={
                    "ok": False,
                    "move": "",
                    "reason": "no_legal_move",
                    "detail": "La IA no encontró jugada legal (board/turn/reglas).",
                },
            )

        # ✅ Jugada encontrada con el lado original
        return AIMoveResponse(ok=True, move=move_str.strip(), reason="minimax", meta={"side": side})

    except HTTPException:
        raise
    except Exception as e:
        print("[AI] Error en minimax choose_best_move:", repr(e))
        raise HTTPException(status_code=500, detail=f"Error IA: {e}")
