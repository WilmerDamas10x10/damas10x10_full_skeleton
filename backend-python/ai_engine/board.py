# backend-python/ai_engine/board.py
"""
Módulo de representación de tablero para Damas 10x10.

Más adelante aquí:
- Parsearemos el FEN de tu proyecto JS.
- Representaremos el tablero como una matriz 10x10.
- Añadiremos helpers para clonar, aplicar movimientos, etc.
"""

from typing import List, Optional

Piece = Optional[str]  # "r","R","n","N" o None
Board = List[List[Piece]]


def empty_board() -> Board:
  """
  Devuelve un tablero vacío 10x10.
  """
  return [[None for _ in range(10)] for _ in range(10)]


def parse_fen(fen: str) -> Board:
  """
  PARSER PROVISIONAL.

  Más adelante lo adaptaremos AL FORMATO REAL de FEN de tu proyecto.
  Por ahora solo devolvemos un tablero vacío para no romper nada.

  TODO:
    - Analizar el formato de FEN que usa __D10.fen().
    - Parsearlo aquí para obtener un Board real.
  """
  # TODO: implementar parseo real según el formato de tu motor JS
  return empty_board()
