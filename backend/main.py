"""API FastAPI de la capa de aplicación de GoldenCare."""

from __future__ import annotations

import hmac
import os
import re
from typing import Any, Generator
from uuid import UUID

from fastapi import Depends, FastAPI, Header, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, func, inspect, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, selectinload, sessionmaker

try:  # Permite ejecutar `uvicorn main:app` desde backend o importar `backend.main`.
    from .auth_utils import (
        DEFAULT_PRESTADOR_PASSWORD,
        create_access_token,
        hash_password,
        normalizar_email_prestador,
        parsear_rol_prestador,
        verify_access_token,
        verify_password,
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
    from .schemas import (
        AceptarPrestadorRequest,
        AdminLoginRequest,
        AdminLoginResponse,
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
        PrestadorAuthInfo,
        PrestadorCreate,
        PrestadorLoginRequest,
        PrestadorLoginResponse,
        PrestadorRead,
        ServicioCreate,
        ServicioRead,
    )
except ImportError:  # pragma: no cover - ruta usada por ejecución directa.
    from auth_utils import (
        DEFAULT_PRESTADOR_PASSWORD,
        create_access_token,
        hash_password,
        normalizar_email_prestador,
        parsear_rol_prestador,
        verify_access_token,
        verify_password,
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
    from schemas import (
        AceptarPrestadorRequest,
        AdminLoginRequest,
        AdminLoginResponse,
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
        PrestadorAuthInfo,
        PrestadorCreate,
        PrestadorLoginRequest,
        PrestadorLoginResponse,
        PrestadorRead,
        ServicioCreate,
        ServicioRead,
    )


DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./goldencare.db")
DATABASE_URL = re.sub(r"^postgres(ql)?://", "postgresql+psycopg://", DATABASE_URL)

engine_kwargs = {}
if DATABASE_URL.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}

engine = create_engine(DATABASE_URL, **engine_kwargs)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

# El MVP de desarrollo crea las tablas automáticamente al iniciar la aplicación.
Base.metadata.create_all(bind=engine)


TARIFAS_SERVICIO_BASE: dict[str, float] = {
    "traslado": 6500.0,
    "acompañamiento": 5000.0,
    "acompanamiento": 5000.0,
    "mandado": 4000.0,
    "mandados": 4000.0,
}
COMISION_PLATAFORMA_PCT = 0.15


def calcular_tarifa_servicio(
    tipo_servicio: str,
    monto_override: float | None = None,
) -> tuple[float, float, float]:
    """Devuelve (monto_total, comision_plataforma_15%, pago_prestador_85%)."""

    if monto_override is not None and monto_override >= 0:
        monto_total = round(float(monto_override), 2)
    else:
        clave = (tipo_servicio or "").strip().lower()
        monto_total = TARIFAS_SERVICIO_BASE.get(clave, 5000.0)

    comision = round(monto_total * COMISION_PLATAFORMA_PCT, 2)
    pago_prestador = round(monto_total - comision, 2)
    return monto_total, comision, pago_prestador


def asegurar_columnas_monetizacion() -> None:
    """Agrega columnas de monetización de forma segura en PostgreSQL y SQLite existentes."""

    inspector = inspect(engine)
    if "servicio" not in inspector.get_table_names():
        return

    columnas_existentes = {col["name"] for col in inspector.get_columns("servicio")}
    columnas_requeridas = [
        ("monto_total", "DOUBLE PRECISION", "REAL", 5000.0),
        ("comision_plataforma", "DOUBLE PRECISION", "REAL", 750.0),
        ("pago_prestador", "DOUBLE PRECISION", "REAL", 4250.0),
    ]
    es_postgres = engine.dialect.name == "postgresql"
    se_agregaron_columnas = False

    with engine.begin() as conn:
        for nombre_col, tipo_pg, tipo_sqlite, valor_default in columnas_requeridas:
            if es_postgres:
                conn.execute(
                    text(
                        f"ALTER TABLE servicio ADD COLUMN IF NOT EXISTS "
                        f"{nombre_col} {tipo_pg} NOT NULL DEFAULT {valor_default}"
                    )
                )
                if nombre_col not in columnas_existentes:
                    se_agregaron_columnas = True
            elif nombre_col not in columnas_existentes:
                conn.execute(
                    text(
                        f"ALTER TABLE servicio ADD COLUMN "
                        f"{nombre_col} {tipo_sqlite} NOT NULL DEFAULT {valor_default}"
                    )
                )
                se_agregaron_columnas = True

    if se_agregaron_columnas:
        with SessionLocal() as db:
            servicios_existentes = db.scalars(select(Servicio)).all()
            for srv in servicios_existentes:
                monto, comision, pago = calcular_tarifa_servicio(srv.tipo_servicio)
                srv.monto_total = monto
                srv.comision_plataforma = comision
                srv.pago_prestador = pago
            db.commit()


asegurar_columnas_monetizacion()


def asegurar_columnas_prestador_auth() -> None:
    """Agrega email y password_hash en prestador de forma segura y asigna credenciales iniciales."""

    inspector = inspect(engine)
    if "prestador" not in inspector.get_table_names():
        return

    columnas_existentes = {col["name"] for col in inspector.get_columns("prestador")}
    es_postgres = engine.dialect.name == "postgresql"

    with engine.begin() as conn:
        for nombre_col, longitud in [("email", 120), ("password_hash", 255)]:
            if es_postgres:
                conn.execute(
                    text(
                        f"ALTER TABLE prestador ADD COLUMN IF NOT EXISTS "
                        f"{nombre_col} VARCHAR({longitud})"
                    )
                )
            elif nombre_col not in columnas_existentes:
                try:
                    conn.execute(
                        text(
                            f"ALTER TABLE prestador ADD COLUMN "
                            f"{nombre_col} VARCHAR({longitud})"
                        )
                    )
                except SQLAlchemyError:
                    pass

        if es_postgres:
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS ix_prestador_email "
                    "ON prestador (email)"
                )
            )

    with SessionLocal() as db:
        prestadores = list(db.scalars(select(Prestador)).all())
        emails_usados = {
            p.email.strip().lower()
            for p in prestadores
            if p.email and p.email.strip()
        }
        modificados = False
        for p in prestadores:
            if not p.email or not p.email.strip():
                nuevo_email = normalizar_email_prestador(p.rol, emails_usados)
                p.email = nuevo_email
                emails_usados.add(nuevo_email)
                modificados = True
            if not p.password_hash:
                p.password_hash = hash_password(DEFAULT_PRESTADOR_PASSWORD)
                modificados = True
        if modificados:
            db.commit()


asegurar_columnas_prestador_auth()

app = FastAPI(title="GoldenCare API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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


def _extraer_token_bearer(authorization: str | None) -> dict[str, Any]:
    """Extrae y valida el token Bearer HMAC-SHA256 del encabezado Authorization."""

    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Se requiere iniciar sesión para realizar esta acción.",
        )
    token = authorization[7:].strip()
    claims = verify_access_token(token)
    if claims is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sesión inválida o expirada. Volvé a iniciar sesión.",
        )
    return claims


def require_admin(
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """Exige un token válido con rol 'admin'."""

    claims = _extraer_token_bearer(authorization)
    if claims.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permisos insuficientes. Se requiere acceso de coordinador.",
        )
    return claims


def require_prestador(
    authorization: str | None = Header(default=None),
) -> tuple[UUID, dict[str, Any]]:
    """Exige un token válido con rol 'prestador' y devuelve su UUID y claims."""

    claims = _extraer_token_bearer(authorization)
    if claims.get("role") != "prestador":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permisos insuficientes. Se requiere sesión de prestador.",
        )
    try:
        prestador_id = UUID(str(claims.get("sub", "")))
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token de prestador inválido.",
        ) from exc
    return prestador_id, claims


def require_admin_or_prestador(
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """Permite acceso autenticado tanto a coordinadores ('admin') como a prestadores."""

    claims = _extraer_token_bearer(authorization)
    if claims.get("role") not in ("admin", "prestador"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Rol de sesión no autorizado.",
        )
    return claims


@app.post("/auth/login", response_model=AdminLoginResponse)
def login_admin(payload: AdminLoginRequest) -> AdminLoginResponse:
    """Autentica al coordinador con correo electrónico (o usuario legacy) y contraseña."""

    identificador = (payload.email or payload.username or "").strip().lower()
    admin_email = os.getenv("ADMIN_EMAIL", "admin@goldencare.com").strip().lower()
    admin_user = os.getenv("ADMIN_USER", "admin").strip().lower()
    admin_password = os.getenv("ADMIN_PASSWORD", "goldencare2026")

    identificadores_validos = {admin_email, admin_user, "admin"}
    if not identificador or identificador not in identificadores_validos:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Correo o contraseña incorrectos.",
        )

    if not hmac.compare_digest(payload.password, admin_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Correo o contraseña incorrectos.",
        )

    token = create_access_token(
        subject="admin",
        role="admin",
        email=admin_email,
    )
    return AdminLoginResponse(
        access_token=token,
        token_type="bearer",
        role="admin",
        email=admin_email,
    )


@app.post("/prestadores/login", response_model=PrestadorLoginResponse)
def login_prestador(
    payload: PrestadorLoginRequest,
    db: Session = Depends(get_db),
) -> PrestadorLoginResponse:
    """Autentica a un prestador activo por correo electrónico y contraseña."""

    email_limpio = payload.email.strip().lower()
    prestador = db.scalars(
        select(Prestador).where(
            func.lower(Prestador.email) == email_limpio,
            Prestador.estado == "activo",
        )
    ).first()

    if prestador is None or not verify_password(payload.password, prestador.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Correo electrónico o contraseña incorrectos.",
        )

    nombre, especialidad = parsear_rol_prestador(prestador.rol)
    token = create_access_token(
        subject=str(prestador.id_prestador),
        role="prestador",
        email=prestador.email or email_limpio,
    )
    return PrestadorLoginResponse(
        access_token=token,
        token_type="bearer",
        prestador=PrestadorAuthInfo(
            id_prestador=prestador.id_prestador,
            nombre=nombre,
            especialidad=especialidad,
            rol=prestador.rol,
            email=prestador.email or email_limpio,
        ),
    )


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


@app.post("/usuarios", response_model=PersonaUsuariaRead, status_code=status.HTTP_201_CREATED, include_in_schema=False)
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


@app.get("/usuarios", response_model=list[PersonaUsuariaRead], include_in_schema=False)
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


@app.post("/servicios", response_model=ServicioRead, status_code=status.HTTP_201_CREATED, include_in_schema=False)
@app.post("/servicios/", response_model=ServicioRead, status_code=status.HTTP_201_CREATED)
def crear_servicio(payload: ServicioCreate, db: Session = Depends(get_db)) -> ServicioRead:
    """Registra una nueva solicitud de servicio para GoldenCare."""

    datos = payload.model_dump()
    datos["estado"] = payload.estado.value
    monto_total, comision, pago_prestador = calcular_tarifa_servicio(
        payload.tipo_servicio,
        payload.monto_total,
    )
    datos["monto_total"] = monto_total
    datos["comision_plataforma"] = (
        round(payload.comision_plataforma, 2)
        if payload.comision_plataforma is not None
        else comision
    )
    datos["pago_prestador"] = (
        round(payload.pago_prestador, 2)
        if payload.pago_prestador is not None
        else pago_prestador
    )
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

    consulta_servicio = (
        select(Servicio)
        .options(
            selectinload(Servicio.usuario).selectinload(
                Persona_Usuaria.contactos_familiares
            ),
            selectinload(Servicio.asignaciones).selectinload(Asignacion.prestador),
            selectinload(Servicio.encuesta),
        )
        .where(Servicio.id_servicio == servicio.id_servicio)
    )
    servicio_completo = db.scalars(consulta_servicio).first()
    return _servicio_a_respuesta(servicio_completo or servicio)


@app.get("/servicios", response_model=list[ServicioRead], include_in_schema=False)
@app.get("/servicios/", response_model=list[ServicioRead])
def listar_servicios(
    estado: str | None = None,
    id_prestador: UUID | None = None,
    db: Session = Depends(get_db),
) -> list[ServicioRead]:
    """Devuelve todos los servicios (activos, completados y cancelados), con filtros opcionales."""

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
    if estado:
        consulta = consulta.where(Servicio.estado == estado.strip().lower())

    servicios = list(db.scalars(consulta).all())
    respuestas = [_servicio_a_respuesta(servicio) for servicio in servicios]

    if id_prestador is not None:
        respuestas = [
            item for item in respuestas if item.id_prestador_asignado == id_prestador
        ]

    return respuestas


@app.patch("/servicios/{id_servicio}/estado", response_model=ServicioRead)
def actualizar_estado_servicio(
    id_servicio: UUID,
    payload: EstadoServicioUpdate,
    claims: dict[str, Any] = Depends(require_admin_or_prestador),
    db: Session = Depends(get_db),
) -> ServicioRead:
    """Actualiza el estado operativo de un servicio existente (admin o prestador asignado)."""

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

    if claims.get("role") == "prestador":
        id_asignado, _ = _extraer_prestador_asignado(servicio)
        if id_asignado is None or str(id_asignado) != str(claims.get("sub")):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Solo podés actualizar el estado de servicios asignados a tu cuenta.",
            )
        if payload.estado not in (EstadoServicio.en_curso, EstadoServicio.completado):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Como prestador solo podés avanzar servicios a 'en curso' o 'completado'.",
            )

    servicio.estado = payload.estado.value
    try:
        db.commit()
        db.expire_all()
        servicio_actualizado = db.scalars(consulta_servicio).first()
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se pudo actualizar el estado del servicio.",
        ) from exc

    return _servicio_a_respuesta(servicio_actualizado or servicio)


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


@app.get("/prestadores", response_model=list[PrestadorRead], include_in_schema=False)
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
    "/prestadores",
    response_model=PrestadorRead,
    status_code=status.HTTP_201_CREATED,
    include_in_schema=False,
)
@app.post(
    "/prestadores/",
    response_model=PrestadorRead,
    status_code=status.HTTP_201_CREATED,
)
def crear_prestador(
    payload: PrestadorCreate,
    _admin: dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Prestador:
    """Registra un nuevo prestador operativo con correo y contraseña hasheada."""

    email_limpio = payload.email.strip().lower()
    existente = db.scalars(
        select(Prestador).where(func.lower(Prestador.email) == email_limpio)
    ).first()
    if existente is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ya existe un prestador registrado con ese correo electrónico.",
        )

    prestador = Prestador(
        rol=payload.rol.strip(),
        email=email_limpio,
        password_hash=hash_password(payload.password),
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


@app.post("/servicios/{id_servicio}/aceptar-prestador", response_model=ServicioRead)
def aceptar_servicio_prestador(
    id_servicio: UUID,
    payload: AceptarPrestadorRequest | None = None,
    prestador_auth: tuple[UUID, dict[str, Any]] = Depends(require_prestador),
    db: Session = Depends(get_db),
) -> ServicioRead:
    """Permite que un prestador autenticado tome un servicio en estado 'solicitado' (flujo tipo Uber)."""

    prestador_id_token, _claims = prestador_auth
    if payload is not None and payload.id_prestador is not None:
        if payload.id_prestador != prestador_id_token:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Solo podés aceptar pedidos con tu propia cuenta de prestador.",
            )

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

    if servicio.estado != EstadoServicio.solicitado.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Esta solicitud ya fue aceptada por otro prestador o no se encuentra disponible.",
        )

    prestador = db.get(Prestador, prestador_id_token)
    if prestador is None or prestador.estado != "activo":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Prestador no encontrado o inactivo.",
        )

    try:
        asignacion = Asignacion(
            id_servicio=servicio.id_servicio,
            id_prestador=prestador.id_prestador,
        )
        db.add(asignacion)
        servicio.estado = EstadoServicio.asignado.value
        db.commit()

        db.expire_all()
        servicio_actualizado = db.scalars(consulta_servicio).first()
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se pudo aceptar la solicitud en este momento.",
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

    ingresos_brutos_raw = db.scalar(
        select(func.coalesce(func.sum(Servicio.monto_total), 0.0)).where(
            Servicio.estado == EstadoServicio.completado.value
        )
    )
    comisiones_plataforma_raw = db.scalar(
        select(func.coalesce(func.sum(Servicio.comision_plataforma), 0.0)).where(
            Servicio.estado == EstadoServicio.completado.value
        )
    )
    ingresos_proyectados_raw = db.scalar(
        select(func.coalesce(func.sum(Servicio.monto_total), 0.0)).where(
            Servicio.estado.in_(estados_pendientes)
        )
    )
    comisiones_proyectadas_raw = db.scalar(
        select(func.coalesce(func.sum(Servicio.comision_plataforma), 0.0)).where(
            Servicio.estado.in_(estados_pendientes)
        )
    )

    return MetricasRead(
        total_usuarios=total_usuarios,
        servicios_pendientes=servicios_pendientes,
        servicios_completados=servicios_completados,
        tasa_cumplimiento=tasa_cumplimiento,
        promedio_valoracion=promedio_valoracion,
        total_encuestas=total_encuestas,
        ingresos_brutos=round(float(ingresos_brutos_raw or 0.0), 2),
        comisiones_plataforma=round(float(comisiones_plataforma_raw or 0.0), 2),
        ingresos_proyectados=round(float(ingresos_proyectados_raw or 0.0), 2),
        comisiones_proyectadas=round(float(comisiones_proyectadas_raw or 0.0), 2),
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

        monto_total, comision_plataforma, pago_prestador = calcular_tarifa_servicio(
            payload.tipo_servicio
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
            monto_total=monto_total,
            comision_plataforma=comision_plataforma,
            pago_prestador=pago_prestador,
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
