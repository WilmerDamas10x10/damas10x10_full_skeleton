import json
from pathlib import Path
from typing import Optional, Any, List

MOVES_FILE = Path(__file__).parent / "ai_moves.jsonl"


# -------------------------------------------------
# Utilidades
# -------------------------------------------------
def _try_parse_board(x: Any) -> Optional[List]:
    """Acepta lista o string JSON-lista"""
    if isinstance(x, list):
        return x

    if isinstance(x, str):
        s = x.strip()
        if s.startswith("[") and s.endswith("]"):
            try:
                j = json.loads(s)
                if isinstance(j, list):
                    return j
            except Exception:
                return None
    return None


def _canon_fen_from_board(board: List) -> str:
    """JSON estable, sin espacios (CLAVE del aprendizaje)"""
    return json.dumps(board, ensure_ascii=False, separators=(",", ":"))


def _normalize_fen_input(fen: Any) -> Optional[str]:
    """
    Convierte lo que venga (board o string JSON)
    en fen canónico comparable
    """
    board = _try_parse_board(fen)
    if board is None:
        return None
    return _canon_fen_from_board(board)


# -------------------------------------------------
# FUNCIÓN PRINCIPAL (APRENDIZAJE)
# -------------------------------------------------
def find_learned_move(fen: Any, side: str) -> Optional[str]:
    """
    Devuelve la mejor jugada aprendida para:
    - fen: tablero 10x10 (lista o JSON)
    - side: "R" o "N"
    """

    if not MOVES_FILE.exists():
        return None

    fen_key = _normalize_fen_input(fen)
    if not fen_key:
        return None

    side = str(side).strip().upper()
    if side.startswith("R"):
        side = "R"
    elif side.startswith("N"):
        side = "N"

    best_move = None
    best_score = float("-inf")

    with MOVES_FILE.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue

            try:
                row = json.loads(line)
            except Exception:
                continue

            # 🔑 comparación CANÓNICA
            row_key = row.get("key") or row.get("fen")
            if row_key != fen_key:
                continue

            row_side = row.get("side")
            if row_side and row_side != side:
                continue

            score = row.get("score", 0)
            try:
                score = float(score)
            except Exception:
                score = 0

            if score > best_score:
                best_score = score
                best_move = row.get("move")

    return best_move
