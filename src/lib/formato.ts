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
