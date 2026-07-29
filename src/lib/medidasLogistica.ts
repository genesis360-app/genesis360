// Medidas físicas: del producto al bulto del envío, y capacidad de una ubicación.
//
// Contexto (auditoría 2026-07-29, a pedido de GO): la app tenía TRES juegos de medidas cargados y
// ninguno conectado a nada.
//   · `productos.peso_kg/largo/ancho/alto_cm` — el campo dice "opcional, para envío"… y el form de
//     Envíos pedía el peso A MANO. Cargarlas no servía para nada: una promesa incumplida.
//   · `producto_presentaciones.*` — medidas POR NIVEL (por Caja, por Pallet). La columna existe y la
//     lib las lee/escribe, pero el editor no tiene inputs, así que están siempre vacías.
//   · `ubicaciones.capacidad_pallets/peso_max_kg/…` (mig 032) — se cargan en Config y no las lee
//     ningún cálculo.
//
// Este archivo conecta las tres. El cubicaje volumétrico (§3, mig 322) se agregó después con el
// diseño de GO que resuelve la objeción de fondo — "con medidas a medias el número miente, y un
// número que miente es peor que no tener ninguno": es **opt-in por tenant** y al activarlo las
// medidas por nivel se vuelven obligatorias en el editor de estructura, así la cobertura es 100%
// por construcción de ahí en adelante. Prenderlo no completa el catálogo viejo → toda función de
// acá devuelve además la COBERTURA, y ninguna pantalla muestra un verde limpio sin ella.

// ── 1) Bulto del envío a partir de los productos ────────────────────────────────────────

export interface ItemConMedidas {
  cantidad: number
  peso_kg?: number | null
  largo_cm?: number | null
  ancho_cm?: number | null
  alto_cm?: number | null
}

export interface BultoSugerido {
  peso_kg: number | null
  largo_cm: number | null
  ancho_cm: number | null
  alto_cm: number | null
  /** Ítems que no tienen peso cargado: el peso sugerido se queda corto por su culpa. */
  sinPeso: number
  /** Ítems que no tienen ninguna medida: las dimensiones sugeridas ignoran su volumen. */
  sinMedidas: number
}

/**
 * Sugiere el bulto de un envío a partir de los productos que lleva.
 *
 * 🛑 Las dos magnitudes NO se combinan igual, y confundirlas es cobrar mal:
 *  · **El peso SE SUMA** — es aditivo y exacto: 3 unidades de 2 kg pesan 6 kg.
 *  · **Las dimensiones NO se suman.** Apilar dos cajas de 30 cm no da una de 60 en los tres ejes.
 *    Se toma el **máximo por eje**, que es el "mínimo garantizado": el bulto no puede ser MÁS CHICO
 *    que su ítem más grande. Es una cota inferior honesta, no una estimación de volumen — por eso
 *    la UI lo ofrece como sugerencia editable y no lo impone.
 *
 * Se devuelven además los conteos de ítems sin datos, para poder avisar que la sugerencia se queda
 * corta en vez de dar un número que parece completo y no lo está (cotizar de menos lo termina
 * cobrando el courier después).
 */
export function sugerirBultoEnvio(items: ItemConMedidas[]): BultoSugerido {
  let peso = 0
  let largo = 0, ancho = 0, alto = 0
  let sinPeso = 0, sinMedidas = 0
  let huboPeso = false, huboMedida = false

  for (const it of items) {
    const cant = Number(it.cantidad ?? 0)
    if (!(cant > 0)) continue

    const p = num(it.peso_kg)
    if (p != null && p > 0) { peso += p * cant; huboPeso = true } else { sinPeso += 1 }

    const l = num(it.largo_cm), a = num(it.ancho_cm), h = num(it.alto_cm)
    if ((l ?? 0) > 0 || (a ?? 0) > 0 || (h ?? 0) > 0) {
      largo = Math.max(largo, l ?? 0)
      ancho = Math.max(ancho, a ?? 0)
      alto  = Math.max(alto,  h ?? 0)
      huboMedida = true
    } else {
      sinMedidas += 1
    }
  }

  return {
    peso_kg: huboPeso ? redondear3(peso) : null,
    largo_cm: huboMedida && largo > 0 ? largo : null,
    ancho_cm: huboMedida && ancho > 0 ? ancho : null,
    alto_cm:  huboMedida && alto  > 0 ? alto  : null,
    sinPeso, sinMedidas,
  }
}

/** Aviso para el usuario cuando la sugerencia está incompleta, o null si está completa. */
export function avisoBultoIncompleto(b: BultoSugerido): string | null {
  if (b.sinPeso === 0 && b.sinMedidas === 0) return null
  if (b.peso_kg == null && b.largo_cm == null) {
    return 'Ninguno de los productos tiene peso ni medidas cargadas — completalos a mano, o cargalos en la ficha del producto para la próxima.'
  }
  const partes: string[] = []
  if (b.sinPeso > 0) partes.push(`${b.sinPeso} sin peso`)
  if (b.sinMedidas > 0) partes.push(`${b.sinMedidas} sin medidas`)
  return `Sugerido a partir de los productos (${partes.join(' · ')}): el bulto real puede ser mayor. Revisalo antes de cotizar.`
}

// ── 2) Capacidad de una ubicación ───────────────────────────────────────────────────────

export type EstadoCapacidad = 'sin_limite' | 'ok' | 'lleno' | 'excedido'

export interface CapacidadUbicacion {
  estado: EstadoCapacidad
  ocupados: number
  capacidad: number | null
  restantes: number | null
  mensaje: string | null
}

/**
 * Estado de ocupación de una ubicación, contando **LPN** (cada LPN es un bulto/pallet en la
 * posición). Se usa `ubicaciones.capacidad_pallets`, que ya existía desde la mig 032 y no leía
 * nadie.
 *
 * 🛑 Es un AVISO, nunca un bloqueo: el dato de capacidad lo carga una persona y puede estar mal o
 * desactualizado. Frenar un ingreso de mercadería real por un número de configuración sería peor
 * que el problema — la mercadería ya está físicamente ahí.
 *
 * Deliberadamente NO calcula volumen: eso exige medidas confiables de cada nivel de cada SKU, y con
 * medidas incompletas el resultado miente.
 */
export function estadoCapacidadUbicacion(
  capacidad: number | null | undefined,
  ocupados: number,
  aAgregar = 0,
): CapacidadUbicacion {
  const cap = num(capacidad)
  const ocup = Math.max(0, Number(ocupados ?? 0))
  if (cap == null || cap <= 0) {
    return { estado: 'sin_limite', ocupados: ocup, capacidad: null, restantes: null, mensaje: null }
  }
  const total = ocup + Math.max(0, aAgregar)
  const restantes = cap - total
  if (restantes < 0) {
    return {
      estado: 'excedido', ocupados: ocup, capacidad: cap, restantes,
      mensaje: `Esta ubicación admite ${cap} y quedaría con ${total}. Se puede guardar igual, pero revisá el espacio.`,
    }
  }
  if (restantes === 0) {
    return {
      estado: 'lleno', ocupados: ocup, capacidad: cap, restantes: 0,
      mensaje: `Con esto la ubicación queda llena (${total} de ${cap}).`,
    }
  }
  return { estado: 'ok', ocupados: ocup, capacidad: cap, restantes, mensaje: null }
}

export interface CargaUbicacion {
  estado: EstadoCapacidad
  pesoKg: number
  pesoMaxKg: number | null
  /** % de las líneas de la ubicación cuyo producto TIENE peso cargado (0-100). */
  cobertura: number
  mensaje: string | null
  /** Aviso separado: el número está calculado sobre datos incompletos. */
  avisoCobertura: string | null
}

/**
 * Carga de una ubicación contra `ubicaciones.peso_max_kg`.
 *
 * 🛑 Es el más importante de los tres campos de capacidad: sobrecargar un rack no es un problema de
 * datos, es de **seguridad física**. Y es el más confiable de calcular — el peso es **aditivo y
 * exacto**, a diferencia del volumen.
 *
 * ⚠ Pero tiene un sesgo peligroso: si a algunos productos les falta el `peso_kg`, el total queda
 * **corto**, o sea que el error empuja hacia "parece que hay lugar" justo cuando el rack podría
 * estar pasado. Por eso se devuelve la **cobertura** y un aviso aparte: nunca hay que mostrar un
 * verde limpio calculado sobre datos incompletos.
 *
 * Igual que la capacidad por LPN: avisa, no bloquea.
 */
export function estadoCargaUbicacion(
  pesoMaxKg: number | null | undefined,
  pesoKg: number | null | undefined,
  lineasConPeso = 0,
  lineasTotal = 0,
): CargaUbicacion {
  const max = num(pesoMaxKg)
  const peso = num(pesoKg) ?? 0
  const cobertura = lineasTotal > 0 ? Math.round((lineasConPeso / lineasTotal) * 100) : 100
  const avisoCobertura = lineasTotal > 0 && lineasConPeso < lineasTotal
    ? `Calculado sobre ${lineasConPeso} de ${lineasTotal} líneas: a las demás les falta el peso en la ficha del producto, así que el total real es mayor.`
    : null

  if (max == null || max <= 0) {
    return { estado: 'sin_limite', pesoKg: peso, pesoMaxKg: null, cobertura, mensaje: null, avisoCobertura }
  }
  if (peso > max) {
    return {
      estado: 'excedido', pesoKg: peso, pesoMaxKg: max, cobertura, avisoCobertura,
      mensaje: `Esta ubicación soporta ${max} kg y tiene ${redondear3(peso)} kg. Revisá la carga.`,
    }
  }
  // 90% es el umbral para avisar antes de llegar al límite: si esperás al 100% exacto, con el
  // peso subestimado por datos faltantes el aviso puede no llegar nunca.
  if (peso >= max * 0.9) {
    return {
      estado: 'lleno', pesoKg: peso, pesoMaxKg: max, cobertura, avisoCobertura,
      mensaje: `Cerca del límite de carga (${redondear3(peso)} de ${max} kg).`,
    }
  }
  return { estado: 'ok', pesoKg: peso, pesoMaxKg: max, cobertura, mensaje: null, avisoCobertura }
}

/**
 * Volumen GEOMÉTRICO de una ubicación en m³ a partir de sus dimensiones en cm, o null si falta
 * alguna. Es el volumen "de la caja vacía": lo que realmente entra es menos (ver
 * `capacidadUtilM3`).
 */
export function volumenUbicacionM3(
  largoCm: number | null | undefined,
  anchoCm: number | null | undefined,
  altoCm: number | null | undefined,
): number | null {
  const l = num(largoCm), a = num(anchoCm), h = num(altoCm)
  if (!l || !a || !h || l <= 0 || a <= 0 || h <= 0) return null
  return Math.round(((l * a * h) / 1_000_000) * 1000) / 1000
}

// ── 3) Cubicaje volumétrico (mig 322) ───────────────────────────────────────────────────

/** Fracción del volumen geométrico que se considera usable si el tenant no configuró otra. */
export const FACTOR_APROVECHAMIENTO_DEFAULT = 0.7

/**
 * Capacidad ÚTIL en m³ de una ubicación: el volumen geométrico por el factor de aprovechamiento.
 *
 * 🛑 Ninguna posición real se llena al 100% geométrico — pasillos, forma irregular, mercadería que
 * no apila. Sin este factor el sistema diría "entra" cuando no entra, que es exactamente el error
 * que hace inútil a un cubicaje. 0.70 es el default típico de la industria (60-75%).
 */
export function capacidadUtilM3(
  volumenGeometricoM3: number | null | undefined,
  factorAprovechamiento?: number | null,
): number | null {
  const v = num(volumenGeometricoM3)
  if (v == null || v <= 0) return null
  const f = num(factorAprovechamiento)
  const factor = f != null && f > 0 && f <= 1 ? f : FACTOR_APROVECHAMIENTO_DEFAULT
  return Math.round(v * factor * 1000) / 1000
}

export interface VolumenUbicacion {
  estado: EstadoCapacidad
  /** m³ ocupados por lo que hay guardado (según `vw_ubicacion_ocupacion`). */
  volumenM3: number
  /** m³ útiles = geométrico × factor. null si la ubicación no tiene las tres medidas. */
  capacidadM3: number | null
  /** % de las líneas cuya presentación TIENE las tres medidas (0-100). */
  cobertura: number
  mensaje: string | null
  /** Aviso separado: el número está calculado sobre datos incompletos. */
  avisoCobertura: string | null
}

/**
 * Ocupación volumétrica de una ubicación (cubicaje, mig 322).
 *
 * ⚠ Tiene el **mismo sesgo peligroso que el peso, y peor**: si a alguna presentación le faltan las
 * medidas, esa línea aporta 0 m³ y el total queda **corto** — o sea que el error empuja hacia
 * "parece que hay lugar" justo cuando la posición podría estar pasada. Por eso nunca se muestra un
 * verde limpio sin decir sobre qué porcentaje de las líneas se calculó.
 *
 * Ése es todo el sentido de que el cubicaje sea **opt-in** (`tenants.cubicaje_habilitado`): al
 * activarlo las medidas pasan a ser obligatorias en el editor de estructura, así la cobertura es
 * 100% por construcción para todo lo que se cargue de ahí en adelante. Prenderlo NO completa el
 * catálogo que ya existe — de ahí la cobertura.
 *
 * Igual que la capacidad por LPN y la carga por peso: **avisa, no bloquea**.
 */
export function estadoVolumenUbicacion(
  capacidadUtil: number | null | undefined,
  volumenOcupadoM3: number | null | undefined,
  lineasConVolumen = 0,
  lineasTotal = 0,
  aAgregarM3 = 0,
): VolumenUbicacion {
  const cap = num(capacidadUtil)
  const ocupado = (num(volumenOcupadoM3) ?? 0) + Math.max(0, num(aAgregarM3) ?? 0)
  const vol = redondear3(ocupado)
  const cobertura = lineasTotal > 0 ? Math.round((lineasConVolumen / lineasTotal) * 100) : 100
  const avisoCobertura = lineasTotal > 0 && lineasConVolumen < lineasTotal
    ? `Calculado sobre ${lineasConVolumen} de ${lineasTotal} líneas: a las demás les faltan las medidas de la presentación, así que el volumen real es mayor.`
    : null

  if (cap == null || cap <= 0) {
    return { estado: 'sin_limite', volumenM3: vol, capacidadM3: null, cobertura, mensaje: null, avisoCobertura }
  }
  if (vol > cap) {
    return {
      estado: 'excedido', volumenM3: vol, capacidadM3: cap, cobertura, avisoCobertura,
      mensaje: `En esta ubicación entran ${cap} m³ útiles y hay ${vol} m³. Revisá el espacio.`,
    }
  }
  // 90%, igual que el peso: esperar al 100% exacto con un volumen subestimado por datos faltantes
  // equivale a no avisar nunca.
  if (vol >= cap * 0.9) {
    return {
      estado: 'lleno', volumenM3: vol, capacidadM3: cap, cobertura, avisoCobertura,
      mensaje: `Cerca del límite de espacio (${vol} de ${cap} m³ útiles).`,
    }
  }
  return { estado: 'ok', volumenM3: vol, capacidadM3: cap, cobertura, mensaje: null, avisoCobertura }
}

/**
 * Volumen en m³ que ocupa una cantidad expresada en una presentación concreta.
 * Espeja el cálculo de `vw_ubicacion_ocupacion` (mig 322): "3 cajas" ocupa 3 × el volumen de la
 * caja, **no** 36 × el de la unidad suelta. Devuelve null si la presentación no está medida —
 * null significa "no sé", que es distinto de 0.
 */
export function volumenDeCantidadM3(
  cantidad: number,
  altoCm: number | null | undefined,
  anchoCm: number | null | undefined,
  largoCm: number | null | undefined,
): number | null {
  const unitario = volumenUbicacionM3(largoCm, anchoCm, altoCm)
  const cant = num(cantidad) ?? 0
  if (unitario == null || !(cant > 0)) return null
  return redondear3(unitario * cant)
}

/** Texto corto para mostrar al lado del nombre de la ubicación: "3 de 4" / "3" si no hay tope. */
export function etiquetaOcupacion(c: CapacidadUbicacion): string {
  return c.capacidad == null ? String(c.ocupados) : `${c.ocupados} de ${c.capacidad}`
}

function num(v: unknown): number | null {
  // `numeric` de Postgres llega como string ("2.50") — normalizar antes de comparar.
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : null
}

function redondear3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000
}
