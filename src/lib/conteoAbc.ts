// Lógica pura de Conteos 2.0 · F4 — clase ABC, conteo cíclico sugerido y reporte
// de exactitud/valorización. Sin I/O (espejo de lo que ejecuta InventarioPage).

import { EPS_CONTEO } from './conteoAjuste'

// ── Clase ABC (Pareto) ──────────────────────────────────────────────────────

export type ClaseABC = 'A' | 'B' | 'C'

export interface ItemValor {
  id: string
  /** Valor de movimiento del producto (Σ cantidad vendida × costo histórico). */
  valor: number
}

/** Umbrales de Pareto acumulado: A = primeros 80% del valor, B = hasta 95%, C = resto. */
export const PARETO_A = 0.80
export const PARETO_B = 0.95

/**
 * Clasifica productos en A/B/C por valor de movimiento (Pareto 80/95).
 * - Se ordena por valor descendente; el % acumulado define la clase.
 * - Productos sin movimiento (valor <= 0) → C.
 * - Si el valor total es 0 (nadie movió) → todos C.
 * Devuelve el mapa id → clase para TODOS los items recibidos.
 */
export function clasificarABC(items: ItemValor[]): Map<string, ClaseABC> {
  const out = new Map<string, ClaseABC>()
  const total = items.reduce((s, i) => s + Math.max(0, i.valor), 0)
  if (total <= 0) {
    for (const i of items) out.set(i.id, 'C')
    return out
  }
  // Orden estable: por valor desc, desempata por id para determinismo.
  const orden = [...items].sort((a, b) => b.valor - a.valor || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  let acum = 0
  for (const i of orden) {
    const v = Math.max(0, i.valor)
    if (v <= 0) { out.set(i.id, 'C'); continue }
    acum += v
    const ratio = acum / total
    out.set(i.id, ratio <= PARETO_A ? 'A' : ratio <= PARETO_B ? 'B' : 'C')
  }
  return out
}

// ── Conteo cíclico sugerido ─────────────────────────────────────────────────

export interface CicloConfig {
  diasA: number
  diasB: number
  diasC: number
}

export interface ProductoCiclo {
  id: string
  nombre?: string
  sku?: string
  clase_abc: ClaseABC | null
  /** Última fecha de conteo (ISO) o null si nunca se contó. */
  ultimo_conteo_at: string | null
}

export interface SugerenciaCiclo {
  id: string
  nombre?: string
  sku?: string
  clase: ClaseABC
  /** Días desde el último conteo (null si nunca se contó). */
  diasDesde: number | null
  /** Cada cuántos días debería recontarse según su clase. */
  cadaDias: number
  /** Días de atraso respecto al ciclo (>0 = vencido; nunca contado = Infinity). */
  atraso: number
}

const diasDeClase = (clase: ClaseABC, cfg: CicloConfig): number =>
  clase === 'A' ? cfg.diasA : clase === 'B' ? cfg.diasB : cfg.diasC

/**
 * Sugiere qué productos conviene contar hoy según su clase ABC y la última fecha de conteo.
 * Sin clase → se trata como 'C' (lo menos frecuente). Nunca contado → atraso máximo (Infinity).
 * Devuelve SOLO los vencidos (atraso > 0), ordenados por mayor atraso primero.
 */
export function sugerirConteoCiclico(productos: ProductoCiclo[], cfg: CicloConfig, hoy: Date): SugerenciaCiclo[] {
  const hoyMs = hoy.getTime()
  const res: SugerenciaCiclo[] = []
  for (const p of productos) {
    const clase: ClaseABC = p.clase_abc ?? 'C'
    const cadaDias = diasDeClase(clase, cfg)
    let diasDesde: number | null = null
    let atraso: number
    if (!p.ultimo_conteo_at) {
      atraso = Infinity  // nunca contado → máxima prioridad
    } else {
      const t = new Date(p.ultimo_conteo_at).getTime()
      diasDesde = Math.floor((hoyMs - t) / 86_400_000)
      atraso = diasDesde - cadaDias
    }
    if (atraso > 0) {
      res.push({ id: p.id, nombre: p.nombre, sku: p.sku, clase, diasDesde, cadaDias, atraso })
    }
  }
  // Mayor atraso primero (Infinity = nunca contado arriba); desempata por clase A>B>C.
  const ordClase = (c: ClaseABC) => (c === 'A' ? 0 : c === 'B' ? 1 : 2)
  return res.sort((a, b) => b.atraso - a.atraso || ordClase(a.clase) - ordClase(b.clase))
}

// ── Reporte de exactitud + valorización ─────────────────────────────────────

export interface ItemConteoReporte {
  cantidad_esperada: number
  /** null = no contada (se omite); número = contada. */
  cantidad_contada: number | null
  /** Costo unitario para valorizar la diferencia. */
  costo: number
}

export interface ReporteExactitud {
  /** Líneas efectivamente contadas (cantidad_contada != null). */
  lineasContadas: number
  /** Líneas contadas que coinciden con lo esperado (|diff| < EPS). */
  lineasExactas: number
  /** Líneas contadas con diferencia. */
  lineasConDiff: number
  /** Líneas no contadas (null) — informativo, no entran en la exactitud. */
  lineasSinContar: number
  /** % de exactitud = lineasExactas / lineasContadas × 100 (0 si no hay contadas). */
  exactitudPct: number
  /** Valor $ del sobrante (Σ diff>0 × costo). */
  valorSobrante: number
  /** Valor $ del faltante (Σ |diff<0| × costo), positivo. */
  valorFaltante: number
  /** Valor neto = sobrante − faltante (negativo = pérdida neta). */
  valorNeto: number
  /** Unidades netas (Σ diff). */
  unidadesNetas: number
}

/**
 * Calcula exactitud (%) y valorización $ de las diferencias de un conteo.
 * Solo cuenta las líneas contadas (cantidad_contada != null) para la exactitud;
 * las no contadas se informan aparte.
 */
export function reporteExactitud(items: ItemConteoReporte[]): ReporteExactitud {
  let lineasContadas = 0, lineasExactas = 0, lineasConDiff = 0, lineasSinContar = 0
  let valorSobrante = 0, valorFaltante = 0, unidadesNetas = 0
  for (const it of items) {
    if (it.cantidad_contada == null) { lineasSinContar++; continue }
    lineasContadas++
    const diff = it.cantidad_contada - it.cantidad_esperada
    unidadesNetas += diff
    if (Math.abs(diff) < EPS_CONTEO) { lineasExactas++; continue }
    lineasConDiff++
    const valor = Math.abs(diff) * (it.costo || 0)
    if (diff > 0) valorSobrante += valor
    else valorFaltante += valor
  }
  const exactitudPct = lineasContadas > 0 ? (lineasExactas / lineasContadas) * 100 : 0
  return {
    lineasContadas, lineasExactas, lineasConDiff, lineasSinContar,
    exactitudPct, valorSobrante, valorFaltante,
    valorNeto: valorSobrante - valorFaltante, unidadesNetas,
  }
}
