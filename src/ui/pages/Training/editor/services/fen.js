// src/ui/pages/Training/editor/services/fen.js
// FEN para damas 10x10 o 8x8.
// r/R = rojas (peón/dama), n/N = negras (peón/dama).
// Números = cantidad de vacías consecutivas. Filas separadas por "/". Al final, turno: " r" o " n".
//
// ✅ Soporta AUTOMÁTICAMENTE dos formatos de fila:
//    1) Grid completo (8 o 10 celdas por fila) con números
//    2) Solo casillas jugables (oscuras): 4 (en 8x8) o 5 (en 10x10)
//
// ✅ (NUEVO) Soporta formato "k" del backend / ai_moves.jsonl:
//    "........../..R......./.../.........N|side:R"
//    - '.' = vacío
//    - r/R/n/N piezas
//    - |side:R o |side:N (opcional)
//
// ⚠️ Importante:
// - fromFEN() por defecto mantiene el comportamiento legacy: auto-orienta (id/flipH/flipV/flipHV)
//   para maximizar piezas en casillas oscuras.
// - Para IA / grabación / reproducibilidad (J1 oscuro estable), usa:
//      fromFENStrict(fen)   o   fromKeyString(k)
//   (autoOrient apagado)

import { SIZE, dark } from "../index.js"; // usa EXACTAMENTE el mismo 'dark' del tablero

const ALLOWED = new Set(["r", "R", "n", "N"]);

/** Normaliza el turno a 'r' | 'n' (acepta r/n/w/b, ROJO/NEGRO, etc.) */
function normTurn(t) {
  const s = String(t ?? "r").trim().toLowerCase();
  if (s === "n" || s === "b" || s === "negro" || s === "black") return "n";
  return "r";
}

/** Normaliza side a 'R' | 'N' (para formato k) */
function normSideRN(x) {
  const s = String(x ?? "R").trim().toUpperCase();
  if (s === "N" || s === "NEGRO" || s === "BLACK" || s === "B") return "N";
  return "R";
}

/** Crea un tablero H×W con nulls */
function emptyBoard(H, W) {
  return Array.from({ length: H }, () => Array(W).fill(null));
}

/** Exporta un tablero a FEN (H = board.length, W = board[0].length) */
export function toFEN(board, turn = "r") {
  if (!Array.isArray(board) || board.length === 0) {
    throw new Error("toFEN: tablero inválido");
  }
  const H = board.length;
  const W = (board[0] || []).length;
  if (!W) throw new Error("toFEN: filas vacías");

  const rows = [];
  for (let r = 0; r < H; r++) {
    const row = board[r] || [];
    if (row.length !== W) throw new Error("toFEN: filas con anchos distintos");
    let out = "";
    let run = 0;
    for (let c = 0; c < W; c++) {
      const cell = row[c];
      if (!cell) { run++; continue; }
      if (run) { out += String(run); run = 0; }
      out += String(cell); // 'r','R','n','N'
    }
    if (run) out += String(run);
    rows.push(out || String(W));
  }
  return rows.join("/") + " " + normTurn(turn);
}

/** (NUEVO) Exporta un tablero al formato "k" (puntos) + |side:X */
export function toKeyString(board, side = "R") {
  if (!Array.isArray(board) || board.length === 0) throw new Error("toKeyString: tablero inválido");
  const H = board.length;
  const W = (board[0] || []).length;
  const rows = [];
  for (let r = 0; r < H; r++) {
    const row = board[r] || [];
    if (row.length !== W) throw new Error("toKeyString: filas con anchos distintos");
    let out = "";
    for (let c = 0; c < W; c++) {
      const v = row[c];
      out += (ALLOWED.has(v) ? v : ".");
    }
    rows.push(out);
  }
  return rows.join("/") + `|side:${normSideRN(side)}`;
}

/**
 * (NUEVO) Importa el formato "k" del backend:
 * "........../..R......./.../.........N|side:R"
 * Devuelve { board, turn } donde turn es 'r'/'n' (según side:R->'r', side:N->'n')
 */
export function fromKeyString(kLike) {
  const txt = String(kLike || "").trim();
  if (!txt) throw new Error("Key vacío");

  // separa |side:X si existe
  let body = txt;
  let side = "R";
  const mSide = /\|side\s*:\s*([RN])/i.exec(txt);
  if (mSide) side = normSideRN(mSide[1]);
  if (txt.includes("|side:")) body = txt.split("|side:")[0].trim();

  const rows = body.split("/");
  if (rows.length !== 10 && rows.length !== 8) {
    throw new Error("Key debe tener 8 o 10 filas");
  }
  const H = rows.length;
  const W = (H === 8 ? 8 : 10);

  const B = emptyBoard(H, W);

  for (let r = 0; r < H; r++) {
    const row = rows[r] || "";
    if (row.length !== W) {
      throw new Error(`Key inválida: fila ${r + 1} no tiene ${W} caracteres`);
    }
    for (let c = 0; c < W; c++) {
      const ch = row[c];
      if (ch === ".") { B[r][c] = null; continue; }
      if (!ALLOWED.has(ch)) {
        throw new Error(`Key inválida: caracter '${ch}' no permitido`);
      }
      B[r][c] = ch;
    }
  }

  // turn: side R->'r', side N->'n'
  const turn = (side === "N") ? "n" : "r";
  return { board: B, turn };
}

/** Parsea FEN a { board, turn }. Soporta 10x10 y 8x8, y autodetecta "grid" vs "solo oscuras". */
export function fromFEN(fen, opts = {}) {
  const { autoOrient = true } = (opts && typeof opts === "object") ? opts : { autoOrient: true };

  const txt = String(fen || "").trim();
  if (!txt) throw new Error("FEN vacío");

  // "cuerpo" + turno opcional final
  const m = /^(.*?)(?:\s+([rRnNwWbB]))?\s*$/.exec(txt);
  if (!m) throw new Error("FEN inválido");
  const rowsPart = m[1].trim();
  const turnRaw = (m[2] || "r").toLowerCase();

  const rows = rowsPart.split("/");
  if (rows.length !== 10 && rows.length !== 8) {
    throw new Error("FEN debe tener 8 o 10 filas");
  }

  const H = rows.length;
  const W = (H === 8 ? 8 : 10);
  const PLAYABLE = W / 2; // 4 en 8x8; 5 en 10x10

  // ───────────── Helpers ─────────────

  function countOnDark(B) {
    let total = 0, onDark = 0;
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const v = B[r]?.[c];
        if (v && v !== "." && v !== " ") {
          total++;
          if (dark(r, c)) onDark++;
        }
      }
    }
    return { total, onDark };
  }

  function flipH(B) { // espejo horizontal por fila
    const out = new Array(H);
    for (let r = 0; r < H; r++) out[r] = (B[r] || []).slice().reverse();
    return out;
  }
  function flipV(B) { // espejo vertical (invierte orden de filas)
    const out = new Array(H);
    for (let r = 0; r < H; r++) out[r] = (B[H - 1 - r] || []).slice();
    return out;
  }

  // Detecta si parece "grid con puntos" (no debería venir aquí normalmente,
  // pero lo toleramos por si alguien pega k sin el |side)
  function looksLikeDotGridRow(rowStr) {
    if (!rowStr) return false;
    // solo '.' y rRnN, y longitud exacta
    if (rowStr.length !== W) return false;
    for (let i = 0; i < rowStr.length; i++) {
      const ch = rowStr[i];
      if (ch === ".") continue;
      if (!ALLOWED.has(ch)) return false;
    }
    return true;
  }

  // Parse tipo GRID (cuenta 8/10 celdas por fila) con números
  const TOK_RE = /(\d+|[rRnN])/g;

  function parseRowAsGrid(tokens) {
    const out = Array(W).fill(null);
    let c = 0;
    for (const tk of tokens) {
      if (/^\d+$/.test(tk)) {
        const n = parseInt(tk, 10);
        if (!(n > 0)) return null;
        c += n;
        if (c > W) return null;
      } else {
        if (!/^[rRnN]$/.test(tk)) return null;
        if (c >= W) return null;
        out[c++] = tk;
      }
    }
    if (c !== W) return null;
    return out;
  }

  // Parse tipo GRID "con puntos" (k-like sin números)
  function parseRowAsDotGrid(rowStr) {
    if (!looksLikeDotGridRow(rowStr)) return null;
    const out = Array(W).fill(null);
    for (let c = 0; c < W; c++) {
      const ch = rowStr[c];
      out[c] = (ch === ".") ? null : ch;
    }
    return out;
  }

  // Parse tipo OSCURAS (solo 4/5 celdas jugables por fila)
  function parseRowAsDark(tokens, rIdx) {
    const out = Array(W).fill(null);
    const offset = (rIdx % 2 === 0 ? 1 : 0); // filas pares: oscuras en 1,3,5... (patrón actual)
    let k = 0; // índice de casilla jugable dentro de la fila (0..PLAYABLE-1)
    for (const tk of tokens) {
      if (/^\d+$/.test(tk)) {
        const n = parseInt(tk, 10);
        if (!(n > 0)) return null;
        k += n;
        if (k > PLAYABLE) return null;
      } else {
        if (!/^[rRnN]$/.test(tk)) return null;
        if (k >= PLAYABLE) return null;
        const c = offset + 2 * k;
        out[c] = tk;
        k++;
      }
    }
    if (k !== PLAYABLE) return null;
    return out;
  }

  function parseBody(rowsArr) {
    const B_grid = emptyBoard(H, W);
    const B_dark = emptyBoard(H, W);
    const B_dot  = emptyBoard(H, W);

    let ok_grid = true, ok_dark = true, ok_dot = true;

    for (let r = 0; r < H; r++) {
      const rowStr = String(rowsArr[r] || "");
      const tokens = rowStr.match(TOK_RE) || [];

      const g = parseRowAsGrid(tokens);
      const d = parseRowAsDark(tokens, r);
      const p = parseRowAsDotGrid(rowStr);

      if (!g) ok_grid = false; else B_grid[r] = g;
      if (!d) ok_dark = false; else B_dark[r] = d;
      if (!p) ok_dot = false; else B_dot[r] = p;
    }

    // Preferencias:
    // - Si solo una encaja, usarla
    if (ok_grid && !ok_dark && !ok_dot) return B_grid;
    if (!ok_grid && ok_dark && !ok_dot) return B_dark;
    if (!ok_grid && !ok_dark && ok_dot) return B_dot;

    // Si varias encajan, elegimos la que deja más piezas en oscuras (como antes)
    const candidates = [];
    if (ok_grid) candidates.push(B_grid);
    if (ok_dark) candidates.push(B_dark);
    if (ok_dot)  candidates.push(B_dot);

    if (!candidates.length) {
      throw new Error("FEN inválido: filas no cuadran con 8/10 celdas, jugables, ni grid con puntos");
    }

    let best = candidates[0];
    let bestOnDark = countOnDark(best).onDark;
    for (let i = 1; i < candidates.length; i++) {
      const onDark = countOnDark(candidates[i]).onDark;
      if (onDark > bestOnDark) {
        best = candidates[i];
        bestOnDark = onDark;
      }
    }
    return best;
  }

  // 1) Parseo base (grid / jugables / dot-grid)
  const baseBoard = parseBody(rows);

  // 2) Auto-orientación (solo si autoOrient=true)
  let finalBoard = baseBoard;

  if (autoOrient) {
    const candidates = [
      { name: "id",  B: baseBoard },
      { name: "h",   B: flipH(baseBoard) },
      { name: "v",   B: flipV(baseBoard) },
      { name: "hv",  B: flipH(flipV(baseBoard)) },
    ];
    let best = candidates[0];
    let bestScore = countOnDark(best.B);
    for (let i = 1; i < candidates.length; i++) {
      const score = countOnDark(candidates[i].B);
      if (score.onDark > bestScore.onDark) {
        best = candidates[i];
        bestScore = score;
      }
    }
    finalBoard = best.B;
  }

  const turn = normTurn(turnRaw);
  return { board: finalBoard, turn };
}

/** (NUEVO) Import estricto: NO hace flips automáticos (mapeo estable para IA/J1 oscuro) */
export function fromFENStrict(fen) {
  return fromFEN(fen, { autoOrient: false });
}

// Convierte: "....R..../...|side:N"  ->  "4R4/..." + " n"
// - Acepta 8x8 o 10x10
// - '.' = vacío
// - r/R/n/N piezas
export function keyToFenCompressed(kStr) {
  const raw = String(kStr || "").trim();
  if (!raw) throw new Error("keyToFenCompressed: k vacío");

  // side:R|N (opcional)
  let side = null;
  const m = raw.match(/\|side\s*:\s*([RN])/i);
  if (m) side = m[1].toUpperCase();

  const body = raw.split("|side:")[0].trim();
  const rows = body.split("/");
  if (rows.length !== 10 && rows.length !== 8) {
    throw new Error("keyToFenCompressed: k debe tener 8 o 10 filas");
  }
  const W = rows.length === 10 ? 10 : 8;

  const fenRows = rows.map((row) => {
    if (row.length !== W) throw new Error(`keyToFenCompressed: fila no tiene ${W} chars`);
    let out = "";
    let run = 0;
    for (const ch of row) {
      if (ch === ".") { run++; continue; }
      if (run) { out += String(run); run = 0; }
      if (!"rRnN".includes(ch)) throw new Error(`keyToFenCompressed: char inválido: ${ch}`);
      out += ch;
    }
    if (run) out += String(run);
    return out || String(W);
  });

  const turn = (side === "N") ? "n" : "r"; // si no viene side, por defecto 'r'
  return fenRows.join("/") + " " + turn;
}
