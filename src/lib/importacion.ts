// Reglas compartidas por los importadores (decisiones D3-a / D3-b de Fede y GO, 2026-09-30 y 2026-10-01).
//
// - Dos pasos: vista previa completa con el motivo de cada error → botón aparte para cargar.
// - Todo o nada: con una sola fila con error no se carga nada; se corrige el ARCHIVO y se vuelve a subir (GO, D3-a).
// - Las categorías/proveedores no se crean desde el importador; uno desactivado se rechaza con motivo.

export const MAX_FILAS_IMPORTACION = 5000

/** Número de fila como lo ve la persona en Excel: la 1 es el encabezado. */
export const filaExcel = (idx: number) => idx + 2

export interface ItemMaestro { id: string; nombre: string; activo?: boolean | null }

/**
 * Busca una categoría/proveedor por nombre (sin distinguir mayúsculas ni espacios de más).
 * Devuelve el id o el motivo del rechazo. `activo` NULL cuenta como activo.
 */
export function resolverReferencia(
  nombre: string | null | undefined,
  maestro: ItemMaestro[],
  tipo: 'Categoría' | 'Proveedor',
): { id: string | null; error?: string } {
  const buscado = String(nombre ?? '').trim()
  if (!buscado) return { id: null }
  const clave = buscado.toLowerCase().replace(/\s+/g, ' ')
  const encontrados = maestro.filter((m) => m.nombre.trim().toLowerCase().replace(/\s+/g, ' ') === clave)
  const activo = encontrados.find((m) => m.activo !== false)
  if (activo) return { id: activo.id }
  if (encontrados.length > 0) {
    return { id: null, error: `${tipo} "${buscado}" está desactivada: reactivala o elegí otra` }
  }
  const donde = tipo === 'Categoría' ? 'creala primero en Configuración' : 'crealo primero en Proveedores'
  return { id: null, error: `${tipo} "${buscado}" no existe — ${donde}` }
}

/** SKU que aparecen más de una vez en el archivo → filas (de Excel) donde aparecen. */
export function skusRepetidos(skus: string[]): Map<string, number[]> {
  const donde = new Map<string, number[]>()
  skus.forEach((s, idx) => {
    const k = s.trim().toUpperCase()
    if (!k) return
    donde.set(k, [...(donde.get(k) ?? []), filaExcel(idx)])
  })
  for (const [k, filas] of donde) if (filas.length < 2) donde.delete(k)
  return donde
}

/**
 * SKU automáticos para las filas que no traen: `AUTO-0001`, `AUTO-0002`… saltando los que ya existen en el negocio
 * o en el mismo archivo (antes se numeraba siempre desde 1 y la segunda importación chocaba con la primera).
 */
export function generarSkusAutomaticos(cantidad: number, ocupados: Iterable<string>): string[] {
  const usados = new Set([...ocupados].map((s) => s.toUpperCase()))
  const out: string[] = []
  let n = 1
  while (out.length < cantidad) {
    const sku = `AUTO-${String(n).padStart(4, '0')}`
    if (!usados.has(sku)) { out.push(sku); usados.add(sku) }
    n++
  }
  return out
}

/** Filas originales del archivo con error + columna `motivo`, para bajarlas, corregirlas y volver a subir. */
export function filasConErrorParaExportar(
  originales: Record<string, unknown>[],
  errores: { idx: number; errores: string[] }[],
): Record<string, unknown>[] {
  return errores
    .filter((e) => e.errores.length > 0)
    .map((e) => ({ fila: filaExcel(e.idx), motivo: e.errores.join(' · '), ...originales[e.idx] }))
}

/**
 * Traduce el error de la carga (función de la base) a un mensaje para la persona. La base ya dice qué fila falló.
 */
export function mensajeErrorCarga(err: { message?: string; code?: string } | null | undefined): string {
  const msg = err?.message ?? 'Error desconocido'
  if (err?.code === '57014' || /statement timeout|canceling statement/i.test(msg)) {
    return 'La carga tardó demasiado y se canceló. No se cargó nada: dividí el archivo en partes más chicas.'
  }
  if (/Failed to fetch|NetworkError|network/i.test(msg)) {
    return 'Se cortó la conexión. Revisá si los productos se cargaron antes de reintentar: la carga es todo o nada, ' +
      'así que o están todos o no está ninguno.'
  }
  return `No se cargó nada. ${msg}`
}
