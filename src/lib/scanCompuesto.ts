import { supabase } from './supabase'
import { parseGS1, looksLikeGS1, normalizeGtin, type GS1Fields } from './gs1'

export interface ScanCompuestoResult {
  fields: GS1Fields
  /** Producto matcheado por GTIN (dedicado) o codigo_barras (fallback). null si no matcheó. */
  producto: any | null
  /** Modo de lectura del perfil aplicable (proveedor del producto → perfil único → 'autocompletar'). */
  lecturaModo: 'autocompletar' | 'directo'
}

/**
 * Resuelve un scan que podría ser un código compuesto GS1. Devuelve null si el
 * código NO parece GS1 (el caller debe caer a la búsqueda plana por barcode/SKU).
 * Si es GS1 pero el GTIN no matchea ningún producto, devuelve `producto: null`.
 */
export async function resolverScanCompuesto(code: string, tenantId: string): Promise<ScanCompuestoResult | null> {
  if (!looksLikeGS1(code)) return null
  const fields = parseGS1(code)
  // Si no hay nada útil (ni GTIN ni lote ni cantidad), tratar como plano.
  if (!fields.gtin && fields.cantidad == null && !fields.lote && !fields.serie) return null

  // Match del producto por GTIN dedicado o codigo_barras (varias normalizaciones).
  let producto: any = null
  if (fields.gtin) {
    const raw = fields.gtin.replace(/\D/g, '')
    const g14 = raw.padStart(14, '0')
    const g13 = g14.replace(/^0/, '')
    const gN = normalizeGtin(fields.gtin)
    const cands = Array.from(new Set([raw, g14, g13, gN].filter(Boolean)))
    const ors = cands.flatMap(c => [`gtin.eq.${c}`, `codigo_barras.eq.${c}`]).join(',')
    const { data } = await supabase.from('productos')
      .select('id, nombre, sku, stock_actual, unidad_medida, imagen_url, tiene_series, tiene_lote, tiene_vencimiento, ubicacion_id, estado_id, proveedor_id, precio_costo, precio_venta')
      .eq('tenant_id', tenantId).eq('activo', true).or(ors).limit(1)
    producto = data?.[0] ?? null
  }

  // Modo de lectura: perfil ligado al proveedor del producto → perfil único → default.
  let lecturaModo: 'autocompletar' | 'directo' = 'autocompletar'
  const { data: perfiles } = await supabase.from('codigo_perfiles')
    .select('proveedor_id, lectura_modo').eq('tenant_id', tenantId).eq('activo', true)
  if (perfiles && perfiles.length) {
    const byProv = producto?.proveedor_id ? perfiles.find((p: any) => p.proveedor_id === producto.proveedor_id) : null
    lecturaModo = (byProv?.lectura_modo ?? (perfiles.length === 1 ? perfiles[0].lectura_modo : 'autocompletar')) as 'autocompletar' | 'directo'
  }

  return { fields, producto, lecturaModo }
}
