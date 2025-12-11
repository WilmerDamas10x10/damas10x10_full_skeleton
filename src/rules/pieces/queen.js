// src/rules/pieces/queen.js
import { DIAG } from "../constants.js";
import { dentro, colorOf, clone, isGhost } from "../utils.js";

/**
 * Movimientos sin captura de la dama (voladora).
 * Devuelve [{to:[r,c]}...]
 */
export function genQueenMoves(board, r, c/*, opts = {} */) {
  const me = board[r]?.[c];
  if (!me) return [];
  const out = [];
  for (const [dr, dc] of DIAG) {
    let nr = r + dr, nc = c + dc;
    while (dentro(nr, nc) && !board[nr][nc]) {
      out.push({ to: [nr, nc] });
      nr += dr; nc += dc;
    }
  }
  return out;
}

/**
 * Capturas de la dama con regla “relajada correcta”:
 *  - NUNCA aterriza en casillas visitadas.
 *  - NUNCA cruza la casilla de ORIGEN en ningún salto.
 *  - PUEDE cruzar otras visitadas DESPUÉS del primer salto.
 *  - GHOST es muro (no capturable).
 *
 * Devuelve rutas: [{ path:[[r0,c0],[r1,c1],...], captures:[{r,c,cell}, ...] }, ...]
 */
export function genQueenCaptures(board, r, c /*, opts = {} */) {
  const me = board[r]?.[c];
  if (!me) return [];

  const my = colorOf(me);
  const rutas = [];
  const key = (rr, cc) => `${rr},${cc}`;
  const origin = [r, c];

  // ¿el segmento (sr,sc) -> (tr,tc) cruza una celda específica (excluyendo extremos)?
  function crossesCell(sr, sc, tr, tc, dr, dc, cell) {
    let rr = sr + dr, cc = sc + dc;
    while (rr !== tr || cc !== tc) {
      if (rr === cell[0] && cc === cell[1]) return true;
      rr += dr; cc += dc;
    }
    return false;
  }

  function dfs(b, rr, cc, tomados, visitadas, firstHopDone, path, caps) {
    let extendida = false;

    for (const [dr, dc] of DIAG) {
      // Avanzar hasta la PRIMERA pieza en esa diagonal
      let mr = rr + dr, mc = cc + dc;

      // Antes del primer salto: no cruzar visitadas (básicamente, el origen).
      // Después: se puede cruzar visitadas, pero nunca la casilla de origen.
      while (dentro(mr, mc) && !b[mr][mc]) {
        if (!firstHopDone && visitadas.has(key(mr, mc))) { mr = NaN; break; }
        mr += dr; mc += dc;
      }
      if (!Number.isFinite(mr) || !dentro(mr, mc)) continue;

      const mid = b[mr][mc];
      if (!mid) continue;
      if (isGhost(mid)) continue;
      if (colorOf(mid) === my) continue;
      if (tomados.has(key(mr, mc))) continue;

      // Nunca cruzar la casilla de origen para “llegar” a la pieza a capturar
      if (crossesCell(rr, cc, mr, mc, dr, dc, origin)) continue;

      // Explorar todos los aterrizajes libres detrás del enemigo
      let lr = mr + dr, lc = mc + dc;
      while (dentro(lr, lc) && !b[lr][lc]) {
        const destKey = key(lr, lc);

        // No aterrizar en visitadas ni en el origen
        if (visitadas.has(destKey) || (lr === origin[0] && lc === origin[1])) {
          lr += dr; lc += dc; continue;
        }

        // Entre la pieza y el aterrizaje:
        //  - si es el primer salto, no cruzar visitadas
        //  - nunca cruzar el ORIGEN
        let rr2 = mr + dr, cc2 = mc + dc;
        let crossesVisited = false, crossesOrigin = false;
        while (rr2 !== lr || cc2 !== lc) {
          if (visitadas.has(key(rr2, cc2))) crossesVisited = true;
          if (rr2 === origin[0] && cc2 === origin[1]) { crossesOrigin = true; break; }
          rr2 += dr; cc2 += dc;
        }
        if ((!firstHopDone && crossesVisited) || crossesOrigin) {
          lr += dr; lc += dc; continue;
        }

        // Aplicar captura y continuar
        const nb = clone(b);
        nb[rr][cc] = null;
        nb[mr][mc] = null;
        nb[lr][lc] = me;

        const nTom = new Set(tomados);   nTom.add(key(mr, mc));
        const nVis = new Set(visitadas); nVis.add(destKey);           // registrar parada
        const nCap = [...caps, { r: mr, c: mc, cell: mid }];

        dfs(nb, lr, lc, nTom, nVis, true, [...path, [lr, lc]], nCap);
        extendida = true;

        lr += dr; lc += dc; // Explorar más aterrizajes detrás del mismo enemigo
      }
    }

    if (!extendida && caps.length) rutas.push({ path, captures: caps });
  }

  // Arrancar con la casilla de origen marcada como visitada
  const visitadas0 = new Set([key(r, c)]);
  dfs(board, r, c, new Set(), visitadas0, false, [[r, c]], []);
  return rutas;
}

// -------------------------------------------------------
// Exports de compatibilidad para index.js y consumidores antiguos
// -------------------------------------------------------

/**
 * Alias para compatibilidad: generateQueenMoves / movimientosDama
 * apuntan a genQueenMoves.
 */
export function generateQueenMoves(board, r, c, opts = {}) {
  // opts se ignora por ahora; se mantiene por compatibilidad de firma
  return genQueenMoves(board, r, c /*, opts*/);
}
export const movimientosDama = genQueenMoves;

/**
 * Alias para compatibilidad: generateQueenCaptures / capturasDama
 * apuntan a genQueenCaptures.
 */
export function generateQueenCaptures(board, r, c, opts = {}) {
  return genQueenCaptures(board, r, c, opts);
}
export const capturasDama = genQueenCaptures;

/**
 * Valor base de la dama para heurísticas de IA.
 * Regla acordada: dama vale 1.5 peones.
 */
export const queenValue = 1.5;
