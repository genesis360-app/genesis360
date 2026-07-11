// Lógica pura del Libro IVA Ventas / débito fiscal NETO (REGLA #0 fiscal).
//
// El débito fiscal de un período NO es solo el IVA de las facturas con CAE: las Notas de
// Crédito electrónicas emitidas (devoluciones con `nc_cae`) lo RESTAN. Hasta v1.125 el
// Libro IVA Ventas, los KPIs de Facturación, la liquidación 12 meses y la Posición IVA del
// Dashboard ignoraban las NC → débito sobre-declarado tras cualquier devolución facturada.
//
// La NC se imputa al período de su EMISIÓN (`devoluciones.nc_fecha`, mig 266), no al de la
// devolución (`created_at`). Los importes se calculan con la MISMA lógica del comprobante
// (espejo de la EF `emitir-factura`): ítems de la devolución a precio_unitario × cantidad,
// alícuota del producto; NC-C no discrimina IVA (resta neto pero no débito).
//
// ⚠ Mantener sincronizado con: supabase/functions/emitir-factura/index.ts (mapeo de ítems
//   de la devolución) y src/lib/facturacionLogic.ts (calcularImportes / calcularIvaDesglose).

import {
  calcularImportes,
  calcularIvaDesglose,
  esComprobanteSinIVA,
  type ItemFacturable,
} from './facturacionLogic'

const r2 = (n: number): number => parseFloat(n.toFixed(2))

/** Una NC electrónica emitida, ya normalizada para el libro. */
export interface NcEmitida {
  id: string
  /** 'NC-C' | 'NC-B' | 'NC-A' (como lo persiste la EF en devoluciones.nc_tipo). */
  nc_tipo: string | null
  nc_numero_comprobante: number | null
  nc_cae: string | null
  /** Fecha de emisión (nc_fecha; fallback created_at para NC previas a mig 266). ISO date. */
  fecha: string
  cliente: string | null
  items: ItemFacturable[]
}

/** Fila del Libro IVA Ventas correspondiente a una NC (montos NEGATIVOS). */
export interface FilaLibroNc {
  fecha: string
  /** Ej: "NC-C #12" */
  comprobante: string
  cliente: string | null
  /** Neto de la NC, en negativo. Para NC-C es el total (no discrimina IVA). */
  neto: number
  /** '21' | '10.5' | '27' | '0' | 'exento' | '—' (NC-C no discrimina). */
  alicuota: string
  /** IVA de la NC, en negativo (0 para NC-C). */
  iva: number
}

// Normaliza la alícuota como llega del numeric de Postgres ("21.00"/"10.50") a la clave
// canónica ("21"/"10.5"). Espejo de la normalización de emitir-factura (REGLA #0 #5).
function normalizarAlicuota(a: unknown): string {
  const s = String(a ?? '21')
  if (s === 'exento' || s === 'sin_iva') return s
  const n = parseFloat(s)
  return Number.isFinite(n) ? String(n) : '21'
}

// Las relaciones embebidas de supabase-js pueden venir tipadas/serializadas como objeto O
// como array de un elemento según el esquema inferido — normalizar a objeto.
function uno<T>(v: T | T[] | null | undefined): T | null {
  return (Array.isArray(v) ? v[0] : v) ?? null
}

/**
 * Mapea una fila cruda de `devoluciones` (con `devolucion_items(… productos(alicuota_iva))`
 * y `ventas(clientes(nombre))` embebidos) a una NcEmitida. Mismo mapeo de ítems que hace la
 * EF al emitir la NC: subtotal = precio_unitario × cantidad, alícuota del producto.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapDevolucionNc(d: any): NcEmitida {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const venta = uno<any>(d.ventas)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cliente = uno<any>(venta?.clientes)
  return {
    id: String(d.id),
    nc_tipo: d.nc_tipo ?? null,
    nc_numero_comprobante: d.nc_numero_comprobante ?? null,
    nc_cae: d.nc_cae ?? null,
    fecha: String(d.nc_fecha ?? d.created_at ?? '').split('T')[0],
    cliente: cliente?.nombre ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    items: ((d.devolucion_items ?? []) as any[]).map((di) => ({
      cantidad: Number(di.cantidad),
      precio_unitario: Number(di.precio_unitario),
      subtotal: r2(Number(di.precio_unitario) * Number(di.cantidad)),
      alicuota_iva: uno<any>(di.productos)?.alicuota_iva ?? '21',
    })),
  }
}

/**
 * Filas del Libro IVA Ventas para una NC, con montos en NEGATIVO.
 *  - NC-C: una sola fila (total a neto, IVA 0, alícuota '—').
 *  - NC-A/B: una fila por alícuota (desglose idéntico al del comprobante emitido).
 */
export function filasLibroNc(nc: NcEmitida): FilaLibroNc[] {
  const tipo = nc.nc_tipo ?? 'NC-C'
  const base = {
    fecha: nc.fecha,
    comprobante: `${tipo} #${nc.nc_numero_comprobante ?? '—'}`,
    cliente: nc.cliente,
  }
  if (esComprobanteSinIVA(tipo)) {
    const { impTotal } = calcularImportes(nc.items, tipo)
    return [{ ...base, neto: -impTotal, alicuota: '—', iva: 0 }]
  }
  const grupos = new Map<string, ItemFacturable[]>()
  for (const it of nc.items) {
    const k = normalizarAlicuota(it.alicuota_iva)
    const arr = grupos.get(k)
    if (arr) arr.push(it)
    else grupos.set(k, [it])
  }
  return [...grupos.entries()].map(([alicuota, items]) => {
    const d = calcularIvaDesglose(items)
    return { ...base, alicuota, neto: -d.totalNeto, iva: -d.totalIVA }
  })
}

/** IVA total (positivo) que las NC restan del débito del período. NC-C aporta 0. */
export function ivaNcTotal(ncs: NcEmitida[]): number {
  return r2(ncs.reduce((s, nc) => s + calcularImportes(nc.items, nc.nc_tipo ?? 'NC-C').impIVA, 0))
}

/** Neto total (positivo) que las NC restan del neto facturado del período. */
export function netoNcTotal(ncs: NcEmitida[]): number {
  return r2(ncs.reduce((s, nc) => s + calcularImportes(nc.items, nc.nc_tipo ?? 'NC-C').impNeto, 0))
}

/**
 * Débito fiscal NETO del período: IVA de facturas con CAE − IVA de NC emitidas.
 * (Puede dar negativo si el período solo tuvo NC — es correcto: baja la posición.)
 */
export function debitoNeto(ivaFacturas: number, ncs: NcEmitida[]): number {
  return r2(ivaFacturas - ivaNcTotal(ncs))
}
