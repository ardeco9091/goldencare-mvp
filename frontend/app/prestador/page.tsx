"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  formatearMonedaARS,
  getApiBaseUrl,
  obtenerTarifaServicio,
  parsearPrestador,
} from "../constants/barrios";

type EstadoServicio =
  | "solicitado"
  | "asignado"
  | "en curso"
  | "completado"
  | "cancelado";

type Prestador = {
  id_prestador: string;
  rol: string;
  disponibilidad: boolean;
  estado: string;
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
  const [providers, setProviders] = useState<Prestador[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string>("");
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

  const loadData = useCallback(async (signal?: AbortSignal) => {
    const baseUrl = getApiBaseUrl();
    try {
      const [providersRes, servicesRes] = await Promise.all([
        fetch(`${baseUrl}/prestadores/`, { cache: "no-store", signal }),
        fetch(`${baseUrl}/servicios/`, { cache: "no-store", signal }),
      ]);

      if (!providersRes.ok || !servicesRes.ok) {
        throw new Error("No se pudo sincronizar con la API de GoldenCare.");
      }

      const [providersData, servicesData] = (await Promise.all([
        providersRes.json(),
        servicesRes.json(),
      ])) as [Prestador[], Servicio[]];

      setProviders(providersData);
      setServices(servicesData);
      setSelectedProviderId((current) => {
        if (
          current &&
          providersData.some((p) => p.id_prestador === current)
        ) {
          return current;
        }
        try {
          const saved = window.localStorage.getItem("goldencare_prestador_id");
          if (saved && providersData.some((p) => p.id_prestador === saved)) {
            return saved;
          }
        } catch {
          // Ignorar restricciones de almacenamiento local
        }
        return providersData[0]?.id_prestador ?? "";
      });

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
    const controller = new AbortController();
    void loadData(controller.signal).finally(() => {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    });
    return () => controller.abort();
  }, [loadData]);

  useEffect(() => {
    if (busyServiceId !== null) {
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
  }, [busyServiceId, loadData]);

  function handleSelectProvider(id: string) {
    setSelectedProviderId(id);
    setActionMessage(null);
    try {
      window.localStorage.setItem("goldencare_prestador_id", id);
    } catch {
      // Ignorar
    }
  }

  const selectedProvider = useMemo(
    () => providers.find((p) => p.id_prestador === selectedProviderId) ?? null,
    [providers, selectedProviderId],
  );

  const selectedProviderInfo = useMemo(
    () => parsearPrestador(selectedProvider?.rol),
    [selectedProvider],
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
    if (!selectedProviderId) return [];
    return services
      .filter(
        (s) =>
          s.id_prestador_asignado === selectedProviderId &&
          (s.estado === "asignado" || s.estado === "en curso"),
      )
      .sort(
        (a, b) =>
          new Date(a.fecha_hora).getTime() - new Date(b.fecha_hora).getTime(),
      );
  }, [services, selectedProviderId]);

  const myCompletedServices = useMemo(() => {
    if (!selectedProviderId) return [];
    return services
      .filter(
        (s) =>
          s.id_prestador_asignado === selectedProviderId &&
          s.estado === "completado",
      )
      .sort(
        (a, b) =>
          new Date(b.fecha_hora).getTime() - new Date(a.fecha_hora).getTime(),
      );
  }, [services, selectedProviderId]);

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
    if (!selectedProviderId) {
      setActionMessage({
        tipo: "error",
        texto: "Seleccioná primero tu perfil de prestador para aceptar pedidos.",
      });
      return;
    }

    setBusyServiceId(idServicio);
    setActionMessage(null);

    try {
      const response = await fetch(
        `${getApiBaseUrl()}/servicios/${encodeURIComponent(idServicio)}/aceptar-prestador`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id_prestador: selectedProviderId }),
        },
      );

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
          "¡Pedido aceptado! Ya aparece en 'Mis Servicios en Curso' para que puedas iniciarlo.",
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
    setBusyServiceId(idServicio);
    setActionMessage(null);

    try {
      const response = await fetch(
        `${getApiBaseUrl()}/servicios/${encodeURIComponent(idServicio)}/estado`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ estado: nuevoEstado }),
        },
      );

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

            <div className="flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-slate-200">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
              <span className="hidden sm:inline">En línea</span>
              {lastSync && (
                <span className="font-mono text-slate-400">{lastSync}</span>
              )}
            </div>
          </div>

          {/* Selector de perfil del prestador */}
          <div className="mt-5 rounded-2xl border border-white/15 bg-white/5 p-4">
            <label
              htmlFor="selector-prestador"
              className="block text-xs font-semibold uppercase tracking-wider text-cyan-300"
            >
              Tu perfil de prestador activo
            </label>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center">
              <select
                id="selector-prestador"
                value={selectedProviderId}
                onChange={(e) => handleSelectProvider(e.target.value)}
                disabled={isLoading || providers.length === 0}
                className="w-full flex-1 rounded-xl border border-white/20 bg-slate-900 px-4 py-3 text-sm font-semibold text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/30"
              >
                {providers.length === 0 ? (
                  <option value="">Sin prestadores activos registrados</option>
                ) : (
                  providers.map((p) => (
                    <option key={p.id_prestador} value={p.id_prestador}>
                      {p.rol}
                    </option>
                  ))
                )}
              </select>

              {selectedProvider && (
                <div className="flex items-center gap-2.5 rounded-xl bg-white/10 px-3.5 py-2.5 text-xs">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-400 font-extrabold text-slate-950">
                    {selectedProviderInfo.iniciales}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-bold text-white">
                      {selectedProviderInfo.nombre}
                    </p>
                    <p className="truncate text-cyan-200">
                      {selectedProviderInfo.especialidad}
                    </p>
                  </div>
                </div>
              )}
            </div>
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
          <section aria-label="Solicitudes disponibles estilo Uber" className="space-y-4">
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
                      disabled={isBusy || !selectedProviderId}
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
                                    ? "bg-violet-100 text-violet-800"
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
                            className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 px-5 py-3.5 text-base font-bold text-white shadow-sm transition hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
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
