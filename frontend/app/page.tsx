"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  BARRIOS_SAN_PEDRO,
  combinarDireccionYPreferencias,
  type BarrioSanPedro,
} from "./constants/barrios";

const CREATE_PUBLIC_ORDER_URL = "http://127.0.0.1:8000/pedidos/publico";
const CONSULT_PUBLIC_ORDER_URL = "http://127.0.0.1:8000/pedidos/consultar";
const SERVICE_SURVEY_BASE_URL = "http://127.0.0.1:8000/servicios";

type TipoServicio = "traslado" | "acompañamiento" | "mandado";
type Zona = BarrioSanPedro | string;
type EstadoServicio =
  | "solicitado"
  | "asignado"
  | "en curso"
  | "completado"
  | "cancelado";

type PedidoRespuesta = {
  id_servicio: string;
  codigo_seguimiento: string;
  nombre_contacto: string;
  tipo_servicio: TipoServicio;
  zona: Zona;
  fecha_hora: string;
  estado: EstadoServicio;
  preferencias?: string | null;
  prestador_asignado?: string | null;
  valoracion?: number | null;
  comentario_encuesta?: string | null;
};

type SurveyDraft = {
  valoracion: number;
  comentario: string;
};

type ServicioOption = {
  id: TipoServicio;
  titulo: string;
  descripcion: string;
  icono: string;
};

const SERVICIOS_DISPONIBLES: ServicioOption[] = [
  {
    id: "traslado",
    titulo: "Traslado",
    descripcion:
      "Acompañamiento en vehículo a turnos médicos, trámites o visitas.",
    icono: "🚗",
  },
  {
    id: "acompañamiento",
    titulo: "Acompañamiento",
    descripcion: "Compañía en el hogar, paseos o actividades diarias.",
    icono: "🤝",
  },
  {
    id: "mandado",
    titulo: "Mandado",
    descripcion: "Compras de farmacia, supermercado o gestiones rápidas.",
    icono: "🛍️",
  },
];

const ZONAS_DISPONIBLES = BARRIOS_SAN_PEDRO;

const ESTADOS_INFO: Record<
  EstadoServicio,
  {
    etiqueta: string;
    explicacion: string;
    badgeClass: string;
    barClass: string;
    progreso: number;
  }
> = {
  solicitado: {
    etiqueta: "Solicitado",
    explicacion:
      "Recibimos tu pedido. Un coordinador está revisando la solicitud para asignarte al prestador ideal.",
    badgeClass: "bg-amber-50 text-amber-800 ring-amber-600/25",
    barClass: "bg-amber-500",
    progreso: 25,
  },
  asignado: {
    etiqueta: "Asignado",
    explicacion:
      "Tu servicio ya tiene un prestador asignado y confirmado para la fecha y hora indicadas.",
    badgeClass: "bg-cyan-50 text-cyan-800 ring-cyan-600/25",
    barClass: "bg-cyan-600",
    progreso: 55,
  },
  "en curso": {
    etiqueta: "En curso",
    explicacion:
      "El prestador se encuentra realizando la asistencia en este momento.",
    badgeClass: "bg-violet-50 text-violet-800 ring-violet-600/25",
    barClass: "bg-violet-600",
    progreso: 80,
  },
  completado: {
    etiqueta: "Completado",
    explicacion:
      "El servicio finalizó correctamente. ¡Gracias por confiar en GoldenCare!",
    badgeClass: "bg-emerald-50 text-emerald-800 ring-emerald-600/25",
    barClass: "bg-emerald-600",
    progreso: 100,
  },
  cancelado: {
    etiqueta: "Cancelado",
    explicacion:
      "Este pedido fue cancelado. Si necesitás reprogramarlo, podés generar una nueva solicitud.",
    badgeClass: "bg-rose-50 text-rose-800 ring-rose-600/25",
    barClass: "bg-rose-500",
    progreso: 100,
  },
};

function formatearFechaHora(valor: string): string {
  try {
    return new Intl.DateTimeFormat("es-AR", {
      dateStyle: "full",
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

export default function ClientPortalPage() {
  const [activeTab, setActiveTab] = useState<"solicitar" | "seguir">("solicitar");

  // Estado del formulario "Solicitar un Servicio"
  const [tipoServicio, setTipoServicio] = useState<TipoServicio>("traslado");
  const [zona, setZona] = useState<Zona>(BARRIOS_SAN_PEDRO[0]);
  const [direccionReferencia, setDireccionReferencia] = useState<string>("");
  const [fechaHora, setFechaHora] = useState<string>("");
  const [nombreContacto, setNombreContacto] = useState<string>("");
  const [preferencias, setPreferencias] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmedOrder, setConfirmedOrder] = useState<PedidoRespuesta | null>(
    null,
  );
  const [copiedCode, setCopiedCode] = useState<boolean>(false);

  // Estado del flujo "Seguir mi Pedido"
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [activeSearchTerm, setActiveSearchTerm] = useState<string>("");
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<PedidoRespuesta[]>([]);
  const [hasSearched, setHasSearched] = useState<boolean>(false);
  const [lastTrackingSync, setLastTrackingSync] = useState<string | null>(null);

  // Estado de encuestas de satisfacción por servicio
  const [surveyDrafts, setSurveyDrafts] = useState<Record<string, SurveyDraft>>(
    {},
  );
  const [submittingSurveyId, setSubmittingSurveyId] = useState<string | null>(
    null,
  );
  const [surveyErrors, setSurveyErrors] = useState<Record<string, string>>({});

  function getSurveyDraft(idServicio: string): SurveyDraft {
    return surveyDrafts[idServicio] ?? { valoracion: 5, comentario: "" };
  }

  function updateSurveyDraft(
    idServicio: string,
    patch: Partial<SurveyDraft>,
  ) {
    setSurveyDrafts((current) => {
      const existing = current[idServicio] ?? { valoracion: 5, comentario: "" };
      return {
        ...current,
        [idServicio]: { ...existing, ...patch },
      };
    });
  }

  async function handleSubmitSurvey(idServicio: string) {
    const draft = getSurveyDraft(idServicio);
    setSubmittingSurveyId(idServicio);
    setSurveyErrors((current) => {
      const next = { ...current };
      delete next[idServicio];
      return next;
    });

    try {
      const response = await fetch(
        `${SERVICE_SURVEY_BASE_URL}/${encodeURIComponent(idServicio)}/encuesta`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            valoracion: draft.valoracion,
            comentario: draft.comentario.trim() || null,
          }),
        },
      );

      const responseBody = await response.json().catch(() => null);
      if (!response.ok) {
        const detail =
          responseBody && typeof responseBody.detail === "string"
            ? responseBody.detail
            : "No se pudo guardar tu calificación.";
        throw new Error(detail);
      }

      setSearchResults((current) =>
        current.map((item) =>
          item.id_servicio === idServicio
            ? {
                ...item,
                valoracion: draft.valoracion,
                comentario_encuesta: draft.comentario.trim() || null,
              }
            : item,
        ),
      );

      setConfirmedOrder((current) =>
        current && current.id_servicio === idServicio
          ? {
              ...current,
              valoracion: draft.valoracion,
              comentario_encuesta: draft.comentario.trim() || null,
            }
          : current,
      );
    } catch (error) {
      setSurveyErrors((current) => ({
        ...current,
        [idServicio]:
          error instanceof Error
            ? error.message
            : "Ocurrió un error al enviar tu calificación.",
      }));
    } finally {
      setSubmittingSurveyId(null);
    }
  }

  const fetchOrdersSilently = useCallback(async (termToQuery: string) => {
    const clean = termToQuery.trim();
    if (!clean) {
      return;
    }

    try {
      const response = await fetch(
        `${CONSULT_PUBLIC_ORDER_URL}/${encodeURIComponent(clean)}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        return;
      }

      const data: PedidoRespuesta[] = await response.json();
      setSearchResults(data);
      setLastTrackingSync(obtenerHoraActual());

      setConfirmedOrder((current) => {
        if (!current) {
          return null;
        }
        const updated = data.find(
          (item) =>
            item.id_servicio === current.id_servicio ||
            item.codigo_seguimiento === current.codigo_seguimiento,
        );
        return updated ?? current;
      });
    } catch {
      // Silencioso en auto-refresco de fondo
    }
  }, []);

  const confirmedTrackingCode = confirmedOrder?.codigo_seguimiento?.trim() || "";

  // Auto-refresco silencioso cada 4 segundos para seguimiento en vivo
  useEffect(() => {
    if (submittingSurveyId !== null) {
      return;
    }

    const targetTerm =
      activeTab === "seguir"
        ? activeSearchTerm.trim()
        : confirmedTrackingCode;

    if (!targetTerm) {
      return;
    }

    // Sincronización inmediata al activar el término o código de confirmación
    void fetchOrdersSilently(targetTerm);

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void fetchOrdersSilently(targetTerm);
      }
    }, 4000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void fetchOrdersSilently(targetTerm);
      }
    };

    window.addEventListener("focus", handleVisibilityChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleVisibilityChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    activeTab,
    activeSearchTerm,
    confirmedTrackingCode,
    submittingSurveyId,
    fetchOrdersSilently,
  ]);

  async function handleSubmitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);

    if (!fechaHora.trim()) {
      setSubmitError("Por favor, seleccioná la fecha y hora del servicio.");
      return;
    }

    if (!nombreContacto.trim()) {
      setSubmitError(
        "Por favor, ingresá tu nombre y teléfono de contacto.",
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const preferenciasCombinadas = combinarDireccionYPreferencias(
        direccionReferencia,
        preferencias,
      );

      const response = await fetch(CREATE_PUBLIC_ORDER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre_contacto: nombreContacto.trim(),
          zona,
          tipo_servicio: tipoServicio,
          fecha_hora: new Date(fechaHora).toISOString(),
          preferencias: preferenciasCombinadas,
        }),
      });

      const responseBody = await response.json().catch(() => null);
      if (!response.ok) {
        const detail =
          responseBody && typeof responseBody.detail === "string"
            ? responseBody.detail
            : "No pudimos registrar tu solicitud en este momento. Verificá los datos e intentá nuevamente.";
        throw new Error(detail);
      }

      const data = responseBody as PedidoRespuesta;
      setConfirmedOrder(data);
      setCopiedCode(false);

      // Guardamos automáticamente el código en la búsqueda activa para seguimiento inmediato
      setSearchQuery(data.codigo_seguimiento);
      setActiveSearchTerm(data.codigo_seguimiento);
      setSearchResults([data]);
      setHasSearched(true);
      setLastTrackingSync(obtenerHoraActual());
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Ocurrió un error al conectar con el servidor de GoldenCare.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleResetOrderForm() {
    setConfirmedOrder(null);
    setSubmitError(null);
    setTipoServicio("traslado");
    setZona(BARRIOS_SAN_PEDRO[0]);
    setDireccionReferencia("");
    setFechaHora("");
    setPreferencias("");
    setCopiedCode(false);
  }

  async function handleCopyTrackingCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 3000);
    } catch {
      setCopiedCode(false);
    }
  }

  async function executeSearch(queryToSearch: string) {
    const cleanQuery = queryToSearch.trim();
    if (!cleanQuery) {
      setSearchError(
        "Ingresá tu código de 8 caracteres o tu nombre/teléfono para buscar.",
      );
      return;
    }

    setIsSearching(true);
    setSearchError(null);
    setHasSearched(true);
    setActiveSearchTerm(cleanQuery);

    try {
      const response = await fetch(
        `${CONSULT_PUBLIC_ORDER_URL}/${encodeURIComponent(cleanQuery)}`,
        { cache: "no-store" },
      );

      if (!response.ok) {
        throw new Error("No se pudo realizar la consulta en este momento.");
      }

      const data: PedidoRespuesta[] = await response.json();
      setSearchResults(data);
      setLastTrackingSync(obtenerHoraActual());
    } catch (error) {
      setSearchError(
        error instanceof Error
          ? error.message
          : "No pudimos conectar con el sistema de seguimiento.",
      );
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }

  async function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await executeSearch(searchQuery);
  }

  function handleGoToTrackingFromConfirmation(code: string) {
    setSearchQuery(code);
    setActiveSearchTerm(code);
    setActiveTab("seguir");
    void executeSearch(code);
  }

  const confirmedStatusInfo = confirmedOrder
    ? (ESTADOS_INFO[confirmedOrder.estado] ?? ESTADOS_INFO.solicitado)
    : ESTADOS_INFO.solicitado;

  function renderSurveySection(pedido: PedidoRespuesta) {
    if (pedido.estado !== "completado") {
      return null;
    }

    if (pedido.valoracion != null) {
      return (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-emerald-900">
              ¡Gracias por tu valoración!
            </p>
            <div
              className="flex items-center gap-1 text-lg text-amber-500"
              aria-label={`Calificación otorgada: ${pedido.valoracion} de 5 estrellas`}
            >
              {[1, 2, 3, 4, 5].map((star) => (
                <span key={star} aria-hidden="true">
                  {star <= (pedido.valoracion ?? 0) ? "★" : "☆"}
                </span>
              ))}
              <span className="ml-1 text-xs font-bold text-emerald-800">
                ({pedido.valoracion}/5)
              </span>
            </div>
          </div>
          {pedido.comentario_encuesta && (
            <p className="mt-2 text-xs italic text-emerald-800">
              “{pedido.comentario_encuesta}”
            </p>
          )}
        </div>
      );
    }

    const draft = getSurveyDraft(pedido.id_servicio);
    const isSaving = submittingSurveyId === pedido.id_servicio;
    const errorMsg = surveyErrors[pedido.id_servicio];

    return (
      <div className="mt-4 rounded-2xl border border-cyan-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-bold text-slate-900">
          ¿Cómo resultó el servicio? Calificá tu experiencia
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          Tu opinión nos ayuda a mantener la calidad de asistencia en GoldenCare.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {[1, 2, 3, 4, 5].map((star) => {
            const active = star <= draft.valoracion;
            return (
              <button
                key={star}
                type="button"
                onClick={() =>
                  updateSurveyDraft(pedido.id_servicio, { valoracion: star })
                }
                aria-label={`Calificar con ${star} ${
                  star === 1 ? "estrella" : "estrellas"
                }`}
                aria-pressed={draft.valoracion === star}
                className={`flex h-11 w-11 items-center justify-center rounded-xl border text-xl transition focus:outline-none focus:ring-2 focus:ring-cyan-500 ${
                  active
                    ? "border-amber-300 bg-amber-50 text-amber-500"
                    : "border-slate-200 bg-slate-50 text-slate-300 hover:border-slate-300"
                }`}
              >
                ★
              </button>
            );
          })}
          <span className="text-xs font-semibold text-slate-600 sm:ml-2">
            {draft.valoracion} de 5 estrellas
          </span>
        </div>

        <div className="mt-3">
          <label
            htmlFor={`comentario-encuesta-${pedido.id_servicio}`}
            className="sr-only"
          >
            Comentario opcional sobre el servicio
          </label>
          <textarea
            id={`comentario-encuesta-${pedido.id_servicio}`}
            rows={2}
            value={draft.comentario}
            onChange={(event) =>
              updateSurveyDraft(pedido.id_servicio, {
                comentario: event.target.value,
              })
            }
            placeholder="Comentario opcional (puntualidad, trato del prestador, etc.)"
            className="w-full resize-none rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-600 focus:ring-2 focus:ring-cyan-500/20"
          />
        </div>

        {errorMsg && (
          <p role="alert" className="mt-2 text-xs font-medium text-rose-700">
            {errorMsg}
          </p>
        )}

        <div className="mt-3 flex justify-end">
          <button
            type="button"
            disabled={isSaving}
            onClick={() => void handleSubmitSurvey(pedido.id_servicio)}
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-cyan-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-cyan-500 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:text-xs"
          >
            {isSaving ? "Enviando..." : "Enviar calificación"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full flex-col overflow-x-hidden bg-slate-50 text-slate-900">
      {/* Encabezado y Hero */}
      <header className="border-b border-slate-200 bg-slate-950 text-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-2 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-cyan-400 text-xl font-extrabold text-slate-950 shadow-sm">
              G
            </div>
            <div className="min-w-0">
              <span className="block truncate text-lg font-bold tracking-tight text-white sm:text-xl">
                GoldenCare
              </span>
              <span className="block truncate text-xs text-cyan-300">
                Portal de Asistencia
              </span>
            </div>
          </div>

          <Link
            href="/admin"
            className="inline-flex min-h-[40px] shrink-0 items-center rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-cyan-400/50 hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-400 sm:px-3.5"
          >
            Acceso Coordinadores
          </Link>
        </div>

        <div className="mx-auto max-w-4xl px-4 pb-8 pt-4 sm:px-6 sm:pb-10 sm:pt-6">
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-4xl">
            Asistencia confiable y cercana para tus seres queridos
          </h1>
          <p className="mt-2 max-w-2xl text-base text-slate-300 sm:text-lg">
            Coordinamos traslados, acompañamientos y mandados de forma simple,
            humana y segura.
          </p>

          {/* Pestañas principales */}
          <div
            role="tablist"
            aria-label="Secciones del portal de clientes"
            className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2"
          >
            <button
              id="tab-solicitar"
              type="button"
              role="tab"
              aria-selected={activeTab === "solicitar"}
              aria-controls="panel-principal"
              onClick={() => setActiveTab("solicitar")}
              className={`flex min-h-[52px] items-center justify-center gap-2.5 rounded-2xl px-5 py-4 text-base font-bold transition focus:outline-none focus:ring-2 focus:ring-cyan-400 ${
                activeTab === "solicitar"
                  ? "bg-cyan-400 text-slate-950 shadow-md"
                  : "border border-white/15 bg-white/5 text-slate-200 hover:bg-white/10"
              }`}
            >
              <span aria-hidden="true" className="text-lg">
                ✨
              </span>
              Solicitar un Servicio
            </button>

            <button
              id="tab-seguir"
              type="button"
              role="tab"
              aria-selected={activeTab === "seguir"}
              aria-controls="panel-principal"
              onClick={() => setActiveTab("seguir")}
              className={`flex min-h-[52px] items-center justify-center gap-2.5 rounded-2xl px-5 py-4 text-base font-bold transition focus:outline-none focus:ring-2 focus:ring-cyan-400 ${
                activeTab === "seguir"
                  ? "bg-cyan-400 text-slate-950 shadow-md"
                  : "border border-white/15 bg-white/5 text-slate-200 hover:bg-white/10"
              }`}
            >
              <span aria-hidden="true" className="text-lg">
                🔍
              </span>
              Seguir mi Pedido
            </button>
          </div>
        </div>
      </header>

      {/* Contenido Principal */}
      <main
        id="panel-principal"
        role="tabpanel"
        aria-labelledby={
          activeTab === "solicitar" ? "tab-solicitar" : "tab-seguir"
        }
        className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6 sm:py-10"
      >
        {activeTab === "solicitar" ? (
          confirmedOrder ? (
            /* Pantalla de Confirmación al enviar con éxito */
            <section
              aria-labelledby="confirmacion-titulo"
              className="rounded-3xl border border-emerald-200 bg-white p-6 shadow-sm sm:p-10"
            >
              <div className="flex flex-col items-center text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-3xl text-emerald-700">
                  ✓
                </div>
                <span
                  className={`mt-4 inline-flex items-center gap-2 rounded-full px-3.5 py-1 text-xs font-bold uppercase tracking-wider ring-1 ring-inset ${confirmedStatusInfo.badgeClass}`}
                >
                  <span className="h-2 w-2 animate-pulse rounded-full bg-current" />
                  Estado en vivo: {confirmedStatusInfo.etiqueta}
                </span>
                <h2
                  id="confirmacion-titulo"
                  className="mt-3 text-2xl font-bold text-slate-950 sm:text-3xl"
                >
                  ¡Recibimos tu solicitud con éxito!
                </h2>
                <p className="mt-2 max-w-xl text-base text-slate-600">
                  Guardá tu código de seguimiento para consultar el avance de tu
                  pedido en cualquier momento.
                </p>
              </div>

              {/* Comprobante con Código de Seguimiento */}
              <div className="mt-8 rounded-2xl border-2 border-cyan-500/30 bg-cyan-50/50 p-4 text-center sm:p-6">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-800">
                  Código de seguimiento (8 caracteres)
                </p>
                <div className="mt-3 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
                  <span className="rounded-xl bg-white px-4 py-3 font-mono text-xl font-extrabold tracking-widest text-slate-950 shadow-sm ring-1 ring-slate-200 sm:px-5 sm:text-3xl">
                    {confirmedOrder.codigo_seguimiento}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      void handleCopyTrackingCode(
                        confirmedOrder.codigo_seguimiento,
                      )
                    }
                    className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  >
                    {copiedCode ? "✓ Código copiado" : "📋 Copiar código"}
                  </button>
                </div>
              </div>

              {/* Resumen del servicio solicitado */}
              <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5 sm:p-6">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
                  Resumen de tu pedido
                </h3>
                <dl className="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="font-medium text-slate-500">
                      Tipo de servicio
                    </dt>
                    <dd className="mt-1 text-base font-bold capitalize text-slate-900">
                      {confirmedOrder.tipo_servicio}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-500">Barrio / Sector</dt>
                    <dd className="mt-1 text-base font-bold text-slate-900">
                      {confirmedOrder.zona}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-500">
                      Fecha y hora programada
                    </dt>
                    <dd className="mt-1 text-base font-bold text-slate-900">
                      {formatearFechaHora(confirmedOrder.fecha_hora)}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-500">
                      Contacto registrado
                    </dt>
                    <dd className="mt-1 text-base font-bold text-slate-900">
                      {confirmedOrder.nombre_contacto}
                    </dd>
                  </div>
                  {confirmedOrder.preferencias && (
                    <div className="sm:col-span-2">
                      <dt className="font-medium text-slate-500">
                        Dirección y detalles indicados
                      </dt>
                      <dd className="mt-1 text-sm font-medium text-slate-800">
                        {confirmedOrder.preferencias}
                      </dd>
                    </div>
                  )}
                </dl>

                {/* Barra de progreso en vivo también en la pantalla de confirmación */}
                <div className="mt-5 border-t border-slate-200 pt-4">
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${confirmedStatusInfo.barClass}`}
                      style={{ width: `${confirmedStatusInfo.progreso}%` }}
                    />
                  </div>
                  <p className="mt-2.5 text-sm text-slate-700">
                    <strong className="font-bold text-slate-900">
                      Estado actual ({confirmedStatusInfo.etiqueta}):
                    </strong>{" "}
                    {confirmedStatusInfo.explicacion}
                  </p>
                  {confirmedOrder.prestador_asignado && (
                    <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm font-semibold text-cyan-950">
                      <span aria-hidden="true">👤</span>
                      <span>
                        Profesional asignado:{" "}
                        <strong>{confirmedOrder.prestador_asignado}</strong>
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Encuesta de satisfacción destacada en la vista de confirmación cuando pasa a completado */}
              {renderSurveySection(confirmedOrder)}

              {/* Acciones posteriores */}
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
                <button
                  type="button"
                  onClick={() =>
                    handleGoToTrackingFromConfirmation(
                      confirmedOrder.codigo_seguimiento,
                    )
                  }
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-600 px-6 py-4 text-base font-bold text-white shadow-sm transition hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2"
                >
                  🔍 Ver estado de mi pedido
                </button>
                <button
                  type="button"
                  onClick={handleResetOrderForm}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-6 py-4 text-base font-bold text-slate-700 transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-400"
                >
                  + Hacer otro pedido
                </button>
              </div>
            </section>
          ) : (
            /* Formulario paso a paso para Solicitar un Servicio */
            <form
              onSubmit={handleSubmitOrder}
              className="space-y-8"
              noValidate
            >
              {/* Paso 1: Elegí el servicio */}
              <section
                aria-labelledby="paso-1-titulo"
                className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-600 text-sm font-bold text-white">
                    1
                  </span>
                  <h2
                    id="paso-1-titulo"
                    className="text-xl font-bold text-slate-950 sm:text-2xl"
                  >
                    Elegí el servicio que necesitás
                  </h2>
                </div>
                <p className="mt-2 text-sm text-slate-600 sm:text-base">
                  Seleccioná una de las opciones tocando sobre la tarjeta.
                </p>

                <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
                  {SERVICIOS_DISPONIBLES.map((item) => {
                    const seleccionado = tipoServicio === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setTipoServicio(item.id)}
                        aria-pressed={seleccionado}
                        className={`flex flex-col items-start rounded-2xl border-2 p-5 text-left transition focus:outline-none focus:ring-2 focus:ring-cyan-500 ${
                          seleccionado
                            ? "border-cyan-600 bg-cyan-50/70 shadow-sm"
                            : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex w-full items-center justify-between">
                          <span
                            className=" flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-2xl"
                            aria-hidden="true"
                          >
                            {item.icono}
                          </span>
                          <span
                            className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs font-bold ${
                              seleccionado
                                ? "border-cyan-600 bg-cyan-600 text-white"
                                : "border-slate-300 bg-white text-transparent"
                            }`}
                            aria-hidden="true"
                          >
                            ✓
                          </span>
                        </div>
                        <span className="mt-4 text-lg font-bold text-slate-950">
                          {item.titulo}
                        </span>
                        <span className="mt-1.5 text-sm leading-relaxed text-slate-600">
                          {item.descripcion}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Paso 2: Barrio, Dirección y Fecha/Hora */}
              <section
                aria-labelledby="paso-2-titulo"
                className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-600 text-sm font-bold text-white">
                    2
                  </span>
                  <h2
                    id="paso-2-titulo"
                    className="text-xl font-bold text-slate-950 sm:text-2xl"
                  >
                    Barrio, Dirección y Fecha del servicio
                  </h2>
                </div>
                <p className="mt-2 text-sm text-slate-600 sm:text-base">
                  Seleccioná tu barrio en San Pedro de Jujuy, indicá la
                  dirección o referencia y cuándo necesitás la asistencia.
                </p>

                <div className="mt-5 grid grid-cols-1 gap-6 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="zona-select"
                      className="mb-2 block text-base font-bold text-slate-800"
                    >
                      Barrio / Sector (San Pedro de Jujuy)
                    </label>
                    <select
                      id="zona-select"
                      name="zona"
                      value={zona}
                      onChange={(event) =>
                        setZona(event.target.value as Zona)
                      }
                      required
                      className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3.5 text-base font-medium text-slate-900 outline-none transition focus:border-cyan-600 focus:ring-2 focus:ring-cyan-500/20"
                    >
                      {ZONAS_DISPONIBLES.map((z) => (
                        <option key={z} value={z}>
                          {z}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="fecha-hora-input"
                      className="mb-2 block text-base font-bold text-slate-800"
                    >
                      Fecha y hora solicitada <span className="text-rose-600">*</span>
                    </label>
                    <input
                      id="fecha-hora-input"
                      name="fecha_hora"
                      type="datetime-local"
                      value={fechaHora}
                      onChange={(event) => setFechaHora(event.target.value)}
                      required
                      className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3.5 text-base font-medium text-slate-900 outline-none transition focus:border-cyan-600 focus:ring-2 focus:ring-cyan-500/20"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label
                      htmlFor="direccion-referencia-input"
                      className="mb-2 block text-base font-bold text-slate-800"
                    >
                      Dirección o referencia exacta
                    </label>
                    <input
                      id="direccion-referencia-input"
                      name="direccion_referencia"
                      type="text"
                      value={direccionReferencia}
                      onChange={(event) =>
                        setDireccionReferencia(event.target.value)
                      }
                      placeholder="Ej. Av. Siria 250 o Cerca del Hospital Paterson"
                      className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3.5 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-600 focus:ring-2 focus:ring-cyan-500/20"
                    />
                  </div>
                </div>
              </section>

              {/* Paso 3: Tus datos de contacto */}
              <section
                aria-labelledby="paso-3-titulo"
                className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-600 text-sm font-bold text-white">
                    3
                  </span>
                  <h2
                    id="paso-3-titulo"
                    className="text-xl font-bold text-slate-950 sm:text-2xl"
                  >
                    Tus datos de contacto
                  </h2>
                </div>
                <p className="mt-2 text-sm text-slate-600 sm:text-base">
                  Dejanos tu nombre y teléfono para confirmar la asignación del
                  prestador.
                </p>

                <div className="mt-5 space-y-5">
                  <div>
                    <label
                      htmlFor="nombre-contacto-input"
                      className="mb-2 block text-base font-bold text-slate-800"
                    >
                      Nombre y teléfono de contacto{" "}
                      <span className="text-rose-600">*</span>
                    </label>
                    <input
                      id="nombre-contacto-input"
                      name="nombre_contacto"
                      type="text"
                      value={nombreContacto}
                      onChange={(event) =>
                        setNombreContacto(event.target.value)
                      }
                      placeholder="Ej. María Gómez - 388 412 3456"
                      required
                      className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3.5 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-600 focus:ring-2 focus:ring-cyan-500/20"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="preferencias-textarea"
                      className="mb-2 block text-base font-bold text-slate-800"
                    >
                      Notas, dirección o detalles importantes{" "}
                      <span className="text-sm font-normal text-slate-500">
                        (Opcional)
                      </span>
                    </label>
                    <textarea
                      id="preferencias-textarea"
                      name="preferencias"
                      rows={3}
                      value={preferencias}
                      onChange={(event) => setPreferencias(event.target.value)}
                      placeholder="Indicá la dirección exacta, si requiere ayuda con bastón/silla de ruedas, o detalles del turno médico..."
                      className="w-full resize-none rounded-2xl border border-slate-300 bg-white px-4 py-3.5 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-600 focus:ring-2 focus:ring-cyan-500/20"
                    />
                  </div>
                </div>

                {submitError && (
                  <div
                    role="alert"
                    className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-base font-medium text-rose-800"
                  >
                    {submitError}
                  </div>
                )}

                <div className="mt-8">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full rounded-2xl bg-cyan-600 px-6 py-4 text-lg font-bold text-white shadow-md transition hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSubmitting
                      ? "Enviando solicitud..."
                      : "Confirmar y Solicitar Servicio"}
                  </button>
                </div>
              </section>
            </form>
          )
        ) : (
          /* Flujo "Seguir mi Pedido" */
          <section
            aria-labelledby="seguimiento-titulo"
            className="space-y-6"
          >
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h2
                  id="seguimiento-titulo"
                  className="text-xl font-bold text-slate-950 sm:text-2xl"
                >
                  Consultá el estado de tu pedido
                </h2>
                {activeSearchTerm && (
                  <span className="inline-flex w-fit items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                    Seguimiento en vivo
                    {lastTrackingSync && (
                      <span className="font-mono text-slate-400">
                        · {lastTrackingSync}
                      </span>
                    )}
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm text-slate-600 sm:text-base">
                Ingresá los 8 caracteres de tu código de seguimiento o el
                nombre/teléfono con el que hiciste el pedido.
              </p>

              <form
                onSubmit={handleSearchSubmit}
                className="mt-5 flex flex-col gap-3 sm:flex-row"
              >
                <label htmlFor="buscar-pedido-input" className="sr-only">
                  Código de seguimiento o nombre de contacto
                </label>
                <input
                  id="buscar-pedido-input"
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Ej. 10000000 o Ana López"
                  className="flex-1 rounded-2xl border border-slate-300 bg-white px-4 py-3.5 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-600 focus:ring-2 focus:ring-cyan-500/20"
                />
                <button
                  type="submit"
                  disabled={isSearching}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-600 px-6 py-3.5 text-base font-bold text-white shadow-sm transition hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSearching ? "Buscando..." : "Buscar pedido"}
                </button>
              </form>

              {searchError && (
                <div
                  role="alert"
                  className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800"
                >
                  {searchError}
                </div>
              )}
            </div>

            {/* Resultados de la búsqueda */}
            {isSearching ? (
              <div
                role="status"
                aria-label="Buscando pedidos"
                className="space-y-4"
              >
                {[1, 2].map((skeleton) => (
                  <div
                    key={skeleton}
                    className="h-44 animate-pulse rounded-3xl border border-slate-200 bg-white p-6"
                  />
                ))}
              </div>
            ) : hasSearched && searchResults.length === 0 && !searchError ? (
              <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
                <p className="text-lg font-bold text-slate-800">
                  No encontramos pedidos con ese código o contacto
                </p>
                <p className="mt-2 text-sm text-slate-600 sm:text-base">
                  Verificá que el código de 8 caracteres o el nombre estén bien
                  escritos, o realizá una nueva solicitud si aún no tenés un
                  pedido registrado.
                </p>
              </div>
            ) : (
              searchResults.length > 0 && (
                <div className="space-y-4">
                  <p className="px-1 text-sm font-semibold text-slate-600">
                    Se {searchResults.length === 1 ? "encontró" : "encontraron"}{" "}
                    {searchResults.length}{" "}
                    {searchResults.length === 1 ? "pedido" : "pedidos"}:
                  </p>
                  {searchResults.map((pedido) => {
                    const infoEstado =
                      ESTADOS_INFO[pedido.estado] ?? ESTADOS_INFO.solicitado;
                    return (
                      <article
                        key={pedido.id_servicio}
                        className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7"
                      >
                        <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                              Código #{pedido.codigo_seguimiento}
                            </span>
                            <h3 className="mt-1 text-xl font-bold capitalize text-slate-950">
                              Servicio de {pedido.tipo_servicio}
                            </h3>
                          </div>

                          <span
                            className={`inline-flex w-fit items-center rounded-full px-4 py-1.5 text-sm font-bold ring-1 ring-inset ${infoEstado.badgeClass}`}
                          >
                            {infoEstado.etiqueta}
                          </span>
                        </div>

                        <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                          <div>
                            <dt className="font-medium text-slate-500">
                              Contacto
                            </dt>
                            <dd className="mt-0.5 font-semibold text-slate-900">
                              {pedido.nombre_contacto}
                            </dd>
                          </div>
                          <div>
                            <dt className="font-medium text-slate-500">Barrio</dt>
                            <dd className="mt-0.5 font-semibold text-slate-900">
                              {pedido.zona}
                            </dd>
                          </div>
                          <div>
                            <dt className="font-medium text-slate-500">
                              Fecha y hora
                            </dt>
                            <dd className="mt-0.5 font-semibold text-slate-900">
                              {formatearFechaHora(pedido.fecha_hora)}
                            </dd>
                          </div>
                          {pedido.preferencias && (
                            <div className="sm:col-span-3">
                              <dt className="font-medium text-slate-500">
                                Dirección y notas
                              </dt>
                              <dd className="mt-0.5 text-sm text-slate-700">
                                {pedido.preferencias}
                              </dd>
                            </div>
                          )}
                        </dl>

                        {/* Barra de progreso y explicación del estado */}
                        <div className="mt-5 rounded-2xl bg-slate-50 p-4">
                          <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${infoEstado.barClass}`}
                              style={{ width: `${infoEstado.progreso}%` }}
                            />
                          </div>
                          <p className="mt-3 text-sm leading-relaxed text-slate-700">
                            <strong className="font-bold text-slate-900">
                              ¿Qué significa este estado?
                            </strong>{" "}
                            {infoEstado.explicacion}
                          </p>
                          {pedido.prestador_asignado && (
                            <div className="mt-3.5 flex items-center gap-2.5 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm font-semibold text-cyan-950">
                              <span aria-hidden="true">👤</span>
                              <span>
                                Profesional asignado:{" "}
                                <strong>{pedido.prestador_asignado}</strong>
                              </span>
                            </div>
                          )}
                          {renderSurveySection(pedido)}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )
            )}
          </section>
        )}
      </main>

      {/* Footer con enlace discreto a /admin */}
      <footer className="border-t border-slate-200 bg-white py-6 text-slate-500">
        <div className="mx-auto flex max-w-4xl flex-col items-center justify-between gap-3 px-4 text-xs sm:flex-row sm:px-6">
          <p>© 2026 GoldenCare · Servicios de asistencia no médica</p>
          <Link
            href="/admin"
            className="font-medium text-slate-500 underline-offset-4 transition hover:text-cyan-700 hover:underline"
          >
            Acceso Coordinadores (/admin)
          </Link>
        </div>
      </footer>
    </div>
  );
}
