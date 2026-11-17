"""API FastAPI de la capa de aplicación de GoldenCare."""

from __future__ import annotations

import os
from typing import Generator
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, selectinload, sessionmaker

try:  # Permite ejecutar `uvicorn main:app` desde backend o importar `backend.main`.
    from .models import (
        Asignacion,
        Base,
        Contacto_Familiar,
        Encuesta,
        Persona_Usuaria,
        Prestador,
        Servicio,
    )
    from .schemas import (
        AsignarPrestadorRequest,
        EncuestaCreate,
        EstadoServicio,
        EstadoServicioUpdate,
        MetricasRead,
        PedidoConsultaRead,
        PedidoPublicoCreate,
        PedidoPublicoRead,
        PersonaUsuariaCreate,
        PersonaUsuariaRead,
        PrestadorCreate,
        PrestadorRead,
        ServicioCreate,
        ServicioRead,
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
    from schemas import (
        AsignarPrestadorRequest,
        EncuestaCreate,
        EstadoServicio,
        EstadoServicioUpdate,
        MetricasRead,
        PedidoConsultaRead,
        PedidoPublicoCreate,
        PedidoPublicoRead,
        PersonaUsuariaCreate,
        PersonaUsuariaRead,
        PrestadorCreate,
        PrestadorRead,
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


def _extraer_prestador_asignado(servicio: Servicio) -> tuple[UUID | None, str | None]:
    """Obtiene el ID y nombre/rol del último prestador asignado al servicio."""

    if not servicio.asignaciones:
        return None, None

    ultima_asignacion = servicio.asignaciones[-1]
    if ultima_asignacion.prestador is not None:
        return (
            ultima_asignacion.prestador.id_prestador,
            ultima_asignacion.prestador.rol,
        )
    return ultima_asignacion.id_prestador, None


def _servicio_a_respuesta(servicio: Servicio) -> ServicioRead:
    """Enriquece un servicio con el contacto familiar, preferencias, prestador y encuesta."""

    nombre_contacto: str | None = None
    preferencias: str | None = None

    if servicio.usuario is not None:
        preferencias = servicio.usuario.preferencias
        nombre_contacto = next(
            (
                item.canal.strip()
                for item in servicio.usuario.contactos_familiares
                if item.canal and item.canal.strip()
            ),
            None,
        )

    id_prestador_asignado, prestador_asignado = _extraer_prestador_asignado(servicio)
    valoracion = (
        servicio.encuesta.valoracion
        if servicio.encuesta is not None and servicio.encuesta.valoracion is not None
        else servicio.valoracion
    )
    comentario_encuesta = (
        servicio.encuesta.comentario if servicio.encuesta is not None else None
    )

    base = ServicioRead.model_validate(servicio)
    return base.model_copy(
        update={
            "nombre_contacto": nombre_contacto,
            "preferencias": preferencias,
            "id_prestador_asignado": id_prestador_asignado,
            "prestador_asignado": prestador_asignado,
            "valoracion": valoracion,
            "comentario_encuesta": comentario_encuesta,
        }
    )


@app.get("/prestadores/", response_model=list[PrestadorRead])
def listar_prestadores(db: Session = Depends(get_db)) -> list[Prestador]:
    """Devuelve los prestadores activos y disponibles para asignar a servicios."""

    consulta = (
        select(Prestador)
        .where(Prestador.estado == "activo")
        .order_by(Prestador.rol.asc())
    )
    return list(db.scalars(consulta).all())


@app.post(
    "/prestadores/",
    response_model=PrestadorRead,
    status_code=status.HTTP_201_CREATED,
)
def crear_prestador(
    payload: PrestadorCreate,
    db: Session = Depends(get_db),
) -> Prestador:
    """Registra un nuevo prestador operativo."""

    prestador = Prestador(
        rol=payload.rol.strip(),
        disponibilidad=payload.disponibilidad,
        estado=payload.estado,
    )
    try:
        db.add(prestador)
        db.commit()
        db.refresh(prestador)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se pudo registrar el prestador.",
        ) from exc

    return prestador


@app.post("/servicios/{id_servicio}/asignar", response_model=ServicioRead)
def asignar_prestador_servicio(
    id_servicio: UUID,
    payload: AsignarPrestadorRequest,
    db: Session = Depends(get_db),
) -> ServicioRead:
    """Asigna o actualiza el prestador de un servicio y pasa su estado a 'asignado'."""

    consulta_servicio = (
        select(Servicio)
        .options(
            selectinload(Servicio.usuario).selectinload(
                Persona_Usuaria.contactos_familiares
            ),
            selectinload(Servicio.asignaciones).selectinload(Asignacion.prestador),
            selectinload(Servicio.encuesta),
        )
        .where(Servicio.id_servicio == id_servicio)
    )
    servicio = db.scalars(consulta_servicio).first()
    if servicio is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Servicio no encontrado.",
        )

    prestador = db.get(Prestador, payload.id_prestador)
    if prestador is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Prestador no encontrado.",
        )

    try:
        if servicio.asignaciones:
            asignacion = servicio.asignaciones[-1]
            asignacion.id_prestador = prestador.id_prestador
        else:
            asignacion = Asignacion(
                id_servicio=servicio.id_servicio,
                id_prestador=prestador.id_prestador,
            )
            db.add(asignacion)

        servicio.estado = EstadoServicio.asignado.value
        db.commit()

        # Recargamos relaciones para construir la respuesta enriquecida
        db.expire_all()
        servicio_actualizado = db.scalars(consulta_servicio).first()
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se pudo asignar el prestador al servicio.",
        ) from exc

    return _servicio_a_respuesta(servicio_actualizado or servicio)


@app.post("/servicios/{id_servicio}/encuesta", response_model=ServicioRead)
def registrar_encuesta_servicio(
    id_servicio: UUID,
    payload: EncuestaCreate,
    db: Session = Depends(get_db),
) -> ServicioRead:
    """Registra la valoración y comentario de satisfacción de un servicio completado."""

    consulta_servicio = (
        select(Servicio)
        .options(
            selectinload(Servicio.usuario).selectinload(
                Persona_Usuaria.contactos_familiares
            ),
            selectinload(Servicio.asignaciones).selectinload(Asignacion.prestador),
            selectinload(Servicio.encuesta),
        )
        .where(Servicio.id_servicio == id_servicio)
    )
    servicio = db.scalars(consulta_servicio).first()
    if servicio is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Servicio no encontrado.",
        )

    if servicio.estado != EstadoServicio.completado.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Solo se pueden calificar servicios que estén en estado 'completado'.",
        )

    comentario_limpio = (
        payload.comentario.strip()
        if payload.comentario and payload.comentario.strip()
        else None
    )

    try:
        if servicio.encuesta is not None:
            servicio.encuesta.valoracion = payload.valoracion
            servicio.encuesta.comentario = comentario_limpio
        else:
            encuesta = Encuesta(
                id_servicio=servicio.id_servicio,
                valoracion=payload.valoracion,
                comentario=comentario_limpio,
            )
            db.add(encuesta)

        servicio.valoracion = payload.valoracion
        db.commit()
        db.expire_all()
        servicio_actualizado = db.scalars(consulta_servicio).first()
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se pudo registrar la encuesta de satisfacción.",
        ) from exc

    return _servicio_a_respuesta(servicio_actualizado or servicio)


@app.get("/servicios/pendientes", response_model=list[ServicioRead])
def listar_servicios_pendientes(db: Session = Depends(get_db)) -> list[ServicioRead]:
    """Devuelve servicios aún abiertos para el dashboard operativo con datos del cliente y prestador."""

    estados_pendientes = [
        EstadoServicio.solicitado.value,
        EstadoServicio.asignado.value,
        EstadoServicio.en_curso.value,
    ]
    consulta = (
        select(Servicio)
        .options(
            selectinload(Servicio.usuario).selectinload(
                Persona_Usuaria.contactos_familiares
            ),
            selectinload(Servicio.asignaciones).selectinload(Asignacion.prestador),
            selectinload(Servicio.encuesta),
        )
        .where(Servicio.estado.in_(estados_pendientes))
        .order_by(Servicio.fecha_hora.asc())
    )
    servicios = db.scalars(consulta).all()
    return [_servicio_a_respuesta(servicio) for servicio in servicios]


@app.get("/metricas", response_model=MetricasRead)
def obtener_metricas(db: Session = Depends(get_db)) -> MetricasRead:
    """Calcula métricas reales desde SQLite para el Panel del Coordinador."""

    estados_pendientes = [
        EstadoServicio.solicitado.value,
        EstadoServicio.asignado.value,
        EstadoServicio.en_curso.value,
    ]

    total_usuarios = (
        db.scalar(select(func.count()).select_from(Persona_Usuaria)) or 0
    )
    servicios_pendientes = (
        db.scalar(
            select(func.count())
            .select_from(Servicio)
            .where(Servicio.estado.in_(estados_pendientes))
        )
        or 0
    )
    servicios_completados = (
        db.scalar(
            select(func.count())
            .select_from(Servicio)
            .where(Servicio.estado == EstadoServicio.completado.value)
        )
        or 0
    )
    total_no_cancelados = (
        db.scalar(
            select(func.count())
            .select_from(Servicio)
            .where(Servicio.estado != EstadoServicio.cancelado.value)
        )
        or 0
    )

    if total_no_cancelados == 0 or servicios_completados == 0:
        tasa_cumplimiento = 100.0
    else:
        tasa_cumplimiento = round(
            (servicios_completados / total_no_cancelados) * 100.0, 1
        )

    total_encuestas = (
        db.scalar(
            select(func.count())
            .select_from(Encuesta)
            .where(Encuesta.valoracion.is_not(None))
        )
        or 0
    )
    promedio_raw = db.scalar(
        select(func.avg(Encuesta.valoracion)).where(
            Encuesta.valoracion.is_not(None)
        )
    )
    promedio_valoracion = (
        round(float(promedio_raw), 1) if promedio_raw is not None else None
    )

    return MetricasRead(
        total_usuarios=total_usuarios,
        servicios_pendientes=servicios_pendientes,
        servicios_completados=servicios_completados,
        tasa_cumplimiento=tasa_cumplimiento,
        promedio_valoracion=promedio_valoracion,
        total_encuestas=total_encuestas,
    )


def _construir_pedido_respuesta(
    servicio: Servicio,
    nombre_contacto: str,
    preferencias: str | None = None,
) -> PedidoPublicoRead:
    """Construye la respuesta enriquecida con código corto de seguimiento y contacto."""

    servicio_read = ServicioRead.model_validate(servicio).model_copy(
        update={
            "nombre_contacto": nombre_contacto,
            "preferencias": preferencias,
        }
    )
    datos_base = servicio_read.model_dump()
    datos_base.pop("nombre_contacto", None)
    codigo = str(servicio.id_servicio)[:8]
    return PedidoPublicoRead(
        **datos_base,
        codigo_seguimiento=codigo,
        nombre_contacto=nombre_contacto,
        servicio=servicio_read,
    )


@app.post(
    "/pedidos/publico",
    response_model=PedidoPublicoRead,
    status_code=status.HTTP_201_CREATED,
)
def crear_pedido_publico(
    payload: PedidoPublicoCreate,
    db: Session = Depends(get_db),
) -> PedidoPublicoRead:
    """Registra un pedido desde el portal público reutilizando o creando la persona usuaria."""

    canal_limpio = payload.nombre_contacto.strip()
    preferencias_limpias = (
        payload.preferencias.strip()
        if payload.preferencias and payload.preferencias.strip()
        else None
    )

    consulta_contacto = (
        select(Contacto_Familiar)
        .options(selectinload(Contacto_Familiar.usuario))
        .where(Contacto_Familiar.canal == canal_limpio)
    )
    contacto_existente = db.scalars(consulta_contacto).first()

    try:
        if contacto_existente is not None and contacto_existente.usuario is not None:
            usuario = contacto_existente.usuario
            if payload.zona:
                usuario.zona = payload.zona
            if preferencias_limpias is not None:
                usuario.preferencias = preferencias_limpias
        else:
            usuario = Persona_Usuaria(
                zona=payload.zona,
                preferencias=preferencias_limpias,
                estado="activa",
            )
            db.add(usuario)
            db.flush()
            db.add(
                Contacto_Familiar(
                    id_usuario=usuario.id_usuario,
                    relacion="responsable",
                    canal=canal_limpio,
                )
            )

        servicio = Servicio(
            id_usuario=usuario.id_usuario,
            id_equipo=None,
            tipo_servicio=payload.tipo_servicio,
            fecha_hora=payload.fecha_hora,
            zona=payload.zona,
            estado=EstadoServicio.solicitado.value,
            duracion_min=0,
            tiempo_respuesta_min=None,
            cumplio_horario=None,
            valoracion=None,
            incidencia_fuera_alcance=False,
        )
        db.add(servicio)
        db.commit()
        db.refresh(servicio)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se pudo registrar el pedido público.",
        ) from exc

    return _construir_pedido_respuesta(
        servicio,
        canal_limpio,
        usuario.preferencias,
    )


@app.get(
    "/pedidos/consultar/{codigo_o_contacto}",
    response_model=list[PedidoConsultaRead],
)
def consultar_pedidos_publicos(
    codigo_o_contacto: str,
    db: Session = Depends(get_db),
) -> list[PedidoConsultaRead]:
    """Busca pedidos recientes por código corto (8 caracteres) o coincidencia parcial en contacto."""

    termino = codigo_o_contacto.strip().lower()
    if not termino:
        return []

    consulta = (
        select(Servicio)
        .options(
            selectinload(Servicio.usuario).selectinload(
                Persona_Usuaria.contactos_familiares
            ),
            selectinload(Servicio.asignaciones).selectinload(Asignacion.prestador),
            selectinload(Servicio.encuesta),
        )
        .order_by(Servicio.fecha_hora.desc())
    )
    servicios = db.scalars(consulta).all()

    resultados: list[PedidoConsultaRead] = []
    for servicio in servicios:
        codigo_corto = str(servicio.id_servicio)[:8].lower()
        contactos = (
            [c.canal for c in servicio.usuario.contactos_familiares if c.canal.strip()]
            if servicio.usuario
            else []
        )
        coincide_codigo = codigo_corto == termino or codigo_corto.startswith(termino)
        coincide_contacto = any(termino in canal.lower() for canal in contactos)

        if coincide_codigo or coincide_contacto:
            nombre_contacto = contactos[0] if contactos else "Sin contacto registrado"
            preferencias = (
                servicio.usuario.preferencias if servicio.usuario is not None else None
            )
            id_prestador_asignado, prestador_asignado = _extraer_prestador_asignado(
                servicio
            )
            valoracion = (
                servicio.encuesta.valoracion
                if servicio.encuesta is not None
                and servicio.encuesta.valoracion is not None
                else servicio.valoracion
            )
            comentario_encuesta = (
                servicio.encuesta.comentario
                if servicio.encuesta is not None
                else None
            )
            servicio_read = ServicioRead.model_validate(servicio).model_copy(
                update={
                    "nombre_contacto": nombre_contacto,
                    "preferencias": preferencias,
                    "id_prestador_asignado": id_prestador_asignado,
                    "prestador_asignado": prestador_asignado,
                    "valoracion": valoracion,
                    "comentario_encuesta": comentario_encuesta,
                }
            )
            datos_base = servicio_read.model_dump()
            datos_base.pop("nombre_contacto", None)
            resultados.append(
                PedidoConsultaRead(
                    **datos_base,
                    codigo_seguimiento=str(servicio.id_servicio)[:8],
                    nombre_contacto=nombre_contacto,
                    servicio=servicio_read,
                )
            )

    return resultados


__all__ = ["app", "engine", "SessionLocal", "get_db"]
