"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  BARRIOS_SAN_PEDRO,
  combinarDireccionYPreferencias,
  formatearMonedaARS,
  getApiBaseUrl,
  obtenerTarifaServicio,
  type BarrioSanPedro,
} from "../constants/barrios";

type EstadoServicio =
  | "solicitado"
  | "asignado"
  | "en curso"
  | "completado"
  | "cancelado";

type SortCriterion = "urgencia" | "fecha" | "cliente" | "estado";
type AdminViewTab = "activos" | "completados" | "todas";

type Servicio = {
  id_servicio: string;
  id_usuario?: string;
  tipo_servicio: string;
  zona: string;
  fecha_hora: string;
  estado: EstadoServicio;
  nombre_contacto?: string | null;
  preferencias?: string | null;
  id_prestador_asignado?: string | null;
  prestador_asignado?: string | null;
  monto_total?: number;
  comision_plataforma?: number;
  pago_prestador?: number;
  valoracion?: number | null;
  comentario_encuesta?: string | null;
};

type Usuario = {
  id_usuario: string;
  zona: string;
  preferencias: string | null;
  estado: string;
  contacto_familiar: string | null;
};

type Prestador = {
  id_prestador: string;
  rol: string;
  email?: string | null;
  disponibilidad: boolean;
  estado: string;
};

type Metricas = {
  total_usuarios: number;
  servicios_pendientes: number;
  servicios_completados: number;
  tasa_cumplimiento: number;
  promedio_valoracion: number | null;
  total_encuestas: number;
  ingresos_brutos: number;
  comisiones_plataforma: number;
  ingresos_proyectados: number;
  comisiones_proyectadas: number;
};

type NewServiceForm = {
  usuarioId: string;
  tipoServicio: "traslado" | "acompañamiento" | "mandado";
  zona: BarrioSanPedro;
  direccion: string;
  fechaHora: string;
};

type NewClientForm = {
  contacto: string;
  zona: BarrioSanPedro;
  direccion: string;
  preferencias: string;
};

type NewProviderForm = {
  rol: string;
  email: string;
  password: string;
};

const initialForm: NewServiceForm = {
  usuarioId: "",
  tipoServicio: "traslado",
  zona: BARRIOS_SAN_PEDRO[0],
  direccion: "",
  fechaHora: "",
};

const initialClientForm: NewClientForm = {
  contacto: "",
  zona: BARRIOS_SAN_PEDRO[0],
  direccion: "",
  preferencias: "",
};

const initialProviderForm: NewProviderForm = {
  rol: "",
  email: "",
  password: "",
};

const initialMetrics: Metricas = {
  total_usuarios: 0,
  servicios_pendientes: 0,
  servicios_completados: 0,
  tasa_cumplimiento: 100,
  promedio_valoracion: null,
  total_encuestas: 0,
  ingresos_brutos: 0,
  comisiones_plataforma: 0,
  ingresos_proyectados: 0,
  comisiones_proyectadas: 0,
};

const serviceStatuses: EstadoServicio[] = [
  "solicitado",
  "asignado",
  "en curso",
  "completado",
  "cancelado",
];

const ESTADO_PRIORIDAD: Record<EstadoServicio, number> = {
  solicitado: 1,
  asignado: 2,
  "en curso": 3,
  completado: 4,
  cancelado: 5,
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getCurrentTimeLabel() {
  return new Intl.DateTimeFormat("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}

function statusClass(status: EstadoServicio) {
  switch (status) {
    case "solicitado":
      return "bg-amber-50 text-amber-800 ring-amber-600/25";
    case "asignado":
      return "bg-blue-50 text-blue-800 ring-blue-600/25";
    case "en curso":
      return "bg-indigo-50 text-indigo-800 ring-indigo-600/25";
    case "completado":
      return "bg-emerald-50 text-emerald-800 ring-emerald-600/25";
    case "cancelado":
      return "bg-rose-50 text-rose-800 ring-rose-600/25";
  }
}

function statusBorderClass(status: EstadoServicio) {
  switch (status) {
    case "solicitado":
      return "border-l-4 border-l-amber-500";
    case "asignado":
      return "border-l-4 border-l-blue-500";
    case "en curso":
      return "border-l-4 border-l-indigo-500";
    case "completado":
      return "border-l-4 border-l-emerald-500";
    case "cancelado":
      return "border-l-4 border-l-rose-500";
  }
}

function statusLabel(status: EstadoServicio) {
  switch (status) {
    case "solicitado":
      return "Solicitado";
    case "asignado":
      return "Asignado";
    case "en curso":
      return "En curso";
    case "completado":
      return "Completado";
    case "cancelado":
      return "Cancelado";
  }
}

function isServiceUrgent(service: Servicio, nowMs: number | null): boolean {
  if (nowMs === null) {
    return false;
  }
  if (service.estado !== "solicitado" && service.estado !== "asignado") {
    return false;
  }
  const serviceMs = new Date(service.fecha_hora).getTime();
  if (Number.isNaN(serviceMs)) {
    return false;
  }
  const diffHours = (serviceMs - nowMs) / (1000 * 60 * 60);
  return diffHours <= 24;
}

export default function AdminPage() {
  // Estado de autenticación del coordinador
  const [authChecked, setAuthChecked] = useState(false);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [adminEmail, setAdminEmail] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState<string>("");
  const [loginPassword, setLoginPassword] = useState<string>("");
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [services, setServices] = useState<Servicio[]>([]);
  const [users, setUsers] = useState<Usuario[]>([]);
  const [providers, setProviders] = useState<Prestador[]>([]);
  const [metricsData, setMetricsData] = useState<Metricas>(initialMetrics);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const consecutiveFailuresRef = useRef<number>(0);

  // Pestaña activa y filtros, búsqueda y ordenamiento de la tabla
  const [activeViewTab, setActiveViewTab] = useState<AdminViewTab>("activos");
  const [searchFilter, setSearchFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("todos");
  const [typeFilter, setTypeFilter] = useState<string>("todos");
  const [sortBy, setSortBy] = useState<SortCriterion>("urgencia");

  // Modal Nuevo Servicio
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState<NewServiceForm>(initialForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Modal Nuevo Cliente
  const [isClientModalOpen, setIsClientModalOpen] = useState(false);
  const [clientFormData, setClientFormData] = useState<NewClientForm>(initialClientForm);
  const [isClientSubmitting, setIsClientSubmitting] = useState(false);
  const [clientFormError, setClientFormError] = useState<string | null>(null);

  // Modal Nuevo Prestador
  const [isProviderModalOpen, setIsProviderModalOpen] = useState(false);
  const [providerFormData, setProviderFormData] =
    useState<NewProviderForm>(initialProviderForm);
  const [isProviderSubmitting, setIsProviderSubmitting] = useState(false);
  const [providerFormError, setProviderFormError] = useState<string | null>(null);

  // Estados de actualización por fila
  const [updatingServiceId, setUpdatingServiceId] = useState<string | null>(null);
  const [assigningServiceId, setAssigningServiceId] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const silentRefreshAll = useCallback(async (signal?: AbortSignal) => {
    const baseUrl = getApiBaseUrl();
    try {
      const [
        servicesResponse,
        metricsResponse,
        usersResponse,
        providersResponse,
      ] = await Promise.all([
        fetch(`${baseUrl}/servicios/`, { cache: "no-store", signal }),
        fetch(`${baseUrl}/metricas`, { cache: "no-store", signal }),
        fetch(`${baseUrl}/usuarios/`, { cache: "no-store", signal }),
        fetch(`${baseUrl}/prestadores/`, { cache: "no-store", signal }),
      ]);

      if (!servicesResponse.ok || !metricsResponse.ok) {
        throw new Error("Respuesta no válida durante la sincronización.");
      }

      const [serviceData, liveMetrics] = await Promise.all([
        servicesResponse.json() as Promise<Servicio[]>,
        metricsResponse.json() as Promise<Metricas>,
      ]);

      setServices(serviceData);
      setMetricsData(liveMetrics);

      if (usersResponse.ok) {
        const userData: Usuario[] = await usersResponse.json();
        setUsers(userData);
      }

      if (providersResponse.ok) {
        const providerData: Prestador[] = await providersResponse.json();
        setProviders(providerData);
      }

      consecutiveFailuresRef.current = 0;
      setError(null);
      setLastSyncTime(getCurrentTimeLabel());
      setNowMs(Date.now());
    } catch {
      if (signal?.aborted) {
        return;
      }
      consecutiveFailuresRef.current += 1;
      if (consecutiveFailuresRef.current >= 2) {
        setError("No se pudieron cargar los servicios pendientes.");
      }
    }
  }, []);

  const loadServices = useCallback(async (signal?: AbortSignal) => {
    const baseUrl = getApiBaseUrl();
    try {
      setError(null);

      const [servicesResponse, metricsResponse] = await Promise.all([
        fetch(`${baseUrl}/servicios/`, { cache: "no-store", signal }),
        fetch(`${baseUrl}/metricas`, { cache: "no-store", signal }),
      ]);

      if (!servicesResponse.ok) {
        throw new Error("No se pudieron cargar los servicios pendientes.");
      }

      const data: Servicio[] = await servicesResponse.json();
      setServices(data);

      if (metricsResponse.ok) {
        const metricsPayload: Metricas = await metricsResponse.json();
        setMetricsData(metricsPayload);
      }

      consecutiveFailuresRef.current = 0;
      setLastSyncTime(getCurrentTimeLabel());
      setNowMs(Date.now());
    } catch (requestError) {
      if (signal?.aborted) {
        return;
      }

      setError(
        requestError instanceof Error
          ? requestError.message
          : "Ocurrió un error al conectar con la API.",
      );
    }
  }, []);

  const loadUsers = useCallback(async () => {
    const response = await fetch(`${getApiBaseUrl()}/usuarios/`, {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error("No se pudieron cargar las personas usuarias.");
    }

    const data: Usuario[] = await response.json();
    setUsers(data);
  }, []);

  const loadProviders = useCallback(async () => {
    const response = await fetch(`${getApiBaseUrl()}/prestadores/`, {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error("No se pudieron cargar los prestadores.");
    }

    const data: Prestador[] = await response.json();
    setProviders(data);
  }, []);

  // Restaurar sesión del coordinador al montar
  useEffect(() => {
    try {
      const savedToken = window.sessionStorage.getItem("goldencare_admin_token");
      const savedEmail = window.sessionStorage.getItem("goldencare_admin_email");
      if (savedToken) {
        setAdminToken(savedToken);
        setAdminEmail(savedEmail || "admin@goldencare.com");
      }
    } catch {
      // Ignorar errores de sessionStorage
    } finally {
      setAuthChecked(true);
    }
  }, []);

  function handleAdminLogout(mensajeError?: string) {
    try {
      window.sessionStorage.removeItem("goldencare_admin_token");
      window.sessionStorage.removeItem("goldencare_admin_email");
    } catch {
      // Ignorar
    }
    setAdminToken(null);
    setAdminEmail(null);
    setLoginPassword("");
    if (mensajeError) {
      setLoginError(mensajeError);
    }
  }

  async function handleAdminLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError(null);

    if (!loginEmail.trim() || !loginPassword) {
      setLoginError("Ingresá tu correo electrónico y contraseña.");
      return;
    }

    setIsLoggingIn(true);
    try {
      const response = await fetch(`${getApiBaseUrl()}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: loginEmail.trim(),
          password: loginPassword,
        }),
      });

      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const detail =
          body && typeof body.detail === "string"
            ? body.detail
            : "Credenciales inválidas.";
        throw new Error(detail);
      }

      const token = String(body.access_token || "");
      const email = String(body.email || loginEmail.trim());
      try {
        window.sessionStorage.setItem("goldencare_admin_token", token);
        window.sessionStorage.setItem("goldencare_admin_email", email);
      } catch {
        // Ignorar
      }
      setAdminToken(token);
      setAdminEmail(email);
      setLoginPassword("");
      setIsLoading(true);
    } catch (err) {
      setLoginError(
        err instanceof Error
          ? err.message
          : "No se pudo iniciar sesión en el panel.",
      );
    } finally {
      setIsLoggingIn(false);
    }
  }

  // Carga inicial (solo cuando el coordinador está autenticado)
  useEffect(() => {
    if (!adminToken) {
      return;
    }
    const controller = new AbortController();
    const baseUrl = getApiBaseUrl();

    Promise.all([
      fetch(`${baseUrl}/servicios/`, {
        cache: "no-store",
        signal: controller.signal,
      }).then((response) => {
        if (!response.ok) {
          throw new Error("No se pudieron cargar los servicios.");
        }
        return response.json() as Promise<Servicio[]>;
      }),
      fetch(`${baseUrl}/usuarios/`, {
        cache: "no-store",
        signal: controller.signal,
      }).then((response) => {
        if (!response.ok) {
          throw new Error("No se pudieron cargar las personas usuarias.");
        }
        return response.json() as Promise<Usuario[]>;
      }),
      fetch(`${baseUrl}/prestadores/`, {
        cache: "no-store",
        signal: controller.signal,
      }).then((response) => {
        if (!response.ok) {
          throw new Error("No se pudieron cargar los prestadores.");
        }
        return response.json() as Promise<Prestador[]>;
      }),
      fetch(`${baseUrl}/metricas`, {
        cache: "no-store",
        signal: controller.signal,
      }).then((response) => {
        if (!response.ok) {
          throw new Error("No se pudieron cargar las métricas operativas.");
        }
        return response.json() as Promise<Metricas>;
      }),
    ])
      .then(([serviceData, userData, providerData, liveMetrics]) => {
        setServices(serviceData);
        setUsers(userData);
        setProviders(providerData);
        setMetricsData(liveMetrics);
        consecutiveFailuresRef.current = 0;
        setLastSyncTime(getCurrentTimeLabel());
        setNowMs(Date.now());
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        consecutiveFailuresRef.current = 1;
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
  }, [adminToken]);

  // Auto-refresco silencioso cada 4 segundos y al recuperar visibilidad de la pestaña
  useEffect(() => {
    if (
      !adminToken ||
      isModalOpen ||
      isClientModalOpen ||
      isProviderModalOpen ||
      updatingServiceId !== null ||
      assigningServiceId !== null
    ) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void silentRefreshAll();
      }
    }, 4000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void silentRefreshAll();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    adminToken,
    isModalOpen,
    isClientModalOpen,
    isProviderModalOpen,
    updatingServiceId,
    assigningServiceId,
    silentRefreshAll,
  ]);

  const tabCounts = useMemo(() => {
    let activos = 0;
    let completados = 0;
    for (const s of services) {
      if (
        s.estado === "solicitado" ||
        s.estado === "asignado" ||
        s.estado === "en curso"
      ) {
        activos += 1;
      } else if (s.estado === "completado") {
        completados += 1;
      }
    }
    return {
      activos,
      completados,
      todas: services.length,
    };
  }, [services]);

  // Filtrado y ordenamiento reactivo (conserva selección durante los auto-refrescos)
  const filteredAndSortedServices = useMemo(() => {
    const query = searchFilter.trim().toLowerCase();

    const filtered = services.filter((service) => {
      if (activeViewTab === "activos") {
        if (
          service.estado !== "solicitado" &&
          service.estado !== "asignado" &&
          service.estado !== "en curso"
        ) {
          return false;
        }
      } else if (activeViewTab === "completados") {
        if (service.estado !== "completado") {
          return false;
        }
      }

      if (
        activeViewTab !== "completados" &&
        statusFilter !== "todos" &&
        service.estado !== statusFilter
      ) {
        return false;
      }
      if (typeFilter !== "todos" && service.tipo_servicio !== typeFilter) {
        return false;
      }
      if (!query) {
        return true;
      }

      const idShort = service.id_servicio.slice(0, 8).toLowerCase();
      const contact = (service.nombre_contacto ?? "").toLowerCase();
      const zone = service.zona.toLowerCase();
      const prefs = (service.preferencias ?? "").toLowerCase();
      const provider = (service.prestador_asignado ?? "").toLowerCase();

      return (
        idShort.includes(query) ||
        contact.includes(query) ||
        zone.includes(query) ||
        prefs.includes(query) ||
        provider.includes(query)
      );
    });

    return [...filtered].sort((a, b) => {
      const timeA = new Date(a.fecha_hora).getTime();
      const timeB = new Date(b.fecha_hora).getTime();

      if (activeViewTab === "completados" && sortBy === "urgencia") {
        return timeB - timeA;
      }

      switch (sortBy) {
        case "urgencia": {
          const aIsSolicitado = a.estado === "solicitado" ? 0 : 1;
          const bIsSolicitado = b.estado === "solicitado" ? 0 : 1;
          if (aIsSolicitado !== bIsSolicitado) {
            return aIsSolicitado - bIsSolicitado;
          }
          return timeA - timeB;
        }
        case "fecha":
          return activeViewTab === "completados" ? timeB - timeA : timeA - timeB;
        case "cliente": {
          const nameA = (a.nombre_contacto ?? "zzz").toLowerCase();
          const nameB = (b.nombre_contacto ?? "zzz").toLowerCase();
          return nameA.localeCompare(nameB, "es-AR");
        }
        case "estado": {
          const prioA = ESTADO_PRIORIDAD[a.estado] ?? 99;
          const prioB = ESTADO_PRIORIDAD[b.estado] ?? 99;
          if (prioA !== prioB) {
            return prioA - prioB;
          }
          return timeA - timeB;
        }
      }
    });
  }, [services, activeViewTab, searchFilter, statusFilter, typeFilter, sortBy]);

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
      const zonaConReferencia = formData.direccion.trim()
        ? `${formData.zona} · ${formData.direccion.trim()}`
        : formData.zona;

      const response = await fetch(`${getApiBaseUrl()}/servicios/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id_usuario: formData.usuarioId,
          tipo_servicio: formData.tipoServicio,
          zona: zonaConReferencia.slice(0, 120),
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
      const preferenciasCombinadas = combinarDireccionYPreferencias(
        clientFormData.direccion,
        clientFormData.preferencias,
      );

      const response = await fetch(`${getApiBaseUrl()}/usuarios/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          zona: clientFormData.zona,
          preferencias: preferenciasCombinadas,
          contacto_familiar: {
            relacion: "responsable",
            canal: clientFormData.contacto.trim(),
          },
        }),
      });

      const responseBody = await response.json().catch(() => null);
      if (!response.ok) {
        const detail =
          responseBody && typeof responseBody.detail === "string"
            ? responseBody.detail
            : "No se pudo registrar el cliente.";
        throw new Error(detail);
      }

      await Promise.all([loadUsers(), silentRefreshAll()]);
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

  function openProviderModal() {
    setProviderFormError(null);
    setIsProviderModalOpen(true);
  }

  function closeProviderModal() {
    if (!isProviderSubmitting) {
      setProviderFormError(null);
      setIsProviderModalOpen(false);
    }
  }

  async function handleProviderSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsProviderSubmitting(true);
    setProviderFormError(null);

    try {
      const response = await fetch(`${getApiBaseUrl()}/prestadores/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
        },
        body: JSON.stringify({
          rol: providerFormData.rol.trim(),
          email: providerFormData.email.trim().toLowerCase(),
          password: providerFormData.password,
          disponibilidad: true,
          estado: "activo",
        }),
      });

      const responseBody = await response.json().catch(() => null);
      if (response.status === 401) {
        handleAdminLogout("Tu sesión expiró. Volvé a iniciar sesión.");
        return;
      }
      if (!response.ok) {
        const detail =
          responseBody && typeof responseBody.detail === "string"
            ? responseBody.detail
            : "No se pudo registrar el prestador.";
        throw new Error(detail);
      }

      await Promise.all([loadProviders(), silentRefreshAll()]);
      setProviderFormData(initialProviderForm);
      setIsProviderModalOpen(false);
    } catch (requestError) {
      setProviderFormError(
        requestError instanceof Error
          ? requestError.message
          : "Ocurrió un error de red al registrar el prestador.",
      );
    } finally {
      setIsProviderSubmitting(false);
    }
  }

  async function handleAssignProvider(idServicio: string, idPrestador: string) {
    if (!idPrestador) {
      return;
    }

    setAssigningServiceId(idServicio);
    setStatusError(null);

    try {
      const response = await fetch(
        `${getApiBaseUrl()}/servicios/${encodeURIComponent(idServicio)}/asignar`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id_prestador: idPrestador }),
        },
      );

      const responseBody = await response.json().catch(() => null);
      if (!response.ok) {
        const detail =
          responseBody && typeof responseBody.detail === "string"
            ? responseBody.detail
            : "No se pudo asignar el prestador al servicio.";
        throw new Error(detail);
      }

      await loadServices();
    } catch (requestError) {
      setStatusError(
        requestError instanceof Error
          ? requestError.message
          : "Ocurrió un error de red al asignar el prestador.",
      );
    } finally {
      setAssigningServiceId(null);
    }
  }

  async function handleStatusChange(idServicio: string, estado: EstadoServicio) {
    setUpdatingServiceId(idServicio);
    setStatusError(null);

    try {
      const response = await fetch(
        `${getApiBaseUrl()}/servicios/${encodeURIComponent(idServicio)}/estado`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
          },
          body: JSON.stringify({ estado }),
        },
      );

      const responseBody = await response.json().catch(() => null);
      if (response.status === 401) {
        handleAdminLogout("Tu sesión expiró. Volvé a iniciar sesión.");
        return;
      }
      if (!response.ok) {
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

  const formattedRating =
    metricsData.promedio_valoracion !== null
      ? `${metricsData.promedio_valoracion.toLocaleString("es-AR", {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        })} ★`
      : "—";

  const cards = [
    {
      label: "Total Usuarios",
      value: isLoading ? "—" : String(metricsData.total_usuarios),
      detail: "Personas usuarias registradas",
      icon: "US",
      iconClass: "bg-blue-100 text-blue-700",
    },
    {
      label: "Servicios Pendientes",
      value: isLoading ? "—" : String(metricsData.servicios_pendientes),
      detail: "En estado solicitado, asignado o en curso",
      icon: "⏱",
      iconClass: "bg-violet-100 text-violet-700",
    },
    {
      label: "Tasa de Cumplimiento",
      value: isLoading
        ? "—"
        : `${metricsData.tasa_cumplimiento.toLocaleString("es-AR", {
            maximumFractionDigits: 1,
          })}%`,
      detail: `${metricsData.servicios_completados} ${
        metricsData.servicios_completados === 1
          ? "servicio completado"
          : "servicios completados"
      }`,
      icon: "%",
      iconClass: "bg-emerald-100 text-emerald-700",
    },
    {
      label: "Satisfacción Promedio",
      value: isLoading ? "—" : formattedRating,
      detail:
        metricsData.total_encuestas > 0
          ? `${metricsData.total_encuestas} ${
              metricsData.total_encuestas === 1
                ? "encuesta respondida"
                : "encuestas respondidas"
            }`
          : "Sin encuestas aún",
      icon: "★",
      iconClass: "bg-amber-100 text-amber-700",
    },
    {
      label: "Comisiones GoldenCare (15%)",
      value: isLoading
        ? "—"
        : formatearMonedaARS(metricsData.comisiones_plataforma),
      detail:
        metricsData.comisiones_proyectadas > 0
          ? `Bruto: ${formatearMonedaARS(metricsData.ingresos_brutos)} · +${formatearMonedaARS(metricsData.comisiones_proyectadas)} en curso`
          : `Ingresos brutos: ${formatearMonedaARS(metricsData.ingresos_brutos)}`,
      icon: "$",
      iconClass: "bg-cyan-100 text-cyan-800",
    },
  ];

  const hasActiveFilters =
    searchFilter.trim() !== "" ||
    statusFilter !== "todos" ||
    typeFilter !== "todos";

  if (!authChecked) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-300">
        <p className="text-sm font-medium">Verificando sesión de coordinador...</p>
      </main>
    );
  }

  if (!adminToken) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 py-10 text-slate-100">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900 p-7 shadow-2xl sm:p-8">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-400 text-2xl font-extrabold text-slate-950">
              G
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-300">
                GoldenCare · San Pedro de Jujuy
              </p>
              <h1 className="text-xl font-bold text-white">
                Acceso Coordinadores
              </h1>
            </div>
          </div>

          <p className="mt-4 text-sm text-slate-400">
            Ingresá con tu correo electrónico y contraseña para administrar
            solicitudes, prestadores y métricas financieras.
          </p>

          <form onSubmit={handleAdminLogin} noValidate className="mt-6 space-y-4">
            <div>
              <label
                htmlFor="admin-login-email"
                className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-300"
              >
                Correo Electrónico
              </label>
              <input
                id="admin-login-email"
                type="email"
                autoComplete="email"
                value={loginEmail}
                onChange={(event) => setLoginEmail(event.target.value)}
                placeholder="admin@goldencare.com"
                required
                className="w-full rounded-xl border border-white/15 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/25"
              />
            </div>

            <div>
              <label
                htmlFor="admin-login-password"
                className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-300"
              >
                Contraseña
              </label>
              <input
                id="admin-login-password"
                type="password"
                autoComplete="current-password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                placeholder="••••••••"
                required
                className="w-full rounded-xl border border-white/15 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/25"
              />
            </div>

            {loginError && (
              <div
                role="alert"
                className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs font-semibold text-rose-200"
              >
                {loginError}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoggingIn}
              className="mt-2 flex min-h-[48px] w-full items-center justify-center rounded-xl bg-cyan-400 px-5 py-3 text-sm font-extrabold text-slate-950 shadow-sm transition hover:bg-cyan-300 focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoggingIn ? "Verificando..." : "Ingresar al Panel"}
            </button>
          </form>

          <div className="mt-6 flex items-center justify-between border-t border-white/10 pt-4 text-xs text-slate-400">
            <Link href="/" className="transition hover:text-cyan-300">
              ← Portal Público
            </Link>
            <Link href="/prestador" className="transition hover:text-cyan-300">
              Portal Prestadores →
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen w-full overflow-x-hidden bg-slate-100 text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-[1600px]">
        <aside className="hidden w-72 shrink-0 flex-col bg-slate-950 px-6 py-8 text-slate-300 lg:flex">
          <div className="flex items-center gap-3 px-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-400 font-bold text-slate-950">
              G
            </div>
            <div>
              <p className="text-lg font-bold tracking-tight text-white">GoldenCare</p>
              <p className="text-xs text-slate-400">San Pedro de Jujuy</p>
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

          <div className="mt-auto space-y-3">
            <Link
              href="/prestador"
              className="flex items-center justify-between rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-3 text-xs font-semibold text-cyan-200 transition hover:border-cyan-400/60 hover:bg-cyan-500/20 hover:text-white"
            >
              <span>🚗 Portal del Prestador</span>
              <span className="text-cyan-300">/prestador</span>
            </Link>

            <Link
              href="/"
              className="flex items-center justify-between rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-xs font-semibold text-slate-300 transition hover:border-cyan-400/50 hover:bg-white/10 hover:text-white"
            >
              <span>← Ir al Portal Público</span>
              <span className="text-cyan-300">/</span>
            </Link>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
                Sesión activa
              </p>
              <p className="mt-2 truncate text-xs font-medium text-slate-200">
                {adminEmail || "admin@goldencare.com"}
              </p>
              <button
                type="button"
                onClick={() => handleAdminLogout()}
                className="mt-3 w-full rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-200 transition hover:bg-rose-500/20"
              >
                Cerrar sesión
              </button>
            </div>
          </div>
        </aside>

        <section className="min-w-0 flex-1 px-5 py-6 sm:px-8 lg:px-12 lg:py-10">
          <header className="flex flex-col gap-5 border-b border-slate-200 pb-8 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-700">
                Panel del coordinador · San Pedro de Jujuy
              </p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
                Resumen operativo
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-500 sm:text-base">
                Gestión en tiempo real de traslados, acompañamientos y mandados por barrio y urgencia.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 self-start sm:self-auto">
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-cyan-500 hover:text-cyan-700 lg:hidden"
              >
                ← Portal Público
              </Link>
              <div className="flex items-center gap-2.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 shadow-sm">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                <span>Actualizado en tiempo real</span>
                {lastSyncTime && (
                  <span className="border-l border-slate-200 pl-2 font-mono text-xs text-slate-400">
                    {lastSyncTime}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleAdminLogout()}
                className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-bold text-rose-700 transition hover:bg-rose-100 lg:hidden"
              >
                Cerrar sesión
              </button>
            </div>
          </header>

          <div id="resumen" className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {cards.map((metric) => (
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
                <h2 className="text-lg font-bold text-slate-950">
                  {activeViewTab === "activos"
                    ? "Servicios Activos"
                    : activeViewTab === "completados"
                      ? "Historial de Servicios Completados"
                      : "Todos los Servicios"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {activeViewTab === "completados"
                    ? "Registro completo de servicios finalizados, comisiones retenidas (15%) y encuestas de satisfacción."
                    : "Solicitudes operativas, tarifas y asignación de prestadores en tiempo real."}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={openProviderModal}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2"
                >
                  <span className="text-lg leading-none">+</span>
                  Nuevo Prestador
                </button>
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
                  {isLoading
                    ? "Cargando..."
                    : `${filteredAndSortedServices.length} resultado${filteredAndSortedServices.length === 1 ? "" : "s"}`}
                </span>
              </div>
            </div>

            {/* Selector de pestañas: Servicios Activos / Historial Completados / Todas */}
            <div
              role="tablist"
              aria-label="Vista de servicios"
              className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-5 py-3 sm:px-6"
            >
              {(
                [
                  {
                    id: "activos" as const,
                    label: "Servicios Activos",
                    count: tabCounts.activos,
                  },
                  {
                    id: "completados" as const,
                    label: "Historial Completados",
                    count: tabCounts.completados,
                  },
                  {
                    id: "todas" as const,
                    label: "Todas",
                    count: tabCounts.todas,
                  },
                ]
              ).map((tab) => {
                const selected = activeViewTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => {
                      setActiveViewTab(tab.id);
                      if (tab.id === "completados") {
                        setStatusFilter("todos");
                      }
                    }}
                    className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-cyan-500 ${
                      selected
                        ? "bg-slate-950 text-white shadow-sm"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                        selected
                          ? "bg-cyan-400 text-slate-950"
                          : "bg-white text-slate-600"
                      }`}
                    >
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Barra de búsqueda, filtros y ordenamiento */}
            <div className="border-b border-slate-200 bg-slate-50/70 px-5 py-4 sm:px-6">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
                <div className="md:col-span-5">
                  <label htmlFor="admin-search" className="sr-only">
                    Buscar por cliente, barrio, dirección o código ID
                  </label>
                  <input
                    id="admin-search"
                    type="text"
                    value={searchFilter}
                    onChange={(event) => setSearchFilter(event.target.value)}
                    placeholder="🔍 Buscar por cliente, barrio, dirección o ID..."
                    className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
                  />
                </div>

                <div className="md:col-span-2">
                  <label htmlFor="filter-estado" className="sr-only">
                    Filtrar por estado
                  </label>
                  <select
                    id="filter-estado"
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
                  >
                    <option value="todos">Estado: Todos</option>
                    <option value="solicitado">Solicitado</option>
                    <option value="asignado">Asignado</option>
                    <option value="en curso">En curso</option>
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label htmlFor="filter-tipo" className="sr-only">
                    Filtrar por tipo de servicio
                  </label>
                  <select
                    id="filter-tipo"
                    value={typeFilter}
                    onChange={(event) => setTypeFilter(event.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
                  >
                    <option value="todos">Tipo: Todos</option>
                    <option value="traslado">Traslado</option>
                    <option value="acompañamiento">Acompañamiento</option>
                    <option value="mandado">Mandado</option>
                  </select>
                </div>

                <div className="md:col-span-3">
                  <label htmlFor="sort-by" className="sr-only">
                    Ordenar servicios por
                  </label>
                  <select
                    id="sort-by"
                    value={sortBy}
                    onChange={(event) =>
                      setSortBy(event.target.value as SortCriterion)
                    }
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
                  >
                    <option value="urgencia">Ordenar: Urgencia (Prioridad)</option>
                    <option value="fecha">Ordenar: Fecha más próxima</option>
                    <option value="cliente">Ordenar: Cliente (A-Z)</option>
                    <option value="estado">Ordenar: Estado operativo</option>
                  </select>
                </div>
              </div>

              {hasActiveFilters && (
                <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                  <span>
                    Mostrando {filteredAndSortedServices.length} resultado
                    {filteredAndSortedServices.length === 1 ? "" : "s"} filtrado
                    {filteredAndSortedServices.length === 1 ? "" : "s"}.
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchFilter("");
                      setStatusFilter("todos");
                      setTypeFilter("todos");
                    }}
                    className="font-semibold text-cyan-700 hover:underline"
                  >
                    Limpiar filtros
                  </button>
                </div>
              )}
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
            ) : filteredAndSortedServices.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <p className="font-semibold text-slate-700">
                  {services.length === 0
                    ? "No hay servicios pendientes"
                    : "No hay servicios que coincidan con los filtros"}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {services.length === 0
                    ? "Las nuevas solicitudes aparecerán aquí."
                    : "Probá cambiando el término de búsqueda o limpiando los filtros."}
                </p>
              </div>
            ) : (
              <div className="space-y-4 bg-slate-50/50 p-4 sm:p-6">
                {filteredAndSortedServices.map((service) => {
                  const urgent = isServiceUrgent(service, nowMs);
                  const fallbackTarifa = obtenerTarifaServicio(service.tipo_servicio);
                  const montoTotal =
                    typeof service.monto_total === "number" && service.monto_total > 0
                      ? service.monto_total
                      : fallbackTarifa.montoTotal;
                  const comision =
                    typeof service.comision_plataforma === "number" &&
                    service.comision_plataforma >= 0
                      ? service.comision_plataforma
                      : fallbackTarifa.comision;
                  const pagoPrestador =
                    typeof service.pago_prestador === "number" &&
                    service.pago_prestador > 0
                      ? service.pago_prestador
                      : Math.max(0, montoTotal - comision);
                  const isBusyStatus = updatingServiceId === service.id_servicio;
                  const isBusyAssign = assigningServiceId === service.id_servicio;
                  const mostrarPieEncuesta =
                    activeViewTab === "completados" ||
                    service.estado === "completado" ||
                    service.valoracion != null ||
                    Boolean(service.comentario_encuesta?.trim());

                  return (
                    <article
                      key={service.id_servicio}
                      className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-sky-300 ${statusBorderClass(service.estado)}`}
                    >
                      {/* Cabecera de tarjeta */}
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center rounded-lg bg-slate-100 px-2.5 py-1 font-mono text-xs font-bold text-slate-700">
                            #{service.id_servicio.slice(0, 8)}
                          </span>
                          <span
                            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ring-1 ring-inset ${statusClass(service.estado)}`}
                          >
                            {statusLabel(service.estado)}
                          </span>
                          {urgent && (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-rose-800 ring-1 ring-inset ring-rose-600/25">
                              <span className="h-1.5 w-1.5 rounded-full bg-rose-600" />
                              Urgente
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 sm:text-sm">
                          <span aria-hidden="true">🕒</span>
                          <span>{formatDate(service.fecha_hora)}</span>
                        </div>
                      </div>

                      {/* Cuerpo en 3 columnas responsivas */}
                      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                        {/* Columna 1: Cliente y Ubicación */}
                        <div className="space-y-1.5">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                            Cliente y Ubicación
                          </p>
                          <p className="text-sm font-bold text-slate-950">
                            {service.nombre_contacto?.trim() ||
                              "Sin contacto registrado"}
                          </p>
                          <p className="text-sm font-bold text-slate-800">
                            📍 {service.zona}
                          </p>
                          {service.preferencias?.trim() ? (
                            <p className="break-words text-xs leading-relaxed text-slate-600">
                              {service.preferencias}
                            </p>
                          ) : (
                            <p className="text-xs text-slate-400">
                              Sin dirección ni notas adicionales.
                            </p>
                          )}
                        </div>

                        {/* Columna 2: Servicio y Tarifas */}
                        <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50/80 p-3.5">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                            Servicio y Tarifas
                          </p>
                          <p className="text-base font-bold capitalize text-slate-900">
                            {service.tipo_servicio}
                          </p>
                          <div className="space-y-1 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-500">Monto total:</span>
                              <span className="text-sm font-extrabold text-slate-950">
                                {formatearMonedaARS(montoTotal)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-500">
                                Comisión GoldenCare (15%):
                              </span>
                              <span className="font-bold text-cyan-800">
                                com. {formatearMonedaARS(comision)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2 border-t border-slate-200/80 pt-1">
                              <span className="text-slate-500">
                                Neto prestador (85%):
                              </span>
                              <span className="font-bold text-emerald-700">
                                {formatearMonedaARS(pagoPrestador)}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Columna 3: Prestador y Controles */}
                        <div className="flex flex-col justify-between space-y-3">
                          <div className="space-y-1.5">
                            <label
                              htmlFor={`prestador-${service.id_servicio}`}
                              className="block text-[11px] font-bold uppercase tracking-wider text-slate-400"
                            >
                              Prestador Asignado
                            </label>
                            <select
                              id={`prestador-${service.id_servicio}`}
                              value={service.id_prestador_asignado || ""}
                              onChange={(event) =>
                                void handleAssignProvider(
                                  service.id_servicio,
                                  event.target.value,
                                )
                              }
                              disabled={isBusyAssign || providers.length === 0}
                              aria-label={`Asignar prestador al servicio ${service.id_servicio}`}
                              className={`w-full cursor-pointer rounded-xl border px-3 py-2 text-xs font-semibold outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-60 ${
                                service.id_prestador_asignado
                                  ? "border-cyan-200 bg-cyan-50/70 text-cyan-950"
                                  : "border-slate-300 bg-white text-slate-700"
                              }`}
                            >
                              <option value="">
                                {providers.length === 0
                                  ? "Sin prestadores (+ Nuevo Prestador)"
                                  : "Sin asignar (Seleccionar...)"}
                              </option>
                              {providers.map((provider) => (
                                <option
                                  key={provider.id_prestador}
                                  value={provider.id_prestador}
                                >
                                  {provider.rol}
                                  {provider.email ? ` (${provider.email})` : ""}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="space-y-2">
                            <label
                              htmlFor={`estado-${service.id_servicio}`}
                              className="block text-[11px] font-bold uppercase tracking-wider text-slate-400"
                            >
                              Estado Operativo
                            </label>

                            <div className="flex flex-wrap items-center gap-1.5">
                              {service.estado === "solicitado" && (
                                <button
                                  type="button"
                                  disabled={isBusyStatus}
                                  onClick={() =>
                                    void handleStatusChange(
                                      service.id_servicio,
                                      "asignado",
                                    )
                                  }
                                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-blue-700 disabled:opacity-60"
                                >
                                  Asignar
                                </button>
                              )}
                              {service.estado === "asignado" && (
                                <button
                                  type="button"
                                  disabled={isBusyStatus}
                                  onClick={() =>
                                    void handleStatusChange(
                                      service.id_servicio,
                                      "en curso",
                                    )
                                  }
                                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-indigo-700 disabled:opacity-60"
                                >
                                  Iniciar
                                </button>
                              )}
                              {service.estado === "en curso" && (
                                <button
                                  type="button"
                                  disabled={isBusyStatus}
                                  onClick={() =>
                                    void handleStatusChange(
                                      service.id_servicio,
                                      "completado",
                                    )
                                  }
                                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                                >
                                  Completar
                                </button>
                              )}
                              {service.estado !== "completado" &&
                                service.estado !== "cancelado" && (
                                  <button
                                    type="button"
                                    disabled={isBusyStatus}
                                    onClick={() =>
                                      void handleStatusChange(
                                        service.id_servicio,
                                        "cancelado",
                                      )
                                    }
                                    className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                                  >
                                    Cancelar
                                  </button>
                                )}

                              <select
                                id={`estado-${service.id_servicio}`}
                                value={service.estado}
                                onChange={(event) =>
                                  void handleStatusChange(
                                    service.id_servicio,
                                    event.target.value as EstadoServicio,
                                  )
                                }
                                disabled={isBusyStatus}
                                aria-label={`Cambiar estado del servicio ${service.id_servicio}`}
                                className={`min-w-[125px] flex-1 cursor-pointer rounded-lg border-0 px-3 py-1.5 text-xs font-bold ring-1 ring-inset outline-none transition focus:ring-2 focus:ring-cyan-500 disabled:cursor-wait disabled:opacity-60 ${statusClass(service.estado)}`}
                              >
                                {serviceStatuses.map((status) => (
                                  <option key={status} value={status}>
                                    {statusLabel(status)}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Pie de tarjeta: Encuesta y valoración */}
                      {mostrarPieEncuesta && (
                        <div className="mt-4 flex flex-col justify-between gap-2 rounded-xl border border-slate-200/80 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center">
                          {service.valoracion != null ? (
                            <>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                                  Calificación del cliente:
                                </span>
                                <div className="flex items-center gap-0.5 text-base text-amber-500">
                                  {[1, 2, 3, 4, 5].map((star) => (
                                    <span key={star} aria-hidden="true">
                                      {star <= (service.valoracion ?? 0)
                                        ? "★"
                                        : "☆"}
                                    </span>
                                  ))}
                                  <span className="ml-1.5 text-xs font-bold text-slate-800">
                                    ({service.valoracion}/5)
                                  </span>
                                </div>
                              </div>
                              {service.comentario_encuesta?.trim() && (
                                <p className="text-xs italic text-slate-700 sm:text-right">
                                  “{service.comentario_encuesta}”
                                </p>
                              )}
                            </>
                          ) : (
                            <p className="text-xs font-medium text-slate-500">
                              ★ Encuesta de satisfacción pendiente — el cliente aún
                              no calificó este servicio.
                            </p>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {/* Directorio de Prestadores con sus correos de acceso */}
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-950">
                  Equipo de Prestadores Activos ({providers.length})
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Correos electrónicos habilitados para ingresar al Portal del Prestador (/prestador).
                </p>
              </div>
              <button
                type="button"
                onClick={openProviderModal}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                + Nuevo Prestador
              </button>
            </div>
            {providers.length === 0 ? (
              <p className="mt-4 text-xs text-slate-500">
                Todavía no hay prestadores activos registrados.
              </p>
            ) : (
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {providers.map((provider) => (
                  <div
                    key={provider.id_prestador}
                    className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3"
                  >
                    <p className="text-sm font-bold text-slate-900">
                      {provider.rol}
                    </p>
                    <p className="mt-1 break-all font-mono text-xs text-cyan-800">
                      {provider.email || "Sin correo asignado"}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section id="indicadores" className="mt-6 flex flex-col gap-4 rounded-2xl bg-slate-950 px-6 py-5 text-white sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-cyan-300">GoldenCare Analytics · San Pedro de Jujuy</p>
              <p className="mt-1 text-sm text-slate-300">
                Satisfacción promedio actual:{" "}
                <strong className="text-amber-300">{formattedRating}</strong> (
                {metricsData.total_encuestas}{" "}
                {metricsData.total_encuestas === 1 ? "encuesta" : "encuestas"}) ·{" "}
                {providers.length}{" "}
                {providers.length === 1 ? "prestador activo" : "prestadores activos"}.
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
                  Cliente / Persona Usuaria
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
                  Barrio / Sector (San Pedro de Jujuy)
                </label>
                <select
                  id="zona"
                  name="zona"
                  value={formData.zona}
                  onChange={handleFormChange}
                  required
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
                >
                  {BARRIOS_SAN_PEDRO.map((barrio) => (
                    <option key={barrio} value={barrio}>
                      {barrio}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="direccion" className="mb-2 block text-sm font-semibold text-slate-700">
                  Dirección o referencia exacta
                </label>
                <input
                  id="direccion"
                  name="direccion"
                  type="text"
                  value={formData.direccion}
                  onChange={handleFormChange}
                  placeholder="Ej. Av. Siria 250 o Cerca del Hospital Paterson"
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
                />
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
                  placeholder="Ej. Ana Pérez - 3888 412345"
                  required
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
                />
              </div>

              <div>
                <label htmlFor="clientZona" className="mb-2 block text-sm font-semibold text-slate-700">
                  Barrio / Sector (San Pedro de Jujuy)
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
                  {BARRIOS_SAN_PEDRO.map((barrio) => (
                    <option key={barrio} value={barrio}>
                      {barrio}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="clientDireccion" className="mb-2 block text-sm font-semibold text-slate-700">
                  Dirección o referencia exacta
                </label>
                <input
                  id="clientDireccion"
                  name="clientDireccion"
                  type="text"
                  value={clientFormData.direccion}
                  onChange={(event) =>
                    setClientFormData((current) => ({
                      ...current,
                      direccion: event.target.value,
                    }))
                  }
                  placeholder="Ej. Av. Siria 250 o Cerca del Hospital Paterson"
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
                />
              </div>

              <div>
                <label htmlFor="preferencias" className="mb-2 block text-sm font-semibold text-slate-700">
                  Preferencias / Notas adicionales
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
                  rows={2}
                  placeholder="Horarios, movilidad u otras preferencias"
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

      {isProviderModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Cerrar modal"
            onClick={closeProviderModal}
            className="absolute inset-0 cursor-default bg-slate-950/60 backdrop-blur-sm"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-provider-title"
            className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl sm:p-8"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-700">
                  Equipo de asistencia
                </p>
                <h2 id="new-provider-title" className="mt-1 text-2xl font-bold tracking-tight text-slate-950">
                  Nuevo Prestador
                </h2>
              </div>
              <button
                type="button"
                onClick={closeProviderModal}
                disabled={isProviderSubmitting}
                aria-label="Cerrar formulario"
                className="rounded-lg p-2 text-2xl leading-none text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleProviderSubmit} className="mt-6 space-y-5">
              <div>
                <label htmlFor="providerRol" className="mb-2 block text-sm font-semibold text-slate-700">
                  Nombre y Especialidad / Rol
                </label>
                <input
                  id="providerRol"
                  name="providerRol"
                  type="text"
                  maxLength={50}
                  value={providerFormData.rol}
                  onChange={(event) =>
                    setProviderFormData((current) => ({
                      ...current,
                      rol: event.target.value,
                    }))
                  }
                  placeholder="Ej. Laura Méndez - Acompañamiento"
                  required
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  Formato sugerido: Nombre y Apellido - Especialidad (máx. 50 caracteres).
                </p>
              </div>

              <div>
                <label htmlFor="providerEmail" className="mb-2 block text-sm font-semibold text-slate-700">
                  Correo Electrónico de acceso <span className="text-rose-600">*</span>
                </label>
                <input
                  id="providerEmail"
                  name="providerEmail"
                  type="email"
                  maxLength={120}
                  value={providerFormData.email}
                  onChange={(event) =>
                    setProviderFormData((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                  placeholder="Ej. maria.perez@goldencare.com"
                  required
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
                />
              </div>

              <div>
                <label htmlFor="providerPassword" className="mb-2 block text-sm font-semibold text-slate-700">
                  Contraseña inicial <span className="text-rose-600">*</span>
                </label>
                <input
                  id="providerPassword"
                  name="providerPassword"
                  type="password"
                  minLength={4}
                  maxLength={128}
                  value={providerFormData.password}
                  onChange={(event) =>
                    setProviderFormData((current) => ({
                      ...current,
                      password: event.target.value,
                    }))
                  }
                  placeholder="Mínimo 4 caracteres"
                  required
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
                />
              </div>

              {providerFormError && (
                <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {providerFormError}
                </div>
              )}

              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeProviderModal}
                  disabled={isProviderSubmitting}
                  className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isProviderSubmitting}
                  className="rounded-xl bg-cyan-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isProviderSubmitting ? "Guardando..." : "Guardar Prestador"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
