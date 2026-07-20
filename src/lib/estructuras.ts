/**
 * Lógica pura de estructuras de producto con niveles dinámicos por UdM
 * (estilo "pack structure / footprint" de Blue Yonder — mig 282).
 *
 * Modelo: cada estructura tiene N niveles ordenados. El nivel 1 es la UdM base
 * (factor 1); cada nivel siguiente declara cuántos del nivel ANTERIOR contiene
 * (caja = 12 unidades, pallet = 40 cajas). `unidades_base` es el producto
 * acumulado de factores = equivalencia total en la UdM base.
 *
 * REGLA #0 inventario: factores SIEMPRE enteros ≥ 1 — la conversión a unidades
 * base tiene que ser exacta, sin floats. El server (fn_estructura_guardar_niveles)
 * recalcula y valida lo mismo: esta lib es la UI/preview, el guard real vive en DB.
 */

export interface NivelEstructura {
  unidad_medida_id: string
  /** Cuántos del nivel anterior contiene. El nivel 1 siempre es 1. */
  factor: number
  /** Equivalencia total en la UdM base (producto acumulado de factores). */
  unidades_base: number
  peso_kg?: number | null
  alto_cm?: number | null
  ancho_cm?: number | null
  largo_cm?: number | null
}

/** Fila de nivel como viene de DB con el join a unidades_medida. */
export interface NivelEstructuraDB extends NivelEstructura {
  id: string
  estructura_id: string
  orden: number
  unidades_medida?: { nombre: string; simbolo: string | null } | null
}

/** Input del formulario: strings crudos de los inputs. */
export interface NivelForm {
  unidad_medida_id: string
  factor: string
  peso: string
  alto: string
  ancho: string
  largo: string
}

/**
 * Calcula la equivalencia acumulada en unidades base de cada nivel.
 * factores[0] se ignora (la base siempre es 1).
 * Devuelve null si algún factor no es un entero ≥ 1 (no se puede calcular).
 */
export function calcularUnidadesBase(factores: number[]): number[] | null {
  const out: number[] = []
  let acum = 1
  for (let i = 0; i < factores.length; i++) {
    const f = i === 0 ? 1 : factores[i]
    if (!Number.isInteger(f) || f < 1) return null
    acum *= f
    out.push(acum)
  }
  return out
}

/**
 * Valida los niveles del formulario. Devuelve el mensaje de error o null si es válido.
 * Espeja las validaciones server-side de fn_estructura_guardar_niveles.
 */
export function validarNiveles(niveles: NivelForm[]): string | null {
  if (niveles.length === 0) return 'La estructura necesita al menos un nivel.'

  const udmVistas = new Set<string>()
  for (let i = 0; i < niveles.length; i++) {
    const n = niveles[i]
    const pos = `Nivel ${i + 1}`

    if (!n.unidad_medida_id) return `${pos}: elegí la unidad de medida.`
    if (udmVistas.has(n.unidad_medida_id))
      return 'No se puede repetir la misma unidad de medida en dos niveles.'
    udmVistas.add(n.unidad_medida_id)

    if (i > 0) {
      const f = Number(n.factor)
      if (!n.factor.trim() || !Number.isInteger(f) || f < 1)
        return `${pos}: el factor debe ser un entero mayor o igual a 1.`
    }

    // Dimensiones/peso: opcionales, pero si se cargan deben ser > 0
    for (const [campo, label] of [
      [n.peso, 'peso'], [n.alto, 'alto'], [n.ancho, 'ancho'], [n.largo, 'largo'],
    ] as const) {
      if (campo.trim() !== '' && !(Number(campo) > 0))
        return `${pos}: el ${label} debe ser mayor a 0.`
    }
  }
  return null
}

/** Convierte los niveles del form al payload jsonb de fn_estructura_guardar_niveles. */
export function nivelesAPayload(niveles: NivelForm[]) {
  return niveles.map((n, i) => ({
    unidad_medida_id: n.unidad_medida_id,
    factor: i === 0 ? 1 : Number(n.factor),
    peso_kg: n.peso.trim() !== '' ? Number(n.peso) : null,
    alto_cm: n.alto.trim() !== '' ? Number(n.alto) : null,
    ancho_cm: n.ancho.trim() !== '' ? Number(n.ancho) : null,
    largo_cm: n.largo.trim() !== '' ? Number(n.largo) : null,
  }))
}

/** Nombre visible de la UdM de un nivel (fallback si el join no vino). */
export function nombreUdm(n: Pick<NivelEstructuraDB, 'unidades_medida'>): string {
  return n.unidades_medida?.nombre ?? '—'
}

/**
 * Resumen de la cadena de conversión: "Caja = 12 × Unidad · Pallet = 40 × Caja (= 480 × Unidad)".
 * Con un solo nivel: "Unidad (base)". Los niveles deben venir ordenados por `orden`.
 */
export function cadenaConversion(niveles: NivelEstructuraDB[]): string {
  if (niveles.length === 0) return 'Sin niveles'
  const base = nombreUdm(niveles[0])
  if (niveles.length === 1) return `${base} (base)`
  return niveles.slice(1).map((n, i) => {
    const anterior = nombreUdm(niveles[i]) // slice(1)[i] === niveles[i+1] → niveles[i] es el anterior
    const extra = i === 0 ? '' : ` (= ${n.unidades_base} × ${base})`
    return `${nombreUdm(n)} = ${n.factor} × ${anterior}${extra}`
  }).join(' · ')
}

/**
 * Convierte una cantidad expresada en un nivel a unidades base (exacto, enteros).
 * Base para operar por UdM al ingresar stock (Fase 2).
 */
export function convertirABase(cantidad: number, nivel: Pick<NivelEstructura, 'unidades_base'>): number {
  if (!Number.isInteger(cantidad) || cantidad < 0) throw new Error('Cantidad inválida')
  return cantidad * nivel.unidades_base
}
