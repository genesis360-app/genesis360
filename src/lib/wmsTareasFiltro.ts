// Filtro por "píldoras" de Picking → Tareas (antes Pedidos → Tareas WMS) (pedido de GO 2026-10-08: "filtrar por pedido,
// por envío, por nro de venta, por producto, etc."). Mismo núcleo que /pedidos, /picking e /inventario.
//
// Pedido, Envío y Venta son identificadores: "Pedido:2" es EXACTO (igual que en pedidosFiltro.ts), no
// "contiene 2". Para texto (producto, SKU, LPN, ubicación, cliente, operario) `:` es "contiene".

import {
  type CampoDef, type Pildora, type Combinador,
  parsearPildora as parsearPildoraCore,
  coincideValor,
  evaluarPildoras as evaluarPildorasCore,
} from './pildorasFiltro'

export type CampoTareaWms = 'pedido' | 'envio' | 'venta' | 'producto' | 'sku' | 'lpn' | 'ubicacion' | 'cliente' | 'asignado'
export type PildoraTareaWms = Pildora<CampoTareaWms>

export const CAMPOS_FILTRO_TAREAS_WMS: ReadonlyArray<CampoDef<CampoTareaWms>> = [
  { campo: 'pedido', label: 'Pedido', aliases: ['ped', 'p'], numerico: true },
  { campo: 'envio', label: 'Envío', aliases: ['envio', 'env', 'e'], numerico: true },
  { campo: 'venta', label: 'Venta', aliases: ['v', 'nro venta'], numerico: true },
  { campo: 'producto', label: 'Producto', aliases: ['prod', 'nombre'] },
  { campo: 'sku', label: 'SKU' },
  { campo: 'lpn', label: 'LPN' },
  { campo: 'ubicacion', label: 'Ubicación', aliases: ['ubicacion', 'ubic', 'u'] },
  { campo: 'cliente', label: 'Cliente', aliases: ['cli'] },
  { campo: 'asignado', label: 'Asignada a', aliases: ['asignado', 'asignada', 'operario'] },
]

export const parsearPildoraTareaWms = (texto: string): PildoraTareaWms | null =>
  parsearPildoraCore(texto, CAMPOS_FILTRO_TAREAS_WMS)

/** Lo que el filtro necesita de una tarea (aplanado desde la fila de `wms_tareas` con sus embeds). */
export interface TareaWmsFiltrable {
  pedido: number | null
  envio: number | null
  venta: number | null
  producto: string | null
  sku: string | null
  lpn: string | null
  ubicacion: string | null
  cliente: string | null
  asignado: string | null
}

/** Aplana una fila de la consulta de la tab (pedidos/envíos/ventas embebidos). */
export function tareaWmsFiltrable(t: any): TareaWmsFiltrable {
  const ubic = [t.ubicacion_origen?.nombre, t.ubicacion_destino?.nombre].filter(Boolean).join(' → ')
  return {
    pedido: t.pedidos?.numero ?? null,
    envio: t.envios?.numero ?? null,
    venta: t.pedidos?.venta?.numero ?? t.envios?.venta?.numero ?? null,
    producto: t.productos?.nombre ?? null,
    sku: t.productos?.sku ?? null,
    lpn: t.lpn_origen ?? null,
    ubicacion: ubic || null,
    cliente: t.pedidos?.clientes?.nombre ?? t.pedidos?.cliente_nombre ?? null,
    asignado: t.usuario_asignado?.nombre_display ?? null,
  }
}

function numeroExacto(valor: number | null, pi: PildoraTareaWms): boolean {
  const buscado = pi.valor.trim().replace(/^#/, '')
  if (!buscado) return true
  if (pi.operador === 'contiene') return valor != null && String(valor) === buscado
  if (pi.operador === 'no_contiene') return valor == null || String(valor) !== buscado
  return coincideValor(valor, pi.operador, buscado)
}

export function evaluarPildoraTareaWms(t: TareaWmsFiltrable, pi: PildoraTareaWms): boolean {
  if (pi.campo === 'libre') {
    const buscado = pi.valor.trim().toLowerCase().replace(/^#/, '')
    if (!buscado) return true
    // Un número suelto busca el MISMO número de pedido, envío o venta (nunca "contiene").
    if (/^\d+$/.test(buscado)) {
      return [t.pedido, t.envio, t.venta].some(n => n != null && String(n) === buscado)
        || (t.sku ?? '').toLowerCase().includes(buscado)
        || (t.lpn ?? '').toLowerCase().includes(buscado)
    }
    return [t.producto, t.sku, t.lpn, t.ubicacion, t.cliente, t.asignado]
      .some(v => (v ?? '').toLowerCase().includes(buscado))
  }
  switch (pi.campo) {
    case 'pedido': return numeroExacto(t.pedido, pi)
    case 'envio': return numeroExacto(t.envio, pi)
    case 'venta': return numeroExacto(t.venta, pi)
    case 'producto': return coincideValor(t.producto, pi.operador, pi.valor)
    case 'sku': return coincideValor(t.sku, pi.operador, pi.valor)
    case 'lpn': return coincideValor(t.lpn, pi.operador, pi.valor)
    case 'ubicacion': return coincideValor(t.ubicacion, pi.operador, pi.valor)
    case 'cliente': return coincideValor(t.cliente, pi.operador, pi.valor)
    case 'asignado': return coincideValor(t.asignado ?? 'Sin asignar', pi.operador, pi.valor)
  }
}

export function evaluarPildorasTareaWms(
  t: TareaWmsFiltrable, pildoras: ReadonlyArray<PildoraTareaWms>, combinador: Combinador,
): boolean {
  return evaluarPildorasCore(t, pildoras, combinador, evaluarPildoraTareaWms)
}
