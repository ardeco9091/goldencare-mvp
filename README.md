# GoldenCare MVP

GoldenCare es un MVP académico para la gestión y coordinación de servicios de asistencia no médica. Permite registrar personas usuarias, crear solicitudes, consultar servicios pendientes y actualizar sus estados operativos.

## Arquitectura

El proyecto está organizado en dos aplicaciones:

```text
goldencare-mvp/
├── backend/
│   ├── main.py
│   ├── models.py
│   ├── schemas.py
│   ├── seed.py
│   ├── requirements.txt
│   └── goldencare.db
└── frontend/
    ├── app/
    ├── package.json
    └── package-lock.json
```

### Backend

- Python
- FastAPI
- SQLAlchemy
- Pydantic
- SQLite para desarrollo

Endpoints principales:

| Método | Endpoint | Descripción |
|---|---|---|
| `POST` | `/usuarios/` | Registra una persona usuaria y su contacto |
| `GET` | `/usuarios/` | Lista personas usuarias disponibles |
| `POST` | `/servicios/` | Registra una solicitud de servicio |
| `GET` | `/servicios/pendientes` | Consulta servicios abiertos |
| `PATCH` | `/servicios/{id_servicio}/estado` | Actualiza el estado de un servicio |

Estados válidos: `solicitado`, `asignado`, `en curso`, `completado` y `cancelado`.

### Frontend

- Next.js con App Router
- React
- TypeScript
- Tailwind CSS

El frontend contiene el dashboard del coordinador, formularios para clientes y servicios, y actualización interactiva de estados.

## Requisitos

- Python 3.10 o superior
- Node.js 18.18 o superior
- npm
- Git

## Instalación y ejecución del backend

Desde la carpeta raíz del repositorio:

### Windows PowerShell

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Si PowerShell bloquea la activación del entorno, se puede ejecutar en esa terminal:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

Luego iniciar la API:

```powershell
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

La API estará disponible en:

- http://127.0.0.1:8000
- Documentación Swagger: http://127.0.0.1:8000/docs

Para cargar o actualizar el dataset simulado:

```powershell
python seed.py
```

## Instalación y ejecución del frontend

Abrir una segunda terminal:

```powershell
cd frontend
npm install
npm run dev
```

El dashboard estará disponible en http://localhost:3000.

El backend debe estar funcionando en el puerto 8000 para que el dashboard pueda consultar y registrar datos.

## Validaciones de desarrollo

Backend:

```powershell
cd backend
python -m py_compile models.py schemas.py main.py
```

Frontend:

```powershell
cd frontend
npm run lint
npx tsc --noEmit
```

## Datos de desarrollo

El archivo `backend/goldencare.db` se conserva intencionalmente en el repositorio porque contiene datos de prueba del MVP. El script `backend/seed.py` también se incluye para reproducir el dataset simulado en otra máquina.

Para producción se recomienda migrar a PostgreSQL, utilizar Alembic para migraciones, incorporar autenticación por roles y separar los datos de desarrollo de los datos productivos.

## Próximas etapas

1. Agregar autenticación y roles para coordinadores, familiares y prestadores.
2. Crear el portal web para que familiares registren personas usuarias y soliciten servicios.
3. Implementar asignación de prestadores y notificaciones.
4. Migrar la base de datos a PostgreSQL.
5. Agregar pruebas automatizadas, auditoría y despliegue con Docker.
