"""API FastAPI de la capa de aplicación de GoldenCare."""

from __future__ import annotations

import os
from typing import Generator
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, selectinload, sessionmaker

try:  # Permite ejecutar `uvicorn main:app` desde backend o importar `backend.main`.
    from .models import Base, Contacto_Familiar, Persona_Usuaria, Servicio
    from .schemas import (
        EstadoServicio,
        EstadoServicioUpdate,
        PersonaUsuariaCreate,
        PersonaUsuariaRead,
        ServicioCreate,
        ServicioRead,
    )
except ImportError:  # pragma: no cover - ruta usada por ejecución directa.
    from models import Base, Contacto_Familiar, Persona_Usuaria, Servicio
    from schemas import (
        EstadoServicio,
        EstadoServicioUpdate,
        PersonaUsuariaCreate,
        PersonaUsuariaRead,
        ServicioCreate,
        ServicioRead,
    )


DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./goldencare.db")

engine_kwargs = {}
if DATABASE_URL.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}

engine = create_engine(DATABASE_URL, **engine_kwargs)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

# El MVP de desarrollo crea las tablas automáticamente al iniciar la aplicación.
Base.metadata.create_all(bind=engine)

app = FastAPI(title="GoldenCare API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db() -> Generator[Session, None, None]:
    """Entrega una sesión por solicitud y garantiza su cierre."""

    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _usuario_a_respuesta(usuario: Persona_Usuaria) -> PersonaUsuariaRead:
    """Expone el nombre o contacto visible sin revelar el UUID en la etiqueta."""

    contacto = next(
        (item.canal for item in usuario.contactos_familiares if item.canal.strip()),
        None,
    )
    return PersonaUsuariaRead(
        id_usuario=usuario.id_usuario,
        zona=usuario.zona,
        preferencias=usuario.preferencias,
        estado=usuario.estado,
        contacto_familiar=contacto,
    )


@app.post("/usuarios/", response_model=PersonaUsuariaRead, status_code=status.HTTP_201_CREATED)
def crear_usuario(payload: PersonaUsuariaCreate, db: Session = Depends(get_db)) -> PersonaUsuariaRead:
    """Registra una persona usuaria y su contacto familiar asociado."""

    usuario = Persona_Usuaria(
        zona=payload.zona,
        preferencias=payload.preferencias,
        estado=payload.estado,
    )

    try:
        db.add(usuario)
        db.flush()
        db.add(
            Contacto_Familiar(
                id_usuario=usuario.id_usuario,
                relacion=payload.contacto_familiar.relacion,
                canal=payload.contacto_familiar.canal,
            )
        )
        db.commit()
        db.refresh(usuario)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se pudo registrar la persona usuaria.",
        ) from exc

    return _usuario_a_respuesta(usuario)


@app.get("/usuarios/", response_model=list[PersonaUsuariaRead])
def listar_usuarios(db: Session = Depends(get_db)) -> list[PersonaUsuariaRead]:
    """Devuelve las personas usuarias disponibles para nuevas solicitudes."""

    consulta = (
        select(Persona_Usuaria)
        .options(selectinload(Persona_Usuaria.contactos_familiares))
        .order_by(Persona_Usuaria.zona.asc())
    )
    usuarios = db.scalars(consulta).all()
    return [_usuario_a_respuesta(usuario) for usuario in usuarios]


@app.post("/servicios/", response_model=ServicioRead, status_code=status.HTTP_201_CREATED)
def crear_servicio(payload: ServicioCreate, db: Session = Depends(get_db)) -> Servicio:
    """Registra una nueva solicitud de servicio para GoldenCare."""

    datos = payload.model_dump()
    datos["estado"] = payload.estado.value
    servicio = Servicio(**datos)

    try:
        db.add(servicio)
        db.commit()
        db.refresh(servicio)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se pudo registrar el servicio.",
        ) from exc

    return servicio


@app.patch("/servicios/{id_servicio}/estado", response_model=ServicioRead)
def actualizar_estado_servicio(
    id_servicio: UUID,
    payload: EstadoServicioUpdate,
    db: Session = Depends(get_db),
) -> Servicio:
    """Actualiza el estado operativo de un servicio existente."""

    servicio = db.get(Servicio, id_servicio)
    if servicio is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Servicio no encontrado.",
        )

    servicio.estado = payload.estado.value
    try:
        db.commit()
        db.refresh(servicio)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se pudo actualizar el estado del servicio.",
        ) from exc

    return servicio


@app.get("/servicios/pendientes", response_model=list[ServicioRead])
def listar_servicios_pendientes(db: Session = Depends(get_db)) -> list[Servicio]:
    """Devuelve servicios aún abiertos para el dashboard operativo."""

    estados_pendientes = [
        EstadoServicio.solicitado.value,
        EstadoServicio.asignado.value,
        EstadoServicio.en_curso.value,
    ]
    consulta = (
        select(Servicio)
        .where(Servicio.estado.in_(estados_pendientes))
        .order_by(Servicio.fecha_hora.asc())
    )
    return list(db.scalars(consulta).all())


__all__ = ["app", "engine", "SessionLocal", "get_db"]
