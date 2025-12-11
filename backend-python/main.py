# main.py
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, validator, root_validator
from typing import Optional, List
from uuid import uuid4
from pathlib import Path
import json

import smtplib
from email.mime.text import MIMEText

# Motor fuerte (minimax u otro) definido en ai_engine.py
from ai_engine import choose_best_move

app = FastAPI(
    title="Backend Damas10x10",
    description="API de usuarios para Damas10x10 (versión inicial)",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # luego afinamos esto; por ahora es para desarrollo
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------------------------------------------------------
# "Base de datos" simple: archivo JSON
# -------------------------------------------------------------------
USERS_FILE = Path("users.json")

# -------------------------------------------------------------------
# Ruta donde guardaremos los logs de jugadas de IA
# -------------------------------------------------------------------
DATA_DIR = Path("data")
AI_MOVES_LOG = DATA_DIR / "ai_moves.jsonl"

# -------------------------------------------------------------------
# Configuración de correo (SMTP)
# -------------------------------------------------------------------
# ⚠️ IMPORTANTE:
# - SMTP_USER debe ser tu correo de Gmail.
# - SMTP_PASSWORD debe ser tu "contraseña de aplicación" de Google
#   (no tu contraseña normal de Gmail).
SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587
SMTP_USER = "TU_CORREO_GMAIL@gmail.com"          # <-- CAMBIAR
SMTP_PASSWORD = "TU_CONTRASENA_DE_APLICACION"    # <-- CAMBIAR
SENDER_NAME = "Reino de las Damas"
SENDER_EMAIL = SMTP_USER


def send_email(to_email: str, subject: str, body: str) -> None:
    """
    Envía un correo de texto plano usando SMTP.
    """
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = f"{SENDER_NAME} <{SENDER_EMAIL}>"
    msg["To"] = to_email

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
        server.starttls()
        server.login(SMTP_USER, SMTP_PASSWORD)
        server.send_message(msg)


# -------------------------------------------------------------------
# Modelos Pydantic (Usuarios)
# -------------------------------------------------------------------
class UserBase(BaseModel):
    name: str
    city: Optional[str] = None
    province: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    profile_photo_url: Optional[str] = None  # luego lo cambiaremos a upload real

    @validator("phone")
    def normalize_phone(cls, v):
        if v is None:
            return v
        v = v.strip()
        if v == "":
            return None
        if v and not any(ch.isdigit() for ch in v):
            raise ValueError("El teléfono debe contener al menos un dígito")
        return v

    @root_validator(skip_on_failure=True)
    def at_least_email_or_phone(cls, values):
        """
        Forzamos que exista al menos email o teléfono.
        Si vienen como "" los tratamos como None.
        """
        email = values.get("email")
        phone = values.get("phone")

        if isinstance(email, str):
            email = email.strip() or None
        if isinstance(phone, str):
            phone = phone.strip() or None

        if not email and not phone:
            raise ValueError("Debes ingresar email o teléfono (al menos uno)")

        values["email"] = email
        values["phone"] = phone
        return values


class UserCreate(UserBase):
    # Lo que llega en el registro
    password: str


class UserPublic(UserBase):
    # Lo que devolvemos al frontend (sin contraseña)
    id: str


class UserInDB(UserBase):
    # Lo que guardamos internamente
    id: str
    password_hash: str


# -------------------------------------------------------------------
# Modelos para IA (jugar contra la máquina)
# -------------------------------------------------------------------
class AIMoveRequest(BaseModel):
    """
    Petición desde el frontend para que la IA piense una jugada.

    - fen: posición actual (opcional).
    - side_to_move: "R" o "N" (quién debe jugar).
    - board: matriz 10x10 con 'r','n','R','N' o None (tablero real).
    """
    fen: Optional[str] = None
    side_to_move: str  # "R" (rojo/blancas) o "N" (negras)
    board: Optional[List[List[Optional[str]]]] = None


class AIMoveResponse(BaseModel):
    """
    Respuesta básica de la IA.
    """
    move: str  # ej: "e3-f4"
    reason: Optional[str] = None


# -------------------------------------------------------------------
# Modelos para logs de IA (aprendizaje por experiencia)
# -------------------------------------------------------------------
class MoveLogEntry(BaseModel):
    """
    Una entrada de log de jugada para entrenamiento.
    Hacemos todos los campos OPCIONALES para evitar errores 422 si
    algún dato viene como null, string, etc.
    Guardamos lo que llegue "tal cual" y luego lo limpiaremos offline.
    """
    ts: Optional[int] = None           # timestamp en ms (Date.now() del frontend)
    fen: Optional[str] = None          # posición en FEN o similar
    move: Optional[str] = None         # jugada, p.ej. "b6-a5" o "__GAME_RESULT__"
    score: Optional[float] = None      # +1 victoria IA, 0 interesante/empate, -1 derrota IA


class MoveLogBatch(BaseModel):
    """
    Lote de jugadas que el frontend envía para guardar.
    Hacemos una lista genérica de MoveLogEntry flexibles.
    """
    entries: List[MoveLogEntry]



# -------------------------------------------------------------------
# Utilidades para "hash" y manejo de archivo JSON
# -------------------------------------------------------------------
def fake_hash_password(password: str) -> str:
    """
    IMPORTANTE:
    Esto es SOLO TEMPORAL. Más adelante lo cambiaremos a bcrypt.
    """
    return "fakehashed_" + password


def load_users() -> List[UserInDB]:
    if not USERS_FILE.exists():
        return []
    text = USERS_FILE.read_text(encoding="utf-8").strip()
    if not text:
        return []
    data = json.loads(text)
    return [UserInDB(**item) for item in data]


def save_users(users: List[UserInDB]) -> None:
    data = [u.dict() for u in users]
    USERS_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def user_to_public(u: UserInDB) -> UserPublic:
    """Convierte el modelo interno (con password_hash) al modelo público."""
    return UserPublic(
        id=u.id,
        name=u.name,
        city=u.city,
        province=u.province,
        email=u.email,
        phone=u.phone,
        profile_photo_url=u.profile_photo_url,
    )


# -------------------------------------------------------------------
# Endpoint de salud
# -------------------------------------------------------------------
@app.get("/health")
def health():
    return {"status": "ok", "message": "Backend Damas10x10 funcionando"}


# -------------------------------------------------------------------
# POST /register  → registrar usuario
# -------------------------------------------------------------------
@app.post("/register", response_model=UserPublic)
def register(user_in: UserCreate):
    users = load_users()

    # Validar que email o teléfono no estén repetidos
    for u in users:
        if user_in.email and u.email == user_in.email:
            raise HTTPException(
                status_code=400,
                detail="Ya existe un usuario con ese email",
            )
        if user_in.phone and u.phone == user_in.phone:
            raise HTTPException(
                status_code=400,
                detail="Ya existe un usuario con ese teléfono",
            )

    user_id = str(uuid4())

    # Creamos el usuario interno con password_hash
    user_db = UserInDB(
        id=user_id,
        name=user_in.name,
        city=user_in.city,
        province=user_in.province,
        email=user_in.email,
        phone=user_in.phone,
        profile_photo_url=user_in.profile_photo_url,
        password_hash=fake_hash_password(user_in.password),
    )

    users.append(user_db)
    save_users(users)

    # Devolvemos versión pública sin contraseña
    return user_to_public(user_db)


# -------------------------------------------------------------------
# POST /login  → iniciar sesión
# -------------------------------------------------------------------
class LoginInput(BaseModel):
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    password: str

    @validator("phone")
    def normalize_phone_login(cls, v):
        if v is None:
            return None
        v = v.strip()
        return v or None

    @root_validator(skip_on_failure=True)
    def check_email_or_phone(cls, values):
        email = values.get("email")
        phone = values.get("phone")

        if isinstance(email, str):
            email = email.strip() or None
        if isinstance(phone, str):
            phone = phone.strip() or None

        if not email and not phone:
            raise ValueError("Debes ingresar email o teléfono")

        values["email"] = email
        values["phone"] = phone
        return values


@app.post("/login", response_model=UserPublic)
def login(data: LoginInput):
    users = load_users()

    # DEBUG: ver qué llegó realmente
    print(f"[LOGIN] email={data.email!r}, phone={data.phone!r}")

    # Buscar al usuario según email o teléfono
    user = None
    for u in users:
        if data.email and u.email == data.email:
            user = u
            break
        if data.phone and u.phone == data.phone:
            user = u
            break

    if not user:
        raise HTTPException(status_code=400, detail="Usuario no encontrado")

    # Verificar contraseña
    if user.password_hash != fake_hash_password(data.password):
        raise HTTPException(status_code=400, detail="Contraseña incorrecta")

    # Si todo está correcto, devolvemos el usuario sin contraseña
    return user_to_public(user)


# -------------------------------------------------------------------
# GET /users  → listar todos los usuarios (públicos)
# -------------------------------------------------------------------
@app.get("/users", response_model=List[UserPublic])
def list_users():
    users = load_users()
    return [user_to_public(u) for u in users]


# -------------------------------------------------------------------
# GET /me  → obtener datos de un usuario concreto (versión simple)
# -------------------------------------------------------------------
@app.get("/me", response_model=UserPublic)
def get_me(email: Optional[EmailStr] = None, phone: Optional[str] = None):
    """
    Versión sencilla de /me:
    - Por ahora recibe email o phone como query param.
    - Más adelante lo cambiaremos para que use token (JWT).
      Ejemplos:
        /me?email=wilmer@example.com
        /me?phone=0991234567
    """
    if not email and not phone:
        raise HTTPException(
            status_code=400,
            detail="Debes enviar email o teléfono como parámetro",
        )

    users = load_users()

    for u in users:
        if email and u.email == email:
            return user_to_public(u)
        if phone and u.phone == phone:
            return user_to_public(u)

    raise HTTPException(status_code=404, detail="Usuario no encontrado")


# -------------------------------------------------------------------
# POST /test-email  → enviar un correo de prueba
# -------------------------------------------------------------------
class TestEmailInput(BaseModel):
    email: EmailStr


@app.post("/test-email")
def test_email(data: TestEmailInput):
    """
    Envía un correo de prueba al email indicado.
    Úsalo solo para comprobar que la configuración SMTP funciona.
    """
    try:
        send_email(
            data.email,
            "Prueba de correo - Reino de las Damas",
            "Hola,\n\nEste es un correo de prueba enviado desde el backend de Damas10x10.\n\nSi ves este mensaje, el envío está funcionando correctamente.",
        )
        return {"ok": True, "message": f"Correo enviado a {data.email}"}
    except Exception as e:
        print("[EMAIL] Error al enviar:", repr(e))
        raise HTTPException(
            status_code=500,
            detail="No se pudo enviar el correo. Revisa la consola del servidor.",
        )


# -------------------------------------------------------------------
# IA: motor de CAPTURAS en Python usando la matriz board
# -------------------------------------------------------------------
def choose_ai_capture_move(board: List[List[Optional[str]]], side: str) -> Optional[str]:
    """
    Motor Python para CAPTURAS (solo capturas):
    - Detecta todas las rutas de captura posibles (saltos encadenados).
    - Calcula el valor de cada ruta (peón=1, dama=1.5).
    - Elige la ruta de mayor puntaje.
    - Devuelve solo el PRIMER tramo de la cadena en formato "e3-f4",
      para que el motor JS continúe la secuencia.
    """

    if not board:
        return None

    ROWS = len(board)
    COLS = len(board[0]) if ROWS > 0 else 0

    own = ("r", "R") if side == "R" else ("n", "N")
    opp = ("n", "N") if side == "R" else ("r", "R")

    def piece_value(ch: Optional[str]) -> float:
        if ch is None:
            return 0.0
        if ch in ("R", "N"):
            return 1.5
        if ch in ("r", "n"):
            return 1.0
        return 0.0

    def to_alg(r: int, c: int) -> str:
        col_letter = chr(ord("a") + c)
        row_num = ROWS - r
        return f"{col_letter}{row_num}"

    directions = [(-1, -1), (-1, 1), (1, -1), (1, 1)]

    best_routes: List[tuple[int, int]] = []
    best_score: float = 0.0

    def explore(r: int, c: int, b, score: float, path: List[tuple[int, int]]):
        nonlocal best_routes, best_score

        found_capture = False

        for dr, dc in directions:
            r_mid = r + dr
            c_mid = c + dc
            r_to = r + 2 * dr
            c_to = c + 2 * dc

            if not (0 <= r_mid < ROWS and 0 <= c_mid < COLS):
                continue
            if not (0 <= r_to < ROWS and 0 <= c_to < COLS):
                continue

            mid = b[r_mid][c_mid]
            dest = b[r_to][c_to]

            # Captura: pieza rival en medio y casilla de aterrizaje libre
            if mid in opp and dest is None:
                found_capture = True

                newb = [row[:] for row in b]
                newb[r][c] = None
                newb[r_mid][c_mid] = None
                newb[r_to][c_to] = b[r][c]

                new_score = score + piece_value(mid)
                new_path = path + [(r_to, c_to)]

                explore(r_to, c_to, newb, new_score, new_path)

        if not found_capture and score > 0:
            # Ruta completa
            if score > best_score:
                best_score = score
                best_routes = [path]
            elif score == best_score:
                best_routes.append(path)

    # Lanzar búsqueda de rutas desde cada pieza propia
    for r in range(ROWS):
        for c in range(COLS):
            ch = board[r][c]
            if ch in own:
                explore(r, c, board, 0.0, [(r, c)])

    if not best_routes:
        return None

    # Elegimos la primera ruta con puntaje máximo
    route = best_routes[0]
    if len(route) < 2:
        return None

    fr, fc = route[0]
    tr, tc = route[1]
    return f"{to_alg(fr, fc)}-{to_alg(tr, tc)}"


# -------------------------------------------------------------------
# POST /ai/log-moves  → guardar jugadas para entrenamiento IA
# -------------------------------------------------------------------
@app.post("/ai/log-moves")
def ai_log_moves(batch: MoveLogBatch):
    """
    Recibe un lote de jugadas desde el frontend y las guarda en un archivo JSONL.

    - No entrena nada todavía.
    - Solo acumula datos para análisis / entrenamiento posterior.
    """
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        with AI_MOVES_LOG.open("a", encoding="utf-8") as f:
            for entry in batch.entries:
                f.write(json.dumps(entry.dict(), ensure_ascii=False) + "\n")

        return {
            "status": "ok",
            "saved": len(batch.entries),
            "file": str(AI_MOVES_LOG),
        }
    except Exception as e:
        print("[AI-LOG] Error guardando logs:", repr(e))
        raise HTTPException(status_code=500, detail="Error guardando logs de IA")


# -------------------------------------------------------------------
# POST /ai/move  → pedir una jugada a la IA (SOLO movimientos sin captura)
# -------------------------------------------------------------------
@app.post("/ai/move", response_model=AIMoveResponse)
def ai_move(req: AIMoveRequest):
    """
    Endpoint IA (versión 2):

    - Recibe side_to_move ("R" o "N"), fen (opcional) y board (matriz 10x10).
    - IMPORTANTE: el frontend SOLO debe llamarlo cuando su motor JS
      ya verificó que NO hay capturas disponibles.
    - Esta IA Python SOLO propone movimientos "quiet" (sin captura),
      usando el motor fuerte minimax (choose_best_move).

    Flujo:
      1) Si no llega tablero → jugada fija de emergencia.
      2) Elegimos depth según cuántas piezas hay en el tablero.
      3) Llamamos a choose_best_move(board, side, depth).
      4) Si hay jugada → la devolvemos.
      5) Si falla o no hay jugada → devolvemos jugada fija.
    """

    if not req.board:
        return AIMoveResponse(
            move="e3-f4",
            reason="IA Python: no llegó tablero, usando jugada fija de prueba",
        )

    # ---------------------------
    # Elegir profundidad dinámica
    # ---------------------------
    total_pieces = sum(1 for row in req.board for cell in row if cell)

    # Apertura / tablero muy lleno
    if total_pieces >= 26:
        depth = 4   # antes 3
    # Medio juego
    elif total_pieces >= 12:
        depth = 5   # antes 4
    # Final
    else:
        depth = 6   # antes 5

    # Log en backend (solo consola de Python, NO sale en el navegador)
    print(f"[AI] ai_move: side={req.side_to_move}, piezas={total_pieces}, depth={depth}")

    move_str: Optional[str] = None

    try:
        # Llamamos al motor fuerte con la profundidad elegida
        move_str = choose_best_move(req.board, req.side_to_move, depth=depth)
        if move_str:
            return AIMoveResponse(
                move=move_str,
                reason=f"IA Python (minimax): jugada quiet con depth={depth}",
            )
    except Exception as e:
        print("[AI] Error en minimax choose_best_move:", repr(e))

    # Si aún así no hay jugada, devolvemos algo fijo para no romper frontend
    if not move_str:
        move_str = "e3-f4"
        reason = "IA Python: no encontró jugada, usando jugada fija de emergencia"
    else:
        reason = "IA Python: jugada de emergencia"

    return AIMoveResponse(
        move=move_str,
        reason=reason,
    )
