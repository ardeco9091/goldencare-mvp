"""Esquemas Pydantic de entrada y salida para la API de GoldenCare."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class EstadoServicio(str, Enum):
    """Estados operativos permitidos para un servicio."""

    solicitado = "solicitado"
    asignado = "asignado"
    en_curso = "en curso"
    completado = "completado"
    cancelado = "cancelado"


class ServicioCreate(BaseModel):
    """Datos necesarios para registrar una solicitud de servicio."""

    id_usuario: UUID
    id_equipo: Optional[UUID] = None
    tipo_servicio: str = Field(min_length=1, max_length=50)
    fecha_hora: datetime
    zona: str = Field(min_length=1, max_length=120)
    estado: EstadoServicio = EstadoServicio.solicitado
    duracion_min: Optional[int] = Field(default=None, ge=0)
    tiempo_respuesta_min: Optional[int] = Field(default=None, ge=0)
    cumplio_horario: Optional[bool] = None
    valoracion: Optional[int] = Field(default=None, ge=1, le=5)
    incidencia_fuera_alcance: bool = False


class ServicioRead(ServicioCreate):
    """Representación de un servicio persistido."""

    id_servicio: UUID
    nombre_contacto: Optional[str] = None
    preferencias: Optional[str] = None
    id_prestador_asignado: Optional[UUID] = None
    prestador_asignado: Optional[str] = None
    comentario_encuesta: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


class EstadoServicioUpdate(BaseModel):
    """Nuevo estado válido para actualizar un servicio."""

    estado: EstadoServicio


class ContactoFamiliarCreate(BaseModel):
    """Datos del contacto o responsable de una persona usuaria."""

    relacion: str = Field(default="responsable", min_length=1, max_length=80)
    canal: str = Field(min_length=1, max_length=80)


class PersonaUsuariaBase(BaseModel):
    """Campos comunes de una persona usuaria."""

    zona: str = Field(min_length=1, max_length=120)
    preferencias: Optional[str] = None
    estado: str = Field(default="activa", min_length=1, max_length=30)


class PersonaUsuariaCreate(PersonaUsuariaBase):
    """Datos para registrar una persona usuaria."""

    contacto_familiar: ContactoFamiliarCreate


class PersonaUsuariaRead(PersonaUsuariaBase):
    """Representación de una persona usuaria persistida."""

    id_usuario: UUID
    contacto_familiar: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


class PrestadorCreate(BaseModel):
    """Datos para registrar un prestador (rol almacena 'Nombre - Especialidad')."""

    rol: str = Field(min_length=1, max_length=50)
    disponibilidad: bool = True
    estado: str = Field(default="activo", min_length=1, max_length=30)

    @field_validator("rol")
    @classmethod
    def validar_rol(cls, valor: str) -> str:
        limpio = valor.strip()
        if not limpio:
            raise ValueError("El nombre y especialidad del prestador no puede estar vacío.")
        return limpio


class PrestadorRead(PrestadorCreate):
    """Representación de un prestador persistido."""

    id_prestador: UUID
    model_config = ConfigDict(from_attributes=True)


class AsignarPrestadorRequest(BaseModel):
    """Datos para asignar un prestador a un servicio."""

    id_prestador: UUID


class EncuestaCreate(BaseModel):
    """Datos enviados por el cliente para calificar un servicio completado."""

    valoracion: int = Field(ge=1, le=5)
    comentario: Optional[str] = None


class EncuestaRead(EncuestaCreate):
    """Representación de una encuesta persistida."""

    id_encuesta: UUID
    id_servicio: UUID
    model_config = ConfigDict(from_attributes=True)


BARRIOS_SAN_PEDRO = (
    "Centro / Microcentro",
    "Barrio Belgrano",
    "Barrio Patricios",
    "Barrio San Martín",
    "Barrio Providencia",
    "Barrio Ejército del Norte",
    "Barrio Güemes / Bernacchi",
    "Barrio 23 de Agosto / La Merced",
    "La Esperanza",
    "Otro barrio de San Pedro",
)

TipoServicioPermitido = Literal["traslado", "acompañamiento", "mandado"]


class PedidoPublicoCreate(BaseModel):
    """Datos unificados enviados desde el portal público de solicitud de servicios."""

    nombre_contacto: str = Field(min_length=1, max_length=80)
    zona: str = Field(min_length=1, max_length=120)
    tipo_servicio: TipoServicioPermitido
    fecha_hora: datetime
    preferencias: Optional[str] = None

    @field_validator("nombre_contacto", "zona")
    @classmethod
    def validar_texto_no_vacio(cls, valor: str) -> str:
        limpio = valor.strip()
        if not limpio:
            raise ValueError("El campo no puede estar vacío.")
        return limpio


class PedidoPublicoRead(ServicioRead):
    """Respuesta al crear un pedido público con su código corto de seguimiento."""

    codigo_seguimiento: str
    nombre_contacto: str
    servicio: ServicioRead


class PedidoConsultaRead(ServicioRead):
    """Resultado de consulta pública de pedidos por código o contacto."""

    codigo_seguimiento: str
    nombre_contacto: str
    servicio: ServicioRead


class MetricasRead(BaseModel):
    """Métricas operativas en tiempo real para el Panel del Coordinador."""

    total_usuarios: int
    servicios_pendientes: int
    servicios_completados: int
    tasa_cumplimiento: float
    promedio_valoracion: Optional[float] = None
    total_encuestas: int = 0


# Alias con el mismo nombre de las entidades SQLAlchemy del modelo conceptual.
Persona_UsuariaCreate = PersonaUsuariaCreate
Persona_UsuariaRead = PersonaUsuariaRead


__all__ = [
    "EstadoServicio",
    "ServicioCreate",
    "ServicioRead",
    "EstadoServicioUpdate",
    "ContactoFamiliarCreate",
    "PersonaUsuariaBase",
    "PersonaUsuariaCreate",
    "PersonaUsuariaRead",
    "Persona_UsuariaCreate",
    "Persona_UsuariaRead",
    "PrestadorCreate",
    "PrestadorRead",
    "AsignarPrestadorRequest",
    "EncuestaCreate",
    "EncuestaRead",
    "PedidoPublicoCreate",
    "PedidoPublicoRead",
    "PedidoConsultaRead",
    "MetricasRead",
]
