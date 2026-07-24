// Unidad de Medida FÍSICA — lógica pura (Fase 1 del rediseño UoM/Empaque/Variantes).
// Espejo en el frontend del modelo de la tabla `unidades_medida_fisicas` (mig 303): familias
// con conversión universal fija. Distinto del viejo `unidades.ts` (mapa kg/gr/lt/ml hardcodeado)
// y del catálogo de EMPAQUE (`unidades_medida`, Caja/Pallet — factor por producto, otra cosa).
//
// La conversión entre dos unidades de la MISMA familia es exacta y universal:
//   cantidad × (factor_base_familia[desde] / factor_base_familia[hacia])
// (1 kg = 1000 g siempre, para cualquier producto/tenant). Entre familias distintas: no hay.

export type FamiliaFisica = 'peso' | 'volumen' | 'longitud' | 'conteo'

export interface UnidadFisica {
  id: string
  familia: FamiliaFisica
  nombre: string
  simbolo: string | null
  factor_base_familia: number
  es_base_familia: boolean
  permite_decimales: boolean
}

/** Solo la familia Conteo es entera; peso/volumen/longitud admiten decimales. */
export function familiaPermiteDecimales(familia: FamiliaFisica): boolean {
  return familia !== 'conteo'
}

/** ¿Esta unidad admite cantidades decimales? Deriva de la familia (no confía en el flag guardado). */
export function unidadPermiteDecimales(u: Pick<UnidadFisica, 'familia'> | null | undefined): boolean {
  return !!u && familiaPermiteDecimales(u.familia)
}

/**
 * Convierte `cantidad` de la unidad `desde` a la unidad `hacia`.
 * - Misma unidad → misma cantidad.
 * - Distinta familia → null (no hay conversión universal entre peso y volumen, etc.).
 * - Misma familia → cantidad × factor(desde)/factor(hacia), redondeado a 10 cifras significativas
 *   para matar el ruido de punto flotante (ej. 0.1+0.2).
 */
export function convertirFisica(
  cantidad: number,
  desde: Pick<UnidadFisica, 'familia' | 'factor_base_familia'>,
  hacia: Pick<UnidadFisica, 'familia' | 'factor_base_familia'>,
): number | null {
  if (desde.familia !== hacia.familia) return null
  if (!(desde.factor_base_familia > 0) || !(hacia.factor_base_familia > 0)) return null
  const r = cantidad * (desde.factor_base_familia / hacia.factor_base_familia)
  return parseFloat(r.toPrecision(10))
}

/** Unidades de una familia dada, ordenadas por factor ascendente (más chica primero). */
export function unidadesDeFamilia(unidades: UnidadFisica[], familia: FamiliaFisica): UnidadFisica[] {
  return unidades.filter(u => u.familia === familia).sort((a, b) => a.factor_base_familia - b.factor_base_familia)
}

/** La unidad base atómica de una familia (factor 1). */
export function unidadBaseDeFamilia(unidades: UnidadFisica[], familia: FamiliaFisica): UnidadFisica | null {
  return unidades.find(u => u.familia === familia && u.es_base_familia) ?? null
}

/** Agrupa las unidades por familia, para armar selects con optgroups. */
export function agruparPorFamilia(unidades: UnidadFisica[]): Record<FamiliaFisica, UnidadFisica[]> {
  const out: Record<FamiliaFisica, UnidadFisica[]> = { conteo: [], peso: [], volumen: [], longitud: [] }
  for (const u of unidades) out[u.familia].push(u)
  for (const f of Object.keys(out) as FamiliaFisica[]) out[f].sort((a, b) => a.factor_base_familia - b.factor_base_familia)
  return out
}

export const ETIQUETA_FAMILIA: Record<FamiliaFisica, string> = {
  conteo: 'Conteo',
  peso: 'Peso',
  volumen: 'Volumen',
  longitud: 'Longitud',
}

/**
 * Mapea un texto legacy de `productos.unidad_medida` a una unidad física del catálogo, best-effort.
 * Espejo exacto del backfill SQL de la mig 303 — para que el frontend preseleccione lo mismo que la
 * migración cargó. Devuelve null si no matchea (caja/pack/docena/custom = empaque, no unidad física).
 */
export function mapearLegacyAFisica(texto: string | null | undefined, unidades: UnidadFisica[]): UnidadFisica | null {
  if (!texto) return null
  const t = texto.trim().toLowerCase()
  const alias: Record<string, string> = {
    gr: 'Gramo', lt: 'Litro', l: 'Litro', mt: 'Metro', unid: 'Unidad', un: 'Unidad',
  }
  const porAlias = alias[t]
  if (porAlias) {
    const m = unidades.find(u => u.nombre === porAlias)
    if (m) return m
  }
  return unidades.find(u => u.nombre.toLowerCase() === t || (u.simbolo ?? '').toLowerCase() === t) ?? null
}
