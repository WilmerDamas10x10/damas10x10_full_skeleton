# experience_engine.py
# ---------------------------------------------------------
# Módulo de "aprendizaje por experiencia" para Damas10x10.
#
# IDEA:
# - Leemos el archivo data/ai_moves.jsonl que se llena con
#   /ai/log-moves (MoveLogEntry: {ts, fen, move, score}).
# - Para cada posición guardada, extraemos un "patrón"
#   MUY sencillo basado en:
#       · cantidad de peones y damas de R
#       · cantidad de peones y damas de N
# - Para cada patrón acumulamos el promedio de "score"
#   (+1 victoria IA, 0 tablas/interesante, -1 derrota IA).
# - En tiempo de juego, desde ai_engine.py llamamos a
#   experience_bonus(board, side) para obtener un pequeño
#   ajuste a la evaluación (bonus o castigo).
#
# NOTA IMPORTANTE:
# - Por ahora este módulo es simple: solo mira material.
# - Más adelante podemos refinar patrones (zonas, coronas,
#   cadenas de captura, etc.), y también filtrar jugadas
#   repetidas o ruidos.
# ---------------------------------------------------------

from pathlib import Path
import json
from typing import Dict, Tuple, List, Optional

# Ruta del archivo de logs (debe coincidir con main.py)
DATA_DIR = Path("data")
AI_MOVES_LOG = DATA_DIR / "ai_moves.jsonl"

# Tipo de clave para patrones de experiencia:
# (num_r, num_R, num_n, num_N)
FeatureKey = Tuple[int, int, int, int]

# Caché en memoria
_EXPERIENCE_TABLE: Dict[FeatureKey, float] = {}
_EXPERIENCE_LOADED: bool = False
_EXPERIENCE_MTIME: Optional[float] = None

# Peso con el que la experiencia afecta a la evaluación.
# Si lo subimos, la IA confiará más en lo aprendido.
EXPERIENCE_WEIGHT = 0.4


# ---------------------------------------------------------
# Utilidades para extraer "features" del tablero o del FEN
# ---------------------------------------------------------
def _features_from_board(board: List[List[Optional[str]]]) -> FeatureKey:
  """
  Extrae un patrón muy simple del tablero:
  - Cuenta cuántas piezas hay de cada tipo:
      r, R, n, N
  """
  num_r = 0
  num_R = 0
  num_n = 0
  num_N = 0

  for row in board:
    for cell in row:
      if cell == "r":
        num_r += 1
      elif cell == "R":
        num_R += 1
      elif cell == "n":
        num_n += 1
      elif cell == "N":
        num_N += 1

  return (num_r, num_R, num_n, num_N)


def _features_from_fen(fen: str) -> FeatureKey:
  """
  Extrae el mismo patrón pero a partir del FEN:
  solo contamos letras r,R,n,N dentro de la cadena.
  Esto no depende del formato exacto del FEN, mientras
  use esas letras para las piezas.
  """
  num_r = fen.count("r")
  num_R = fen.count("R")
  num_n = fen.count("n")
  num_N = fen.count("N")
  return (num_r, num_R, num_n, num_N)


# ---------------------------------------------------------
# Carga de experiencia desde data/ai_moves.jsonl
# ---------------------------------------------------------
def _build_experience_table(log_path: Path) -> Dict[FeatureKey, float]:
  """
  Lee el archivo JSONL de logs y construye un diccionario:
      patrón -> promedio(score)

  Donde:
    - score se espera en el rango [-1, 1].
    - Si no hay 'score' en una entrada, se ignora.
  """
  table_sum: Dict[FeatureKey, float] = {}
  table_count: Dict[FeatureKey, int] = {}

  if not log_path.exists():
    # No hay experiencia todavía.
    return {}

  with log_path.open("r", encoding="utf-8") as f:
    for line in f:
      line = line.strip()
      if not line:
        continue
      try:
        obj = json.loads(line)
      except Exception:
        continue

      fen = obj.get("fen")
      score = obj.get("score")

      # Necesitamos al menos fen + score para aprender algo útil.
      if not isinstance(fen, str):
        continue
      try:
        score = float(score)
      except (TypeError, ValueError):
        continue

      # Extraer patrón desde el FEN
      key = _features_from_fen(fen)

      # Acumular
      table_sum[key] = table_sum.get(key, 0.0) + score
      table_count[key] = table_count.get(key, 0) + 1

  # Convertir a promedio
  table_avg: Dict[FeatureKey, float] = {}
  for key, total in table_sum.items():
    cnt = table_count.get(key, 1)
    table_avg[key] = total / max(cnt, 1)

  return table_avg


def _ensure_experience_loaded() -> None:
  """
  Carga (o recarga) la tabla de experiencia solo si:
    - Aún no se ha cargado.
    - O el archivo ha cambiado (mtime distinto).
  """
  global _EXPERIENCE_TABLE, _EXPERIENCE_LOADED, _EXPERIENCE_MTIME

  try:
    mtime = AI_MOVES_LOG.stat().st_mtime
  except FileNotFoundError:
    _EXPERIENCE_TABLE = {}
    _EXPERIENCE_LOADED = True
    _EXPERIENCE_MTIME = None
    return

  if not _EXPERIENCE_LOADED or _EXPERIENCE_MTIME != mtime:
    _EXPERIENCE_TABLE = _build_experience_table(AI_MOVES_LOG)
    _EXPERIENCE_LOADED = True
    _EXPERIENCE_MTIME = mtime
    print(
      f"[EXP] Tabla de experiencia cargada: {len(_EXPERIENCE_TABLE)} patrones."
    )


# ---------------------------------------------------------
# API pública: bonus de experiencia para la evaluación
# ---------------------------------------------------------
def experience_bonus(board: List[List[Optional[str]]], side: str) -> float:
  """
  Devuelve un pequeño ajuste a la evaluación basado en experiencia.

  - board: tablero 10x10 con 'r','R','n','N' o None.
  - side:  "R" o "N" (color para el que evaluamos).

  Por ahora:
    · NO diferenciamos entre R y N en los patrones.
      Es decir, el mismo patrón de material se comparte
      para ambos colores. Más adelante podemos ampliar
      esta firma para pasar 'ia_side' y aprender por color.
    · Solo miramos material, así que el efecto será suave.

  Devuelve:
    · Un número que se suma al score de evaluate_board.
  """
  _ensure_experience_loaded()

  if not _EXPERIENCE_TABLE:
    # No hay nada aprendido todavía
    return 0.0

  key = _features_from_board(board)
  avg_score = _EXPERIENCE_TABLE.get(key)
  if avg_score is None:
    # No hay experiencia para este patrón
    return 0.0

  # Aplicamos un peso moderado para no romper la heurística base.
  return EXPERIENCE_WEIGHT * avg_score
