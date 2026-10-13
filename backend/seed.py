"""Carga determinista del dataset simulado de GoldenCare.

Ejecutar desde la carpeta backend:

    python seed.py

También se puede indicar otra base mediante la variable de entorno
DATABASE_URL. Los identificadores fijos hacen que el script sea idempotente.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

try:  # Permite ejecutar `python seed.py` o importar `backend.seed`.
    from .models import Asignacion, Base, Persona_Usuaria, Prestador, Servicio
except ImportError:  # pragma: no cover - ruta usada por ejecución directa.
    from models import Asignacion, Base, Persona_Usuaria, Prestador, Servicio


DEFAULT_DATABASE = Path(__file__).resolve().parent / "goldencare.db"
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DEFAULT_DATABASE.as_posix()}")

engine_kwargs: dict[str, Any] = {}
if DATABASE_URL.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}

engine = create_engine(DATABASE_URL, **engine_kwargs)


USUARIO_IDS = {
    "ana": UUID("11111111-1111-4111-8111-111111111111"),
    "carlos": UUID("22222222-2222-4222-8222-222222222222"),
    "marta": UUID("33333333-3333-4333-8333-333333333333"),
}

PRESTADOR_IDS = {
    "laura": UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    "roberto": UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
}

SERVICIO_IDS = [
    UUID("10000000-0000-4000-8000-000000000001"),
    UUID("10000000-0000-4000-8000-000000000002"),
    UUID("10000000-0000-4000-8000-000000000003"),
    UUID("10000000-0000-4000-8000-000000000004"),
    UUID("10000000-0000-4000-8000-000000000005"),
    UUID("10000000-0000-4000-8000-000000000006"),
    UUID("10000000-0000-4000-8000-000000000007"),
    UUID("10000000-0000-4000-8000-000000000008"),
    UUID("10000000-0000-4000-8000-000000000009"),
    UUID("10000000-0000-4000-8000-000000000010"),
]


def upsert(session: Session, model: type[Any], primary_key: UUID, values: dict[str, Any]) -> Any:
    """Crea un registro simulado o actualiza el registro con el mismo ID."""

    record = session.get(model, primary_key)
    if record is None:
        record = model(**values)
        session.add(record)
    else:
        for field, value in values.items():
            setattr(record, field, value)
    return record


def seed() -> None:
    """Crea las tablas necesarias y carga el dataset reproducible de GoldenCare."""

    Base.metadata.create_all(bind=engine)
    now = datetime.now().astimezone().replace(second=0, microsecond=0)

    users = {
        USUARIO_IDS["ana"]: {
            "zona": "Zona Centro",
            "preferencias": "Acompañamiento por la mañana",
            "estado": "activa",
        },
        USUARIO_IDS["carlos"]: {
            "zona": "Barrio Norte",
            "preferencias": "Traslados y mandados programados",
            "estado": "activa",
        },
        USUARIO_IDS["marta"]: {
            "zona": "Zona Sur",
            "preferencias": "Preferencia por prestadora mujer",
            "estado": "activa",
        },
    }

    providers = {
        PRESTADOR_IDS["laura"]: {
            "rol": "acompañante",
            "disponibilidad": True,
            "estado": "activo",
        },
        PRESTADOR_IDS["roberto"]: {
            "rol": "conductor",
            "disponibilidad": True,
            "estado": "activo",
        },
    }

    # Fechas distribuidas entre hoy y los cinco días anteriores para facilitar
    # el análisis temporal del dashboard.
    service_specs = [
        (0, "ana", "acompañamiento", "Zona Centro", "solicitado", 9, None),
        (1, "carlos", "traslado", "Barrio Norte", "en curso", 10, "roberto"),
        (2, "marta", "mandado", "Zona Sur", "completado", 11, "laura"),
        (3, "ana", "traslado", "Zona Centro", "solicitado", 12, None),
        (1, "marta", "acompañamiento", "Zona Sur", "en curso", 13, "laura"),
        (4, "carlos", "mandado", "Barrio Norte", "completado", 14, "roberto"),
        (2, "ana", "traslado", "Zona Centro", "en curso", 15, "roberto"),
        (5, "marta", "acompañamiento", "Zona Sur", "completado", 16, "laura"),
        (3, "carlos", "mandado", "Barrio Norte", "solicitado", 17, None),
        (1, "ana", "mandado", "Zona Centro", "completado", 18, "laura"),
    ]

    with Session(engine) as session:
        for user_id, values in users.items():
            upsert(session, Persona_Usuaria, user_id, {"id_usuario": user_id, **values})

        for provider_id, values in providers.items():
            upsert(session, Prestador, provider_id, {"id_prestador": provider_id, **values})

        for index, (days_ago, user_key, service_type, zone, state, hour, provider_key) in enumerate(
            service_specs
        ):
            service_id = SERVICIO_IDS[index]
            service_date = (now - timedelta(days=days_ago)).replace(hour=hour)
            is_completed = state == "completado"
            service_values = {
                "id_servicio": service_id,
                "id_usuario": USUARIO_IDS[user_key],
                "tipo_servicio": service_type,
                "fecha_hora": service_date,
                "zona": zone,
                "estado": state,
                "duracion_min": 45 + index * 5 if is_completed else None,
                "tiempo_respuesta_min": 12 + index if state != "solicitado" else None,
                "cumplio_horario": (index % 4 != 0) if is_completed else None,
                "valoracion": 4 + (index % 2) if is_completed else None,
                "incidencia_fuera_alcance": False,
            }
            upsert(session, Servicio, service_id, service_values)

            if provider_key is not None:
                assignment_id = UUID(f"{index + 1:08d}-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
                assignment_values = {
                    "id_asignacion": assignment_id,
                    "id_servicio": service_id,
                    "id_prestador": PRESTADOR_IDS[provider_key],
                    "resultado": "Servicio completado" if is_completed else None,
                }
                upsert(session, Asignacion, assignment_id, assignment_values)

        session.commit()

    print("Dataset simulado de GoldenCare cargado: 3 usuarios, 2 prestadores y 10 servicios.")


if __name__ == "__main__":
    seed()
