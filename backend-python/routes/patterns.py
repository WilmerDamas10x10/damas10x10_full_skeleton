from fastapi import APIRouter
from pathlib import Path
import json

# Router principal de patrones
router = APIRouter(
    prefix="/ai/patterns",
    tags=["AI Patterns"]
)

# Ruta del archivo donde se guardarán los patrones
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)

PATTERN_FILE = DATA_DIR / "pattern_index.json"


@router.get("/index")
def get_pattern_index():
    """
    Devuelve el índice completo de patrones guardados.
    """
    if not PATTERN_FILE.exists():
        return {
            "ok": True,
            "patterns": {},
            "source": "empty"
        }

    try:
        with open(PATTERN_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return {
            "ok": True,
            "patterns": data,
            "source": "disk"
        }
    except Exception as e:
        return {
            "ok": False,
            "error": str(e),
            "patterns": {}
        }


@router.post("/sync")
def sync_pattern_index(payload: dict):
    """
    Recibe patrones desde el frontend y los guarda en disco.
    """
    patterns = payload.get("patterns", {})

    try:
        with open(PATTERN_FILE, "w", encoding="utf-8") as f:
            json.dump(patterns, f, indent=2, ensure_ascii=False)

        return {
            "ok": True,
            "count": len(patterns),
            "saved": True
        }
    except Exception as e:
        return {
            "ok": False,
            "error": str(e)
        }
