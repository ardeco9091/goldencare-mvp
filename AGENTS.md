# GoldenCare MVP - Reglas del Proyecto

## Arquitectura General
Plataforma de coordinación de servicios de asistencia no médica (traslados, acompañamientos, mandados).
- **Backend:** Python + FastAPI + SQLAlchemy + SQLite (`backend/goldencare.db`), corriendo en `http://127.0.0.1:8000`.
- **Frontend:** Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS v4, corriendo en `http://localhost:3000`.

## Estructura de Rutas del Frontend
- `/` (`frontend/app/page.tsx`): **Portal Público del Cliente**. Interfaz simple, accesible y mobile-first para que personas usuarias o familiares soliciten un servicio y consulten el estado de sus pedidos.
- `/admin` (`frontend/app/admin/page.tsx`): **Panel del Coordinador**. Dashboard operativo para ver métricas, gestionar servicios pendientes y actualizar estados.

## Convenciones Técnicas
- Mantener los modelos existentes en `backend/models.py` (`Persona_Usuaria`, `Contacto_Familiar`, `Servicio`, `Prestador`, `Asignacion`, `Encuesta`, `Equipamiento`) sin romper la compatibilidad con la base de datos SQLite actual.
- Validar entradas y salidas en `backend/schemas.py` usando Pydantic v2.
- Todo el texto visible para el usuario final debe estar en español (es-AR).
- Mantener una estética limpia, profesional y de alto contraste (paleta `slate` y `cyan` de Tailwind).