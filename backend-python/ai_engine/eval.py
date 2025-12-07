# backend-python/ai_engine/eval.py
"""
Función de evaluación para Damas10x10.

Más adelante:
  - Diferencia de material (peones, damas)
  - Posición (centralización, avance, etc.)
  - Ideas extra que quieras probar
"""

from .board import Board


def evaluate_board(board: Board, side_to_move: str) -> float:
  """
  Evalúa el tablero desde el punto de vista de side_to_move.

  TODO:
    - Implementar evaluación real.
  """
  # Por ahora devolvemos 0.0 como evaluación neutra.
  return 0.0
