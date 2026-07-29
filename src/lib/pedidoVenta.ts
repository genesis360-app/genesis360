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
export function canalesExcluidosValidos(
  configurados: unknown,
  canales: { id: string; activo: boolean }[],
): string[] {
  if (!Array.isArray(configurados)) return []
  const vivos = new Set(canales.filter(c => c.activo).map(c => c.id))
  return configurados.filter((id): id is string => typeof id === 'string' && vivos.has(id))
}

/**
 * ¿Esta venta necesita que el depósito le prepare un pedido? Espejo (informativo) de
 * `fn_venta_requiere_pedido` (mig 318) — se usa para avisarle al usuario en el POS, nunca para
 * decidir: la decisión REAL la toma el servidor, que es el único que la ve toda.
 *
 * La regla, según el diagrama de flujo de GO: **todas las ventas generan pedido MENOS la entrega
 * directa**, que es la única en la que el cliente se lleva la mercadería en el momento:
 *
 *   PRESUPUESTO (estado pendiente)                                → NO genera (mig 323)
 *   entrega directa = canal PRESENCIAL + despachada + sin envío   → NO genera
 *   con envío (propio o de tercero)                               → genera
 *   reserva (la mercadería no salió y hay compromiso)             → genera
 *   canal ONLINE sin envío (= retiro en local)                    → genera
 *
 * 🛑 Ojo con el orden: el gate de PAGO ya no vive acá. Una reserva con seña parcial genera el
 * pedido igual y se prepara; que esté saldada se valida recién al ENTREGAR
 * (`fn_pedido_entregar_retiro`). Si el pago volviera a condicionar la creación, el depósito se
 * quedaría sin trabajo hasta que entre el saldo — que es justo lo que este rediseño corrigió.
 */
export function ventaRequierePedido(venta: {
  estado: string
  con_envio?: boolean | null
  canal_clasificacion?: 'online' | 'presencial' | null
  canal_id?: string | null
}, canalesExcluidos: string[] = []): boolean {
  // 🛑 'pendiente' es un PRESUPUESTO (el ticket dice "★ PRESUPUESTO ★"), no un compromiso: el
  // cliente no aceptó, no pagó y puede no convertirse nunca. Comprometer trabajo de depósito con
  // eso está mal — lo detectó GO cuando una venta recurrente generó un presupuesto, el presupuesto
  // generó un pedido, y al cancelarse quedó el pedido vivo para preparar. El pedido nace cuando el
  // presupuesto SE CONVIERTE en venta (mig 323).
  if (!['reservada', 'despachada', 'facturada'].includes(venta.estado)) return false
  if (venta.canal_id && canalesExcluidos.includes(venta.canal_id)) return false

  if (venta.con_envio) return true
  if (venta.estado === 'reservada') return true

  // Sin canal resuelto se asume presencial: el caso conservador, no inventa trabajo de depósito.
  return (venta.canal_clasificacion ?? 'presencial') === 'online'
}

/** Estados en los que una venta sigue VIVA: si no, su pedido no tiene razón de existir. */
export const ESTADOS_VENTA_VIVA = ['pendiente', 'reservada', 'despachada', 'facturada'] as const

/**
 * Por qué NO se puede lanzar el pedido de esta venta (o null si se puede). Espejo de
 * `fn_pedido_venta_viva` (mig 323) — el servidor lo revalida.
 */
export function motivoNoLanzarPedido(estadoVenta: string | null | undefined): string | null {
  if (!estadoVenta) return null   // pedido de logística puro: no aplica
  if (estadoVenta === 'cancelada' || estadoVenta === 'devuelta') {
    return `La venta está ${estadoVenta}: no se puede preparar mercadería para una venta que ya no existe.`
  }
  if (estadoVenta === 'pendiente') {
    return 'La venta todavía es un PRESUPUESTO: confirmala antes de mandar a preparar la mercadería.'
  }
  return null
}

/**
 * 💵 Lo que el TICKET tiene que decirle al cliente sobre su pago.
 *
 * El ticket mostraba el TOTAL y, en gris, lo pagado — pero en ningún lado cuánto FALTA, que es
 * justamente el número por el que el cliente vuelve al local. Y desde la mig 318 el mostrador NO
 * entrega hasta que la venta esté saldada, así que si el ticket no lo dice, el cliente se entera
 * recién cuando viene a buscar la mercadería.
 *
 * Se suma el envío: `total` NO lo incluye pero `monto_pagado` SÍ (ISS-105) — mostrar el saldo
 * contra `total` a secas le diría al cliente que debe menos de lo que debe.
 */
export function resumenPagoTicket(venta: {
  estado?: string | null
  total?: number | null
  costo_envio?: number | null
  costo_envio_logistica?: number | null
  monto_pagado?: number | null
}): { totalConTodo: number; pagado: number; saldo: number; mostrarSaldo: boolean } {
  const totalConTodo = Number(venta.total ?? 0) + Number(venta.costo_envio ?? 0) + Number(venta.costo_envio_logistica ?? 0)
  const pagado = Number(venta.monto_pagado ?? 0)
  const bruto = totalConTodo - pagado
  // Medio peso de tolerancia, igual criterio que el resto de los chequeos de saldo del sistema.
  const saldo = bruto > 0.5 ? bruto : 0
  // Un PRESUPUESTO no tiene saldo que reclamar: todavía no es una venta.
  return { totalConTodo, pagado, saldo, mostrarSaldo: saldo > 0 && venta.estado !== 'pendiente' }
}

/**
 * 💵 Saldo que falta cobrar para poder entregar (caja "Debe validar pago total" del diagrama).
 * `total` NO incluye el costo de envío pero `monto_pagado` SÍ (ISS-105), así que hay que sumarlo:
 * compararlo contra `total` a secas dejaría salir mercadería con el envío sin cobrar.
 * Devuelve 0 si está saldada o si es cuenta corriente (ahí la deuda es a propósito).
 */
export function saldoParaEntregar(venta: {
  total?: number | null
  costo_envio?: number | null
  monto_pagado?: number | null
  es_cuenta_corriente?: boolean | null
}): number {
  if (venta.es_cuenta_corriente) return 0
  const saldo = Number(venta.total ?? 0) + Number(venta.costo_envio ?? 0) - Number(venta.monto_pagado ?? 0)
  return saldo > 0.5 ? saldo : 0
}
