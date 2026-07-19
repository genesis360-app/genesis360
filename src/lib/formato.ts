// Helpers de formateo de moneda (v1.8.44)
// Etiqueta visual: cambia símbolo + locale según `tenants.moneda`. No hace conversiones.

export type Moneda = 'ARS' | 'USD' | 'CLP' | 'UYU' | 'PYG' | 'BOB' | 'BRL' | 'PEN' | 'MXN' | 'COP' | 'EUR'

const SIMBOLOS: Record<string, string> = {
  ARS: '$',
  USD: 'US$',
  CLP: 'CL$',
  UYU: '$U',
  PYG: '₲',
  BOB: 'Bs.',
  BRL: 'R$',
  PEN: 'S/',
  MXN: 'MX$',
  COP: 'COL$',
  EUR: '€',
}

const LOCALES: Record<string, string> = {
  ARS: 'es-AR',
  USD: 'en-US',
  CLP: 'es-CL',
  UYU: 'es-UY',
  PYG: 'es-PY',
  BOB: 'es-BO',
  BRL: 'pt-BR',
  PEN: 'es-PE',
  MXN: 'es-MX',
  COP: 'es-CO',
  EUR: 'es-ES',
}

export const MONEDAS_DISPONIBLES: { code: Moneda; nombre: string; simbolo: string }[] = [
  { code: 'ARS', nombre: 'Peso argentino',         simbolo: '$' },
  { code: 'USD', nombre: 'Dólar estadounidense',   simbolo: 'US$' },
  { code: 'CLP', nombre: 'Peso chileno',           simbolo: 'CL$' },
  { code: 'UYU', nombre: 'Peso uruguayo',          simbolo: '$U' },
  { code: 'PYG', nombre: 'Guaraní paraguayo',      simbolo: '₲' },
  { code: 'BOB', nombre: 'Boliviano',              simbolo: 'Bs.' },
  { code: 'BRL', nombre: 'Real brasileño',         simbolo: 'R$' },
  { code: 'PEN', nombre: 'Sol peruano',            simbolo: 'S/' },
  { code: 'MXN', nombre: 'Peso mexicano',          simbolo: 'MX$' },
  { code: 'COP', nombre: 'Peso colombiano',        simbolo: 'COL$' },
  { code: 'EUR', nombre: 'Euro',                   simbolo: '€' },
]

export function simboloMoneda(moneda?: string | null): string {
  return SIMBOLOS[moneda ?? 'ARS'] ?? '$'
}

export function localeMoneda(moneda?: string | null): string {
  return LOCALES[moneda ?? 'ARS'] ?? 'es-AR'
}

export interface FormatMonedaOpts {
  decimals?: number
  showSymbol?: boolean
}

export function formatMoneda(
  monto: number | string | null | undefined,
  moneda?: string | null,
  opts: FormatMonedaOpts = {},
): string {
  const n = typeof monto === 'number' ? monto : parseFloat(String(monto ?? 0))
  const safe = isNaN(n) ? 0 : n
  const decimals = opts.decimals ?? 0
  const showSymbol = opts.showSymbol ?? true
  const formatted = safe.toLocaleString(localeMoneda(moneda), { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  return showSymbol ? `${simboloMoneda(moneda)}${formatted}` : formatted
}

// ── Helpers centrales de formato numérico (backlog Fede/GO punto 6, 2026-07-19) ──────────
// Punto único para los TRES formatos que usa la app: plata ($, sin decimales, es-AR),
// enteros (separador de miles) y porcentajes. El código existente tiene ~340 llamados
// sueltos a toLocaleString('es-AR', …) — el código NUEVO debe usar estos helpers, y el
// viejo se migra de forma oportunista al tocar cada archivo (no en una pasada masiva).

/** Plata en pesos, sin decimales: 12345.6 → "$12.346". Para montos con centavos usar formatMoneda con decimals:2. */
export function fmtPesos(n: number | string | null | undefined): string {
  const v = typeof n === 'number' ? n : parseFloat(String(n ?? 0))
  return `$${(isNaN(v) ? 0 : v).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

/** Entero con separador de miles: 12345 → "12.345". */
export function fmtEntero(n: number | string | null | undefined): string {
  const v = typeof n === 'number' ? n : parseFloat(String(n ?? 0))
  return (isNaN(v) ? 0 : Math.round(v)).toLocaleString('es-AR')
}

/** Porcentaje: 10 → "10%" · 10.5 → "10,5%" (hasta 2 decimales, sin ceros de relleno). */
export function fmtPct(n: number | string | null | undefined): string {
  const v = typeof n === 'number' ? n : parseFloat(String(n ?? 0))
  return `${(isNaN(v) ? 0 : v).toLocaleString('es-AR', { maximumFractionDigits: 2 })}%`
}
