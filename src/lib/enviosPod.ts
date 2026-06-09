// ── EN2 — POD robusto + cierre de entrega ────────────────────────────────────
// Lógica pura (testeable) para la prueba de entrega del módulo Envíos.
//   D1 campos requeridos configurables · D3 firma+DNI+OTP sobre umbral (propio)
//   D4 geoloc con fallback graceful · D5 sub-estados no-entrega · D6 reintento.

export interface PodRequeridos {
  fecha?: boolean
  receptor?: boolean
  foto?: boolean
  firma?: boolean
  dni?: boolean
}

export interface PodValores {
  fecha?: string | null
  receptor?: string | null
  firma_url?: string | null
  dni?: string | null
  fotos?: number   // cantidad de fotos cargadas
}

export const POD_CAMPOS: Array<{ k: keyof PodRequeridos; label: string }> = [
  { k: 'fecha',    label: 'Fecha de entrega' },
  { k: 'receptor', label: 'Nombre del receptor' },
  { k: 'foto',     label: 'Foto del paquete' },
  { k: 'firma',    label: 'Firma del receptor' },
  { k: 'dni',      label: 'DNI del receptor' },
]

export const SUBESTADOS_NO_ENTREGA = [
  { v: 'ausente',              t: 'Cliente ausente' },
  { v: 'rechazado',            t: 'Cliente rechazó el paquete' },
  { v: 'direccion_incorrecta', t: 'Dirección incorrecta' },
] as const

export type SubestadoNoEntrega = typeof SUBESTADOS_NO_ENTREGA[number]['v']

/**
 * D1/D2 — Devuelve la lista de campos requeridos que faltan para poder marcar
 * "entregado". `fotoMin` exige al menos esa cantidad de fotos (D2).
 */
export function podFaltantes(
  valores: PodValores,
  requeridos: PodRequeridos,
  fotoMin = 0,
): string[] {
  const faltan: string[] = []
  if (requeridos.fecha    && !valores.fecha)            faltan.push('Fecha de entrega')
  if (requeridos.receptor && !(valores.receptor ?? '').trim()) faltan.push('Nombre del receptor')
  if (requeridos.dni      && !(valores.dni ?? '').trim())      faltan.push('DNI del receptor')
  if (requeridos.firma    && !valores.firma_url)        faltan.push('Firma del receptor')
  const fotos = valores.fotos ?? 0
  const minFotos = Math.max(requeridos.foto ? 1 : 0, fotoMin)
  if (minFotos > 0 && fotos < minFotos) {
    faltan.push(minFotos === 1 ? 'Al menos 1 foto' : `Al menos ${minFotos} fotos`)
  }
  return faltan
}

/** D3 — ¿este envío requiere OTP del receptor? Solo envío propio, sobre umbral. */
export function requiereOtp(esPropio: boolean, total: number, umbral: number | null | undefined): boolean {
  const u = Number(umbral ?? 0)
  return esPropio && u > 0 && total >= u
}

/**
 * D4 — Estado de la geolocalización al entregar.
 *   null  → no se pudo capturar (permiso/sin señal) = `no_disponible` (NO frena la entrega).
 *   ≤ km  → `ok` · > km → `fuera_rango`. alertaKm 0 = sin control (siempre ok si hay coords).
 */
export function geoEstado(distanciaKm: number | null, alertaKm: number | null | undefined): 'ok' | 'fuera_rango' | 'no_disponible' {
  if (distanciaKm == null) return 'no_disponible'
  const km = Number(alertaKm ?? 0)
  if (km <= 0) return 'ok'
  return distanciaKm <= km ? 'ok' : 'fuera_rango'
}

/**
 * D5/D6 — Resuelve el resultado de un "no entregado":
 *   ausente y quedan intentos → vuelve a `en_camino` (reintento).
 *   rechazado / direccion_incorrecta, o agotó intentos → `devolucion`.
 */
export function resolverNoEntrega(
  intentosActuales: number,
  max: number,
  subestado: SubestadoNoEntrega,
): { nuevoIntentos: number; estado: 'en_camino' | 'devolucion'; reintenta: boolean } {
  const nuevoIntentos = intentosActuales + 1
  const puedeReintentar = subestado === 'ausente' && nuevoIntentos < max
  return {
    nuevoIntentos,
    estado: puedeReintentar ? 'en_camino' : 'devolucion',
    reintenta: puedeReintentar,
  }
}

/** D6 — ¿corresponde recargo por reintento? (cuando se superó N intentos y hay recargo configurado). */
export function recargoReintento(intentos: number, max: number, recargo: number | null | undefined): number {
  const r = Number(recargo ?? 0)
  return intentos >= max && r > 0 ? r : 0
}

/** Haversine en km (para la distancia geoloc del POD vs destino). */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 100) / 100
}

/** Genera un código OTP de 6 dígitos (rnd inyectable para tests). */
export function generarCodigoOtp(rnd: () => number = Math.random): string {
  return String(Math.floor(rnd() * 1_000_000)).padStart(6, '0')
}
