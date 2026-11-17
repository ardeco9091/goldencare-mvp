"""Carga determinista e idempotente del dataset inicial de GoldenCare.

Ejecutar desde la raíz o desde la carpeta backend:

    python backend/seed.py
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

try:  # Permite ejecutar `python seed.py` o importar `backend.seed`.
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


def seed() -> None:
    """Crea las tablas necesarias y carga el dataset reproducible de GoldenCare."""

    Base.metadata.create_all(bind=engine)
    now = datetime.now().astimezone().replace(second=0, microsecond=0)

    users = {
        "ana": {
            "id_usuario": USUARIO_IDS["ana"],
            "zona": "Zona Centro",
            "preferencias": "Acompañamiento por la mañana · Av. Belgrano 450, usa bastón",
            "estado": "activa",
            "canal": "Ana López - 388 412 3456",
        },
        "carlos": {
            "id_usuario": USUARIO_IDS["carlos"],
            "zona": "Barrio Norte",
            "preferencias": "Traslados a control cardiológico · Los Perales 210",
            "estado": "activa",
            "canal": "Carlos Ruiz - 388 456 7890",
        },
        "marta": {
            "id_usuario": USUARIO_IDS["marta"],
            "zona": "Zona Sur",
            "preferencias": "Preferencia por prestadora mujer · Pje. Las Rosas 88",
            "estado": "activa",
            "canal": "Marta Sosa - 388 511 2233",
        },
        "jorge": {
            "id_usuario": USUARIO_IDS["jorge"],
            "zona": "Zona Centro",
            "preferencias": "Mandados de farmacia y supermercado · San Martín 920",
            "estado": "activa",
            "canal": "Jorge Paz - 388 499 8877",
        },
    }

    providers = {
        PRESTADOR_IDS["laura"]: {
            "rol": "Laura Méndez - Acompañamiento",
            "disponibilidad": True,
            "estado": "activo",
        },
        PRESTADOR_IDS["roberto"]: {
            "rol": "Roberto Gómez - Traslados",
            "disponibilidad": True,
            "estado": "activo",
        },
        PRESTADOR_IDS["carolina"]: {
            "rol": "Carolina Vega - Mandados y Farmacia",
            "disponibilidad": True,
            "estado": "activo",
        },
    }

    # 6 servicios en distintos estados (solicitado, asignado, en curso, completado)
    # con 2 encuestas respondidas y 1 completado listo para calificar en vivo.
    service_specs = [
        {
            "id_servicio": SERVICIO_IDS[0],
            "user_key": "ana",
            "tipo_servicio": "acompañamiento",
            "zona": "Zona Centro",
            "estado": "solicitado",
            "days_offset": 1,
            "hour": 9,
            "provider_key": None,
            "survey": None,
        },
        {
            "id_servicio": SERVICIO_IDS[1],
            "user_key": "jorge",
            "tipo_servicio": "mandado",
            "zona": "Zona Centro",
            "estado": "asignado",
            "days_offset": 1,
            "hour": 11,
            "provider_key": "carolina",
            "survey": None,
        },
        {
            "id_servicio": SERVICIO_IDS[2],
            "user_key": "carlos",
            "tipo_servicio": "traslado",
            "zona": "Barrio Norte",
            "estado": "en curso",
            "days_offset": 0,
            "hour": 10,
            "provider_key": "roberto",
            "survey": None,
        },
        {
            "id_servicio": SERVICIO_IDS[3],
            "user_key": "marta",
            "tipo_servicio": "acompañamiento",
            "zona": "Zona Sur",
            "estado": "completado",
            "days_offset": -2,
            "hour": 16,
            "provider_key": "laura",
            "survey": {
                "id_encuesta": UUID("e1111111-1111-4111-8111-111111111111"),
                "valoracion": 5,
                "comentario": "Excelente trato y puntualidad de Laura con mi mamá.",
            },
        },
        {
            "id_servicio": SERVICIO_IDS[4],
            "user_key": "carlos",
            "tipo_servicio": "mandado",
            "zona": "Barrio Norte",
            "estado": "completado",
            "days_offset": -3,
            "hour": 14,
            "provider_key": "carolina",
            "survey": {
                "id_encuesta": UUID("e2222222-2222-4222-8222-222222222222"),
                "valoracion": 4,
                "comentario": "Muy rápida la gestión de los medicamentos en la farmacia.",
            },
        },
        {
            "id_servicio": SERVICIO_IDS[5],
            "user_key": "ana",
            "tipo_servicio": "traslado",
            "zona": "Zona Centro",
            "estado": "completado",
            "days_offset": -1,
            "hour": 12,
            "provider_key": "roberto",
            "survey": None,  # Completado sin calificar aún para probar encuesta en vivo
        },
    ]

    with Session(engine) as session:
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
            service_date = (now + timedelta(days=spec["days_offset"])).replace(
                hour=spec["hour"]
            )
            is_completed = spec["estado"] == "completado"
            survey_data = spec["survey"]

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

        session.commit()

    print(
        "Dataset inicial de GoldenCare sincronizado con éxito: "
        "4 personas usuarias con contactos, 3 prestadores activos, 6 servicios y 2 encuestas."
    )


if __name__ == "__main__":
    seed()
