from fastapi import APIRouter, Depends, HTTPException, status, Header
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr
from datetime import datetime, timedelta
from jose import JWTError, jwt
from passlib.context import CryptContext
import os

router = APIRouter(prefix="/auth", tags=["auth"])

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

# In‑memory user store for demo (replace with DB in production)
_users_db = {}

pwd_context = CryptContext(schemes=["bcrypt_sha256"], deprecated="auto")

class UserCreate(BaseModel):
    email: EmailStr
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: timedelta | None = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=30))
    to_encode.update({"exp": expire})
    secret = os.getenv("JWT_SECRET_KEY", "change-me-secret")
    return jwt.encode(to_encode, secret, algorithm="HS256")

@router.post("/register", response_model=Token)
async def register(form: UserCreate):
    if form.email in _users_db:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")
    _users_db[form.email] = get_password_hash(form.password)
    access_token = create_access_token({"sub": form.email})
    return Token(access_token=access_token)

@router.post("/login", response_model=Token)
async def login(req: LoginRequest):
    user_hash = _users_db.get(req.email)
    if not user_hash or not verify_password(req.password, user_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    access_token = create_access_token({"sub": req.email})
    return Token(access_token=access_token)

# Helper to verify JWT token from Authorization header
def verify_jwt_token(authorization: str = Header(None)):
    if not authorization:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing token")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token format")
    secret = os.getenv("JWT_SECRET_KEY", "change-me-secret")
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
        return payload
    except JWTError as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
