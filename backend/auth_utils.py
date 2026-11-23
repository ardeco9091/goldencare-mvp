"""Utilidades de hash de contraseñas (PBKDF2) y tokens firmados HMAC-SHA256."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
import unicodedata
from typing import Any

PBKDF2_ITERATIONS = 120_000
DEFAULT_PRESTADOR_PASSWORD = "prestador123"
TOKEN_TTL_SECONDS = 60 * 60 * 24  # 24 horas


def _get_auth_secret() -> bytes:
    secret = os.getenv(
        "AUTH_SECRET",
        os.getenv("ADMIN_PASSWORD", "goldencare-hmac-secret-2026"),
    )
    return secret.encode("utf-8")


def hash_password(plain_password: str) -> str:
    """Genera un hash seguro usando hashlib.pbkdf2_hmac con sal aleatoria."""

    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac(
        "sha256",
        plain_password.encode("utf-8"),
        salt.encode("utf-8"),
        PBKDF2_ITERATIONS,
    )
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt}${dk.hex()}"


def verify_password(plain_password: str, stored_hash: str | None) -> bool:
    """Verifica una contraseña en texto plano contra su hash PBKDF2."""

    if not stored_hash or not plain_password:
        return False
    parts = stored_hash.split("$")
    if len(parts) != 4 or parts[0] != "pbkdf2_sha256":
        return False
    try:
        iterations = int(parts[1])
    except ValueError:
        return False
    salt, expected_hex = parts[2], parts[3]
    dk = hashlib.pbkdf2_hmac(
        "sha256",
        plain_password.encode("utf-8"),
        salt.encode("utf-8"),
        iterations,
    )
    return hmac.compare_digest(dk.hex(), expected_hex)


def normalizar_email_prestador(rol: str, existentes: set[str] | None = None) -> str:
    """Genera un correo normalizado '<nombre>@goldencare.com' a partir del campo rol."""

    nombre_base = re.split(r"\s*[-–—·]\s*", (rol or "").strip())[0].strip()
    sin_acentos = (
        unicodedata.normalize("NFKD", nombre_base)
        .encode("ascii", "ignore")
        .decode("ascii")
        .lower()
    )
    slug = re.sub(r"[^a-z0-9]+", ".", sin_acentos).strip(".")
    if not slug:
        slug = "prestador"

    candidato = f"{slug}@goldencare.com"
    if existentes is None or candidato not in existentes:
        return candidato

    contador = 2
    while f"{slug}{contador}@goldencare.com" in existentes:
        contador += 1
    return f"{slug}{contador}@goldencare.com"


def parsear_rol_prestador(rol: str) -> tuple[str, str]:
    """Separa 'Nombre - Especialidad' en (nombre, especialidad)."""

    limpio = (rol or "").strip()
    partes = re.split(r"\s*[-–—·]\s*", limpio)
    nombre = partes[0].strip() if partes and partes[0].strip() else limpio or "Prestador"
    especialidad = (
        " · ".join(p.strip() for p in partes[1:] if p.strip())
        if len(partes) > 1
        else "Asistencia GoldenCare"
    )
    return nombre, especialidad


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode((data + padding).encode("ascii"))


def create_access_token(
    subject: str,
    role: str,
    email: str,
    id_prestador: str | None = None,
    ttl_seconds: int = TOKEN_TTL_SECONDS,
) -> str:
    """Crea un token compacto firmado con HMAC-SHA256."""

    payload: dict[str, Any] = {
        "sub": subject,
        "role": role,
        "email": email,
        "exp": int(time.time()) + ttl_seconds,
    }
    if id_prestador is not None:
        payload["id_prestador"] = id_prestador
    payload_bytes = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode(
        "utf-8"
    )
    payload_b64 = _b64url_encode(payload_bytes)
    signature = hmac.new(
        _get_auth_secret(),
        payload_b64.encode("ascii"),
        hashlib.sha256,
    ).digest()
    sig_b64 = _b64url_encode(signature)
    return f"{payload_b64}.{sig_b64}"


def verify_access_token(token: str) -> dict[str, Any] | None:
    """Valida firma HMAC-SHA256 y expiración; devuelve los claims o None si es inválido."""

    if not token or "." not in token:
        return None
    parts = token.split(".")
    if len(parts) != 2:
        return None
    payload_b64, sig_b64 = parts
    expected_sig = hmac.new(
        _get_auth_secret(),
        payload_b64.encode("ascii"),
        hashlib.sha256,
    ).digest()
    expected_sig_b64 = _b64url_encode(expected_sig)
    if not hmac.compare_digest(sig_b64, expected_sig_b64):
        return None

    try:
        payload = json.loads(_b64url_decode(payload_b64).decode("utf-8"))
    except (ValueError, KeyError, UnicodeDecodeError):
        return None

    if not isinstance(payload, dict):
        return None
    exp = payload.get("exp")
    if not isinstance(exp, int) or exp < int(time.time()):
        return None

    return payload
