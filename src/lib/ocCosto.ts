// ocCosto — qué costo unitario precargar al agregar un producto a una Orden de Compra.
//
// 🛑 BUG REAL que motivó este archivo (Fede, 2026-09-11): el form de la OC precargaba
// `productos.precio_costo` sin mirar NADA. Para un producto priceado en dólares eso es el
// **mirror en ARS** (el valor que la ficha calcula para margen/reportes/POS), no el costo real.
// El número se guardaba tal cual y después se mostraba como dólares, porque la OC tiene su propia
// `moneda`: un producto de **US$99,99 quedaba como una OC de US$150.985** — y al recibirla generaba
// el gasto por ese monto. Es el mismo bug del mirror que ya había mordido en la lista de Productos
// (2026-08-20), acá por otra puerta.
//
// La regla, entonces: **el valor precargado siempre está EN LA MONEDA DE LA OC**, y si hay que
// convertir para llegar a él, se dice. Cuando no se puede saber sin inventar un número, no se
// precarga nada — un campo vacío que el usuario completa es mucho menos peligroso que un número
// plausible en la moneda equivocada.
//
// Sobre la tasa: se usa la MISMA en las dos direcciones (`cotizacionUsdAArs`, la de COMPRA por
// convención del sistema — ver `tasaUsdAArs` en cajaBoveda.ts). Es deliberado: con una sola tasa el
// ida y vuelta cierra exacto. Usar patas distintas según la dirección es justo lo que generó el
// vuelto fantasma del POS (issue #1 de Fede, 2026-09-08).

export type MonedaOC = 'ARS' | 'USD'

export interface ProductoCosto {
  precio_costo?: number | string | null
  precio_costo_usd?: number | string | null
  moneda_costo?: string | null
}

export interface CostoSugerido {
  /** Valor a precargar, SIEMPRE en la moneda de la OC. `null` = no se puede sugerir sin inventar. */
  valor: number | null
  /** ¿Lo calculamos nosotros con la cotización? Entonces el usuario tiene que poder revisarlo. */
  convertido: boolean
  /** Por qué no hay valor (para avisar en pantalla en vez de dejar un campo mudo). */
  motivo?: 'sin_costo' | 'sin_cotizacion'
}

/** El `numeric` de Postgres llega como string ("1500.00") — normalizar antes de comparar. */
function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** ¿El producto está priceado en dólares? (`productos.moneda_costo`, rediseño mig 367.) */
export function productoEsUsd(p: ProductoCosto): boolean {
  return String(p?.moneda_costo ?? 'local').toLowerCase() === 'usd'
}

export function costoSugeridoOC(
  producto: ProductoCosto | null | undefined,
  monedaOC: MonedaOC,
  cotizacionUsdAArs: number,
): CostoSugerido {
  const p = producto ?? {}
  const esUsd    = productoEsUsd(p)
  const costoArs = num(p.precio_costo)       // nativo ARS, o el mirror que calculó la ficha
  const costoUsd = num(p.precio_costo_usd)   // nativo USD (solo tiene valor si esUsd)
  const cotiz    = num(cotizacionUsdAArs)

  if (monedaOC === 'USD') {
    // El caso que estaba roto: producto en dólares → su valor NATIVO, sin pasar por el mirror.
    if (esUsd && costoUsd > 0) return { valor: costoUsd, convertido: false }
    // Producto en pesos dentro de una OC en dólares: no hay un valor guardado en USD, hay que
    // convertir. Sin cotización NO se precarga — un número en pesos metido en una OC en dólares es
    // exactamente el bug que este archivo viene a cerrar.
    if (costoArs > 0) {
      return cotiz > 0
        ? { valor: round2(costoArs / cotiz), convertido: true }
        : { valor: null, convertido: false, motivo: 'sin_cotizacion' }
    }
    return { valor: null, convertido: false, motivo: 'sin_costo' }
  }

  // OC en pesos: `precio_costo` ya está en pesos (sea nativo o el mirror de un producto en USD),
  // así que no hace falta convertir nada.
  if (costoArs > 0) return { valor: costoArs, convertido: false }
  if (esUsd && costoUsd > 0) {
    return cotiz > 0
      ? { valor: round2(costoUsd * cotiz), convertido: true }
      : { valor: null, convertido: false, motivo: 'sin_cotizacion' }
  }
  return { valor: null, convertido: false, motivo: 'sin_costo' }
}
