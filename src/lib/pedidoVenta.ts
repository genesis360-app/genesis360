// Pedidos que nacen de una VENTA (migs 315/316) — lógica pura.
//
// Hasta la mig 314 el único puente entre los dos módulos era Pedido → venta
// (`fn_pedido_generar_venta`, PED4). Desde la 315 existe el sentido inverso: una venta de ciertos
// canales genera automáticamente un Pedido de PREPARACIÓN.
//
// 🛑 Un pedido con `venta_origen_id` YA TIENE su venta, su plata y su stock resueltos. Entregarlo
// NO genera una venta nueva ni mueve stock — solo registra que la mercadería salió. Los guards
// server-side que lo garantizan están en la mig 316; acá vive únicamente lo que la UI necesita
// decidir (a quién mostrar y cómo buscarlo).

/** Pedido listo para que el mostrador lo entregue. */
export interface PedidoMostrador {
  id: string
  numero: number
  numero_sucursal?: number | null
  estado: string
  requiere_envio: boolean
  venta_origen_id: string | null
  cliente_nombre?: string | null
  cliente_dni?: string | null
  created_at?: string | null
}

/**
 * Qué pedidos ve el de mostrador (pedido textual de GO): SOLO los que están **listos para
 * entregar** y son **retiro en local**. Nada de pedidos a medio preparar ni de los que salen por
 * envío — para esos el mostrador no tiene nada que hacer, y mostrarlos sería ruido en la pantalla
 * de alguien que está atendiendo con el cliente enfrente.
 *
 * `venta_origen_id` es obligatorio: un pedido de logística puro se entrega desde /pedidos, que
 * además le genera la venta. Éste ya la tiene.
 */
export function esPedidoParaMostrador(p: PedidoMostrador): boolean {
  return p.estado === 'listo_para_entrega' && !p.requiere_envio && !!p.venta_origen_id
}

/**
 * Búsqueda del mostrador: nombre de cliente, DNI o número de pedido (pedido de GO).
 * Sin término devuelve todo. El número matchea tanto el correlativo del tenant como el de la
 * sucursal, porque `tenants.pedido_numeracion` decide cuál se le muestra al usuario y el cliente
 * puede venir con cualquiera de los dos anotado.
 */
export function filtrarPedidosMostrador<T extends PedidoMostrador>(pedidos: T[], termino: string): T[] {
  const q = normalizar(termino)
  if (!q) return pedidos
  const qDigitos = soloDigitos(termino)
  return pedidos.filter(p => {
    if (q && normalizar(p.cliente_nombre ?? '').includes(q)) return true
    if (!qDigitos) return false

    // El número se compara EXACTO: es un identificador corto, y un "contiene" haría que buscar el
    // pedido 5 devuelva también el 15, el 25 y el 50.
    if (String(p.numero) === qDigitos) return true
    if (p.numero_sucursal != null && String(p.numero_sucursal) === qDigitos) return true

    // El DNI se compara por PREFIJO y con un mínimo de 3 dígitos. Por dígitos para que dé igual si
    // lo cargaron con puntos ("30.123.456"); por prefijo y no por "contiene" porque un "contiene"
    // convierte cualquier búsqueda corta en ruido — tipear "5" para el pedido 5 devolvía además a
    // todo cliente con un 5 en el documento.
    const dni = soloDigitos(p.cliente_dni ?? '')
    if (qDigitos.length >= 3 && dni && dni.startsWith(qDigitos)) return true

    return false
  })
}

/** minúsculas + sin tildes, para que "Pérez" matchee "perez" (mismo criterio que el resto del POS). */
function normalizar(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
}

function soloDigitos(s: string): string {
  return (s ?? '').replace(/\D/g, '')
}

/**
 * Los canales elegidos en Config → Pedidos, saneados: solo ids que todavía existen y están
 * activos. Un canal borrado o desactivado que quedó en la config no debe pintarse como
 * seleccionado ni volver a guardarse.
 */
export function canalesAutoValidos(
  configurados: unknown,
  canales: { id: string; activo: boolean }[],
): string[] {
  if (!Array.isArray(configurados)) return []
  const vivos = new Set(canales.filter(c => c.activo).map(c => c.id))
  return configurados.filter((id): id is string => typeof id === 'string' && vivos.has(id))
}

/**
 * ¿Esta venta va a generar un pedido? Espejo (informativo) de la condición del trigger
 * `trg_venta_auto_pedido` de la mig 315 — se usa solo para avisarle al usuario en el POS, nunca
 * para decidir: la decisión REAL la toma el servidor, que es el único que la ve toda.
 *
 * 💵 `total` NO incluye el costo de envío pero `monto_pagado` SÍ (ISS-105), así que la
 * comparación de "reserva 100% pagada" tiene que sumarlo. Se usa `>=` y no `=` para que una seña
 * de más por redondeo no deje el pedido sin generar.
 */
export function ventaGeneraPedido(venta: {
  estado: string
  origen?: string | null
  total?: number | null
  costo_envio?: number | null
  monto_pagado?: number | null
  canal_id?: string | null
}, canalesAuto: string[]): boolean {
  if (!['pendiente', 'reservada', 'despachada'].includes(venta.estado)) return false
  if (!venta.canal_id || !canalesAuto.includes(venta.canal_id)) return false
  if (venta.estado === 'reservada') {
    const total = Number(venta.total ?? 0) + Number(venta.costo_envio ?? 0)
    const pagado = Number(venta.monto_pagado ?? 0)
    if (!(total > 0) || pagado < total) return false
  }
  return true
}
