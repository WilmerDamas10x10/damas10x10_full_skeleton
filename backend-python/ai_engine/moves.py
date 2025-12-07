# backend-python/ai_engine/moves.py
"""
Generación de movimientos para Damas10x10.

TODO:
  - Implementar generación de movimientos normales y capturas
  - Respetar reglas de captura obligatoria, cadenas, etc.
"""

from typing import List, Dict, Any
from .board import Board


Move = Dict[str, Any]


def generate_legal_moves(board: Board, side_to_move: str) -> List[Move]:
  """
  Genera una lista de movimientos legales para side_to_move.

  TODO:
    - Implementar según las reglas de tu proyecto.
  """
  # Por ahora devolvemos lista vacía para no romper nada.
  return []
