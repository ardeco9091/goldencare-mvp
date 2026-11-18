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

