# ai_engine.py  (IA-ENGINE v7)
# Motor de IA para Damas10x10 (nivel 3 aproximado)
# - Trabaja con tablero 10x10: lista de listas con 'r','n','R','N' o None
# - side: "R" (rojo/blancas) o "N" (negras)
# - Devuelve jugadas en formato algebraico: "e3-f4" o "c3-e5-g7" (cadena)

from typing import List, Optional, Tuple

Board = List[List[Optional[str]]]
Coord = Tuple[int, int]

BOARD_SIZE = 10
IA_ENGINE_VERSION = "IA-ENGINE v7"


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
    """No la usamos de momento, pero la dejamos por si acaso."""
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
        # fr/fc y tr/tc se mantienen para compatibilidad
        self.fr = fr
        self.fc = fc
        self.tr = tr
        self.tc = tc
        self.captures: List[Coord] = captures or []
        # route = lista de casillas por donde pasa la pieza:
        # [(r0,c0), (r1,c1), (r2,c2), ...]
        self.route: List[Coord] = route or [(fr, fc), (tr, tc)]

    @property
    def is_capture(self) -> bool:
        return len(self.captures) > 0

    def to_algebraic(self) -> str:
        """
        Si es quiet move: 'e3-f4'
        Si es captura en cadena: 'c3-e5-g7-i9' (toda la ruta)
        """
        if self.route and len(self.route) > 1:
            parts = [to_alg(r, c) for (r, c) in self.route]
            return "-".join(parts)
        # fallback (por si acaso)
        return f"{to_alg(self.fr, self.fc)}-{to_alg(self.tr, self.tc)}"

    def __repr__(self) -> str:
        return f"Move({self.fr},{self.fc}->{self.tr},{self.tc}, caps={self.captures}, route={self.route})"


def apply_move(board: Board, move: Move, side: str) -> Board:
    """Aplica una jugada sobre una copia del tablero."""
    newb = clone_board(board)
    piece = newb[move.fr][move.fc]
    newb[move.fr][move.fc] = None
    for (cr, cc) in move.captures:
        newb[cr][cc] = None
    newb[move.tr][move.tc] = piece

    # coronación similar a tu lógica JS
    if piece == "r" and move.tr == 0:
        newb[move.tr][move.tc] = "R"
    if piece == "n" and move.tr == BOARD_SIZE - 1:
        newb[move.tr][move.tc] = "N"

    return newb


# -------------------------------------------------------
# Reglas de dirección para peones (basadas en tipo de pieza)
# -------------------------------------------------------

def pawn_forward_dr(piece: str) -> int:
    """
    Devuelve el delta de fila 'adelante' para un peón.
    Según coronación:
      - 'r' se corona en fila 0 → avanza hacia arriba (fila disminuye): dr = -1
      - 'n' se corona en fila BOARD_SIZE-1 → avanza hacia abajo (fila aumenta): dr = +1
    """
    if piece == "r":
        return -1
    if piece == "n":
        return +1
    return 0


# -------------------------------------------------------
# Generación de capturas (rutas completas con multi-saltos)
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
    """
    DFS de capturas múltiples para una pieza.

    Reglas:
    1) Peones (r/n): solo capturan hacia adelante según SU tipo de pieza:
       - 'r': dr = -1 (fila disminuye).
       - 'n': dr = +1 (fila aumenta).
    2) Damas (R/N): capturan en las 4 diagonales (salto corto, 2 casillas).
    3) NO permitir:
       - volver a una casilla ya pisada como destino (r_to,c_to) → no estacionarse de nuevo.
       - usar el casillero inicial (start_r,start_c) como casilla intermedia (r_mid,c_mid)
         ni como casilla de destino (r_to,c_to).
       - volver a PASAR o CAER por una casilla donde YA hubo un peón enemigo capturado
         en esta misma cadena (coordenadas en `captures`).
    """
    piece = board[r][c]
    if piece is None:
        return

    enemy_color = "N" if side == "R" else "R"
    found = False

    # Casillas "prohibidas" para esta cadena:
    forbidden = set(captures)
    forbidden.add((start_r, start_c))

    for dr, dc in DIRECTIONS:
        # Restricción de dirección para peones (solo adelante)
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

        # No volver a casillas ya visitadas como destino (no estacionarse de nuevo)
        if (r_to, c_to) in path:
            continue

        # 🔴 NO podemos NI PASAR (r_mid,c_mid) NI CAER (r_to,c_to)
        # en casillas que:
        #  - sean el origen de la cadena
        #  - o hayan tenido ya un peón enemigo capturado en esta cadena
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

    # Si no encontramos más capturas, registramos la ruta completa
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
    """
    Genera todas las capturas posibles para 'side' y
    aplica la regla de máximo valor capturado:
    - Solo devuelve las jugadas cuya suma de piezas capturadas
      es la máxima posible en la posición.
    Además:
      - aplica la restricción de que la dama (o cualquier pieza)
        no puede volver a caer/pasar por casillas donde ya se capturó
        un peón enemigo en esta cadena (manejado en _explore_captures_for_piece).
      - en caso de EMPATE de valor total entre cadenas, se da
        PREFERENCIA a las jugadas donde la pieza que captura es una DAMA.
      - si sigue habiendo empate, se prefiere la jugada cuya casilla final
        esté más "adelantada" en la dirección natural de ese color.
    """
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

    # --- Regla de máximo valor capturado ---
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

    # --- Preferencia de DAMA vs peón (capturador) ---
    king_moves: List[Move] = []
    pawn_moves: List[Move] = []

    for mv in best_moves:
        piece = (
            board[mv.fr][mv.fc]
            if 0 <= mv.fr < BOARD_SIZE and 0 <= mv.fc < BOARD_SIZE
            else None
        )
        if is_king(piece):
            king_moves.append(mv)
        else:
            pawn_moves.append(mv)

    if king_moves and pawn_moves:
        candidate_moves = king_moves
    else:
        candidate_moves = best_moves

    # --- Tie-break: preferir la jugada que más AVANZA ---
    if len(candidate_moves) <= 1:
        return candidate_moves

    # Para negras: avanzar = fila más grande
    # Para rojas: avanzar = fila más pequeña
    if side == "N":
        best_row = max(mv.tr for mv in candidate_moves)
        advanced_moves = [mv for mv in candidate_moves if mv.tr == best_row]
    else:  # side == "R"
        best_row = min(mv.tr for mv in candidate_moves)
        advanced_moves = [mv for mv in candidate_moves if mv.tr == best_row]

    # Si tras aplicar avance nos quedamos con algo, usamos eso;
    # si por alguna razón no, devolvemos candidate_moves tal cual.
    if advanced_moves:
        return advanced_moves

    return candidate_moves


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

            # peones: solo hacia adelante según SU tipo, no según 'side'
            if is_king(piece):
                candidate_dirs = DIRECTIONS
            else:
                pf = pawn_forward_dr(piece)      # -1 para 'r', +1 para 'n'
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
    """Respeta la regla de 'si hay capturas, solo capturas', y si las hay,
    ya vienen filtradas por máximo valor capturado + preferencia de dama
    + preferencia de avance."""
    capture_moves = generate_capture_moves(board, side)
    if capture_moves:
        return capture_moves
    return generate_quiet_moves(board, side)


# -------------------------------------------------------
# Evaluación del tablero
# -------------------------------------------------------

def evaluate_board(board: Board, side: str) -> float:
    """
    Evalúa el tablero desde el punto de vista de 'side'.
    + material propio
    - material rival
    + ligera bonificación por avance de peones
    """
    own_color = side
    enemy_color = "N" if side == "R" else "R"

    own_score = 0.0
    enemy_score = 0.0

    for r in range(BOARD_SIZE):
        for c in range(BOARD_SIZE):
            ch = board[r][c]
            if ch is None:
                continue

            val = piece_value(ch)
            col = piece_color(ch)

            if col == own_color:
                own_score += val
                # avance de peones según tipo:
                if ch == "r":
                    # cuanto más arriba (r pequeño), mejor
                    own_score += (BOARD_SIZE - 1 - r) * 0.02
                elif ch == "n":
                    # cuanto más abajo (r grande), mejor
                    own_score += r * 0.02
            elif col == enemy_color:
                enemy_score += val

    return own_score - enemy_score


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
    """
    Devuelve (valor, mejor_movimiento) desde la perspectiva de maximizing_side.
    side_to_move indica quién mueve en este nodo.
    """
    if depth == 0:
        return evaluate_board(board, maximizing_side), None

    moves = generate_legal_moves(board, side_to_move)
    if not moves:
        # sin jugadas: posición "muerta" (puede contarse como pérdida)
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

            # pequeña extensión de capturas: si es captura, no reducimos tanto la profundidad
            next_depth = depth - 1
            if mv.is_capture and depth > 1:
                next_depth = depth  # extensiones suaves para cadenas

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
    """
    Devuelve la mejor captura inmediata (cadena completa) para 'side',
    ya respetando:
      - máximo valor capturado
      - preferencia de dama (si hay empate peón/dama)
      - preferencia de avance en caso de empate final.
    Si no hay capturas, devuelve None.
    """
    moves = generate_capture_moves(board, side)
    if not moves:
        return None

    best_mv = moves[0]
    return best_mv.to_algebraic()


def choose_best_move(board: Board, side: str, depth: int = 4) -> Optional[str]:
    """
    Motor principal:
    - Si hay capturas, generate_legal_moves ya devuelve solo capturas
      de máximo valor total + preferencia de dama + avance.
    - Si no hay capturas, explora también movimientos simples.
    - depth recomendado: 3–5 (cuidado con el rendimiento en servidores lentos).
    """
    if not board or len(board) != BOARD_SIZE:
        return None

    # Para depuración, puedes descomentar esto:
    # print(f"[{IA_ENGINE_VERSION}] choose_best_move side={side}, depth={depth}")

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
