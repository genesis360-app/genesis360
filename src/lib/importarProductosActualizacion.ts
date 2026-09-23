// Qué escribe el importador de productos cuando ACTUALIZA uno que ya existe.
//
// 🛑 El bug que cierra (hallazgo D-3, `tests/specs/uat-modo-basico.md` §66.8): al actualizar, el
// importador reescribía la fila ENTERA —las 26 columnas del payload— poniendo el valor por defecto
// en todo lo que el archivo no trajera. No actualizaba lo pedido: reemplazaba el producto completo.
// Un CSV con tres columnas para corregir precios borraba el proveedor, la descripción, el código de
// barras, la alícuota de IVA y las marcas de trazabilidad. Medido en PROD sobre 27 productos: se
// perdían 19 proveedores, 19 descripciones, 12 códigos de barras y 9 productos con trazabilidad.
//
// La prueba de que no alcanzaba con sumarle columnas al export: `activo` YA estaba en el archivo
// exportado y se pisaba igual, porque el payload lo escribía fijo en `true` — exportar y reimportar
// te reactivaba los productos dados de baja.
//
// La regla, decidida por GO (2026-09-23): **lo que el archivo trae manda; lo que no trae, no se
// toca**. Al CREAR no cambia nada (un producto nuevo necesita sus valores por defecto).

/** Celda con contenido. 🛑 `0` y `false` son VALORES, no vacíos — solo `''`/`null`/`undefined` lo son. */
export function celdaTieneValor(v: unknown): boolean {
  if (v === null || v === undefined) return false
  return String(v).trim() !== ''
}

/** Las columnas del archivo que esta fila trae con algún valor. */
export function columnasConValor(row: Record<string, unknown>): Set<string> {
  const s = new Set<string>()
  for (const k of Object.keys(row ?? {})) if (celdaTieneValor(row[k])) s.add(k)
  return s
}

/**
 * Qué columna del archivo gobierna cada campo del payload.
 *
 * Los precios van en GRUPO: `precio_costo` y `precio_costo_moneda` mandan juntos sobre
 * `precio_costo` + `precio_costo_usd` + `moneda_costo` + `precio_costo_moneda`, porque los cuatro se
 * derivan del mismo par y escribir uno sin los otros deja el producto en un estado incoherente
 * (por ejemplo, el monto en dólares viejo con la moneda nueva).
 */
const GOBIERNA: Record<string, string[]> = {
  nombre:              ['nombre'],
  codigo_barras:       ['codigo_barras'],
  categoria_id:        ['categoria'],
  proveedor_id:        ['proveedor'],

  precio_costo:        ['precio_costo', 'precio_costo_moneda'],
  precio_costo_usd:    ['precio_costo', 'precio_costo_moneda'],
  moneda_costo:        ['precio_costo', 'precio_costo_moneda'],
  precio_costo_moneda: ['precio_costo', 'precio_costo_moneda'],

  precio_venta:        ['precio_venta', 'precio_venta_moneda'],
  precio_usd:          ['precio_venta', 'precio_venta_moneda'],
  moneda_venta:        ['precio_venta', 'precio_venta_moneda'],
  precio_venta_moneda: ['precio_venta', 'precio_venta_moneda'],

  stock_minimo:        ['stock_minimo'],
  unidad_medida:       ['unidad_medida'],
  descripcion:         ['descripcion'],
  notas:               ['notas'],
  activo:              ['activo'],
  alicuota_iva:        ['alicuota_iva'],
  margen_objetivo:     ['margen_objetivo'],
  tiene_series:        ['tiene_series'],
  tiene_lote:          ['tiene_lote'],
  tiene_vencimiento:   ['tiene_vencimiento'],
  regla_inventario:    ['regla_inventario'],
  es_kit:              ['es_kit'],
}

/** Nunca se tocan al actualizar: `sku` es la clave por la que se encuentra el producto. */
const NUNCA_AL_ACTUALIZAR = new Set(['tenant_id', 'sku'])

/**
 * Recorta el payload completo dejando SOLO los campos que el archivo trae.
 *
 * Devolver `{}` es un resultado válido y significa "esta fila no cambia nada": quien llama no debería
 * mandar ese UPDATE.
 */
export function payloadParaActualizar<T extends Record<string, unknown>>(
  payloadCompleto: T,
  columnas: Set<string>,
): Partial<T> {
  const out: Record<string, unknown> = {}
  for (const campo of Object.keys(payloadCompleto)) {
    if (NUNCA_AL_ACTUALIZAR.has(campo)) continue
    const fuentes = GOBIERNA[campo]
    // Un campo sin mapeo no se escribe nunca al actualizar: es más seguro olvidarse de actualizar
    // algo que pisarlo sin que nadie lo haya pedido. Si mañana se agrega una columna al importador,
    // hay que sumarla a GOBIERNA — y mientras tanto no rompe nada.
    if (!fuentes) continue
    if (fuentes.some((c) => columnas.has(c))) out[campo] = payloadCompleto[campo]
  }
  return out as Partial<T>
}

/**
 * ¿Actualizar el precio de este producto es ambiguo?
 *
 * 🛑 REGLA #0. Si el producto está hoy en dólares y el archivo trae el precio SIN la columna de
 * moneda, el número es ambiguo: no se sabe si son 100 pesos o 100 dólares. Asumir pesos lo
 * convertiría en silencio a ~1/1400 de su valor; asumir dólares sería inventar. Se rechaza la fila.
 */
export function precioAmbiguo(
  columnas: Set<string>,
  monedaActual: string | null | undefined,
  cual: 'venta' | 'costo',
): boolean {
  const colPrecio = cual === 'venta' ? 'precio_venta' : 'precio_costo'
  const colMoneda = cual === 'venta' ? 'precio_venta_moneda' : 'precio_costo_moneda'
  return monedaActual === 'usd' && columnas.has(colPrecio) && !columnas.has(colMoneda)
}
