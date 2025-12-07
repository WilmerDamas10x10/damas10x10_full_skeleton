# backend-python/ai_engine/__init__.py
"""
Paquete del motor de IA para Damas10x10 en Python.

Por ahora solo expone una función:
    choose_best_move(fen: str, side_to_move: str) -> str | None

Más adelante aquí vivirá el motor completo:
- Representación de tablero
- Generación de movimientos
- Evaluación
- Búsqueda (minimax, poda, etc.)
"""

from .search import choose_best_move

__all__ = ["choose_best_move"]
