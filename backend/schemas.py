"""Esquemas Pydantic de entrada y salida para la API de GoldenCare."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


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
    """Datos para registrar un prestador."""

    rol: str = Field(min_length=1, max_length=50)
    disponibilidad: bool = True
    estado: str = Field(default="activo", min_length=1, max_length=30)


class PrestadorRead(PrestadorCreate):
    """Representación de un prestador persistido."""

    id_prestador: UUID
    model_config = ConfigDict(from_attributes=True)


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
]
