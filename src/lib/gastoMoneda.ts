// gastoMoneda — en qué moneda se registra y se paga un gasto.
//
// Pedido de GO (2026-09-11, reportado por Fede): "al registrar un nuevo gasto, el monto que se pone
// es únicamente en $. Debería haber un select box del lado izquierdo del monto para elegir la
// moneda... por default debe tomar la moneda que se encuentra en config/moneda principal del
// negocio".
//
// ── Lo que había antes ───────────────────────────────────────────────────────────────────────
// `gastos.moneda` existe desde la mig 379 pero NADIE la seteaba: el formulario no la ofrecía y el
// label decía "Monto total ($)" con el peso hardcodeado. Peor: `GastosPage` filtraba las cajas
// disponibles a `moneda === 'ARS'` a propósito, con este comentario en el código:
//
//   "Gastos todavía no soporta pagar en USD (eso es específico de Ventas). Sin filtrar acá, el
//    picker podía ofrecer una Caja USD y el trigger de moneda-por-sesión rechazaría el insert."
//
// Ese trigger (`fn_validar_moneda_coincide_sesion`) es el guard server-side: un movimiento de caja
// cuya moneda no coincide con la de su sesión se RECHAZA. Así que abrir la moneda del gasto sin
// abrir también la caja no habría servido de nada — el pago en efectivo fallaría.
//
// ── 🛑 REGLA #0 ──────────────────────────────────────────────────────────────────────────────
// Un gasto mueve plata de una caja. Las dos reglas que sostienen este archivo:
//   1. El efectivo de un gasto sale de una caja DE LA MISMA MONEDA. No se convierte al vuelo.
//   2. Si no hay caja en esa moneda, se avisa ANTES de registrar — no se cae en una caja de otra
//      moneda "porque es la que hay", que es exactamente como se pierde plata sin rastro.

import { MONEDAS_DISPONIBLES } from '@/lib/formato'

/** Una sesión de caja abierta, tal como la trae GastosPage (con su caja embebida). */
export interface SesionCaja {
  id: string
  usuario_id?: string | null
  cajas?: { nombre?: string | null; es_caja_fuerte?: boolean | null; moneda?: string | null; sucursal_id?: string | null } | null
}

export const monedaDe = (v: { moneda?: string | null } | null | undefined): string =>
  (v?.moneda ?? 'ARS').toUpperCase()

/**
 * Las monedas que ofrece el selector, con la del negocio PRIMERO.
 *
 * Se ofrecen todas las que la app soporta (`MONEDAS_DISPONIBLES`) y no solo ARS/USD: un gasto puede
 * ser en la moneda que el proveedor cobre. Lo que cambia según el caso es si se puede PAGAR en
 * efectivo — eso lo resuelve `puedePagarEfectivoEn`, no la lista.
 */
export function monedasParaGasto(monedaTenant: string | null | undefined): string[] {
  const principal = (monedaTenant ?? 'ARS').toUpperCase()
  const resto = MONEDAS_DISPONIBLES.map(m => m.code).filter(c => c !== principal)
  return [principal, ...resto]
}

/** Las sesiones OPERATIVAS (no caja fuerte) en las que se puede pagar un gasto de esta moneda.
 *  Genérico para devolver el MISMO tipo que recibe: la página trae sesiones con más campos
 *  (`monto_apertura`, `abrio`, …) y estrecharlas acá le rompería el resto del archivo. */
export function cajasOperativasDeMoneda<T extends SesionCaja>(sesiones: T[] | null | undefined, moneda: string): T[] {
  const m = (moneda ?? 'ARS').toUpperCase()
  return (sesiones ?? []).filter(s => !s.cajas?.es_caja_fuerte && monedaDe(s.cajas) === m)
}

/** La caja fuerte de esta moneda (desde la mig 373 hay una por moneda, no una sola). */
export function cajaFuerteDeMoneda<T extends SesionCaja>(sesiones: T[] | null | undefined, moneda: string): T | null {
  const m = (moneda ?? 'ARS').toUpperCase()
  return (sesiones ?? []).find(s => s.cajas?.es_caja_fuerte && monedaDe(s.cajas) === m) ?? null
}

/** ¿Hay dónde asentar un egreso de EFECTIVO en esta moneda? */
export function puedePagarEfectivoEn<T extends SesionCaja>(sesiones: T[] | null | undefined, moneda: string): boolean {
  return cajasOperativasDeMoneda(sesiones, moneda).length > 0 || cajaFuerteDeMoneda(sesiones, moneda) != null
}

/**
 * ¿El medio de pago puede usarse para un gasto en esta moneda?
 *
 * El corte es por EFECTIVO: un billete es de una moneda concreta y tiene que entrar a una caja de
 * esa moneda (lo exige `fn_validar_moneda_coincide_sesion`). Los medios no-efectivo
 * (transferencia, tarjeta, cuenta corriente) generan un movimiento INFORMATIVO que no toca el
 * saldo físico de ninguna caja, así que no se bloquean: un gasto en dólares puede pagarse por
 * transferencia sin que exista una caja USD.
 */
export function medioSirveParaMoneda(
  monedaMedio: string | null | undefined,
  monedaGasto: string,
  esEfectivo: boolean,
): boolean {
  if (!esEfectivo) return true
  return (monedaMedio ?? 'ARS').toUpperCase() === (monedaGasto ?? 'ARS').toUpperCase()
}

export interface ProblemaPagoGasto {
  motivo: 'sin_caja' | 'medio_otra_moneda'
  detalle: string
}

/**
 * Valida el pago de un gasto ANTES de escribir nada. Devuelve `null` si está todo bien.
 *
 * Se corre en el cliente para poder avisar con un mensaje entendible; el trigger de la base es la
 * red de seguridad real. Sin esta validación el usuario vería el error crudo de Postgres
 * ("la moneda del movimiento no coincide...") recién después de intentar guardar.
 */
export function validarPagoGasto(params: {
  monedaGasto: string
  sesiones: SesionCaja[] | null | undefined
  medios: { tipo: string; monto: number; moneda?: string | null; esEfectivo: boolean }[]
}): ProblemaPagoGasto | null {
  const { monedaGasto, sesiones, medios } = params
  const conMonto = medios.filter(m => m.tipo && m.monto > 0)
  const efectivos = conMonto.filter(m => m.esEfectivo)
  if (efectivos.length === 0) return null

  const cruzado = efectivos.find(m => !medioSirveParaMoneda(m.moneda, monedaGasto, true))
  if (cruzado) {
    return {
      motivo: 'medio_otra_moneda',
      detalle: `"${cruzado.tipo}" es un medio en ${(cruzado.moneda ?? 'ARS').toUpperCase()} y el gasto está en ${monedaGasto}. `
        + 'El efectivo tiene que salir de una caja de la misma moneda.',
    }
  }

  if (!puedePagarEfectivoEn(sesiones, monedaGasto)) {
    return {
      motivo: 'sin_caja',
      detalle: `No hay ninguna caja en ${monedaGasto} abierta para registrar el egreso en efectivo. `
        + `Abrí una caja en ${monedaGasto}, o pagá el gasto por transferencia u otro medio.`,
    }
  }
  return null
}

/**
 * Suma montos AGRUPADOS POR MONEDA.
 *
 * 🛑 Existe para no volver a sumar un alquiler en dólares con uno en pesos: ese total no es plata,
 * es un número inventado. El tab de gastos fijos mostraba uno solo (`Total mensual estimado`)
 * sumando todo junto — con una sola moneda daba bien y por eso pasó desapercibido.
 *
 * Devuelve pares `[moneda, total]` con la moneda del negocio PRIMERO (es la que el usuario espera
 * leer arriba), y el resto alfabético para que el orden no dependa del orden de las filas.
 */
export function totalesPorMoneda(
  filas: { monto: number | string | null | undefined; moneda?: string | null }[] | null | undefined,
  monedaTenant: string | null | undefined,
): [string, number][] {
  const principal = (monedaTenant ?? 'ARS').toUpperCase()
  const acc: Record<string, number> = {}
  for (const f of filas ?? []) {
    const m = (f.moneda ?? principal).toUpperCase()
    acc[m] = (acc[m] ?? 0) + (Number(f.monto) || 0)
  }
  return Object.entries(acc).sort(([a], [b]) =>
    a === principal ? -1 : b === principal ? 1 : a.localeCompare(b))
}
