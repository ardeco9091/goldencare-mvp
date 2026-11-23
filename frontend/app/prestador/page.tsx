"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  BARRIOS_SAN_PEDRO,
  formatearMonedaARS,
  getApiBaseUrl,
  obtenerTarifaServicio,
  parsearPrestador,
  type BarrioSanPedro,
} from "../constants/barrios";

type EstadoServicio =
  | "solicitado"
  | "asignado"
  | "en curso"
  | "completado"
  | "cancelado";

type PrestadorSesion = {
  id_prestador: string;
  nombre: string;
  especialidad: string;
  rol: string;
  email: string;
  barrio_cobertura?: string | null;
};

type RegistroPostulanteForm = {
  nombre: string;
  dni: string;
  telefono: string;
  email: string;
  password: string;
  especialidad: string;
  barrio_cobertura: BarrioSanPedro;
  experiencia: string;
};

const ESPECIALIDADES_PRESTADOR = [
  "Acompañamiento",
  "Traslados",
  "Mandados y Farmacia",
  "Asistencia Integral",
] as const;

const initialRegistroForm: RegistroPostulanteForm = {
  nombre: "",
  dni: "",
  telefono: "",
  email: "",
  password: "",
  especialidad: ESPECIALIDADES_PRESTADOR[0],
  barrio_cobertura: BARRIOS_SAN_PEDRO[0],
  experiencia: "",
};

type Servicio = {
  id_servicio: string;
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

const STORAGE_TOKEN_KEY = "goldencare_prestador_token";
const STORAGE_INFO_KEY = "goldencare_prestador_info";

function formatearFechaHora(valor: string): string {
  try {
    return new Intl.DateTimeFormat("es-AR", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(valor));
  } catch {
    return valor;
  }
}

function obtenerHoraActual(): string {
  return new Intl.DateTimeFormat("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}

function esUrgente(fechaHora: string, nowMs: number | null): boolean {
  if (nowMs === null) {
    return false;
  }
  const ms = new Date(fechaHora).getTime();
  if (Number.isNaN(ms)) {
    return false;
  }
  return (ms - nowMs) / (1000 * 60 * 60) <= 24;
}

function iconoServicio(tipo: string): string {
  const t = tipo.trim().toLowerCase();
  if (t === "traslado") return "🚗";
  if (t === "mandado" || t === "mandados") return "🛍️";
  return "🤝";
}

function obtenerMontos(servicio: Servicio) {
  const fallback = obtenerTarifaServicio(servicio.tipo_servicio);
  const montoTotal =
    typeof servicio.monto_total === "number" && servicio.monto_total > 0
      ? servicio.monto_total
      : fallback.montoTotal;
  const comision =
    typeof servicio.comision_plataforma === "number" &&
    servicio.comision_plataforma >= 0
      ? servicio.comision_plataforma
      : fallback.comision;
  const pagoPrestador =
    typeof servicio.pago_prestador === "number" && servicio.pago_prestador > 0
      ? servicio.pago_prestador
      : Math.max(0, montoTotal - comision);
  return { montoTotal, comision, pagoPrestador };
}

export default function PrestadorPortalPage() {
  // Autenticación y autoregistro del prestador
  const [authChecked, setAuthChecked] = useState<boolean>(false);
  const [authTab, setAuthTab] = useState<"login" | "registro">("login");
  const [token, setToken] = useState<string | null>(null);
  const [prestador, setPrestador] = useState<PrestadorSesion | null>(null);
  const [loginEmail, setLoginEmail] = useState<string>("");
  const [loginPassword, setLoginPassword] = useState<string>("");
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Estado del formulario de postulación ("Registrarme como Prestador")
  const [registroForm, setRegistroForm] =
    useState<RegistroPostulanteForm>(initialRegistroForm);
  const [isRegistering, setIsRegistering] = useState<boolean>(false);
  const [registroError, setRegistroError] = useState<string | null>(null);
  const [registroExitoso, setRegistroExitoso] = useState<{
    nombre: string;
    email: string;
    especialidad: string;
    barrio_cobertura: string;
  } | null>(null);

  // Estado operativo
  const [services, setServices] = useState<Servicio[]>([]);
  const [activeTab, setActiveTab] = useState<"disponibles" | "en_curso">(
    "disponibles",
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{
    tipo: "exito" | "error";
    texto: string;
  } | null>(null);
  const [busyServiceId, setBusyServiceId] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number | null>(null);

  // Restaurar sesión desde sessionStorage
  useEffect(() => {
    try {
      const savedToken = window.sessionStorage.getItem(STORAGE_TOKEN_KEY);
      const savedInfoRaw = window.sessionStorage.getItem(STORAGE_INFO_KEY);
      if (savedToken && savedInfoRaw) {
        const parsed = JSON.parse(savedInfoRaw) as PrestadorSesion;
        if (parsed && parsed.id_prestador) {
          setToken(savedToken);
          setPrestador(parsed);
        }
      }
    } catch {
      // Ignorar errores de sessionStorage
    } finally {
      setAuthChecked(true);
    }
  }, []);

  const handleLogout = useCallback((mensajeError?: string) => {
    try {
      window.sessionStorage.removeItem(STORAGE_TOKEN_KEY);
      window.sessionStorage.removeItem(STORAGE_INFO_KEY);
    } catch {
      // Ignorar
    }
    setToken(null);
    setPrestador(null);
    setServices([]);
    setActionMessage(null);
    setLoginPassword("");
    if (mensajeError) {
      setLoginError(mensajeError);
    }
  }, []);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError(null);

    if (!loginEmail.trim() || !loginPassword) {
      setLoginError("Ingresá tu correo electrónico y contraseña.");
      return;
    }

    setIsLoggingIn(true);
    try {
      const response = await fetch(`${getApiBaseUrl()}/prestadores/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: loginEmail.trim().toLowerCase(),
          password: loginPassword,
        }),
      });

      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const detail =
          body && typeof body.detail === "string"
            ? body.detail
            : "Correo electrónico o contraseña incorrectos.";
        throw new Error(detail);
      }

      const accessToken = String(body.access_token || "");
      const prestadorInfo = body.prestador as PrestadorSesion;
      try {
        window.sessionStorage.setItem(STORAGE_TOKEN_KEY, accessToken);
        window.sessionStorage.setItem(
          STORAGE_INFO_KEY,
          JSON.stringify(prestadorInfo),
        );
      } catch {
        // Ignorar
      }

      setToken(accessToken);
      setPrestador(prestadorInfo);
      setLoginPassword("");
      setIsLoading(true);
      setActionMessage(null);
    } catch (err) {
      setLoginError(
        err instanceof Error
          ? err.message
          : "No se pudo iniciar sesión en el Portal del Prestador.",
      );
    } finally {
      setIsLoggingIn(false);
    }
  }

  async function handleRegistroSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRegistroError(null);

    if (
      !registroForm.nombre.trim() ||
      !registroForm.dni.trim() ||
      !registroForm.telefono.trim() ||
      !registroForm.email.trim() ||
      registroForm.password.length < 4
    ) {
      setRegistroError(
        "Completá todos los campos obligatorios (contraseña mínimo 4 caracteres).",
      );
      return;
    }

    setIsRegistering(true);
    try {
      const response = await fetch(`${getApiBaseUrl()}/prestadores/registro`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: registroForm.nombre.trim(),
          dni: registroForm.dni.trim(),
          telefono: registroForm.telefono.trim(),
          email: registroForm.email.trim().toLowerCase(),
          password: registroForm.password,
          especialidad: registroForm.especialidad,
          barrio_cobertura: registroForm.barrio_cobertura,
          experiencia: registroForm.experiencia.trim() || null,
        }),
      });

      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const detail =
          body && typeof body.detail === "string"
            ? body.detail
            : "No se pudo enviar tu postulación. Verificá los datos ingresados.";
        throw new Error(detail);
      }

      setRegistroExitoso({
        nombre: registroForm.nombre.trim(),
        email: registroForm.email.trim().toLowerCase(),
        especialidad: registroForm.especialidad,
        barrio_cobertura: registroForm.barrio_cobertura,
      });
      setLoginEmail(registroForm.email.trim().toLowerCase());
      setRegistroForm(initialRegistroForm);
    } catch (err) {
      setRegistroError(
        err instanceof Error
          ? err.message
          : "Ocurrió un error al enviar tu solicitud de registro.",
      );
    } finally {
      setIsRegistering(false);
    }
  }

  const loadData = useCallback(async (signal?: AbortSignal) => {
    const baseUrl = getApiBaseUrl();
    try {
      const servicesRes = await fetch(`${baseUrl}/servicios/`, {
        cache: "no-store",
        signal,
      });

      if (!servicesRes.ok) {
        throw new Error("No se pudo sincronizar con la API de GoldenCare.");
      }

      const servicesData = (await servicesRes.json()) as Servicio[];
      setServices(servicesData);
      setError(null);
      setLastSync(obtenerHoraActual());
      setNowMs(Date.now());
    } catch (err) {
      if (signal?.aborted) {
        return;
      }
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo conectar con el servidor.",
      );
    }
  }, []);

  useEffect(() => {
    if (!token || !prestador) {
      return;
    }
    const controller = new AbortController();
    void loadData(controller.signal).finally(() => {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    });
    return () => controller.abort();
  }, [token, prestador, loadData]);

  useEffect(() => {
    if (!token || !prestador || busyServiceId !== null) {
      return;
    }
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadData();
      }
    }, 4000);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void loadData();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [token, prestador, busyServiceId, loadData]);

  const prestadorInfo = useMemo(
    () => parsearPrestador(prestador?.rol),
    [prestador],
  );

  const availableRequests = useMemo(() => {
    return services
      .filter((s) => s.estado === "solicitado")
      .sort(
        (a, b) =>
          new Date(a.fecha_hora).getTime() - new Date(b.fecha_hora).getTime(),
      );
  }, [services]);

  const myActiveServices = useMemo(() => {
    if (!prestador?.id_prestador) return [];
    return services
      .filter(
        (s) =>
          s.id_prestador_asignado === prestador.id_prestador &&
          (s.estado === "asignado" || s.estado === "en curso"),
      )
      .sort(
        (a, b) =>
          new Date(a.fecha_hora).getTime() - new Date(b.fecha_hora).getTime(),
      );
  }, [services, prestador]);

  const myCompletedServices = useMemo(() => {
    if (!prestador?.id_prestador) return [];
    return services
      .filter(
        (s) =>
          s.id_prestador_asignado === prestador.id_prestador &&
          s.estado === "completado",
      )
      .sort(
        (a, b) =>
          new Date(b.fecha_hora).getTime() - new Date(a.fecha_hora).getTime(),
      );
  }, [services, prestador]);

  const earningsSummary = useMemo(() => {
    const acumulado = myCompletedServices.reduce(
      (acc, s) => acc + obtenerMontos(s).pagoPrestador,
      0,
    );
    const enCurso = myActiveServices.reduce(
      (acc, s) => acc + obtenerMontos(s).pagoPrestador,
      0,
    );
    return {
      acumulado,
      enCurso,
      completados: myCompletedServices.length,
    };
  }, [myCompletedServices, myActiveServices]);

  async function handleAcceptRequest(idServicio: string) {
    if (!token || !prestador) {
      handleLogout("Iniciá sesión nuevamente para aceptar pedidos.");
      return;
    }

    setBusyServiceId(idServicio);
    setActionMessage(null);

    try {
      const response = await fetch(
        `${getApiBaseUrl()}/servicios/${encodeURIComponent(idServicio)}/aceptar-prestador`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ id_prestador: prestador.id_prestador }),
        },
      );

      if (response.status === 401) {
        handleLogout("Tu sesión expiró. Volvé a iniciar sesión.");
        return;
      }

      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const detail =
          body && typeof body.detail === "string"
            ? body.detail
            : "No se pudo aceptar el pedido.";
        throw new Error(detail);
      }

      await loadData();
      setActiveTab("en_curso");
      setActionMessage({
        tipo: "exito",
        texto:
          "¡Pedido aceptado! Ya aparece en 'Mis Servicios' para que puedas iniciarlo.",
      });
    } catch (err) {
      setActionMessage({
        tipo: "error",
        texto:
          err instanceof Error
            ? err.message
            : "Ocurrió un error al aceptar el pedido.",
      });
      await loadData();
    } finally {
      setBusyServiceId(null);
    }
  }

  async function handleAdvanceStatus(
    idServicio: string,
    nuevoEstado: "en curso" | "completado",
  ) {
    if (!token) {
      handleLogout("Iniciá sesión nuevamente para actualizar el servicio.");
      return;
    }

    setBusyServiceId(idServicio);
    setActionMessage(null);

    try {
      const response = await fetch(
        `${getApiBaseUrl()}/servicios/${encodeURIComponent(idServicio)}/estado`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ estado: nuevoEstado }),
        },
      );

      if (response.status === 401) {
        handleLogout("Tu sesión expiró. Volvé a iniciar sesión.");
        return;
      }

      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const detail =
          body && typeof body.detail === "string"
            ? body.detail
            : "No se pudo actualizar el estado del servicio.";
        throw new Error(detail);
      }

      await loadData();
      setActionMessage({
        tipo: "exito",
        texto:
          nuevoEstado === "en curso"
            ? "Servicio marcado como 'En curso'. El cliente ya ve el avance en vivo."
            : "¡Servicio completado! Tus ganancias netas (85%) ya se sumaron a tu acumulado.",
      });
    } catch (err) {
      setActionMessage({
        tipo: "error",
        texto:
          err instanceof Error
            ? err.message
            : "Ocurrió un error al actualizar el estado.",
      });
    } finally {
      setBusyServiceId(null);
    }
  }

  if (!authChecked) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-300">
        <p className="text-sm font-medium">Verificando sesión...</p>
      </main>
    );
  }

  if (!token || !prestador) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 py-10 text-slate-100">
        <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-slate-900 p-6 shadow-2xl sm:p-8">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-400 text-2xl font-extrabold text-slate-950">
              G
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-300">
                GoldenCare · San Pedro de Jujuy
              </p>
              <h1 className="text-xl font-bold text-white">
                Portal del Prestador
              </h1>
            </div>
          </div>

          {/* Selector de pestañas: Iniciar Sesión / Registrarme como Prestador */}
          <div
            role="tablist"
            aria-label="Acceso o registro de prestador"
            className="mt-6 grid grid-cols-2 gap-2 rounded-2xl bg-slate-950 p-1.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={authTab === "login"}
              onClick={() => {
                setAuthTab("login");
                setLoginError(null);
              }}
              className={`rounded-xl px-3 py-2.5 text-xs font-bold transition sm:text-sm ${
                authTab === "login"
                  ? "bg-cyan-400 text-slate-950 shadow-sm"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              Iniciar Sesión
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={authTab === "registro"}
              onClick={() => {
                setAuthTab("registro");
                setRegistroError(null);
              }}
              className={`rounded-xl px-3 py-2.5 text-xs font-bold transition sm:text-sm ${
                authTab === "registro"
                  ? "bg-cyan-400 text-slate-950 shadow-sm"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              Registrarme como Prestador
            </button>
          </div>

          {authTab === "login" ? (
            <>
              <p className="mt-5 text-sm text-slate-400">
                Ingresá con tu correo electrónico y contraseña para ver
                solicitudes disponibles, aceptar pedidos y consultar tus
                ganancias netas (85%).
              </p>

              <form onSubmit={handleLogin} className="mt-5 space-y-4">
                <div>
                  <label
                    htmlFor="prestador-login-email"
                    className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-300"
                  >
                    Correo Electrónico
                  </label>
                  <input
                    id="prestador-login-email"
                    type="email"
                    autoComplete="email"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    placeholder="laura.mendez@goldencare.com"
                    required
                    className="w-full rounded-xl border border-white/15 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/25"
                  />
                </div>

                <div>
                  <label
                    htmlFor="prestador-login-password"
                    className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-300"
                  >
                    Contraseña
                  </label>
                  <input
                    id="prestador-login-password"
                    type="password"
                    autoComplete="current-password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
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
                  {isLoggingIn ? "Ingresando..." : "Ingresar al Portal"}
                </button>
              </form>

              {/* Aviso discreto de acceso demo */}
              <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-3.5 text-xs text-slate-400">
                <p className="font-semibold text-cyan-300">
                  Cuentas demo habilitadas (clave:{" "}
                  <code className="text-white">prestador123</code>)
                </p>
                <ul className="mt-1.5 space-y-0.5 font-mono text-[11px] text-slate-300">
                  <li>laura.mendez@goldencare.com</li>
                  <li>roberto.gomez@goldencare.com</li>
                  <li>carolina.vega@goldencare.com</li>
                </ul>
              </div>
            </>
          ) : registroExitoso ? (
            <div className="mt-6 rounded-2xl border border-amber-400/35 bg-amber-500/10 p-5 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-400/20 text-2xl">
                ⏳
              </div>
              <span className="mt-3 inline-flex rounded-full bg-amber-400/20 px-3 py-1 text-xs font-bold uppercase tracking-wider text-amber-200">
                Pendiente de Verificación
              </span>
              <h2 className="mt-3 text-lg font-bold text-white">
                ¡Recibimos tu postulación, {registroExitoso.nombre}!
              </h2>
              <p className="mt-2 text-xs leading-relaxed text-slate-300">
                Tu cuenta (<strong className="text-white">{registroExitoso.email}</strong>)
                quedó registrada para <strong className="text-cyan-300">{registroExitoso.especialidad}</strong> en{" "}
                <strong>{registroExitoso.barrio_cobertura}</strong>. Un coordinador
                de GoldenCare verificará tus datos antes de habilitarte para aceptar pedidos.
              </p>
              <button
                type="button"
                onClick={() => {
                  setRegistroExitoso(null);
                  setAuthTab("login");
                }}
                className="mt-5 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-cyan-400 px-4 py-2.5 text-sm font-extrabold text-slate-950 transition hover:bg-cyan-300"
              >
                Ir a Iniciar Sesión
              </button>
            </div>
          ) : (
            <>
              <p className="mt-5 text-sm text-slate-400">
                Completá tus datos para postularte como prestador en San Pedro de
                Jujuy. Tu cuenta quedará pendiente de verificación por el
                coordinador.
              </p>

              <form onSubmit={handleRegistroSubmit} className="mt-5 space-y-3.5">
                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="reg-nombre"
                      className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-300"
                    >
                      Nombre y Apellido *
                    </label>
                    <input
                      id="reg-nombre"
                      type="text"
                      required
                      maxLength={60}
                      value={registroForm.nombre}
                      onChange={(e) =>
                        setRegistroForm((prev) => ({
                          ...prev,
                          nombre: e.target.value,
                        }))
                      }
                      placeholder="Ej. Lucía Fernández"
                      className="w-full rounded-xl border border-white/15 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/25"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="reg-dni"
                      className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-300"
                    >
                      DNI *
                    </label>
                    <input
                      id="reg-dni"
                      type="text"
                      required
                      maxLength={30}
                      value={registroForm.dni}
                      onChange={(e) =>
                        setRegistroForm((prev) => ({
                          ...prev,
                          dni: e.target.value,
                        }))
                      }
                      placeholder="Ej. 35.412.890"
                      className="w-full rounded-xl border border-white/15 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/25"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="reg-telefono"
                      className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-300"
                    >
                      Teléfono / WhatsApp *
                    </label>
                    <input
                      id="reg-telefono"
                      type="text"
                      required
                      maxLength={50}
                      value={registroForm.telefono}
                      onChange={(e) =>
                        setRegistroForm((prev) => ({
                          ...prev,
                          telefono: e.target.value,
                        }))
                      }
                      placeholder="Ej. 3888 412345"
                      className="w-full rounded-xl border border-white/15 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/25"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="reg-email"
                      className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-300"
                    >
                      Correo Electrónico *
                    </label>
                    <input
                      id="reg-email"
                      type="email"
                      required
                      maxLength={120}
                      value={registroForm.email}
                      onChange={(e) =>
                        setRegistroForm((prev) => ({
                          ...prev,
                          email: e.target.value,
                        }))
                      }
                      placeholder="lucia@ejemplo.com"
                      className="w-full rounded-xl border border-white/15 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/25"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="reg-password"
                    className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-300"
                  >
                    Contraseña *
                  </label>
                  <input
                    id="reg-password"
                    type="password"
                    required
                    minLength={4}
                    maxLength={128}
                    value={registroForm.password}
                    onChange={(e) =>
                      setRegistroForm((prev) => ({
                        ...prev,
                        password: e.target.value,
                      }))
                    }
                    placeholder="Mínimo 4 caracteres"
                    className="w-full rounded-xl border border-white/15 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/25"
                  />
                </div>

                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="reg-especialidad"
                      className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-300"
                    >
                      Especialidad *
                    </label>
                    <select
                      id="reg-especialidad"
                      value={registroForm.especialidad}
                      onChange={(e) =>
                        setRegistroForm((prev) => ({
                          ...prev,
                          especialidad: e.target.value,
                        }))
                      }
                      className="w-full rounded-xl border border-white/15 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/25"
                    >
                      {ESPECIALIDADES_PRESTADOR.map((esp) => (
                        <option key={esp} value={esp}>
                          {esp}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="reg-barrio"
                      className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-300"
                    >
                      Barrio de cobertura *
                    </label>
                    <select
                      id="reg-barrio"
                      value={registroForm.barrio_cobertura}
                      onChange={(e) =>
                        setRegistroForm((prev) => ({
                          ...prev,
                          barrio_cobertura: e.target.value as BarrioSanPedro,
                        }))
                      }
                      className="w-full rounded-xl border border-white/15 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/25"
                    >
                      {BARRIOS_SAN_PEDRO.map((barrio) => (
                        <option key={barrio} value={barrio}>
                          {barrio}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="reg-experiencia"
                    className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-300"
                  >
                    Experiencia y Referencias
                  </label>
                  <textarea
                    id="reg-experiencia"
                    rows={3}
                    value={registroForm.experiencia}
                    onChange={(e) =>
                      setRegistroForm((prev) => ({
                        ...prev,
                        experiencia: e.target.value,
                      }))
                    }
                    placeholder="Contanos tu experiencia acompañando adultos mayores, disponibilidad horaria o si contás con movilidad propia..."
                    className="w-full resize-none rounded-xl border border-white/15 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/25"
                  />
                </div>

                {registroError && (
                  <div
                    role="alert"
                    className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs font-semibold text-rose-200"
                  >
                    {registroError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isRegistering}
                  className="mt-2 flex min-h-[48px] w-full items-center justify-center rounded-xl bg-cyan-400 px-5 py-3 text-sm font-extrabold text-slate-950 shadow-sm transition hover:bg-cyan-300 focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isRegistering
                    ? "Enviando postulación..."
                    : "Enviar Postulación"}
                </button>
              </form>
            </>
          )}

          <div className="mt-5 text-center text-xs text-slate-400">
            <Link href="/" className="transition hover:text-cyan-300">
              ← Volver al Portal Público
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen w-full flex-col overflow-x-hidden bg-slate-100 text-slate-900">
      {/* Header móvil estilo app de prestadores */}
      <header className="border-b border-slate-800 bg-slate-950 text-white">
        <div className="mx-auto max-w-3xl px-4 py-5 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-cyan-400 text-xl font-extrabold text-slate-950 shadow-sm">
                G
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight text-white sm:text-xl">
                  GoldenCare Prestadores
                </h1>
                <p className="text-xs text-cyan-300">
                  San Pedro de Jujuy · Modo Operativo
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="hidden items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-slate-200 sm:flex">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                <span>En línea</span>
                {lastSync && (
                  <span className="font-mono text-slate-400">{lastSync}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleLogout()}
                className="rounded-xl border border-rose-400/35 bg-rose-500/15 px-3 py-2 text-xs font-bold text-rose-200 transition hover:bg-rose-500/25"
              >
                Cerrar sesión
              </button>
            </div>
          </div>

          {/* Perfil del prestador autenticado */}
          <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-white/15 bg-white/5 p-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-cyan-400 text-sm font-extrabold text-slate-950">
                {prestadorInfo.iniciales}
              </span>
              <div className="min-w-0">
                <p className="truncate text-base font-bold text-white">
                  {prestador.nombre || prestadorInfo.nombre}
                </p>
                <p className="truncate text-xs text-cyan-200">
                  {prestador.especialidad || prestadorInfo.especialidad}
                </p>
                <p className="truncate font-mono text-[11px] text-slate-400">
                  {prestador.email}
                </p>
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-emerald-500/20 px-2.5 py-1 text-[11px] font-bold text-emerald-300 ring-1 ring-emerald-400/30">
              Activo
            </span>
          </div>

          {/* Resumen de Ganancias del Prestador */}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
                Ganancias acumuladas (85%)
              </p>
              <p className="mt-1.5 text-2xl font-extrabold text-white sm:text-3xl">
                {isLoading ? "—" : formatearMonedaARS(earningsSummary.acumulado)}
              </p>
              <p className="mt-1 text-xs text-emerald-200">
                {earningsSummary.completados}{" "}
                {earningsSummary.completados === 1
                  ? "servicio completado"
                  : "servicios completados"}
              </p>
            </div>

            <div className="rounded-2xl border border-cyan-400/30 bg-cyan-500/10 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-cyan-300">
                En curso / por cobrar
              </p>
              <p className="mt-1.5 text-2xl font-extrabold text-white sm:text-3xl">
                {isLoading ? "—" : formatearMonedaARS(earningsSummary.enCurso)}
              </p>
              <p className="mt-1 text-xs text-cyan-200">
                {myActiveServices.length}{" "}
                {myActiveServices.length === 1
                  ? "servicio activo"
                  : "servicios activos"}
              </p>
            </div>
          </div>

          {/* Pestañas principales */}
          <div
            role="tablist"
            aria-label="Secciones del portal de prestadores"
            className="mt-5 grid grid-cols-2 gap-2.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "disponibles"}
              onClick={() => setActiveTab("disponibles")}
              className={`flex min-h-[48px] items-center justify-center gap-2 rounded-2xl px-3 py-3 text-sm font-bold transition focus:outline-none focus:ring-2 focus:ring-cyan-400 ${
                activeTab === "disponibles"
                  ? "bg-cyan-400 text-slate-950 shadow-md"
                  : "border border-white/15 bg-white/5 text-slate-200 hover:bg-white/10"
              }`}
            >
              <span>Solicitudes Disponibles</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-extrabold ${
                  activeTab === "disponibles"
                    ? "bg-slate-950/15 text-slate-950"
                    : "bg-white/15 text-white"
                }`}
              >
                {availableRequests.length}
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "en_curso"}
              onClick={() => setActiveTab("en_curso")}
              className={`flex min-h-[48px] items-center justify-center gap-2 rounded-2xl px-3 py-3 text-sm font-bold transition focus:outline-none focus:ring-2 focus:ring-cyan-400 ${
                activeTab === "en_curso"
                  ? "bg-cyan-400 text-slate-950 shadow-md"
                  : "border border-white/15 bg-white/5 text-slate-200 hover:bg-white/10"
              }`}
            >
              <span>Mis Servicios</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-extrabold ${
                  activeTab === "en_curso"
                    ? "bg-slate-950/15 text-slate-950"
                    : "bg-white/15 text-white"
                }`}
              >
                {myActiveServices.length}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Contenido Principal */}
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6">
        {actionMessage && (
          <div
            role="status"
            className={`mb-5 rounded-2xl border px-4 py-3.5 text-sm font-semibold ${
              actionMessage.tipo === "exito"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-rose-200 bg-rose-50 text-rose-800"
            }`}
          >
            {actionMessage.texto}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3.5 text-sm font-medium text-rose-800"
          >
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="h-44 animate-pulse rounded-3xl border border-slate-200 bg-white p-5"
              />
            ))}
          </div>
        ) : activeTab === "disponibles" ? (
          <section
            aria-label="Solicitudes disponibles estilo Uber"
            className="space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900 sm:text-lg">
                Solicitudes abiertas en San Pedro de Jujuy
              </h2>
              <span className="text-xs font-medium text-slate-500">
                Cobrás el 85% neto
              </span>
            </div>

            {availableRequests.length === 0 ? (
              <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
                <p className="text-3xl" aria-hidden="true">
                  📡
                </p>
                <p className="mt-3 text-base font-bold text-slate-800">
                  No hay solicitudes nuevas en este momento
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Esta pantalla se actualiza automáticamente cada 4 segundos cuando
                  ingresa un nuevo pedido.
                </p>
              </div>
            ) : (
              availableRequests.map((srv) => {
                const { montoTotal, pagoPrestador } = obtenerMontos(srv);
                const urgent = esUrgente(srv.fecha_hora, nowMs);
                const isBusy = busyServiceId === srv.id_servicio;

                return (
                  <article
                    key={srv.id_servicio}
                    className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-cyan-300"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span
                          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-2xl"
                          aria-hidden="true"
                        >
                          {iconoServicio(srv.tipo_servicio)}
                        </span>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-bold capitalize text-slate-950">
                              {srv.tipo_servicio}
                            </h3>
                            {urgent && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-[11px] font-bold uppercase text-rose-800">
                                <span className="h-1.5 w-1.5 rounded-full bg-rose-600" />
                                Urgente
                              </span>
                            )}
                          </div>
                          <p className="text-xs font-mono text-slate-400">
                            Pedido #{srv.id_servicio.slice(0, 8)}
                          </p>
                        </div>
                      </div>

                      <div className="text-right">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
                          Tu ganancia (85%)
                        </p>
                        <p className="text-2xl font-extrabold text-emerald-700">
                          {formatearMonedaARS(pagoPrestador)}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          Total cliente: {formatearMonedaARS(montoTotal)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-2.5 rounded-2xl bg-slate-50 p-3.5 text-sm sm:grid-cols-2">
                      <div>
                        <span className="block text-xs font-medium text-slate-500">
                          Barrio / Sector
                        </span>
                        <span className="font-bold text-slate-900">
                          📍 {srv.zona}
                        </span>
                      </div>
                      <div>
                        <span className="block text-xs font-medium text-slate-500">
                          Fecha y hora
                        </span>
                        <span className="font-bold text-slate-900">
                          🕒 {formatearFechaHora(srv.fecha_hora)}
                        </span>
                      </div>
                      <div className="sm:col-span-2">
                        <span className="block text-xs font-medium text-slate-500">
                          Cliente
                        </span>
                        <span className="font-semibold text-slate-800">
                          {srv.nombre_contacto?.trim() || "Cliente GoldenCare"}
                        </span>
                        {srv.preferencias?.trim() && (
                          <p className="mt-1 text-xs text-slate-600">
                            {srv.preferencias}
                          </p>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleAcceptRequest(srv.id_servicio)}
                      className="mt-4 flex min-h-[50px] w-full items-center justify-center gap-2 rounded-2xl bg-cyan-600 px-5 py-3.5 text-base font-bold text-white shadow-sm transition hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isBusy ? "Aceptando pedido..." : "✓ Aceptar Pedido"}
                    </button>
                  </article>
                );
              })
            )}
          </section>
        ) : (
          <section aria-label="Mis servicios en curso" className="space-y-6">
            <div className="space-y-4">
              <h2 className="text-base font-bold text-slate-900 sm:text-lg">
                Mis Servicios en Curso ({myActiveServices.length})
              </h2>

              {myActiveServices.length === 0 ? (
                <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
                  <p className="text-base font-bold text-slate-800">
                    No tenés servicios activos asignados
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    Aceptá una solicitud desde la pestaña &ldquo;Solicitudes
                    Disponibles&rdquo; para comenzar.
                  </p>
                </div>
              ) : (
                myActiveServices.map((srv) => {
                  const { pagoPrestador, montoTotal } = obtenerMontos(srv);
                  const isBusy = busyServiceId === srv.id_servicio;
                  const estaEnCurso = srv.estado === "en curso";

                  return (
                    <article
                      key={srv.id_servicio}
                      className="rounded-3xl border-2 border-cyan-200 bg-white p-5 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span
                            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-cyan-50 text-2xl"
                            aria-hidden="true"
                          >
                            {iconoServicio(srv.tipo_servicio)}
                          </span>
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-lg font-bold capitalize text-slate-950">
                                {srv.tipo_servicio}
                              </h3>
                              <span
                                className={`rounded-full px-2.5 py-0.5 text-xs font-bold uppercase ${
                                  estaEnCurso
                                    ? "bg-indigo-100 text-indigo-800"
                                    : "bg-cyan-100 text-cyan-800"
                                }`}
                              >
                                {estaEnCurso ? "En curso" : "Asignado"}
                              </span>
                            </div>
                            <p className="text-xs font-mono text-slate-400">
                              Pedido #{srv.id_servicio.slice(0, 8)}
                            </p>
                          </div>
                        </div>

                        <div className="text-right">
                          <p className="text-[11px] font-bold uppercase text-emerald-700">
                            Ganás (85%)
                          </p>
                          <p className="text-xl font-extrabold text-emerald-700">
                            {formatearMonedaARS(pagoPrestador)}
                          </p>
                          <p className="text-[11px] text-slate-400">
                            Total {formatearMonedaARS(montoTotal)}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-1 gap-2.5 rounded-2xl bg-slate-50 p-3.5 text-sm sm:grid-cols-2">
                        <div>
                          <span className="block text-xs font-medium text-slate-500">
                            Cliente y contacto
                          </span>
                          <span className="font-bold text-slate-900">
                            {srv.nombre_contacto?.trim() || "Cliente GoldenCare"}
                          </span>
                        </div>
                        <div>
                          <span className="block text-xs font-medium text-slate-500">
                            Barrio / Sector
                          </span>
                          <span className="font-bold text-slate-900">
                            📍 {srv.zona}
                          </span>
                        </div>
                        <div className="sm:col-span-2">
                          <span className="block text-xs font-medium text-slate-500">
                            Horario y detalles
                          </span>
                          <span className="font-semibold text-slate-800">
                            🕒 {formatearFechaHora(srv.fecha_hora)}
                          </span>
                          {srv.preferencias?.trim() && (
                            <p className="mt-1 text-xs text-slate-600">
                              {srv.preferencias}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="mt-4">
                        {!estaEnCurso ? (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              void handleAdvanceStatus(
                                srv.id_servicio,
                                "en curso",
                              )
                            }
                            className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-5 py-3.5 text-base font-bold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isBusy
                              ? "Actualizando..."
                              : "▶ Iniciar Servicio (En curso)"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              void handleAdvanceStatus(
                                srv.id_servicio,
                                "completado",
                              )
                            }
                            className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3.5 text-base font-bold text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isBusy
                              ? "Finalizando..."
                              : "✓ Finalizar y Completar Servicio"}
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })
              )}
            </div>

            {/* Historial reciente completado del prestador */}
            {myCompletedServices.length > 0 && (
              <div className="space-y-3 border-t border-slate-200 pt-5">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
                  Historial completado ({myCompletedServices.length})
                </h3>
                <div className="space-y-2.5">
                  {myCompletedServices.map((srv) => {
                    const { pagoPrestador } = obtenerMontos(srv);
                    return (
                      <div
                        key={srv.id_servicio}
                        className="flex flex-col justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3.5 sm:flex-row sm:items-center"
                      >
                        <div>
                          <p className="text-sm font-bold capitalize text-slate-900">
                            {iconoServicio(srv.tipo_servicio)} {srv.tipo_servicio}{" "}
                            ·{" "}
                            <span className="font-medium text-slate-600">
                              {srv.zona}
                            </span>
                          </p>
                          <p className="text-xs text-slate-500">
                            {srv.nombre_contacto || "Cliente"} ·{" "}
                            {formatearFechaHora(srv.fecha_hora)}
                          </p>
                        </div>
                        <div className="flex items-center justify-between gap-3 sm:justify-end">
                          {srv.valoracion != null && (
                            <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-700 ring-1 ring-amber-200">
                              ★ {srv.valoracion}/5
                            </span>
                          )}
                          <span className="text-sm font-extrabold text-emerald-700">
                            + {formatearMonedaARS(pagoPrestador)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white py-5 text-center text-xs text-slate-500">
        © 2026 GoldenCare · Portal Operativo de Prestadores · San Pedro de Jujuy
      </footer>
    </div>
  );
}
