"use client";

import {
  useCallback,
  useEffect,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";

const API_URL = "http://127.0.0.1:8000/servicios/pendientes";
const CREATE_API_URL = "http://127.0.0.1:8000/servicios/";
const USERS_API_URL = "http://127.0.0.1:8000/usuarios/";

type EstadoServicio =
  | "solicitado"
  | "asignado"
  | "en curso"
  | "completado"
  | "cancelado";

type Servicio = {
  id_servicio: string;
  tipo_servicio: string;
  zona: string;
  fecha_hora: string;
  estado: EstadoServicio;
};

type Usuario = {
  id_usuario: string;
  zona: string;
  preferencias: string | null;
  estado: string;
  contacto_familiar: string | null;
};

type NewServiceForm = {
  usuarioId: string;
  tipoServicio: "traslado" | "acompañamiento" | "mandado";
  zona: "Zona Centro" | "Barrio Norte" | "Zona Sur";
  fechaHora: string;
};

type NewClientForm = {
  contacto: string;
  zona: "Zona Centro" | "Barrio Norte" | "Zona Sur";
  preferencias: string;
};

const initialForm: NewServiceForm = {
  usuarioId: "",
  tipoServicio: "traslado",
  zona: "Zona Centro",
  fechaHora: "",
};

const initialClientForm: NewClientForm = {
  contacto: "",
  zona: "Zona Centro",
  preferencias: "",
};

const serviceStatuses: EstadoServicio[] = [
  "solicitado",
  "asignado",
  "en curso",
  "completado",
  "cancelado",
];

const metrics = [
  {
    label: "Total Usuarios",
    value: "248",
    detail: "+12% este mes",
    icon: "US",
    iconClass: "bg-blue-100 text-blue-700",
  },
  {
    label: "Tasa de Cumplimiento",
    value: "94,8%",
    detail: "+2,4% frente al mes anterior",
    icon: "%",
    iconClass: "bg-emerald-100 text-emerald-700",
  },
  {
    label: "Tiempo Promedio de Respuesta",
    value: "18 min",
    detail: "4 min menos que la semana pasada",
    icon: "⏱",
    iconClass: "bg-violet-100 text-violet-700",
  },
];

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function statusClass(status: EstadoServicio) {
  switch (status) {
    case "solicitado":
      return "bg-amber-50 text-amber-700 ring-amber-600/20";
    case "asignado":
      return "bg-blue-50 text-blue-700 ring-blue-600/20";
    case "en curso":
      return "bg-violet-50 text-violet-700 ring-violet-600/20";
    case "completado":
      return "bg-emerald-50 text-emerald-700 ring-emerald-600/20";
    case "cancelado":
      return "bg-rose-50 text-rose-700 ring-rose-600/20";
  }
}

export default function Home() {
  const [services, setServices] = useState<Servicio[]>([]);
  const [users, setUsers] = useState<Usuario[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState<NewServiceForm>(initialForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isClientModalOpen, setIsClientModalOpen] = useState(false);
  const [clientFormData, setClientFormData] = useState<NewClientForm>(initialClientForm);
  const [isClientSubmitting, setIsClientSubmitting] = useState(false);
  const [clientFormError, setClientFormError] = useState<string | null>(null);
  const [updatingServiceId, setUpdatingServiceId] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const loadServices = useCallback(async (signal?: AbortSignal) => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(API_URL, { cache: "no-store", signal });
      if (!response.ok) {
        throw new Error("No se pudieron cargar los servicios pendientes.");
      }

      const data: Servicio[] = await response.json();
      setServices(data);
    } catch (requestError) {
      if (signal?.aborted) {
        return;
      }

      setError(
        requestError instanceof Error
          ? requestError.message
          : "Ocurrió un error al conectar con la API.",
      );
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false);
      }
    }
  }, []);

  const loadUsers = useCallback(async () => {
    const response = await fetch(USERS_API_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("No se pudieron cargar las personas usuarias.");
    }

    const data: Usuario[] = await response.json();
    setUsers(data);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    Promise.all([
      fetch(API_URL, { cache: "no-store", signal: controller.signal }).then((response) => {
        if (!response.ok) {
          throw new Error("No se pudieron cargar los servicios pendientes.");
        }
        return response.json() as Promise<Servicio[]>;
      }),
      fetch(USERS_API_URL, { cache: "no-store", signal: controller.signal }).then((response) => {
        if (!response.ok) {
          throw new Error("No se pudieron cargar las personas usuarias.");
        }
        return response.json() as Promise<Usuario[]>;
      }),
    ])
      .then(([serviceData, userData]) => {
        setServices(serviceData);
        setUsers(userData);
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Ocurrió un error al conectar con la API.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => controller.abort();
  }, []);

  function handleFormChange(
    event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) {
    const { name, value } = event.target;
    setFormData((current) => ({ ...current, [name]: value } as NewServiceForm));
  }

  function openModal() {
    setFormError(null);
    setIsModalOpen(true);
  }

  function closeModal() {
    if (!isSubmitting) {
      setFormError(null);
      setIsModalOpen(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setFormError(null);

    try {
      const response = await fetch(CREATE_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id_usuario: formData.usuarioId,
          tipo_servicio: formData.tipoServicio,
          zona: formData.zona,
          fecha_hora: new Date(formData.fechaHora).toISOString(),
          id_equipo: null,
          estado: "solicitado",
          duracion_min: 0,
          tiempo_respuesta_min: null,
          cumplio_horario: null,
          valoracion: null,
          incidencia_fuera_alcance: false,
        }),
      });

      const responseBody = await response.json().catch(() => null);
      if (!response.ok) {
        console.log("Detalle JSON del error al registrar el servicio:", responseBody);
        const detail =
          responseBody && typeof responseBody.detail === "string"
            ? responseBody.detail
            : "No se pudo registrar el servicio.";
        throw new Error(detail);
      }

      await loadServices();
      setFormData(initialForm);
      setIsModalOpen(false);
    } catch (requestError) {
      setFormError(
        requestError instanceof Error
          ? requestError.message
          : "Ocurrió un error de red al registrar el servicio.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function openClientModal() {
    setClientFormError(null);
    setIsClientModalOpen(true);
  }

  function closeClientModal() {
    if (!isClientSubmitting) {
      setClientFormError(null);
      setIsClientModalOpen(false);
    }
  }

  async function handleClientSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsClientSubmitting(true);
    setClientFormError(null);

    try {
      const response = await fetch(USERS_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          zona: clientFormData.zona,
          preferencias: clientFormData.preferencias.trim() || null,
          contacto_familiar: {
            relacion: "responsable",
            canal: clientFormData.contacto.trim(),
          },
        }),
      });

      const responseBody = await response.json().catch(() => null);
      if (!response.ok) {
        console.log("Detalle JSON del error al registrar el cliente:", responseBody);
        const detail =
          responseBody && typeof responseBody.detail === "string"
            ? responseBody.detail
            : "No se pudo registrar el cliente.";
        throw new Error(detail);
      }

      await loadUsers();
      setClientFormData(initialClientForm);
      setIsClientModalOpen(false);
    } catch (requestError) {
      setClientFormError(
        requestError instanceof Error
          ? requestError.message
          : "Ocurrió un error de red al registrar el cliente.",
      );
    } finally {
      setIsClientSubmitting(false);
    }
  }

  async function handleStatusChange(idServicio: string, estado: EstadoServicio) {
    setUpdatingServiceId(idServicio);
    setStatusError(null);

    try {
      const response = await fetch(
        `http://127.0.0.1:8000/servicios/${encodeURIComponent(idServicio)}/estado`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ estado }),
        },
      );

      const responseBody = await response.json().catch(() => null);
      if (!response.ok) {
        console.log("Detalle JSON del error al actualizar el estado:", responseBody);
        const detail =
          responseBody && typeof responseBody.detail === "string"
            ? responseBody.detail
            : "No se pudo actualizar el estado del servicio.";
        throw new Error(detail);
      }

      await loadServices();
    } catch (requestError) {
      setStatusError(
        requestError instanceof Error
          ? requestError.message
          : "Ocurrió un error de red al actualizar el estado.",
      );
    } finally {
      setUpdatingServiceId(null);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-[1600px]">
        <aside className="hidden w-72 shrink-0 flex-col bg-slate-950 px-6 py-8 text-slate-300 lg:flex">
          <div className="flex items-center gap-3 px-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-400 font-bold text-slate-950">
              G
            </div>
            <div>
              <p className="text-lg font-bold tracking-tight text-white">GoldenCare</p>
              <p className="text-xs text-slate-400">Coordinación operativa</p>
            </div>
          </div>

          <nav className="mt-12 space-y-2" aria-label="Navegación principal">
            <a
              href="#resumen"
              className="flex items-center gap-3 rounded-xl bg-white/10 px-4 py-3 text-sm font-semibold text-white"
            >
              <span className="text-cyan-300">▦</span>
              Resumen
            </a>
            <a
              href="#servicios"
              className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm transition hover:bg-white/10 hover:text-white"
            >
              <span>≡</span>
              Servicios
            </a>
            <a
              href="#indicadores"
              className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm transition hover:bg-white/10 hover:text-white"
            >
              <span>↗</span>
              Indicadores
            </a>
          </nav>

          <div className="mt-auto rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
              Estado del sistema
            </p>
            <div className="mt-3 flex items-center gap-2 text-sm text-slate-200">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.12)]" />
              API operativa
            </div>
          </div>
        </aside>

        <section className="min-w-0 flex-1 px-5 py-6 sm:px-8 lg:px-12 lg:py-10">
          <header className="flex flex-col gap-5 border-b border-slate-200 pb-8 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-700">
                Panel del coordinador
              </p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
                Resumen operativo
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-500 sm:text-base">
                Una vista general de la demanda y los servicios que requieren seguimiento.
              </p>
            </div>
            <div className="flex items-center gap-3 self-start rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 shadow-sm sm:self-auto">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Actualizado en tiempo real
            </div>
          </header>

          <div id="resumen" className="mt-8 grid gap-4 md:grid-cols-3">
            {metrics.map((metric) => (
              <article
                key={metric.label}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <p className="text-sm font-medium text-slate-500">{metric.label}</p>
                  <span
                    className={`flex h-10 min-w-10 items-center justify-center rounded-xl px-2 text-xs font-bold ${metric.iconClass}`}
                  >
                    {metric.icon}
                  </span>
                </div>
                <p className="mt-5 text-3xl font-bold tracking-tight text-slate-950">
                  {metric.value}
                </p>
                <p className="mt-2 text-xs font-medium text-emerald-600">{metric.detail}</p>
              </article>
            ))}
          </div>

          <section id="servicios" className="mt-8 rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div>
                <h2 className="text-lg font-bold text-slate-950">Servicios pendientes</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Solicitudes abiertas que necesitan coordinación.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={openClientModal}
                  className="inline-flex items-center gap-2 rounded-xl border border-cyan-600 bg-white px-4 py-2.5 text-sm font-semibold text-cyan-700 shadow-sm transition hover:bg-cyan-50 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2"
                >
                  <span className="text-lg leading-none">+</span>
                  Nuevo Cliente
                </button>
                <button
                  type="button"
                  onClick={openModal}
                  className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2"
                >
                  <span className="text-lg leading-none">+</span>
                  Registrar Nuevo Servicio
                </button>
                <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600">
                  {isLoading ? "Cargando..." : `${services.length} servicios`}
                </span>
              </div>
            </div>

            {statusError && (
              <div role="alert" className="mx-6 mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {statusError}
              </div>
            )}

            {error ? (
              <div className="m-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error} Verifica que la API de GoldenCare esté disponible en 127.0.0.1:8000.
              </div>
            ) : isLoading ? (
              <div className="space-y-3 p-6" aria-label="Cargando servicios" role="status">
                {[1, 2, 3].map((row) => (
                  <div key={row} className="h-12 animate-pulse rounded-lg bg-slate-100" />
                ))}
              </div>
            ) : services.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <p className="font-semibold text-slate-700">No hay servicios pendientes</p>
                <p className="mt-1 text-sm text-slate-500">Las nuevas solicitudes aparecerán aquí.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      <th scope="col" className="px-6 py-4 font-semibold">ID</th>
                      <th scope="col" className="px-6 py-4 font-semibold">Tipo de Servicio</th>
                      <th scope="col" className="px-6 py-4 font-semibold">Zona</th>
                      <th scope="col" className="px-6 py-4 font-semibold">Fecha</th>
                      <th scope="col" className="px-6 py-4 font-semibold">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {services.map((service) => (
                      <tr key={service.id_servicio} className="transition hover:bg-slate-50">
                        <td className="whitespace-nowrap px-6 py-4 font-mono text-xs text-slate-500">
                          {service.id_servicio.slice(0, 8)}…
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 font-semibold capitalize text-slate-800">
                          {service.tipo_servicio}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-slate-600">{service.zona}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-slate-600">
                          {formatDate(service.fecha_hora)}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4">
                          <select
                            value={service.estado}
                            onChange={(event) =>
                              void handleStatusChange(
                                service.id_servicio,
                                event.target.value as EstadoServicio,
                              )
                            }
                            disabled={updatingServiceId === service.id_servicio}
                            aria-label={`Actualizar estado del servicio ${service.id_servicio}`}
                            className={`cursor-pointer rounded-full border-0 px-3 py-1 text-xs font-semibold ring-1 ring-inset outline-none transition focus:ring-2 focus:ring-cyan-500 disabled:cursor-wait disabled:opacity-60 ${statusClass(service.estado)}`}
                          >
                            {serviceStatuses.map((status) => (
                              <option key={status} value={status}>
                                {status}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section id="indicadores" className="mt-6 flex flex-col gap-4 rounded-2xl bg-slate-950 px-6 py-5 text-white sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-cyan-300">GoldenCare Analytics</p>
              <p className="mt-1 text-sm text-slate-300">
                Los indicadores se actualizarán con datos operativos consolidados.
              </p>
            </div>
            <span className="text-sm font-medium text-slate-400">MVP académico</span>
          </section>
        </section>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Cerrar modal"
            onClick={closeModal}
            className="absolute inset-0 cursor-default bg-slate-950/60 backdrop-blur-sm"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-service-title"
            className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl sm:p-8"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-700">
                  Nueva solicitud
                </p>
                <h2 id="new-service-title" className="mt-1 text-2xl font-bold tracking-tight text-slate-950">
                  Registrar Nuevo Servicio
                </h2>
              </div>
              <button
                type="button"
                onClick={closeModal}
                disabled={isSubmitting}
                aria-label="Cerrar formulario"
                className="rounded-lg p-2 text-2xl leading-none text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-6 space-y-5">
              <div>
                <label htmlFor="usuarioId" className="mb-2 block text-sm font-semibold text-slate-700">
                  Usuario ID
                </label>
                <select
                  id="usuarioId"
                  name="usuarioId"
                  value={formData.usuarioId}
                  onChange={handleFormChange}
                  required
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
                >
                  <option value="" disabled>
                    Seleccionar persona usuaria
                  </option>
                  {users.map((user) => (
                    <option key={user.id_usuario} value={user.id_usuario}>
                      {user.contacto_familiar?.trim() || `Persona usuaria · ${user.zona}`} · {user.zona}
                    </option>
                  ))}
                </select>
                {users.length === 0 && (
                  <p className="mt-2 text-xs text-amber-700">
                    Primero registra un cliente para poder asociarlo al servicio.
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="tipoServicio" className="mb-2 block text-sm font-semibold text-slate-700">
                  Tipo de Servicio
                </label>
                <select
                  id="tipoServicio"
                  name="tipoServicio"
                  value={formData.tipoServicio}
                  onChange={handleFormChange}
                  required
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
                >
                  <option value="traslado">Traslado</option>
                  <option value="acompañamiento">Acompañamiento</option>
                  <option value="mandado">Mandado</option>
                </select>
              </div>

              <div>
                <label htmlFor="zona" className="mb-2 block text-sm font-semibold text-slate-700">
                  Zona
                </label>
                <select
                  id="zona"
                  name="zona"
                  value={formData.zona}
                  onChange={handleFormChange}
                  required
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
                >
                  <option value="Zona Centro">Zona Centro</option>
                  <option value="Barrio Norte">Barrio Norte</option>
                  <option value="Zona Sur">Zona Sur</option>
                </select>
              </div>

              <div>
                <label htmlFor="fechaHora" className="mb-2 block text-sm font-semibold text-slate-700">
                  Fecha y Hora
                </label>
                <input
                  id="fechaHora"
                  name="fechaHora"
                  type="datetime-local"
                  value={formData.fechaHora}
                  onChange={handleFormChange}
                  required
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
                />
              </div>

              {formError && (
                <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {formError}
                </div>
              )}

              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={isSubmitting}
                  className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-xl bg-cyan-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? "Registrando..." : "Guardar Servicio"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isClientModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Cerrar modal"
            onClick={closeClientModal}
            className="absolute inset-0 cursor-default bg-slate-950/60 backdrop-blur-sm"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-client-title"
            className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl sm:p-8"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-700">
                  Alta de cliente
                </p>
                <h2 id="new-client-title" className="mt-1 text-2xl font-bold tracking-tight text-slate-950">
                  Nuevo Cliente
                </h2>
              </div>
              <button
                type="button"
                onClick={closeClientModal}
                disabled={isClientSubmitting}
                aria-label="Cerrar formulario"
                className="rounded-lg p-2 text-2xl leading-none text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleClientSubmit} className="mt-6 space-y-5">
              <div>
                <label htmlFor="contacto" className="mb-2 block text-sm font-semibold text-slate-700">
                  Nombre / Contacto
                </label>
                <input
                  id="contacto"
                  name="contacto"
                  type="text"
                  value={clientFormData.contacto}
                  onChange={(event) =>
                    setClientFormData((current) => ({ ...current, contacto: event.target.value }))
                  }
                  placeholder="Ej. Ana Pérez - 388 412 3456"
                  required
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
                />
              </div>

              <div>
                <label htmlFor="clientZona" className="mb-2 block text-sm font-semibold text-slate-700">
                  Zona
                </label>
                <select
                  id="clientZona"
                  name="clientZona"
                  value={clientFormData.zona}
                  onChange={(event) =>
                    setClientFormData((current) => ({
                      ...current,
                      zona: event.target.value as NewClientForm["zona"],
                    }))
                  }
                  required
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
                >
                  <option value="Zona Centro">Zona Centro</option>
                  <option value="Barrio Norte">Barrio Norte</option>
                  <option value="Zona Sur">Zona Sur</option>
                </select>
              </div>

              <div>
                <label htmlFor="preferencias" className="mb-2 block text-sm font-semibold text-slate-700">
                  Preferencias
                </label>
                <textarea
                  id="preferencias"
                  name="preferencias"
                  value={clientFormData.preferencias}
                  onChange={(event) =>
                    setClientFormData((current) => ({
                      ...current,
                      preferencias: event.target.value,
                    }))
                  }
                  rows={3}
                  placeholder="Horarios, tipo de asistencia u otras preferencias"
                  className="w-full resize-none rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
                />
              </div>

              {clientFormError && (
                <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {clientFormError}
                </div>
              )}

              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeClientModal}
                  disabled={isClientSubmitting}
                  className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isClientSubmitting}
                  className="rounded-xl bg-cyan-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isClientSubmitting ? "Guardando..." : "Guardar Cliente"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
