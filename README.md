# GoldenCare MVP

**GoldenCare MVP** es una plataforma web de coordinación de servicios de asistencia no médica para personas mayores (traslados, acompañamientos y mandados) diseñada específicamente para **San Pedro de Jujuy, Jujuy, Argentina**. Conecta en tiempo real a familias y personas usuarias con prestadores locales y el equipo de coordinación operativa mediante un flujo ágil **tipo Uber** y un modelo transparente de monetización (85% prestador / 15% comisión de plataforma).

---

## 1. Identificación del Proyecto y Equipo

- **Sistema:** GoldenCare MVP — Plataforma de coordinación de asistencia no médica para personas mayores en San Pedro de Jujuy, Jujuy, Argentina.
- **Empresa Cliente:** **NoveTech** — Fundador: **Ferrero Alejandro Martín** (Serapio Soria N.º 580, San Pedro de Jujuy, Jujuy).
- **Equipo de Desarrollo (EDI II):**
  - **Project Manager:** Tomás Francisco Ibáñez
  - **Programador:** Ariel Artur de la Villarmois
  - **Capacitador:** Lautaro Edgardo Lastra

---

## 2. Arquitectura y Stack Tecnológico en Producción

El repositorio está organizado como un monorepo desacoplado (`backend/` + `frontend/`) con proxy interno `/api/:path*` en Next.js para operar bajo un único dominio sin fricciones de CORS.

```text
goldencare-mvp/
├── AGENTS.md                        # Reglas y convenciones técnicas del proyecto
├── README.md                        # Documentación general, arquitectura y despliegue
├── backend/                         # API REST con FastAPI + SQLAlchemy 2.0 + Pydantic v2
│   ├── auth_utils.py                # Hash PBKDF2-SHA256 y tokens firmados HMAC-SHA256
│   ├── main.py                      # Endpoints, migración automática de columnas y lógica operativa
│   ├── models.py                    # Modelos relacionales (Persona_Usuaria, Servicio, Prestador, Asignacion, Encuesta...)
│   ├── schemas.py                   # Validación de entrada/salida con Pydantic v2
│   ├── seed.py                      # Carga determinista e idempotente de datos de San Pedro de Jujuy
│   ├── requirements.txt             # Dependencias de Python (incluye psycopg[binary])
│   └── goldencare.db                # Base de datos SQLite para desarrollo local
└── frontend/                        # Aplicación web Next.js 16 (App Router) + React 19
    ├── next.config.ts               # Proxy /api/:path* hacia NEXT_PUBLIC_API_URL (Render o local)
    ├── app/
    │   ├── layout.tsx               # Layout raíz en español (es-AR)
    │   ├── globals.css              # Estilos globales Tailwind CSS v4
    │   ├── constants/
    │   │   └── barrios.ts           # Barrios de San Pedro de Jujuy, tarifas ARS y helpers compartidos
    │   ├── page.tsx                 # Portal Público del Cliente (/)
    │   ├── prestador/
    │   │   └── page.tsx             # Portal Operativo del Prestador (/prestador)
    │   └── admin/
    │       └── page.tsx             # Panel del Coordinador (/admin)
    ├── package.json
    └── tsconfig.json
```

### Despliegue Cloud y Entornos

| Capa | Tecnología | Entorno de Producción | Desarrollo Local |
|---|---|---|---|
| **Frontend** | Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 | **Vercel:** `https://goldencare-mvp.vercel.app` | `http://localhost:3000` |
| **Backend** | Python 3.12.8 · FastAPI · SQLAlchemy 2.0 · Pydantic v2 · `psycopg[binary]` | **Render:** `https://goldencare-backend-9cb3.onrender.com` | `http://127.0.0.1:8000` |
| **Base de Datos** | PostgreSQL (producción) / SQLite (local) | **Supabase** (Sudamérica — São Paulo) con migración automática al inicio | `backend/goldencare.db` |

> **Migración automática segura:** Al iniciar FastAPI, `asegurar_columnas_monetizacion()` verifica el esquema de la tabla `servicio` y ejecuta `ALTER TABLE servicio ADD COLUMN IF NOT EXISTS ...` en PostgreSQL (o su equivalente seguro en SQLite) para `monto_total`, `comision_plataforma` y `pago_prestador`, recalculando registros previos sin pérdida de datos.

---

## 3. Los 3 Portales Operativos y Flujo Tipo Uber

### Modelo de Monetización y Tarifas (ARS)

| Tipo de Servicio | Tarifa Cliente (`monto_total`) | Comisión GoldenCare (15%) | Ganancia Neta Prestador (85%) |
|---|---:|---:|---:|
| **Traslado** | `$ 6.500` | `$ 975` | `$ 5.525` |
| **Acompañamiento** | `$ 5.000` | `$ 750` | `$ 4.250` |
| **Mandados** | `$ 4.000` | `$ 600` | `$ 3.400` |

### 1. Portal Público del Cliente (`/`)
- **Acceso limpio para familias:** sin botones ni enlaces administrativos expuestos en el header ni en el footer.
- **Solicitud guiada en 3 pasos:** elección de servicio con tarifa visible, barrios reales de San Pedro de Jujuy (`Centro / Microcentro`, `Barrio Belgrano`, `Barrio Patricios`, `Barrio San Martín`, `Barrio Providencia`, `Barrio Ejército del Norte`, `Barrio Güemes / Bernacchi`, `Barrio 23 de Agosto / La Merced`, `La Esperanza`, `Otro barrio de San Pedro`), dirección/referencia exacta, fecha/hora y datos de contacto.
- **Tarifa Estimada previa:** muestra el monto fijo transparente antes de confirmar el pedido.
- **Seguimiento en vivo tipo Uber (auto-refresco cada 4 s):**
  - Código único de 8 caracteres con copiado rápido y buscador por código o contacto.
  - Estado `solicitado`: indicador animado *"Buscando prestador disponible en San Pedro..."*.
  - Estados `asignado` y `en curso`: tarjeta destacada estilo Uber con iniciales, nombre, especialidad/rol del prestador asignado, estado en vivo y tarifa.
  - Estado `completado`: habilita la **encuesta de satisfacción (1 a 5 estrellas + comentario opcional)**.

### 2. Portal del Prestador (`/prestador`)
- **Acceso autenticado y autoregistro con verificación obligatoria:**
  - Pestaña **Iniciar Sesión**: ingreso por correo electrónico y contraseña (`POST /prestadores/login`), con control de estado de verificación (`403` si está pendiente o rechazado), token `Bearer` firmado HMAC-SHA256 en `sessionStorage` y botón **"Cerrar sesión"**.
  - Pestaña **Registrarme como Prestador**: formulario público de postulación (`POST /prestadores/registro`) con Nombre y Apellido, DNI, Teléfono/WhatsApp, Correo Electrónico, Contraseña, Especialidad, Barrio de cobertura en San Pedro de Jujuy y Experiencia/Referencias. Queda en estado **Pendiente de Verificación** hasta que el coordinador lo apruebe.
- **Interfaz mobile-first:** pensada para celulares de prestadores en terreno con sincronización automática cada 4 segundos.
- **Perfil y Ganancias exclusivas:** muestra exclusivamente las **Ganancias acumuladas (85%)** sobre servicios completados y el monto **En curso / por cobrar** del prestador autenticado.
- **Solicitudes Disponibles (estilo Uber):** lista en tiempo real de pedidos en estado `solicitado` con badge de urgencia, barrio, dirección, ganancia neta (85%) y botón **"Aceptar Pedido"** (`POST /servicios/{id_servicio}/aceptar-prestador`, protegido por token Bearer y con control de concurrencia `409 Conflict`).
- **Mis Servicios:** gestión en un toque para avanzar el ciclo operativo (`asignado` → `en curso` → `completado`) verificando que el servicio pertenezca al prestador autenticado, más historial completado con valoraciones.

### 3. Panel del Coordinador (`/admin`)
- **Acceso autenticado con Correo y Contraseña:** login mediante `POST /auth/login` (acepta correo `ADMIN_EMAIL` o usuario legacy `ADMIN_USER`) y token firmado HMAC-SHA256 guardado en `sessionStorage`, con botón **"Cerrar sesión"**.
- **Verificación de Postulantes Pendientes:** sección destacada con contador en vivo (`GET /prestadores/pendientes`) que muestra DNI, teléfono, correo, especialidad, barrio y experiencia de cada postulante con botones directos **"Verificar y Habilitar"** y **"Rechazar"** (`PATCH /prestadores/{id_prestador}/verificar`).
- **Alta directa de prestadores:** el modal **Nuevo Prestador** solicita Nombre/Especialidad, **Correo Electrónico**, **Contraseña inicial** (almacenada como hash PBKDF2-SHA256), DNI, Teléfono y Barrio de cobertura, habilitando la cuenta de inmediato.
- **Tarjetas completas sin scroll horizontal:** lista vertical de tarjetas independientes con borde izquierdo por estado (`solicitado` ámbar, `asignado` azul, `en curso` índigo, `completado` esmeralda, `cancelado` rojo), cabecera con ID/estado/urgencia/fecha y cuerpo en 3 columnas responsivas (Cliente y Ubicación completa sin truncar, Servicio y desglose de Tarifas, Prestador y controles directos).
- **Pestañas y filtros inteligentes:** vistas de **Servicios Activos**, **Historial Completados** (con estrellas y comentario de encuesta) y **Todas**; búsqueda instantánea, filtros por estado/tipo y ordenamiento por **urgencia horaria (próximas 24 h)**.
- **Métricas Operativas y Financieras:** Total de Usuarios, Servicios Pendientes, Tasa de Cumplimiento, Satisfacción Promedio (`★`) y **Comisiones GoldenCare (15%)** con ingresos brutos y comisiones proyectadas en curso.
- **Gestión de equipo y demanda:** altas rápidas de clientes, prestadores y servicios.

---

## 4. Endpoints Principales de la API

En producción se consumen de forma transparente a través del proxy `/api/*` de Vercel hacia `https://goldencare-backend-9cb3.onrender.com`.

| Método | Endpoint | Descripción |
|---|---|---|
| `POST` | `/auth/login` | Autentica al coordinador con correo (`ADMIN_EMAIL` o usuario legacy) y contraseña; devuelve token HMAC-SHA256 con `role: "admin"` |
| `POST` | `/prestadores/registro` | Autoregistro público de postulantes a prestador (DNI, teléfono, email, password, especialidad, barrio y experiencia); queda `pendiente` de verificación |
| `POST` | `/prestadores/login` | Autentica a un prestador aprobado por correo y contraseña (PBKDF2); rechaza con `403` si está pendiente o rechazado |
| `GET` | `/prestadores/pendientes` | *(Admin)* Lista los postulantes a prestador en estado `pendiente` de verificación |
| `PATCH` | `/prestadores/{id_prestador}/verificar` | *(Admin)* Aprueba (`aprobar`) o rechaza (`rechazar`) a un postulante a prestador |
| `POST` | `/pedidos/publico` | Crea un pedido desde `/`, calcula tarifa/comisión/neto, crea o reutiliza el usuario y devuelve código corto de 8 caracteres |
| `GET` | `/pedidos/consultar/{codigo_o_contacto}` | Consulta pedidos por código de 8 caracteres o coincidencia parcial en nombre/teléfono |
| `GET` | `/servicios/` | Lista todos los servicios enriquecidos (soporta filtros `?estado=` y `?id_prestador=`) |
| `GET` | `/servicios/pendientes` | Lista los servicios abiertos (`solicitado`, `asignado`, `en curso`) |
| `POST` | `/servicios/` | Registra un nuevo servicio desde el panel `/admin` con cálculo automático de tarifas |
| `POST` | `/servicios/{id_servicio}/aceptar-prestador` | Permite a un prestador tomar un servicio `solicitado` (flujo Uber), creando la `Asignacion` y pasándolo a `asignado` |
| `POST` | `/servicios/{id_servicio}/asignar` | Asigna o reasigna un prestador desde `/admin` y actualiza el estado a `asignado` |
| `PATCH` | `/servicios/{id_servicio}/estado` | Actualiza el estado operativo (`solicitado`, `asignado`, `en curso`, `completado`, `cancelado`) |
| `POST` | `/servicios/{id_servicio}/encuesta` | Registra la calificación (1–5 estrellas) y comentario para un servicio `completado` |
| `GET` | `/metricas` | Métricas operativas y financieras en vivo (`ingresos_brutos`, `comisiones_plataforma`, `ingresos_proyectados`, `comisiones_proyectadas`, encuestas y cumplimiento) |
| `GET` / `POST` | `/usuarios/` | Lista y registra personas usuarias con su contacto familiar |
| `GET` / `POST` | `/prestadores/` | Lista y registra prestadores activos (`Nombre - Especialidad`) |

---

## 5. Variables de Entorno

| Variable | Servicio | Descripción | Ejemplo |
|---|---|---|---|
| `DATABASE_URL` | Backend (Render) | Cadena de conexión PostgreSQL de Supabase (se normaliza automáticamente a `postgresql+psycopg://`). En local usa SQLite por defecto | `postgresql://postgres:***@aws-0-sa-east-1.pooler.supabase.com:6543/postgres` |
| `PYTHON_VERSION` | Backend (Render) | Versión fija de Python para compatibilidad óptima con wheels binarios | `3.12.8` |
| `ADMIN_EMAIL` | Backend (Render) | Correo administrativo para login en `/admin` (por defecto `admin@goldencare.com`) | `admin@goldencare.com` |
| `ADMIN_USER` | Backend (Render) | Usuario legacy alternativo aceptado en `/auth/login` | `admin` |
| `ADMIN_PASSWORD` | Backend (Render) | Contraseña administrativa (por defecto `goldencare2026`) y clave base para firma HMAC-SHA256 | `goldencare2026` |
| `NEXT_PUBLIC_API_URL` | Frontend (Vercel) | URL base del backend usada por `next.config.ts` en el rewrite `/api/:path*` | `https://goldencare-backend-9cb3.onrender.com` |

### Credenciales Iniciales de Prueba
- **Coordinador (`/admin`):** `admin@goldencare.com` / `goldencare2026` (configurables vía `ADMIN_EMAIL` y `ADMIN_PASSWORD`).
- **Prestadores iniciales (`/prestador`, contraseña `prestador123`):**
  - `laura.mendez@goldencare.com` (Laura Méndez - Acompañamiento)
  - `roberto.gomez@goldencare.com` (Roberto Gómez - Traslados)
  - `carolina.vega@goldencare.com` (Carolina Vega - Mandados y Farmacia)

---

## 6. Guía de Ejecución Local y Verificación

### Requisitos previos
- **Python** 3.12+ (recomendado `3.12.8`)
- **Node.js** 20+ y **npm**

### 1. Backend (FastAPI)
```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
python seed.py
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```
- API local: `http://127.0.0.1:8000`
- Swagger UI: `http://127.0.0.1:8000/docs`

### 2. Frontend (Next.js)
```powershell
cd frontend
npm install
npm run dev -- -H 0.0.0.0
```
- **Portal Público del Cliente:** `http://localhost:3000`
- **Portal del Prestador:** `http://localhost:3000/prestador`
- **Panel del Coordinador:** `http://localhost:3000/admin`

### 3. Comandos de Verificación
```powershell
# Verificación de sintaxis del backend
cd backend
python -m py_compile models.py schemas.py main.py seed.py

# Verificación de tipos y build de producción del frontend
cd frontend
npx tsc --noEmit
npm run build
```
