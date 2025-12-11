// src/rules/pieces/pawn.js
// Reglas de PEÓN (hombre): movimiento y capturas encadenadas solo hacia adelante.
// Contrato:
//   generatePawnMoves(board, r, c, opts)     -> Move[]       (p.ej. { to:[r,c] })
//   generatePawnCaptures(board, r, c, opts)  -> Route[]      (p.ej. { path:[[r,c],...], captures:[{r,c,cell}], ... })

import { SIZE, FORWARD } from "../constants.js";
import { dentro, clone, colorOf } from "../utils.js";

export function generatePawnMoves(board, r, c, opts = {}) {
  const me = board[r]?.[c];
  if (!me) return [];
  const my  = colorOf(me);
  const dir = FORWARD[my];

  const out = [];
  for (const dc of [-1, +1]) {
    const nr = r + dir, nc = c + dc;
    if (dentro(nr, nc) && !board[nr][nc]) {
      out.push({ to: [nr, nc] });
    }
  }
  return out;
}

export function generatePawnCaptures(board, r, c, opts = {}) {
  const me = board[r]?.[c];
  if (!me) return [];

  const my  = colorOf(me);
  const dir = FORWARD[my];
  const lastRow = (dir === -1 ? 0 : SIZE - 1);

  const routes = [];

  function dfs(b, rr, cc, path, caps) {
    let extended = false;

    for (const dc of [-1, +1]) {
      const mr = rr + dir,   mc = cc + dc;     // enemigo adyacente
      const lr = rr + 2*dir, lc = cc + 2*dc;   // aterrizaje detrás (distancia fija 2)
      if (!dentro(mr, mc) || !dentro(lr, lc)) continue;

      const mid = b[mr][mc];
      if (mid && colorOf(mid) !== my && !b[lr][lc]) {
        // aplicar salto
        const nb = clone(b);
        nb[rr][cc] = null;
        nb[mr][mc] = null;
        nb[lr][lc] = me;

        const newPath = [...path, [lr, lc]];
        const newCaps = [...caps, { r: mr, c: mc, cell: mid }];

        // Si aterriza en fila de coronación, la jugada TERMINA aquí (no continúa cadena)
        if (lr === lastRow) {
          routes.push({ path: newPath, captures: newCaps });
          extended = true;
          continue;
        }

        dfs(nb, lr, lc, newPath, newCaps);
        extended = true;
      }
    }

    // Si no se pudo extender y hubo capturas, cerramos la ruta
    if (!extended && caps.length) {
      routes.push({ path, captures: caps });
    }
  }

  dfs(board, r, c, [[r, c]], []);
  return routes;
}
// -------------------------------------------------------
// Exports de compatibilidad para index.js y consumidores antiguos
// -------------------------------------------------------

/**
 * Alias para compatibilidad: genPawnMoves / movimientosPeon
 * apuntan a generatePawnMoves.
 */
export function genPawnMoves(board, r, c, opts = {}) {
  return generatePawnMoves(board, r, c, opts);
}
export const movimientosPeon = genPawnMoves;

/**
 * Alias para compatibilidad: genPawnCaptures / capturasPeon
 * apuntan a generatePawnCaptures.
 */
export function genPawnCaptures(board, r, c, opts = {}) {
  return generatePawnCaptures(board, r, c, opts);
}
export const capturasPeon = genPawnCaptures;

/**
 * Valor base del peón para heurísticas de IA.
 */
export const pawnValue = 1.0;
