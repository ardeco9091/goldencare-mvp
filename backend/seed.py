"""Carga determinista e idempotente del dataset inicial de GoldenCare (San Pedro de Jujuy).

Ejecutar desde la raíz o desde la carpeta backend:

    python backend/seed.py
"""

from __future__ import annotations

import os
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.orm import Session

try:  # Permite ejecutar `python seed.py` o importar `backend.seed`.
    from .auth_utils import (
        DEFAULT_PRESTADOR_PASSWORD,
        hash_password,
        normalizar_email_prestador,
    )
    from .models import (
        Asignacion,
        Base,
        Contacto_Familiar,
        Encuesta,
        Persona_Usuaria,
        Prestador,
        Servicio,
    )
except ImportError:  # pragma: no cover - ruta usada por ejecución directa.
    from auth_utils import (
        DEFAULT_PRESTADOR_PASSWORD,
        hash_password,
        normalizar_email_prestador,
    )
    from models import (
        Asignacion,
        Base,
        Contacto_Familiar,
        Encuesta,
        Persona_Usuaria,
        Prestador,
        Servicio,
    )


DEFAULT_DATABASE = Path(__file__).resolve().parent / "goldencare.db"
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DEFAULT_DATABASE.as_posix()}")
DATABASE_URL = re.sub(r"^postgres(ql)?://", "postgresql+psycopg://", DATABASE_URL)

engine_kwargs: dict[str, Any] = {}
if DATABASE_URL.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}

engine = create_engine(DATABASE_URL, **engine_kwargs)


USUARIO_IDS = {
    "ana": UUID("11111111-1111-4111-8111-111111111111"),
    "carlos": UUID("22222222-2222-4222-8222-222222222222"),
    "marta": UUID("33333333-3333-4333-8333-333333333333"),
    "jorge": UUID("44444444-4444-4444-8444-444444444444"),
}

CONTACTO_IDS = {
    "ana": UUID("c1111111-1111-4111-8111-111111111111"),
    "carlos": UUID("c2222222-2222-4222-8222-222222222222"),
    "marta": UUID("c3333333-3333-4333-8333-333333333333"),
    "jorge": UUID("c4444444-4444-4444-8444-444444444444"),
}

PRESTADOR_IDS = {
    "laura": UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    "roberto": UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
    "carolina": UUID("cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
}

SERVICIO_IDS = [
    UUID("10000000-0000-4000-8000-000000000001"),
    UUID("10000000-0000-4000-8000-000000000002"),
    UUID("10000000-0000-4000-8000-000000000003"),
    UUID("10000000-0000-4000-8000-000000000004"),
    UUID("10000000-0000-4000-8000-000000000005"),
    UUID("10000000-0000-4000-8000-000000000006"),
]


def upsert(
    session: Session,
    model: type[Any],
    primary_key: UUID,
    values: dict[str, Any],
) -> Any:
    """Crea un registro o actualiza el existente con el mismo ID sin duplicar."""

    record = session.get(model, primary_key)
    if record is None:
        record = model(**values)
        session.add(record)
    else:
        for field, value in values.items():
            setattr(record, field, value)
    return record


TARIFAS_BASE = {
    "traslado": 6500.0,
    "acompañamiento": 5000.0,
    "acompanamiento": 5000.0,
    "mandado": 4000.0,
    "mandados": 4000.0,
}


def calcular_tarifas(tipo_servicio: str) -> tuple[float, float, float]:
    monto = TARIFAS_BASE.get(tipo_servicio.strip().lower(), 5000.0)
    comision = round(monto * 0.15, 2)
    pago_prestador = round(monto - comision, 2)
    return monto, comision, pago_prestador


def asegurar_columnas_monetizacion() -> None:
    inspector = inspect(engine)
    if "servicio" not in inspector.get_table_names():
        return
    existentes = {col["name"] for col in inspector.get_columns("servicio")}
    es_pg = engine.dialect.name == "postgresql"
    with engine.begin() as conn:
        for col, tipo_pg, tipo_sq, default_val in [
            ("monto_total", "DOUBLE PRECISION", "REAL", 5000.0),
            ("comision_plataforma", "DOUBLE PRECISION", "REAL", 750.0),
            ("pago_prestador", "DOUBLE PRECISION", "REAL", 4250.0),
        ]:
            if es_pg:
                conn.execute(
                    text(
                        f"ALTER TABLE servicio ADD COLUMN IF NOT EXISTS "
                        f"{col} {tipo_pg} NOT NULL DEFAULT {default_val}"
                    )
                )
            elif col not in existentes:
                conn.execute(
                    text(
                        f"ALTER TABLE servicio ADD COLUMN "
                        f"{col} {tipo_sq} NOT NULL DEFAULT {default_val}"
                    )
                )


def asegurar_columnas_prestador_auth() -> None:
    inspector = inspect(engine)
    if "prestador" not in inspector.get_table_names():
        return
    existentes = {col["name"] for col in inspector.get_columns("prestador")}
    es_pg = engine.dialect.name == "postgresql"
    with engine.begin() as conn:
        for col, longitud in [("email", 120), ("password_hash", 255)]:
            if es_pg:
                conn.execute(
                    text(
                        f"ALTER TABLE prestador ADD COLUMN IF NOT EXISTS "
                        f"{col} VARCHAR({longitud})"
                    )
                )
            elif col not in existentes:
                conn.execute(
                    text(
                        f"ALTER TABLE prestador ADD COLUMN "
                        f"{col} VARCHAR({longitud})"
                    )
                )


def seed() -> None:
    """Crea las tablas necesarias y carga el dataset reproducible de San Pedro de Jujuy."""

    Base.metadata.create_all(bind=engine)
    asegurar_columnas_monetizacion()
    asegurar_columnas_prestador_auth()
    now = datetime.now().astimezone().replace(second=0, microsecond=0)

    users = {
        "ana": {
            "id_usuario": USUARIO_IDS["ana"],
            "zona": "Centro / Microcentro",
            "preferencias": "Dirección: Calle Mitre 420 (frente a Plaza Belgrano) · Acompañamiento por la mañana, camina con bastón",
            "estado": "activa",
            "canal": "Ana López - 3888 412345",
        },
        "carlos": {
            "id_usuario": USUARIO_IDS["carlos"],
            "zona": "Barrio Belgrano",
            "preferencias": "Dirección: Av. Siria 250 (cerca del Hospital Paterson) · Traslados a control cardiológico",
            "estado": "activa",
            "canal": "Carlos Ruiz - 3888 456789",
        },
        "marta": {
            "id_usuario": USUARIO_IDS["marta"],
            "zona": "Barrio Patricios",
            "preferencias": "Dirección: Av. 9 de Julio 610 · Preferencia por prestadora mujer, casa rejas blancas",
            "estado": "activa",
            "canal": "Marta Sosa - 3888 511223",
        },
        "jorge": {
            "id_usuario": USUARIO_IDS["jorge"],
            "zona": "Barrio Providencia",
            "preferencias": "Dirección: Av. Sarmiento 180 (a 2 cuadras de la Terminal) · Mandados de farmacia y supermercado",
            "estado": "activa",
            "canal": "Jorge Paz - 3888 499887",
        },
    }

    default_hash = hash_password(DEFAULT_PRESTADOR_PASSWORD)
    providers = {
        PRESTADOR_IDS["laura"]: {
            "rol": "Laura Méndez - Acompañamiento",
            "email": "laura.mendez@goldencare.com",
            "password_hash": default_hash,
            "disponibilidad": True,
            "estado": "activo",
        },
        PRESTADOR_IDS["roberto"]: {
            "rol": "Roberto Gómez - Traslados",
            "email": "roberto.gomez@goldencare.com",
            "password_hash": default_hash,
            "disponibilidad": True,
            "estado": "activo",
        },
        PRESTADOR_IDS["carolina"]: {
            "rol": "Carolina Vega - Mandados y Farmacia",
            "email": "carolina.vega@goldencare.com",
            "password_hash": default_hash,
            "disponibilidad": True,
            "estado": "activo",
        },
    }

    # 6 servicios en distintos estados (solicitado, asignado, en curso, completado)
    # con barrios reales de San Pedro de Jujuy.
    service_specs = [
        {
            "id_servicio": SERVICIO_IDS[0],
            "user_key": "ana",
            "tipo_servicio": "acompañamiento",
            "zona": "Centro / Microcentro",
            "estado": "solicitado",
            "hours_offset": 4,  # Dentro de las próximas 24h -> Urgente
            "provider_key": None,
            "survey": None,
        },
        {
            "id_servicio": SERVICIO_IDS[1],
            "user_key": "jorge",
            "tipo_servicio": "mandado",
            "zona": "Barrio Providencia",
            "estado": "asignado",
            "hours_offset": 18,  # Dentro de las próximas 24h -> Urgente
            "provider_key": "carolina",
            "survey": None,
        },
        {
            "id_servicio": SERVICIO_IDS[2],
            "user_key": "carlos",
            "tipo_servicio": "traslado",
            "zona": "Barrio Belgrano",
            "estado": "en curso",
            "hours_offset": -1,
            "provider_key": "roberto",
            "survey": None,
        },
        {
            "id_servicio": SERVICIO_IDS[3],
            "user_key": "marta",
            "tipo_servicio": "acompañamiento",
            "zona": "Barrio Patricios",
            "estado": "completado",
            "hours_offset": -48,
            "provider_key": "laura",
            "survey": {
                "id_encuesta": UUID("e1111111-1111-4111-8111-111111111111"),
                "valoracion": 5,
                "comentario": "Excelente trato y puntualidad de Laura con mi mamá en Barrio Patricios.",
            },
        },
        {
            "id_servicio": SERVICIO_IDS[4],
            "user_key": "carlos",
            "tipo_servicio": "mandado",
            "zona": "Barrio Belgrano",
            "estado": "completado",
            "hours_offset": -72,
            "provider_key": "carolina",
            "survey": {
                "id_encuesta": UUID("e2222222-2222-4222-8222-222222222222"),
                "valoracion": 4,
                "comentario": "Muy rápida la compra de medicamentos cerca del Hospital Paterson.",
            },
        },
        {
            "id_servicio": SERVICIO_IDS[5],
            "user_key": "ana",
            "tipo_servicio": "traslado",
            "zona": "Centro / Microcentro",
            "estado": "completado",
            "hours_offset": -24,
            "provider_key": "roberto",
            "survey": None,  # Completado sin calificar aún para probar encuesta en vivo
        },
    ]

    with Session(engine) as session:
        # También actualizamos zonas genéricas previas en la base si existen
        mapa_zonas_legacy = {
            "Zona Centro": "Centro / Microcentro",
            "Barrio Norte": "Barrio Belgrano",
            "Zona Sur": "Barrio Patricios",
        }
        for usuario_db in session.scalars(select(Persona_Usuaria)).all():
            if usuario_db.zona in mapa_zonas_legacy:
                usuario_db.zona = mapa_zonas_legacy[usuario_db.zona]

        for servicio_db in session.scalars(select(Servicio)).all():
            if servicio_db.zona in mapa_zonas_legacy:
                servicio_db.zona = mapa_zonas_legacy[servicio_db.zona]

        for key, data in users.items():
            user_id = data["id_usuario"]
            upsert(
                session,
                Persona_Usuaria,
                user_id,
                {
                    "id_usuario": user_id,
                    "zona": data["zona"],
                    "preferencias": data["preferencias"],
                    "estado": data["estado"],
                },
            )

            contacto_existente = session.scalars(
                select(Contacto_Familiar).where(
                    Contacto_Familiar.id_usuario == user_id
                )
            ).first()
            if contacto_existente is None:
                upsert(
                    session,
                    Contacto_Familiar,
                    CONTACTO_IDS[key],
                    {
                        "id_contacto": CONTACTO_IDS[key],
                        "id_usuario": user_id,
                        "relacion": "responsable",
                        "canal": data["canal"],
                    },
                )
            else:
                contacto_existente.canal = data["canal"]
                contacto_existente.relacion = "responsable"

        for provider_id, values in providers.items():
            upsert(
                session,
                Prestador,
                provider_id,
                {"id_prestador": provider_id, **values},
            )

        for index, spec in enumerate(service_specs):
            service_id = spec["id_servicio"]
            service_date = now + timedelta(hours=spec["hours_offset"])
            is_completed = spec["estado"] == "completado"
            survey_data = spec["survey"]

            monto_total, comision_plataforma, pago_prestador = calcular_tarifas(
                spec["tipo_servicio"]
            )
            service_values = {
                "id_servicio": service_id,
                "id_usuario": USUARIO_IDS[spec["user_key"]],
                "tipo_servicio": spec["tipo_servicio"],
                "fecha_hora": service_date,
                "zona": spec["zona"],
                "estado": spec["estado"],
                "duracion_min": 60 if is_completed else 0,
                "tiempo_respuesta_min": (
                    15 if spec["estado"] != "solicitado" else None
                ),
                "cumplio_horario": True if is_completed else None,
                "valoracion": (
                    survey_data["valoracion"] if survey_data is not None else None
                ),
                "incidencia_fuera_alcance": False,
                "monto_total": monto_total,
                "comision_plataforma": comision_plataforma,
                "pago_prestador": pago_prestador,
            }
            upsert(session, Servicio, service_id, service_values)

            provider_key = spec["provider_key"]
            if provider_key is not None:
                assignment_id = UUID(f"{index + 1:08d}-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
                upsert(
                    session,
                    Asignacion,
                    assignment_id,
                    {
                        "id_asignacion": assignment_id,
                        "id_servicio": service_id,
                        "id_prestador": PRESTADOR_IDS[provider_key],
                        "resultado": (
                            "Servicio completado satisfactoriamente"
                            if is_completed
                            else None
                        ),
                    },
                )

            if survey_data is not None:
                encuesta_existente = session.scalars(
                    select(Encuesta).where(Encuesta.id_servicio == service_id)
                ).first()
                if encuesta_existente is None:
                    upsert(
                        session,
                        Encuesta,
                        survey_data["id_encuesta"],
                        {
                            "id_encuesta": survey_data["id_encuesta"],
                            "id_servicio": service_id,
                            "valoracion": survey_data["valoracion"],
                            "comentario": survey_data["comentario"],
                        },
                    )
                else:
                    encuesta_existente.valoracion = survey_data["valoracion"]
                    encuesta_existente.comentario = survey_data["comentario"]

        # Backfill de credenciales para cualquier prestador previo sin email o password_hash
        todos_prestadores = list(session.scalars(select(Prestador)).all())
        emails_usados = {
            p.email.strip().lower()
            for p in todos_prestadores
            if p.email and p.email.strip()
        }
        for p in todos_prestadores:
            if not p.email or not p.email.strip():
                nuevo_email = normalizar_email_prestador(p.rol, emails_usados)
                p.email = nuevo_email
                emails_usados.add(nuevo_email)
            if not p.password_hash:
                p.password_hash = hash_password(DEFAULT_PRESTADOR_PASSWORD)

        session.commit()

    print(
        "Dataset de San Pedro de Jujuy sincronizado con éxito: "
        "4 personas usuarias, 3 prestadores activos, 6 servicios y 2 encuestas.\n"
        "Credenciales de prueba prestadores (clave: prestador123):\n"
        "  - laura.mendez@goldencare.com\n"
        "  - roberto.gomez@goldencare.com\n"
        "  - carolina.vega@goldencare.com"
    )


if __name__ == "__main__":
    seed()
