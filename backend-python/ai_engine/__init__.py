# backend-python/ai_engine/__init__.py
# Puente de exports (modo seguro sin imports relativos).
# Carga backend-python/ai_engine.py directamente por ruta.

import importlib.util
from pathlib import Path

_ENGINE_PATH = Path(__file__).resolve().parent.parent / "ai_engine.py"

spec = importlib.util.spec_from_file_location("ai_engine_file", _ENGINE_PATH)
if spec is None or spec.loader is None:
    raise ImportError(f"No se pudo cargar ai_engine.py desde {_ENGINE_PATH}")

_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(_mod)

IA_ENGINE_VERSION = getattr(_mod, "IA_ENGINE_VERSION", "IA-ENGINE")

board_to_key = getattr(_mod, "board_to_key", None)
choose_best_move = getattr(_mod, "choose_best_move", None)
choose_ai_capture_move = getattr(_mod, "choose_ai_capture_move", None)

load_learned_patterns = getattr(_mod, "load_learned_patterns", None)
get_learned_move_by_key = getattr(_mod, "get_learned_move_by_key", None)
get_learned_move_fallback_fen = getattr(_mod, "get_learned_move_fallback_fen", None)

if choose_best_move is None:
    raise ImportError("ai_engine.py no exporta choose_best_move (no existe esa función).")
