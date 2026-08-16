"""
auth.py — JWT-based multi-user authentication with MongoDB persistence.

Access tokens: 15 min, signed with JWT_SECRET_KEY.
Refresh tokens: 30 days, signed with JWT_REFRESH_SECRET, stored in httpOnly cookie.
Refresh token rotation: every /auth/refresh call issues a brand-new refresh token.

Startup fails with a clear error if either secret is missing from the environment.
"""
from fastapi import APIRouter, HTTPException, status, Header, Response, Request
from pydantic import BaseModel, EmailStr
from datetime import datetime, timedelta
from jose import JWTError, jwt
import bcrypt
import os

from .db import users as user_db

router = APIRouter(prefix="/auth", tags=["auth"])

# ── Secrets — NO fallback defaults; fail fast if missing ────────────────────
_ACCESS_SECRET = os.getenv("JWT_SECRET_KEY")
_REFRESH_SECRET = os.getenv("JWT_REFRESH_SECRET")

if not _ACCESS_SECRET:
    raise RuntimeError(
        "JWT_SECRET_KEY is not set. "
        "Add it to your .env file before starting the server."
    )
if not _REFRESH_SECRET:
    raise RuntimeError(
        "JWT_REFRESH_SECRET is not set. "
        "Add it to your .env file before starting the server."
    )

ACCESS_SECRET: str = _ACCESS_SECRET
REFRESH_SECRET: str = _REFRESH_SECRET

# ── Token lifetimes ─────────────────────────────────────────────────────────
ACCESS_TOKEN_EXPIRE_MINUTES = 15
REFRESH_TOKEN_EXPIRE_DAYS = 30

# ── Pydantic models ─────────────────────────────────────────────────────────
class UserCreate(BaseModel):
    email: EmailStr
    password: str

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


# ── Helpers ─────────────────────────────────────────────────────────────────
def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False

def get_password_hash(password: str) -> str:
    # Use standard gensalt() strength (default is 12)
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")

def create_access_token(user_id: str) -> str:
    from datetime import timezone
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode({"sub": user_id, "exp": expire}, ACCESS_SECRET, algorithm="HS256")

def create_refresh_token(user_id: str) -> str:
    from datetime import timezone
    expire = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    return jwt.encode({"sub": user_id, "exp": expire}, REFRESH_SECRET, algorithm="HS256")

def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key="refresh_token",
        value=token,
        httponly=True,
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        path="/auth",
        samesite="lax",
    )


# ── Auth endpoints ───────────────────────────────────────────────────────────
@router.post("/register", response_model=TokenResponse, status_code=201)
async def register(form: UserCreate, response: Response):
    if await user_db.get_user_by_email(form.email):
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    uid = await user_db.create_user(form.email, get_password_hash(form.password))
    _set_refresh_cookie(response, create_refresh_token(uid))
    return TokenResponse(access_token=create_access_token(uid))


@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest, response: Response):
    user = await user_db.get_user_by_email(req.email)
    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    uid = str(user["_id"])
    _set_refresh_cookie(response, create_refresh_token(uid))
    return TokenResponse(access_token=create_access_token(uid))


@router.post("/refresh", response_model=TokenResponse)
async def refresh_tokens(request: Request, response: Response):
    """Issue new access + refresh tokens (rotation). Reads refresh token from httpOnly cookie."""
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing refresh token")
    try:
        payload = jwt.decode(token, REFRESH_SECRET, algorithms=["HS256"])
        uid: str = payload["sub"]
    except (JWTError, KeyError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired refresh token")
    if not await user_db.get_user_by_id(uid):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")
    # Rotation: issue brand-new refresh token every time
    _set_refresh_cookie(response, create_refresh_token(uid))
    return TokenResponse(access_token=create_access_token(uid))


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(key="refresh_token", path="/auth")
    return {"msg": "Logged out"}


# ── FastAPI dependency ───────────────────────────────────────────────────────
def get_current_user_id(authorization: str = Header(None)) -> str:
    """Validate Bearer access token; return the user_id (sub claim)."""
    if not authorization:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing Authorization header")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token format")
    try:
        payload = jwt.decode(token, ACCESS_SECRET, algorithms=["HS256"])
        uid: str = payload["sub"]
        return uid
    except (JWTError, KeyError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")

