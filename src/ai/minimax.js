// src/ai/minimax.js
// Minimax + Alpha-Beta con TT (Zobrist), quiescence y SEE en raíz.
// Captura obligatoria en todos los niveles + preferencia de Dama en EMPATE,
// con PREFILTRO ESTRICTO en la RAÍZ para asegurar que la IA elija Dama si existe
// una captura empatada por puntos. Incluye cortes por tiempo/nodos.

export function minimaxChooseBestMove(board, side, depth, helpers, opts = {}) {
  const { COLOR, SIZE, colorOf, movimientos, aplicarMovimiento, crownIfNeeded, evaluate } = helpers;

  const settings = {
    maxDepth: Math.max(2, depth | 0),
    timeMs: opts.timeMs ?? 900,
    quiescence: opts.quiescence ?? true,
    useSEE: opts.useSEE ?? true,
    seePenaltyMargin: opts.seePenaltyMargin ?? -0.08,
    useTT: true,
    useMVVLVA: true,
    useTTMoveFirst: true,
    nodeBudget: 150_000,
  };

  const INF = Infinity;
  const me  = side;

  // Tiempo/Nodos
  const t0 = Date.now();
  const deadline = t0 + settings.timeMs;
  const timeUp   = () => Date.now() >= deadline;
  let nodes = 0;

  // Utils
  const cloneBoard = (b) => b.map(r => r.slice());
  const rc = (p) => Array.isArray(p) ? p : [p.r, p.c];
  const sameRC = (a,b) => a && b && a[0]===b[0] && a[1]===b[1];

  function normalizeCapturePath(originRC, rawPath){
    let arr = (rawPath || []).map(rc);
    if (arr.length < 1) return [];
    if (!sameRC(arr[0], originRC)) arr = [originRC, ...arr];
    const norm = [];
    for (const p of arr) if (!norm.length || !sameRC(norm[norm.length-1], p)) norm.push(p);
    return norm.length >= 2 ? norm : [];
  }

  function diagPassCells(from, to){
    const [fr, fc] = from, [tr, tc] = to;
    const dr = Math.sign(tr - fr), dc = Math.sign(tc - fc);
    const cells = [];
    let r = fr + dr, c = fc + dc;
    while (r !== tr && c !== tc){ cells.push([r,c]); r+=dr; c+=dc; }
    return cells;
  }
  function findMidOnBoard(b, from, to, who){
    const cells = diagPassCells(from, to);
    let mid = null, count = 0;
    for (const [r,c] of cells){
      const ch = b[r][c];
      if (ch){
        count++;
        if (colorOf(ch) === who) return null; // bloqueado por pieza propia
        mid = [r,c];
      }
    }
    return count === 1 ? mid : null;
  }

  function applySingleCapture(b, from, to){
    const nb = cloneBoard(b);
    const [fr, fc] = from, [tr, tc] = to;
    const piece = nb[fr][fc];
    if (!piece) return nb;
    const mid = findMidOnBoard(nb, from, to, colorOf(piece));
    nb[tr][tc] = piece; nb[fr][fc] = null;
    if (mid) nb[mid[0]][mid[1]] = null;
    try { crownIfNeeded(nb, [tr, tc]); } catch {}
    return nb;
  }
  function applyCapturePath(b, path){
    let nb = cloneBoard(b);
    for (let i=0; i<path.length-1; i++) nb = applySingleCapture(nb, path[i], path[i+1]);
    return nb;
  }

  function genAllMoves(b, who){
    const captures = [], quiet = [];
    for (let r=0; r<SIZE; r++){
      for (let c=0; c<SIZE; c++){
        const ch = b[r][c];
        if (!ch || colorOf(ch) !== who) continue;
        const mv = movimientos(b, [r,c]) || {};
        const cc = mv.captures || mv.capturas || mv.takes || [];
        const mm = mv.moves || mv.movs || [];
        for (const rt of cc){
          const raw = rt?.path || rt?.ruta || rt?.steps || [];
          const norm = normalizeCapturePath([r,c], raw);
          if (norm.length >= 2) captures.push({ type:"capture", path:norm, from:[r,c] });
        }
        for (const m of mm){
          const to = m?.to || (Array.isArray(m?.path) ? m.path[m.path.length-1] : null);
          if (to) quiet.push({ type:"quiet", from:[r,c], to: rc(to) });
        }
      }
    }
    return { captures, quiet };
  }

  // SEE raíz
  function pieceValue(ch){ if (!ch) return 0; return (ch === 'R' || ch === 'N') ? 1.5 : 1.0; }
  function seeAfterQuietRoot(b, move, who){
    const nb = cloneBoard(b);
    const { from, to } = move;
    const piece = nb[from[0]][from[1]];
    nb[from[0]][from[1]] = null;
    nb[to[0]][to[1]] = piece;
    try { crownIfNeeded(nb, to); } catch {}
    const opp = (who === COLOR.ROJO) ? COLOR.NEGRO : COLOR.ROJO;
    const { captures: oppCaps } = genAllMoves(nb, opp);
    if (oppCaps.length === 0) return 0;
    for (const cap of oppCaps){
      const path = cap.path;
      for (let i=0;i<path.length-1;i++){
        const mids = diagPassCells(path[i], path[i+1]).filter(([r,c]) => nb[r][c] != null);
        if (mids.length === 1){
          const [mr,mc] = mids[0];
          if (mr === to[0] && mc === to[1]) return -pieceValue(piece);
        }
      }
    }
    return 0;
  }

  // Zobrist / TT
  const PIECES = ['r','R','n','N'];
  const P_INDEX = Object.fromEntries(PIECES.map((p,i)=>[p,i]));
  let seed = 0x9E3779B97F4A7C15n;
  function rnd64(){ seed^=seed>>12n; seed^=seed<<25n; seed^=seed>>27n; return (seed*0x2545F4914F6CDD1Dn)&((1n<<64n)-1n); }
  const Z = Array.from({length: SIZE}, () => Array.from({length: SIZE}, () => Array.from({length: PIECES.length}, () => rnd64())));
  const Z_SIDE = rnd64();
  function hashBoard(b, sideToMove){ let h=0n; for(let r=0;r<SIZE;r++){ for(let c=0;c<SIZE;c++){ const ch=b[r][c]; if(!ch)continue; const pi=P_INDEX[ch]; if(pi==null)continue; h^=Z[r][c][pi]; } } if (sideToMove===COLOR.ROJO) h^=Z_SIDE; return h; }
  const TT_FLAG = { EXACT:0, LOWER:1, UPPER:2 };
  const tt = new Map();
  function ttGet(keyStr, depthReq, alpha, beta){
    const e = tt.get(keyStr); if(!e) return null;
    if (e.depth < depthReq) return null;
    if (e.flag === TT_FLAG.EXACT) return e;
    if (e.flag === TT_FLAG.LOWER && e.score >= beta) return e;
    if (e.flag === TT_FLAG.UPPER && e.score <= alpha) return e;
    return e;
  }
  function ttStore(keyStr, depthStored, flag, score, move){ tt.set(keyStr, { depth: depthStored, flag, score, move }); }

  // ---------- Ordenamiento ----------
  function captureStats(b, m){
    if (m.type !== 'capture') return { victimSum: 0, attackerVal: 0, promotes: false };
    let nb = cloneBoard(b);
    const attacker = nb[m.path[0][0]]?.[m.path[0][1]];
    const attackerVal = pieceValue(attacker);
    let victimSum = 0;
    for (let i=0;i<m.path.length-1;i++){
      const from = m.path[i], to = m.path[i+1];
      const mid = findMidOnBoard(nb, from, to, colorOf(attacker));
      if (mid){
        const v = nb[mid[0]][mid[1]];
        victimSum += pieceValue(v);
      }
      nb = applySingleCapture(nb, from, to);
    }
    const last = m.path[m.path.length-1];
    const promotes = (() => {
      const ch = nb[last[0]]?.[last[1]];
      return ch === 'R' || ch === 'N';
    })();
    return { victimSum, attackerVal, promotes };
  }

  function mvvlvaScore(b, m){
    if (m.type !== 'capture') return 0;
    const fr = m.path[0], tr = m.path[1];
    const mids = diagPassCells(fr, tr);
    const occ = mids.find(([r,c]) => b[r][c] != null);
    const victim = b[occ?.[0]]?.[occ?.[1]] ?? null;
    const attacker = b[fr[0]][fr[1]];
    return 100 * pieceValue(victim) - pieceValue(attacker);
  }

  function orderMoves(b, who, moves, ttMove){
    if (!moves.length) return moves;
    let arr = moves.slice();
    if (settings.useTTMoveFirst && ttMove){
      const idx = arr.findIndex(m => isSameMove(m, ttMove));
      if (idx >= 0){ const [mv] = arr.splice(idx,1); arr.unshift(mv); }
    }
    const caps = arr.filter(m => m.type === "capture");
    const quiet = arr.filter(m => m.type === "quiet");

    // Capts: víctima total desc, atacante de mayor valor (Dama) desc, corona primero, fallback MVVLVA
    caps.sort((a, b2) => {
      const A = captureStats(b, a);
      const B = captureStats(b, b2);
      if (B.victimSum !== A.victimSum) return B.victimSum - A.victimSum;
      if (B.attackerVal !== A.attackerVal) return B.attackerVal - A.attackerVal; // Dama > peón
      if (A.promotes !== B.promotes) return (B.promotes ? 1 : 0) - (A.promotes ? 1 : 0);
      return mvvlvaScore(b, b2) - mvvlvaScore(b, a);
    });

    // Quiet: acercarse a coronación
    quiet.sort((a, b2) => {
      const red = (who === COLOR.ROJO);
      const aRow = a.to[0], bRow = b2.to[0];
      const aScore = red ? (SIZE - 1 - aRow) : aRow;
      const bScore = red ? (SIZE - 1 - bRow) : bRow;
      return bScore - aScore;
    });

    return caps.concat(quiet);
  }

  function isSameMove(a, b){
    if (!a || !b) return false;
    if (a.type !== b.type) return false;
    if (a.type === 'quiet')
      return a.from[0]===b.from[0] && a.from[1]===b.from[1] && a.to[0]===b.to[0] && a.to[1]===b.to[1];
    const pa = a.path || [], pb = b.path || [];
    if (pa.length !== pb.length) return false;
    for (let i=0;i<pa.length;i++){
      if (pa[i][0]!==pb[i][0] || pa[i][1]!==pb[i][1]) return false;
    }
    return true;
  }
  const opponent = (s) => (s === COLOR.ROJO ? COLOR.NEGRO : COLOR.ROJO);

  // ---------- Núcleo Minimax (captura obligatoria en todos los niveles) ----------
  function minimax(b, who, d, alpha, beta, maximizing, inQuiescence = false){
    if (timeUp()) return { score: evaluate(b, me, { COLOR, SIZE, colorOf, movimientos }), move: null };
    if (++nodes > settings.nodeBudget) return { score: evaluate(b, me, { COLOR, SIZE, colorOf, movimientos }), move: null };

    const key = (settings.useTT ? (hashBoard(b, who).toString()) : null);
    const ttCand = (settings.useTT && key) ? ttGet(key, d, alpha, beta) : null;
    if (ttCand && ttCand.depth >= d && ttCand.move && ttCand.flag === 0){
      return { score: ttCand.score, move: ttCand.move };
    }

    const all = genAllMoves(b, who);
    const hasCaps = all.captures.length > 0;
    const legal = hasCaps ? all.captures : all.captures.concat(all.quiet);

    const atHorizon = d === 0;
    if (atHorizon){
      if (settings.quiescence && hasCaps && !inQuiescence){
        const onlyCaps = orderMoves(b, who, legal.filter(m=>m.type==="capture"));
        return minimaxInner(b, who, 1, alpha, beta, maximizing, true, true, onlyCaps, key);
      }
      const score = evaluate(b, me, { COLOR, SIZE, colorOf, movimientos });
      const res = { score, move:null };
      if (settings.useTT && key) ttStore(key, d, TT_FLAG.EXACT, score, null);
      return res;
    }

    const ordered = orderMoves(b, who, legal, ttCand?.move);
    return minimaxInner(b, who, d, alpha, beta, maximizing, inQuiescence, hasCaps, ordered, key);
  }

  function minimaxInner(b, who, d, alpha, beta, maximizing, inQuiescence, hasCapsHere, preMoves, parentKeyStr){
    let moves = hasCapsHere ? preMoves.filter(m => m.type === "capture") : preMoves;
    if (moves.length === 0){
      const score = evaluate(b, me, { COLOR, SIZE, colorOf, movimientos });
      return { score, move:null };
    }

    let bestMove = null;
    let localAlpha = alpha;
    let localBeta  = beta;

    if (maximizing){
      let best = -INF;
      for (const m of moves){
        if (timeUp() || nodes > settings.nodeBudget) break;

        const nb = (m.type === "capture")
          ? applyCapturePath(b, m.path)
          : (() => { const tmp = cloneBoard(b); const res = aplicarMovimiento(tmp, { from:m.from, to:m.to }); try{ crownIfNeeded(res, m.to);}catch{}; return res; })();

        const { score } = minimax(nb, opponent(who), d-1, localAlpha, localBeta, false, inQuiescence || m.type==="capture");
        if (score > best){ best = score; bestMove = m; }
        if (best > localAlpha) localAlpha = best;
        if (localBeta <= localAlpha) break;
      }
      if (settings.useTT && parentKeyStr){
        let flag = TT_FLAG.EXACT;
        if (best <= alpha) flag = TT_FLAG.UPPER;
        else if (best >= beta) flag = TT_FLAG.LOWER;
        ttStore(parentKeyStr, d, flag, best, bestMove);
      }
      return { score: best, move: bestMove };
    } else {
      let best = INF;
      for (const m of moves){
        if (timeUp() || nodes > settings.nodeBudget) break;

        const nb = (m.type === "capture")
          ? applyCapturePath(b, m.path)
          : (() => { const tmp = cloneBoard(b); const res = aplicarMovimiento(tmp, { from:m.from, to:m.to }); try{ crownIfNeeded(res, m.to);}catch{}; return res; })();

        const { score } = minimax(nb, opponent(who), d-1, localAlpha, localBeta, true, inQuiescence || m.type==="capture");
        if (score < best){ best = score; bestMove = m; }
        if (best < localBeta) localBeta = best;
        if (localBeta <= localAlpha) break;
      }
      if (settings.useTT && parentKeyStr){
        let flag = TT_FLAG.EXACT;
        if (best <= alpha) flag = TT_FLAG.UPPER;
        else if (best >= beta) flag = TT_FLAG.LOWER;
        ttStore(parentKeyStr, d, flag, best, bestMove);
      }
      return { score: best, move: bestMove };
    }
  }

  // ---------- PREFILTRO ESTRICTO en RAÍZ ----------
  const rootAll = genAllMoves(board, side);
  const rootHasCaps = rootAll.captures.length > 0;
  if (!rootHasCaps && rootAll.quiet.length === 0) return null;

  let rootMoves = rootHasCaps ? rootAll.captures : rootAll.captures.concat(rootAll.quiet);
  if (rootHasCaps) {
    // 1) Solo capturas con máximo valor de víctimas
    let maxVict = -Infinity;
    const withStats = rootMoves.map(m => {
      const s = captureStats(board, m);
      if (s.victimSum > maxVict) maxVict = s.victimSum;
      return { m, s };
    }).filter(x => x.s.victimSum === maxVict);

    // 2) Si hay al menos una con atacante Dama, quedarse solo con esas
    const anyQueen = withStats.some(x => x.s.attackerVal > 1.0); // Dama = 1.5
    let filtered = anyQueen ? withStats.filter(x => x.s.attackerVal > 1.0) : withStats;

    // 3) Si hay varias y alguna corona, quedarse con las que coronan
    const anyProm = filtered.some(x => x.s.promotes);
    if (anyProm) filtered = filtered.filter(x => x.s.promotes);

    rootMoves = filtered.map(x => x.m);
  }

  // SEE en raíz solo si no hay capturas
  if (settings.useSEE && !rootHasCaps){
    const safe = [];
    for (const m of rootMoves){
      if (m.type === "quiet"){
        const see = seeAfterQuietRoot(board, m, side);
        if (see >= settings.seePenaltyMargin) safe.push(m);
      } else safe.push(m);
    }
    if (safe.length) rootMoves = safe;
  }

  rootMoves = orderMoves(board, side, rootMoves, null);
  if (rootMoves.length === 0) return null;

  // Iterative deepening
  let bestGlobal = null;
  let bestScoreGlobal = -INF;
  for (let d = Math.min(2, settings.maxDepth); d <= settings.maxDepth; d++){
    if (timeUp()) break;

    let alphaG = -INF, betaG = INF;
    let iterBest = null, iterScore = -INF;

    for (const m of rootMoves){
      if (timeUp()) break;

      const nb = (m.type === "capture")
        ? applyCapturePath(board, m.path)
        : (() => { const tmp = cloneBoard(board); const res = aplicarMovimiento(tmp, { from:m.from, to:m.to }); try{ crownIfNeeded(res, m.to);}catch{}; return res; })();

      const { score } = minimax(nb, (side === COLOR.ROJO ? COLOR.NEGRO : COLOR.ROJO), d-1, alphaG, betaG, false, false);
      if (score > iterScore){ iterScore = score; iterBest = m; }
      if (iterScore > alphaG) alphaG = iterScore;
      if (betaG <= alphaG) break;
    }

    if (iterBest){
      bestGlobal = iterBest;
      bestScoreGlobal = iterScore;
      const idx = rootMoves.findIndex(m => isSameMove(m, iterBest));
      if (idx > 0){ const [mv] = rootMoves.splice(idx,1); rootMoves.unshift(mv); }
    }
  }

  return bestGlobal;

  // helper
  function isSameMove(a, b){
    if (!a || !b) return false;
    if (a.type !== b.type) return false;
    if (a.type === 'quiet')
      return a.from[0]===b.from[0] && a.from[1]===b.from[1] && a.to[0]===b.to[0] && a.to[1]===b.to[1];
    const pa = a.path || [], pb = b.path || [];
    if (pa.length !== pb.length) return false;
    for (let i=0;i<pa.length;i++){
      if (pa[i][0]!==pb[i][0] || pa[i][1]!==pb[i][1]) return false;
    }
    return true;
  }
}
