"""Modelos de datos operativos y de coordinación de GoldenCare."""

from __future__ import annotations

from datetime import datetime
from typing import List, Optional
from uuid import UUID, uuid4

from sqlalchemy import Boolean, CheckConstraint, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid


class Base(DeclarativeBase):
    """Base declarativa compartida por las entidades de GoldenCare."""


class Persona_Usuaria(Base):
    """Persona que solicita o recibe servicios de asistencia no médica."""

    __tablename__ = "persona_usuaria"

    id_usuario: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    zona: Mapped[str] = mapped_column(String(120), nullable=False)
    preferencias: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    estado: Mapped[str] = mapped_column(String(30), nullable=False, default="activa")

    contactos_familiares: Mapped[List[Contacto_Familiar]] = relationship(
        back_populates="usuario",
        cascade="all, delete-orphan",
    )
    servicios: Mapped[List[Servicio]] = relationship(
        back_populates="usuario",
        cascade="all, delete-orphan",
    )


class Contacto_Familiar(Base):
    """Contacto familiar o responsable asociado a una persona usuaria."""

    __tablename__ = "contacto_familiar"

    id_contacto: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    id_usuario: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("persona_usuaria.id_usuario", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    relacion: Mapped[str] = mapped_column(String(80), nullable=False)
    canal: Mapped[str] = mapped_column(String(80), nullable=False)

    usuario: Mapped[Persona_Usuaria] = relationship(back_populates="contactos_familiares")


class Servicio(Base):
    """Solicitud y registro operativo de un servicio."""

    __tablename__ = "servicio"
    __table_args__ = (
        CheckConstraint("duracion_min >= 0", name="ck_servicio_duracion_no_negativa"),
        CheckConstraint("tiempo_respuesta_min >= 0", name="ck_servicio_respuesta_no_negativa"),
        CheckConstraint(
            "valoracion IS NULL OR valoracion BETWEEN 1 AND 5",
            name="ck_servicio_valoracion_1_5",
        ),
    )

    id_servicio: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    id_usuario: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("persona_usuaria.id_usuario", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    id_equipo: Mapped[Optional[UUID]] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("equipamiento.id_equipo", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    tipo_servicio: Mapped[str] = mapped_column(String(50), nullable=False)
    fecha_hora: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    zona: Mapped[str] = mapped_column(String(120), nullable=False)
    estado: Mapped[str] = mapped_column(String(30), nullable=False, default="solicitado")
    duracion_min: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    tiempo_respuesta_min: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    cumplio_horario: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    valoracion: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    incidencia_fuera_alcance: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    monto_total: Mapped[float] = mapped_column(Float, nullable=False, default=5000.0)
    comision_plataforma: Mapped[float] = mapped_column(Float, nullable=False, default=750.0)
    pago_prestador: Mapped[float] = mapped_column(Float, nullable=False, default=4250.0)

    usuario: Mapped[Persona_Usuaria] = relationship(back_populates="servicios")
    equipamiento: Mapped[Optional[Equipamiento]] = relationship(back_populates="servicios")
    asignaciones: Mapped[List[Asignacion]] = relationship(
        back_populates="servicio",
        cascade="all, delete-orphan",
    )
    encuesta: Mapped[Optional[Encuesta]] = relationship(
        back_populates="servicio",
        uselist=False,
        cascade="all, delete-orphan",
    )


class Prestador(Base):
    """Prestador/a disponible para ejecutar servicios."""

    __tablename__ = "prestador"

    id_prestador: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    rol: Mapped[str] = mapped_column(String(50), nullable=False)
    email: Mapped[Optional[str]] = mapped_column(String(120), nullable=True, unique=True, index=True)
    password_hash: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    dni: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    telefono: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    barrio_cobertura: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    experiencia: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    estado_verificacion: Mapped[str] = mapped_column(String(30), nullable=False, default="aprobado")
    disponibilidad: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    estado: Mapped[str] = mapped_column(String(30), nullable=False, default="activo")

    asignaciones: Mapped[List[Asignacion]] = relationship(
        back_populates="prestador",
        cascade="all, delete-orphan",
    )


class Asignacion(Base):
    """Asignación de un prestador a un servicio."""

    __tablename__ = "asignacion"

    id_asignacion: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    id_servicio: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("servicio.id_servicio", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    id_prestador: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("prestador.id_prestador", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    resultado: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    servicio: Mapped[Servicio] = relationship(back_populates="asignaciones")
    prestador: Mapped[Prestador] = relationship(back_populates="asignaciones")


class Encuesta(Base):
    """Encuesta opcional de satisfacción asociada a un servicio."""

    __tablename__ = "encuesta"

    id_encuesta: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    id_servicio: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("servicio.id_servicio", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    valoracion: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    comentario: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    __table_args__ = (
        CheckConstraint(
            "valoracion IS NULL OR valoracion BETWEEN 1 AND 5",
            name="ck_encuesta_valoracion_1_5",
        ),
    )

    servicio: Mapped[Servicio] = relationship(back_populates="encuesta")


class Equipamiento(Base):
    """Equipamiento operativo disponible para los servicios."""

    __tablename__ = "equipamiento"

    id_equipo: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    tipo: Mapped[str] = mapped_column(String(80), nullable=False)
    estado: Mapped[str] = mapped_column(String(30), nullable=False, default="disponible")

    servicios: Mapped[List[Servicio]] = relationship(back_populates="equipamiento")


__all__ = [
    "Base",
    "Persona_Usuaria",
    "Contacto_Familiar",
    "Servicio",
    "Prestador",
    "Asignacion",
    "Encuesta",
    "Equipamiento",
]
