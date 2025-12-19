# ai_engine.py  (IA-ENGINE v7+experiencia por KEY canónica)
# Motor de IA para Damas10x10 (nivel 3 aproximado)
# - Tablero 10x10: lista de listas con 'r','n','R','N' o None
# - side: "R" (rojo/blancas) o "N" (negras)
# - Devuelve jugadas en formato algebraico: "e3-f4" o "c3-e5-g7" (cadena)

from typing import List, Optional, Tuple, Dict, Any
from pathlib import Path
import json

Board = List[List[Optional[str]]]
Coord = Tuple[int, int]

BOARD_SIZE = 10
IA_ENGINE_VERSION = "IA-ENGINE v7+EXP"

# -------------------------------------------------------------------
# Archivo donde se guardan las jugadas de experiencia (JSONL)
# generado por /ai/log-moves
# -------------------------------------------------------------------
LEARNED_FILE = (Path(__file__).resolve().parent / "data" / "ai_moves.jsonl")


# -------------------------------------------------------------------
# Key canónica del tablero (UNIFICACIÓN)
# - '.' para vacío
# - 10 filas separadas por '/'
# - incluye side al final
# Ej: "....n...../..r......./... (10 filas) ...|side:N"
# -------------------------------------------------------------------
def board_to_key(board: Board, side: str) -> str:
    rows: List[str] = []
    for r in range(BOARD_SIZE):
        row_chars: List[str] = []
        for c in range(BOARD_SIZE):
            ch = board[r][c]
            row_chars.append(ch if ch else ".")
        rows.append("".join(row_chars))
    return "/".join(rows) + f"|side:{side}"


# -------------------------------------------------------------------
# ✅ NUEVO: helpers para aprendizaje independiente del side
# -------------------------------------------------------------------
def strip_side_from_key(k: str) -> str:
    """Quita '|side:R' / '|side:N' si existe."""
    if not isinstance(k, str):
        return ""
    if "|side:" in k:
        return k.split("|side:")[0]
    return k


def legal_moves_set(board: Board, side: str) -> set:
    """Movimientos legales en formato algebraico."""
    try:
        return {mv.to_algebraic() for mv in generate_legal_moves(board, side)}
    except Exception:
        return set()


# -------------------------------------------------------------------
# Carga de patrones aprendidos desde ai_moves.jsonl (por KEY)
# Soporta:
#  - formato recomendado: {"k": "<key>", "move": "e3-f4", "score": 1, ...}
#  - fallback legacy: {"fen": "<fen>", "move": "..."} si aún existe
# Acumula puntaje por jugada o conteo si no hay score
# -------------------------------------------------------------------
def load_learned_patterns(
    max_lines: int = 5000,
) -> Dict[str, Dict[str, float]]:
    """
    Devuelve:
      patrones: dict
        {
          "<key_or_fen>": {
             "<move>": score_acumulado (float),
             ...
          },
          ...
        }
    """
    patrones: Dict[str, Dict[str, float]] = {}

    if not LEARNED_FILE.exists():
        print(f"[IA-LEARN][LOAD] file NOT FOUND -> {LEARNED_FILE}")
        return patrones

    # Confirmar que se está leyendo el archivo correcto y actualizado
    try:
        st = LEARNED_FILE.stat()
        print(
            f"[IA-LEARN][LOAD] file={LEARNED_FILE} "
            f"bytes={st.st_size} mtime={int(st.st_mtime)} max_lines={max_lines}"
        )
    except Exception as e:
        print(f"[IA-LEARN][LOAD] stat error: {repr(e)} file={LEARNED_FILE}")

    loaded_lines = 0

    with LEARNED_FILE.open("r", encoding="utf-8") as f:
        for i, line in enumerate(f):
            if i >= max_lines:
                break
            line = line.strip()
            if not line:
                continue

            loaded_lines += 1

            try:
                row = json.loads(line)
            except Exception:
                continue

            move = row.get("move")
            if not move or move == "__GAME_RESULT__":
                continue

            k = row.get("k")
            fen = row.get("fen")

            key = k or fen
            if key is None:
                continue

            # si key viene como lista/dict (legacy), convertir a string estable
            if not isinstance(key, str):
                try:
                    key = json.dumps(key, ensure_ascii=False, separators=(",", ":"))
                except Exception:
                    continue

            try:
                score = float(row.get("score", 1.0))
            except Exception:
                score = 1.0

            # ✅ Guardar por KEY completa (con side)
            d = patrones.setdefault(key, {})
            d[move] = d.get(move, 0.0) + score

            # ✅ NUEVO: guardar también por KEY SIN side
            base = strip_side_from_key(key)
            if base and base != key:
                d2 = patrones.setdefault(base, {})
                d2[move] = d2.get(move, 0.0) + score

    print(f"[IA-LEARN][LOAD] lines_scanned={loaded_lines} keys_loaded={len(patrones)}")

    return patrones


def get_learned_move_by_key(
    key: Optional[str],
    max_lines: int = 5000,
) -> Optional[str]:
    """
    Si existe una jugada aprendida para esta KEY en ai_moves.jsonl,
    devuelve la jugada con mayor score acumulado. Si no, devuelve None.
    """
    if not key:
        print("[IA-LEARN] key=None (no se puede buscar)")
        return None

    patrones = load_learned_patterns(max_lines=max_lines)

    print(f"[IA-LEARN][LOOKUP] searching key_head={key[:90]}...")

    moves_for_key = patrones.get(key)
    if not moves_for_key:
        print(f"[IA-LEARN] MISS key -> {key[:90]}...")
        return None

    best_move, best_score = None, float("-inf")
    for move_str, score in moves_for_key.items():
        if score > best_score:
            best_score = score
            best_move = move_str

    if best_move is not None:
        print(f"[IA-LEARN] HIT key -> {best_move} (score={best_score})")

    return best_move


def get_learned_move_fallback_fen(
    fen: Optional[str],
    max_lines: int = 5000,
) -> Optional[str]:
    """
    Fallback opcional (legacy): si en tu JSONL aún guardas 'fen'
    y por ahora tu frontend/backend lo manda, esto lo soporta.
    """
    if not fen:
        return None

    if not isinstance(fen, str):
        try:
            fen = json.dumps(fen, ensure_ascii=False, separators=(",", ":"))
        except Exception:
            return None

    patrones = load_learned_patterns(max_lines=max_lines)
    moves_for_fen = patrones.get(fen)
    if not moves_for_fen:
        return None

    best_move, best_score = None, float("-inf")
    for move_str, score in moves_for_fen.items():
        if score > best_score:
            best_score = score
            best_move = move_str

    if best_move is not None:
        print(f"[IA-LEARN] HIT fen -> {best_move} (score={best_score})")

    return best_move


# -------------------------------------------------------
# Utilidades básicas sobre piezas/tablero
# -------------------------------------------------------
def piece_color(ch: Optional[str]) -> Optional[str]:
    """Devuelve 'R' o 'N' según la pieza, o None si no hay pieza."""
    if ch in ("r", "R"):
        return "R"
    if ch in ("n", "N"):
        return "N"
    return None


def is_king(ch: Optional[str]) -> bool:
    return ch in ("R", "N")


def piece_value(ch: Optional[str]) -> float:
    """Valor simple: peón=1, dama=1.5."""
    if ch is None:
        return 0.0
    if ch in ("R", "N"):
        return 1.5
    if ch in ("r", "n"):
        return 1.0
    return 0.0


def clone_board(board: Board) -> Board:
    return [row[:] for row in board]


def in_bounds(r: int, c: int) -> bool:
    return 0 <= r < BOARD_SIZE and 0 <= c < BOARD_SIZE


def to_alg(r: int, c: int) -> str:
    """Convierte (row, col) → 'a1'..'j10'.
    row 9 → 1 (abajo), row 0 → 10 (arriba)."""
    col_letter = chr(ord("a") + c)
    row_num = BOARD_SIZE - r
    return f"{col_letter}{row_num}"


def from_alg(coord: str) -> Coord:
    col = ord(coord[0].lower()) - ord("a")
    row_num = int(coord[1:])
    row = BOARD_SIZE - row_num
    return (row, col)


# -------------------------------------------------------
# Representación de jugadas
# -------------------------------------------------------
class Move:
    __slots__ = ("fr", "fc", "tr", "tc", "captures", "route")

    def __init__(
        self,
        fr: int,
        fc: int,
        tr: int,
        tc: int,
        captures: Optional[List[Coord]] = None,
        route: Optional[List[Coord]] = None,
    ) -> None:
        self.fr = fr
        self.fc = fc
        self.tr = tr
        self.tc = tc
        self.captures: List[Coord] = captures or []
        self.route: List[Coord] = route or [(fr, fc), (tr, tc)]

    @property
    def is_capture(self) -> bool:
        return len(self.captures) > 0

    def to_algebraic(self) -> str:
        if self.route and len(self.route) > 1:
            parts = [to_alg(r, c) for (r, c) in self.route]
            return "-".join(parts)
        return f"{to_alg(self.fr, self.fc)}-{to_alg(self.tr, self.tc)}"

    def __repr__(self) -> str:
        return f"Move({self.fr},{self.fc}->{self.tr},{self.tc}, caps={self.captures}, route={self.route})"


def apply_move(board: Board, move: Move, side: str) -> Board:
    newb = clone_board(board)
    piece = newb[move.fr][move.fc]
    newb[move.fr][move.fc] = None
    for (cr, cc) in move.captures:
        newb[cr][cc] = None
    newb[move.tr][move.tc] = piece

    if piece == "r" and move.tr == 0:
        newb[move.tr][move.tc] = "R"
    if piece == "n" and move.tr == BOARD_SIZE - 1:
        newb[move.tr][move.tc] = "N"

    return newb


# -------------------------------------------------------
# Reglas de dirección para peones
# -------------------------------------------------------
def pawn_forward_dr(piece: str) -> int:
    if piece == "r":
        return -1
    if piece == "n":
        return +1
    return 0


# -------------------------------------------------------
# Generación de capturas (multi-saltos)
# -------------------------------------------------------
DIRECTIONS = [(-1, -1), (-1, 1), (1, -1), (1, 1)]


def _explore_captures_for_piece(
    board: Board,
    side: str,
    r: int,
    c: int,
    path: List[Coord],
    captures: List[Coord],
    results: List[Move],
    start_r: int,
    start_c: int,
) -> None:
    piece = board[r][c]
    if piece is None:
        return

    enemy_color = "N" if side == "R" else "R"
    found = False

    forbidden = set(captures)
    forbidden.add((start_r, start_c))

    for dr, dc in DIRECTIONS:
        if not is_king(piece):
            pf = pawn_forward_dr(piece)
            if dr != pf:
                continue

        r_mid = r + dr
        c_mid = c + dc
        r_to = r + 2 * dr
        c_to = c + 2 * dc

        if not (in_bounds(r_mid, c_mid) and in_bounds(r_to, c_to)):
            continue

        if (r_to, c_to) in path:
            continue

        if (r_mid, c_mid) in forbidden or (r_to, c_to) in forbidden:
            continue

        mid_piece = board[r_mid][c_mid]
        dest_piece = board[r_to][c_to]

        if (
            mid_piece is not None
            and piece_color(mid_piece) == enemy_color
            and dest_piece is None
        ):
            found = True
            new_board = clone_board(board)
            moving_piece = new_board[r][c]
            new_board[r][c] = None
            new_board[r_mid][c_mid] = None
            new_board[r_to][c_to] = moving_piece

            new_path = path + [(r_to, c_to)]
            new_captures = captures + [(r_mid, c_mid)]

            _explore_captures_for_piece(
                new_board,
                side,
                r_to,
                c_to,
                new_path,
                new_captures,
                results,
                start_r,
                start_c,
            )

    if not found and captures:
        start_rr, start_cc = path[0]
        end_r, end_c = path[-1]
        results.append(
            Move(
                start_rr,
                start_cc,
                end_r,
                end_c,
                captures=list(captures),
                route=list(path),
            )
        )


def generate_capture_moves(board: Board, side: str) -> List[Move]:
    all_moves: List[Move] = []

    for r in range(BOARD_SIZE):
        for c in range(BOARD_SIZE):
            piece = board[r][c]
            if piece is None:
                continue
            if piece_color(piece) != side:
                continue

            _explore_captures_for_piece(
                board,
                side,
                r,
                c,
                path=[(r, c)],
                captures=[],
                results=all_moves,
                start_r=r,
                start_c=c,
            )

    if not all_moves:
        return []

    values: List[float] = []
    for mv in all_moves:
        v = sum(piece_value(board[rr][cc]) for (rr, cc) in mv.captures)
        values.append(v)

    max_val = max(values)
    best_moves: List[Move] = []
    for mv in all_moves:
        captured_value = sum(piece_value(board[rr][cc]) for (rr, cc) in mv.captures)
        if captured_value == max_val:
            best_moves.append(mv)

    king_moves: List[Move] = []
    pawn_moves: List[Move] = []

    for mv in best_moves:
        piece = board[mv.fr][mv.fc] if 0 <= mv.fr < BOARD_SIZE and 0 <= mv.fc < BOARD_SIZE else None
        if is_king(piece):
            king_moves.append(mv)
        else:
            pawn_moves.append(mv)

    if king_moves and pawn_moves:
        candidate_moves = king_moves
    else:
        candidate_moves = best_moves

    if len(candidate_moves) <= 1:
        return candidate_moves

    if side == "N":
        best_row = max(mv.tr for mv in candidate_moves)
        advanced_moves = [mv for mv in candidate_moves if mv.tr == best_row]
    else:
        best_row = min(mv.tr for mv in candidate_moves)
        advanced_moves = [mv for mv in candidate_moves if mv.tr == best_row]

    return advanced_moves if advanced_moves else candidate_moves


# -------------------------------------------------------
# Movimientos simples (sin captura)
# -------------------------------------------------------
def generate_quiet_moves(board: Board, side: str) -> List[Move]:
    moves: List[Move] = []

    for r in range(BOARD_SIZE):
        for c in range(BOARD_SIZE):
            piece = board[r][c]
            if piece is None:
                continue
            if piece_color(piece) != side:
                continue

            if is_king(piece):
                candidate_dirs = DIRECTIONS
            else:
                pf = pawn_forward_dr(piece)
                candidate_dirs = [(pf, -1), (pf, 1)]

            for dr, dc in candidate_dirs:
                rr = r + dr
                cc = c + dc
                if not in_bounds(rr, cc):
                    continue
                if board[rr][cc] is None:
                    moves.append(
                        Move(
                            r,
                            c,
                            rr,
                            cc,
                            captures=[],
                            route=[(r, c), (rr, cc)],
                        )
                    )

    return moves


def generate_legal_moves(board: Board, side: str) -> List[Move]:
    capture_moves = generate_capture_moves(board, side)
    if capture_moves:
        return capture_moves
    return generate_quiet_moves(board, side)


# -------------------------------------------------------
# Evaluación
# -------------------------------------------------------
def evaluate_board(board: Board, side: str) -> float:
    PAWN_VALUE          = 1.0
    KING_VALUE          = 1.5
    ADVANCE_WEIGHT      = 0.01
    KING_CENTER_WEIGHT  = 0.06
    EDGE_PENALTY        = 0.03
    MOBILITY_WEIGHT     = 0.03

    own_color   = side
    enemy_color = "N" if side == "R" else "R"

    own_score   = 0.0
    enemy_score = 0.0

    center_row = (BOARD_SIZE - 1) / 2.0
    center_col = (BOARD_SIZE - 1) / 2.0

    for r in range(BOARD_SIZE):
        for c in range(BOARD_SIZE):
            ch = board[r][c]
            if not ch:
                continue

            col = piece_color(ch)
            if col is None:
                continue

            val = KING_VALUE if is_king(ch) else PAWN_VALUE

            if col == own_color:
                own_score += val
            elif col == enemy_color:
                enemy_score += val

            if ch == "r":
                advance = (BOARD_SIZE - 1 - r)
                if col == own_color:
                    own_score += advance * ADVANCE_WEIGHT
                elif col == enemy_color:
                    enemy_score += advance * ADVANCE_WEIGHT
            elif ch == "n":
                advance = r
                if col == own_color:
                    own_score += advance * ADVANCE_WEIGHT
                elif col == enemy_color:
                    enemy_score += advance * ADVANCE_WEIGHT

            if is_king(ch):
                dist_center = abs(r - center_row) + abs(c - center_col)
                center_bonus = max(0.0, 4.0 - dist_center) * KING_CENTER_WEIGHT
                if col == own_color:
                    own_score += center_bonus
                elif col == enemy_color:
                    enemy_score += center_bonus

            if ch in ("r", "n") and (c == 0 or c == BOARD_SIZE - 1):
                if col == own_color:
                    own_score -= EDGE_PENALTY
                elif col == enemy_color:
                    enemy_score -= EDGE_PENALTY

    try:
        own_moves   = len(generate_quiet_moves(board, own_color))
        enemy_moves = len(generate_quiet_moves(board, enemy_color))
        mobility_score = (own_moves - enemy_moves) * MOBILITY_WEIGHT
    except Exception:
        mobility_score = 0.0

    return (own_score - enemy_score) + mobility_score


# -------------------------------------------------------
# MINIMAX + alpha-beta
# -------------------------------------------------------
def minimax(
    board: Board,
    side_to_move: str,
    depth: int,
    alpha: float,
    beta: float,
    maximizing_side: str,
) -> Tuple[float, Optional[Move]]:
    if depth == 0:
        return evaluate_board(board, maximizing_side), None

    moves = generate_legal_moves(board, side_to_move)
    if not moves:
        score = evaluate_board(board, maximizing_side)
        if side_to_move == maximizing_side:
            score -= 2.0
        else:
            score += 2.0
        return score, None

    best_move: Optional[Move] = None

    if side_to_move == maximizing_side:
        value = float("-inf")
        for mv in moves:
            newb = apply_move(board, mv, side_to_move)
            next_side = "N" if side_to_move == "R" else "R"

            next_depth = depth - 1
            if mv.is_capture and depth > 1:
                next_depth = depth

            child_val, _ = minimax(newb, next_side, next_depth, alpha, beta, maximizing_side)

            if child_val > value:
                value = child_val
                best_move = mv

            alpha = max(alpha, value)
            if beta <= alpha:
                break

        return value, best_move
    else:
        value = float("inf")
        for mv in moves:
            newb = apply_move(board, mv, side_to_move)
            next_side = "N" if side_to_move == "R" else "R"

            next_depth = depth - 1
            if mv.is_capture and depth > 1:
                next_depth = depth

            child_val, _ = minimax(newb, next_side, next_depth, alpha, beta, maximizing_side)

            if child_val < value:
                value = child_val
                best_move = mv

            beta = min(beta, value)
            if beta <= alpha:
                break

        return value, best_move


# -------------------------------------------------------
# API pública usada por main.py
# -------------------------------------------------------
def choose_ai_capture_move(board: Board, side: str) -> Optional[str]:
    moves = generate_capture_moves(board, side)
    if not moves:
        return None
    return moves[0].to_algebraic()


def choose_best_move(
    board: Board,
    side: str,
    depth: int = 4,
    fen: Optional[str] = None,          # legacy/optional
    use_learned: bool = True,
    learned_max_lines: int = 5000,
) -> Optional[str]:
    """
    Motor principal:
    1) EXPERIENCIA (por key canónica) -> si hay match, usarla
    2) ✅ NUEVO: fallback por key sin side (solo si jugada es legal)
    3) (opcional) fallback legacy por fen si lo estás usando
    4) MINIMAX normal
    """
    if not board or len(board) != BOARD_SIZE:
        return None

    if use_learned:
        try:
            # 1) Match exacto (con side)
            key = board_to_key(board, side)
            learned = get_learned_move_by_key(key, max_lines=learned_max_lines)
            if learned:
                return learned

            # 2) ✅ Fallback: match por tablero SIN side
            base = strip_side_from_key(key)
            learned2 = get_learned_move_by_key(base, max_lines=learned_max_lines)
            if learned2:
                legal = legal_moves_set(board, side)
                if learned2 in legal:
                    print(f"[IA-LEARN] HIT base-key ✅ {learned2}")
                    return learned2
                else:
                    print(f"[IA-LEARN] base-key encontró jugada NO legal para side={side}: {learned2}")

        except Exception as e:
            print(f"[IA-LEARN] ERROR leyendo experiencia: {e}")

        if fen:
            try:
                learned3 = get_learned_move_fallback_fen(fen, max_lines=learned_max_lines)
                if learned3:
                    return learned3
            except Exception as e:
                print(f"[IA-LEARN] ERROR leyendo experiencia por fen: {e}")

    _, best_mv = minimax(
        board,
        side_to_move=side,
        depth=depth,
        alpha=float("-inf"),
        beta=float("inf"),
        maximizing_side=side,
    )

    if best_mv is None:
        return None

    return best_mv.to_algebraic()
