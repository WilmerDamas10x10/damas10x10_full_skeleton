// src/rules/pieces/index.js
// Re-export centralizado de piezas para el motor.

// PEONES
export {
  generatePawnMoves,
  generatePawnCaptures,
  genPawnMoves,
  genPawnCaptures,
  movimientosPeon,
  capturasPeon,
  pawnValue,
} from "./pawn.js";

// DAMAS
export {
  genQueenMoves,
  genQueenCaptures,
  generateQueenMoves,
  generateQueenCaptures,
  movimientosDama,
  capturasDama,
  queenValue,
} from "./queen.js";
