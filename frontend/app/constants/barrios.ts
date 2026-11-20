export const BARRIOS_SAN_PEDRO = [
  "Centro / Microcentro",
  "Barrio Belgrano",
  "Barrio Patricios",
  "Barrio San Martín",
  "Barrio Providencia",
  "Barrio Ejército del Norte",
  "Barrio Güemes / Bernacchi",
  "Barrio 23 de Agosto / La Merced",
  "La Esperanza",
  "Otro barrio de San Pedro",
] as const;

export type BarrioSanPedro = (typeof BARRIOS_SAN_PEDRO)[number];

/**
 * Concatena de forma clara la dirección o referencia exacta con las notas/preferencias
 * sin requerir cambios en el esquema de tablas de SQLite.
 */
export function combinarDireccionYPreferencias(
  direccion: string,
  preferencias: string,
): string | null {
  const dirLimpia = direccion.trim();
  const prefLimpia = preferencias.trim();

  if (dirLimpia && prefLimpia) {
    return `Dirección: ${dirLimpia} · ${prefLimpia}`;
  }
  if (dirLimpia) {
    return `Dirección: ${dirLimpia}`;
  }
  if (prefLimpia) {
    return prefLimpia;
  }
  return null;
}

/**
 * Devuelve la ruta base del proxy de Next.js (/api) que redirige hacia FastAPI (127.0.0.1:8000)
 * tanto en localhost:3000 como desde dispositivos móviles o túneles externos.
 */
export function getApiBaseUrl(): string {
  return "/api";
}

export const TARIFAS_SERVICIO = {
  traslado: 6500,
  acompañamiento: 5000,
  mandado: 4000,
} as const;

export const COMISION_PLATAFORMA_PCT = 0.15;

export function obtenerTarifaServicio(tipo: string): {
  montoTotal: number;
  comision: number;
  pagoPrestador: number;
} {
  const clave = tipo.trim().toLowerCase();
  let montoTotal = 5000;
  if (clave === "traslado") {
    montoTotal = TARIFAS_SERVICIO.traslado;
  } else if (clave === "acompañamiento" || clave === "acompanamiento") {
    montoTotal = TARIFAS_SERVICIO.acompañamiento;
  } else if (clave === "mandado" || clave === "mandados") {
    montoTotal = TARIFAS_SERVICIO.mandado;
  }
  const comision = Math.round(montoTotal * COMISION_PLATAFORMA_PCT);
  const pagoPrestador = montoTotal - comision;
  return { montoTotal, comision, pagoPrestador };
}

export function formatearMonedaARS(monto: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(monto) ? monto : 0);
}

export function parsearPrestador(rolCompleto?: string | null): {
  nombre: string;
  especialidad: string;
  iniciales: string;
} {
  const limpio = (rolCompleto ?? "").trim();
  if (!limpio) {
    return {
      nombre: "Prestador GoldenCare",
      especialidad: "Asistencia domiciliaria",
      iniciales: "GC",
    };
  }
  const partes = limpio.split(/\s*[-–—·]\s*/);
  const nombre = partes[0]?.trim() || limpio;
  const especialidad = partes.slice(1).join(" · ").trim() || "Asistencia GoldenCare";
  const palabras = nombre.split(/\s+/).filter(Boolean);
  const iniciales =
    palabras.length >= 2
      ? `${palabras[0][0]}${palabras[1][0]}`.toUpperCase()
      : nombre.slice(0, 2).toUpperCase();
  return { nombre, especialidad, iniciales };
}

