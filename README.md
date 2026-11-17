# GoldenCare MVP

**GoldenCare** es una plataforma de coordinación de servicios de asistencia no médica (traslados, acompañamientos y mandados) diseñada para conectar de forma simple, accesible y en tiempo real a personas usuarias, sus familiares y el equipo de coordinación operativa.

---

## Arquitectura General

El proyecto sigue una arquitectura desacoplada en dos aplicaciones dentro del monorepo:

```text
goldencare-mvp/
├── AGENTS.md                 # Reglas y convenciones del proyecto
├── README.md                 # Documentación general y guía de ejecución
├── backend/                  # API REST con FastAPI + SQLAlchemy + SQLite
│   ├── main.py               # Endpoints y lógica de negocio
│   ├── models.py             # Modelos relacionales SQLAlchemy
│   ├── schemas.py            # Validación de esquemas con Pydantic v2
│   ├── seed.py               # Carga determinista e idempotente de datos iniciales
│   ├── requirements.txt      # Dependencias de Python
│   └── goldencare.db         # Base de datos SQLite local
└── frontend/                 # Aplicación web Next.js 16 (App Router)
    ├── app/
    │   ├── layout.tsx        # Layout raíz en español (es-AR)
    │   ├── page.tsx          # Portal Público del Cliente (/)
    │   └── admin/
    │       └── page.tsx      # Panel Operativo del Coordinador (/admin)
    ├── package.json
    └── tsconfig.json
```

### Stack Tecnológico
- **Backend:** Python 3.10+ · FastAPI · SQLAlchemy 2.0 · Pydantic v2 · SQLite (`backend/goldencare.db`) en `http://127.0.0.1:8000`.
- **Frontend:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 (paleta de alto contraste `slate` + `cyan`) en `http://localhost:3000`.

---

## Módulos y Rutas del Frontend

### 1. Portal Público del Cliente (`/`)
Interfaz accesible, clara y 100% *mobile-first* orientada a personas usuarias y familiares:
- **Solicitar un Servicio:** Flujo guiado en 3 pasos para elegir el tipo de asistencia (`traslado`, `acompañamiento` o `mandado`), zona (`Zona Centro`, `Barrio Norte`, `Zona Sur`), fecha/hora y datos de contacto con notas o preferencias.
- **Comprobante con Código Corto:** Genera un código único de 8 caracteres con botón de copiado rápido y estado en vivo.
- **Seguir mi Pedido:** Buscador por código de 8 caracteres o por nombre/teléfono, con barra visual de progreso, explicación de cada etapa, visualización del **profesional asignado** y auto-refresco silencioso cada 4 segundos.
- **Encuesta de Satisfacción:** Cuando el servicio pasa a estado `completado`, habilita automáticamente la calificación de 1 a 5 estrellas (`★`) y comentario opcional, tanto en el comprobante en vivo como en la pestaña de seguimiento.

### 2. Panel del Coordinador (`/admin`)
Dashboard operativo para la gestión integral de la demanda en tiempo real:
- **Métricas Operativas en Vivo:** Tarjetas sincronizadas con la base de datos para **Total Usuarios**, **Servicios Pendientes**, **Tasa de Cumplimiento** y **Satisfacción Promedio (`★`)**.
- **Gestión de Clientes y Prestadores:** Modales ágiles para dar de alta nuevos clientes (`Persona_Usuaria` + `Contacto_Familiar`) y profesionales (`Prestador`).
- **Asignación de Prestadores y Estados:** Tabla interactiva con datos de contacto y preferencias del cliente, selector directo de **Prestador Asignado** (que vincula la tabla `Asignacion` y pasa el servicio a `asignado`) y selector de estado operativo (`solicitado`, `asignado`, `en curso`, `completado`, `cancelado`).
- **Sincronización Automática:** Refresco silencioso cada 4 segundos con pausa inteligente al abrir modales y tolerancia a reinicios del servidor.

---

## Endpoints Principales de la API (`http://127.0.0.1:8000`)

| Método | Endpoint | Descripción |
|---|---|---|
| `POST` | `/pedidos/publico` | Registra un pedido desde el portal público (reutilizando o creando la `Persona_Usuaria` y `Contacto_Familiar`) y devuelve el código de seguimiento de 8 caracteres |
| `GET` | `/pedidos/consultar/{codigo_o_contacto}` | Busca pedidos por código corto de 8 caracteres o coincidencia parcial en el nombre/teléfono de contacto |
| `POST` | `/servicios/{id_servicio}/encuesta` | Registra la valoración (1 a 5 estrellas) y comentario en la tabla `Encuesta` para un servicio `completado` |
| `GET` | `/servicios/pendientes` | Lista los servicios abiertos (`solicitado`, `asignado`, `en curso`) enriquecidos con contacto, preferencias y prestador asignado |
| `POST` | `/servicios/` | Registra un nuevo servicio desde el panel del coordinador |
| `POST` | `/servicios/{id_servicio}/asignar` | Crea o actualiza la `Asignacion` de un prestador y cambia automáticamente el estado a `asignado` |
| `PATCH` | `/servicios/{id_servicio}/estado` | Actualiza el estado operativo de un servicio |
| `GET` | `/metricas` | Devuelve métricas consolidadas en tiempo real (`total_usuarios`, `servicios_pendientes`, `servicios_completados`, `tasa_cumplimiento`, `promedio_valoracion`, `total_encuestas`) |
| `GET` | `/usuarios/` | Lista las personas usuarias registradas con su contacto familiar |
| `POST` | `/usuarios/` | Registra una nueva persona usuaria y su contacto responsable |
| `GET` | `/prestadores/` | Lista los prestadores activos disponibles para asignación |
| `POST` | `/prestadores/` | Registra un nuevo prestador operativo (`Nombre - Especialidad`) |

---

## Guía de Instalación y Ejecución Local

### Requisitos previos
- **Python** 3.10 o superior
- **Node.js** 18.18 o superior y **npm**

### 1. Levantar el Backend (FastAPI)

Abrir una terminal en la raíz del proyecto (`goldencare-mvp`):

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

*(Opcional)* Si PowerShell restringe la ejecución de scripts en la sesión actual:
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

Poblar o sincronizar los datos iniciales de demostración (script idempotente con 4 clientes, 3 prestadores, 6 servicios y 2 encuestas):
```powershell
python seed.py
```

Iniciar el servidor FastAPI en el puerto `8000`:
```powershell
uvicorn main:app --reload --port 8000
```
- **API Base:** http://127.0.0.1:8000
- **Documentación interactiva (Swagger UI):** http://127.0.0.1:8000/docs

### 2. Levantar el Frontend (Next.js)

Abrir una **segunda terminal** en la raíz del proyecto (`goldencare-mvp`):

```powershell
cd frontend
npm install
npm run dev
```

Accesos en el navegador:
- **Portal Público del Cliente:** http://localhost:3000
- **Panel Operativo del Coordinador:** http://localhost:3000/admin

---

## Verificación de Calidad y Compilación

### Backend (Python)
```powershell
cd backend
python -m py_compile models.py schemas.py main.py seed.py
```

### Frontend (TypeScript y Build de Producción)
```powershell
cd frontend
npx tsc --noEmit
npm run build
```
