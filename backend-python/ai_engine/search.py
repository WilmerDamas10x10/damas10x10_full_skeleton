# backend-python/ai_engine/search.py
"""
Búsqueda de la mejor jugada (minimax, poda, etc.)

Aquí vivirá la lógica fuerte de la IA:
  - Árbol de búsqueda
  - Poda alfa-beta
  - Control de tiempo / profundidad
"""

from typing import Optional
from .board import parse_fen
from .moves import generate_legal_moves
from .eval import evaluate_board


def choose_best_move(fen: str, side_to_move: str) -> Optional[str]:
  """
  Devuelve una jugada sugerida en algún formato manejable.

  Por ahora:
    - Parseamos el FEN con parse_fen (aunque devuelva vacío).
    - Generamos movimientos (lista vacía de momento).
    - Devolvemos None para que el caller use un fallback.

  Más adelante:
    - Implementaremos minimax + evaluación real.
    - Devolveremos un movimiento concreto (por ejemplo: "e3-f4",
      o un JSON con from/to/path).
  """
  board = parse_fen(fen)
  moves = generate_legal_moves(board, side_to_move)

  if not moves:
    return None

  # TODO:
  #  - Implementar selección real usando evaluate_board y búsqueda.
  # Por ahora devolvemos un placeholder muy simple:
  return None
