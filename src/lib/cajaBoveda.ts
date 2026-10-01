// G5 Fase 5 — lógica de la Bóveda multi-moneda (ARS/USD).

export type SentidoConversionUsd = 'usd_a_ars' | 'ars_a_usd'

export interface ConversionUsdResult {
  montoDestino: number
  tasaUsada: number
}

// Conversión USD↔$ desde la Bóveda. D-1 fase 2 (GO, 2026-09-25): UNA sola tasa en todo el sistema,
// también acá y en los dos sentidos — el vendedor divisa BNA del día hábil anterior (ver
// `src/lib/cotizacionBna.ts`). Antes (relevamiento F2, G5 Fase 5) vender dólares iba a COMPRA y
// comprarlos a VENTA, como una casa de cambio; esa diferencia desaparece por decisión de GO.
// J1: sin redondeo — decimales exactos.
export function calcularConversionUsd(
  sentido: SentidoConversionUsd,
  montoOrigen: number,
  tasa: number,
): ConversionUsdResult {
  if (!(montoOrigen > 0)) throw new Error('Ingresá un monto válido')
  if (!(tasa > 0)) throw new Error('No hay cotización del dólar BNA — no se puede convertir')
  if (sentido === 'usd_a_ars') return { montoDestino: montoOrigen * tasa, tasaUsada: tasa }
  return { montoDestino: montoOrigen / tasa, tasaUsada: tasa }
}

// Busca la sesión permanente de una Caja Fuerte (por moneda); si no existe, la crea con la
// `moneda` stampeada explícitamente (antes de esta fase, los 4 sitios que creaban esta sesión
// nunca la seteaban — quedaban en el default 'ARS' de la columna, lo que hoy rechazaría el
// trigger fn_validar_moneda_coincide_sesion (mig 372) apenas se intente usar la fuerte en USD).
export async function ensureFuerteSesionId(
  supabase: any,
  tenantId: string,
  cajaFuerteId: string,
  moneda: 'ARS' | 'USD',
  usuarioId: string,
): Promise<string> {
  // 🛑 `estado = 'abierta'` no estaba y hace falta: sin él, una sesión permanente YA CERRADA se
  // devolvía como si siguiera abierta.
  const buscar = async () => {
    const { data } = await supabase.from('caja_sesiones')
      .select('id').eq('caja_id', cajaFuerteId).eq('es_permanente', true).eq('estado', 'abierta')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    return (data?.id as string | undefined) ?? null
  }

  const existente = await buscar()
  if (existente) return existente

  const { data: nueva, error } = await supabase.from('caja_sesiones').insert({
    tenant_id: tenantId, caja_id: cajaFuerteId,
    estado: 'abierta', es_permanente: true, moneda,
    usuario_id: usuarioId, monto_apertura: 0,
  }).select('id').single()

  if (error) {
    // 🛑 Este get-or-create es el que dejó 6 sesiones abiertas a la vez en la Bóveda de un negocio
    // real: dos llamadas en paralelo hacen el mismo SELECT, ninguna encuentra nada, las dos
    // insertan. Desde la mig 435 el índice único corta la carrera — pero el que la pierde recibe un
    // 23505, y tirarle ese error en la cara sería cambiar un bug silencioso por uno ruidoso.
    // La sesión que ganó es la buena: se la devolvemos.
    if ((error as any)?.code === '23505') {
      const ganadora = await buscar()
      if (ganadora) return ganadora
    }
    throw error
  }
  return nueva.id as string
}
