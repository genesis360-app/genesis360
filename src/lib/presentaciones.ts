// Presentaciones de empaque — lógica pura (Fase 5 del rediseño UoM/Empaque/Variantes, mig 310).
//
// `producto_presentaciones` es la FUENTE DE VERDAD del empaque desde la mig 310 (antes era un
// espejo derivado de `producto_estructura_niveles`, una cadena lineal que no podía expresar
// HERMANAS). Modelo final de Fede:
//
//   · Es un ÁRBOL GENEALÓGICO: cada presentación declara de cuál CUELGA y cuántas de esa
//     contiene ("Pallet-A = 100 Caja-8"). La equivalencia total en unidades base (`factor_base`)
//     se RESUELVE subiendo la cadena y se guarda resuelta.
//   · Admite HERMANAS: "Caja-12" y "Caja-10" del mismo producto, ambas colgando de la base.
//   · El empaque es LOGÍSTICA PURA: sin precio propio. El precio vive en la unidad base + tiers
//     (mig 306/307). Ver `precioPresentacion` en estructuras.ts.
//
// 🛑 Regla #0 (inventario): los factores son SIEMPRE enteros. La conversión a unidades base tiene
// que ser exacta — el stock se guarda en la unidad base. Esta lib es la UI/preview; el guard real
// es `fn_presentaciones_guardar`, que revalida lo mismo server-side.

/** Fila del editor. `cantidad_padre` es lo que carga el usuario; el factor se deriva. */
export interface PresentacionRow {
  /** Clave estable de React y de referencia padre↔hijo dentro del form. */
  key: string
  etiqueta: string
  nombre_empaque_id: string
  /** null = es la presentación BASE (factor 1, raíz del árbol). */
  padre_key: string | null
  /** Cuántas unidades del PADRE contiene (texto del input). Vacío en la base. */
  cantidad_padre: string
  peso: string
  alto: string
  ancho: string
  largo: string
}

export interface PresentacionRPC {
  padre_idx: number | null
  nombre_empaque_id: string | null
  etiqueta: string
  factor_base: number
  peso_kg: number | null
  alto_cm: number | null
  ancho_cm: number | null
  largo_cm: number | null
}

const enteroDe = (texto: string): number | null => {
  const t = (texto ?? '').trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isInteger(n) ? n : null
}

/** La fila base: la única sin padre. */
export function filaBase(rows: PresentacionRow[]): PresentacionRow | null {
  return rows.find(r => r.padre_key === null) ?? null
}

/**
 * Equivalencia total en unidades base de una fila: sube la cadena multiplicando.
 * Devuelve null si la cadena está incompleta, tiene un ciclo o un valor inválido.
 */
export function factorBaseDe(row: PresentacionRow, rows: PresentacionRow[]): number | null {
  let actual: PresentacionRow | undefined = row
  let factor = 1
  const vistas = new Set<string>()
  while (actual && actual.padre_key !== null) {
    if (vistas.has(actual.key)) return null       // ciclo
    vistas.add(actual.key)
    const n = enteroDe(actual.cantidad_padre)
    if (n === null || n < 1) return null
    factor *= n
    actual = rows.find(r => r.key === actual!.padre_key)
    if (!actual) return null                       // padre inexistente
  }
  return actual ? factor : null                    // se llegó a la base
}

/**
 * Valida el árbol completo. Devuelve el mensaje de error o null.
 * Espeja las validaciones de `fn_presentaciones_guardar` (la RPC igual revalida: la UI se cachea).
 *
 * `exigirMedidas` = el tenant tiene el **cubicaje** activo (`tenants.cubicaje_habilitado`, mig 322):
 * ahí el peso y las tres medidas dejan de ser opcionales, porque un nivel sin medir aporta 0 m³ y
 * hace que el volumen ocupado quede corto — el error empuja hacia "parece que hay lugar". El guard
 * real es el trigger `trg_presentaciones_exige_medidas`; esto es para que el error se vea al tipear
 * y no como una excepción de Postgres al guardar.
 */
export function validarPresentaciones(rows: PresentacionRow[], exigirMedidas = false): string | null {
  if (rows.length === 0) return 'Tiene que haber al menos la presentación base.'

  const bases = rows.filter(r => r.padre_key === null)
  if (bases.length !== 1) return 'Tiene que haber exactamente una presentación base (la unidad suelta).'

  const etiquetas = new Set<string>()
  for (const r of rows) {
    const etiqueta = r.etiqueta.trim()
    if (!etiqueta) return 'Todas las presentaciones necesitan un nombre.'
    if (etiquetas.has(etiqueta.toLowerCase()))
      return `Hay dos presentaciones llamadas "${etiqueta}": los nombres tienen que ser distintos.`
    etiquetas.add(etiqueta.toLowerCase())

    if (r.padre_key !== null) {
      const padre = rows.find(x => x.key === r.padre_key)
      if (!padre) return `"${etiqueta}": elegí de qué presentación cuelga.`
      const n = enteroDe(r.cantidad_padre)
      if (n === null || n < 2)
        return `"${etiqueta}": tiene que contener 2 o más de "${padre.etiqueta.trim() || '—'}" (un número entero).`
      if (factorBaseDe(r, rows) === null)
        return `"${etiqueta}": la cadena de empaque está incompleta o se muerde la cola.`
    }

    for (const [campo, label] of [
      [r.peso, 'peso'], [r.alto, 'alto'], [r.ancho, 'ancho'], [r.largo, 'largo'],
    ] as const) {
      if (campo.trim() !== '' && !(Number(campo) > 0))
        return `"${etiqueta}": el ${label} tiene que ser mayor a 0.`
      if (exigirMedidas && campo.trim() === '')
        return `"${etiqueta}": el cubicaje está activado, así que hace falta cargar el ${label}. Podés desactivarlo en Configuración → Inventario.`
    }
  }

  // Dos presentaciones con el MISMO factor son la misma cosa con dos nombres → confunde al operario.
  const porFactor = new Map<number, string>()
  for (const r of rows) {
    const f = factorBaseDe(r, rows)
    if (f === null) continue
    const previa = porFactor.get(f)
    if (previa) return `"${r.etiqueta.trim()}" y "${previa}" equivalen a las mismas ${f} unidades base: dejá una sola.`
    porFactor.set(f, r.etiqueta.trim())
  }
  return null
}

/**
 * Profundidad de una fila respecto de la base (0 = la base misma, "NB"). Sube la cadena de
 * padres contando saltos. Es la agrupación VISUAL por nivel del editor (Fede 25/7, punto 4) — no
 * cambia el modelo de datos, solo cómo se agrupan las filas en pantalla.
 */
export function profundidadDe(row: PresentacionRow, rows: PresentacionRow[]): number {
  let actual: PresentacionRow | undefined = row
  let profundidad = 0
  const vistas = new Set<string>()
  while (actual && actual.padre_key !== null) {
    if (vistas.has(actual.key)) return profundidad // ciclo (defensivo, no debería pasar con datos válidos)
    vistas.add(actual.key)
    profundidad++
    actual = rows.find(r => r.key === actual!.padre_key)
  }
  return profundidad
}

/**
 * Agrupa las filas por nivel (profundidad) para la "burbuja" visual de cada nivel: 0 = NB, 1, 2…
 * Dentro de cada nivel, hermanas ordenadas de MENOR a MAYOR cantidad de unidades base (pedido de
 * Fede) — no por el orden de creación crudo.
 */
export function agruparPorNivel(rows: PresentacionRow[]): { nivel: number; filas: PresentacionRow[] }[] {
  const porNivel = new Map<number, PresentacionRow[]>()
  for (const r of rows) {
    const n = profundidadDe(r, rows)
    if (!porNivel.has(n)) porNivel.set(n, [])
    porNivel.get(n)!.push(r)
  }
  return [...porNivel.entries()]
    .sort(([a], [b]) => a - b)
    .map(([nivel, filas]) => ({
      nivel,
      filas: filas.slice().sort((a, b) => (factorBaseDe(a, rows) ?? 0) - (factorBaseDe(b, rows) ?? 0)),
    }))
}

/**
 * Ordena las filas para que un padre SIEMPRE aparezca antes que sus hijos (recorrido en anchura
 * desde la base) y las convierte al payload de `fn_presentaciones_guardar`, donde el padre se
 * referencia por su ÍNDICE anterior en el array — así el árbol no puede tener ciclos.
 * Devuelve null si el árbol no es válido.
 */
export function construirPayload(rows: PresentacionRow[]): PresentacionRPC[] | null {
  const base = filaBase(rows)
  if (!base) return null

  const ordenadas: PresentacionRow[] = [base]
  let cambio = true
  while (cambio) {
    cambio = false
    for (const r of rows) {
      if (ordenadas.includes(r)) continue
      if (ordenadas.some(o => o.key === r.padre_key)) { ordenadas.push(r); cambio = true }
    }
  }
  if (ordenadas.length !== rows.length) return null   // quedaron huérfanas o en ciclo

  const num = (t: string) => (t.trim() === '' ? null : Number(t))
  return ordenadas.map(r => {
    const factor = factorBaseDe(r, rows)
    if (factor === null) throw new Error(`Cadena inválida en "${r.etiqueta}"`)
    return {
      padre_idx: r.padre_key === null ? null : ordenadas.findIndex(o => o.key === r.padre_key),
      nombre_empaque_id: r.nombre_empaque_id || null,
      etiqueta: r.etiqueta.trim(),
      factor_base: factor,
      peso_kg: num(r.peso),
      alto_cm: num(r.alto),
      ancho_cm: num(r.ancho),
      largo_cm: num(r.largo),
    }
  })
}

/** Fila como viene de la DB, para reconstruir el form. */
export interface PresentacionFila {
  id: string
  etiqueta: string
  nombre_empaque_id: string | null
  factor_base: number
  es_base: boolean
  padre_linea_id: string | null
  orden: number
  peso_kg: number | null
  alto_cm: number | null
  ancho_cm: number | null
  largo_cm: number | null
}

/** Convierte lo guardado en DB al modelo del editor (deriva `cantidad_padre` del factor). */
export function filasAForm(filas: PresentacionFila[]): PresentacionRow[] {
  const porId = new Map(filas.map(f => [f.id, f]))
  const txt = (n: number | null) => (n === null || n === undefined ? '' : String(n))
  return filas
    .slice()
    .sort((a, b) => a.orden - b.orden)
    .map(f => {
      const padre = f.padre_linea_id ? porId.get(f.padre_linea_id) : null
      return {
        key: f.id,
        etiqueta: f.etiqueta,
        nombre_empaque_id: f.nombre_empaque_id ?? '',
        padre_key: f.padre_linea_id,
        cantidad_padre: padre && padre.factor_base > 0 ? String(f.factor_base / padre.factor_base) : '',
        peso: txt(f.peso_kg), alto: txt(f.alto_cm), ancho: txt(f.ancho_cm), largo: txt(f.largo_cm),
      }
    })
}

/**
 * Resumen legible del árbol: "Caja = 12 × unidad · Pallet = 18 × Caja (= 216 unidades)".
 * Es lo que ve el operario para confirmar que la conversión quedó bien cargada.
 */
export function resumenArbol(rows: PresentacionRow[]): string {
  const base = filaBase(rows)
  if (!base) return 'Sin presentación base'
  const hijos = rows.filter(r => r.padre_key !== null)
  if (hijos.length === 0) return `${base.etiqueta || 'Unidad'} (base)`
  return hijos.map(r => {
    const padre = rows.find(x => x.key === r.padre_key)
    const factor = factorBaseDe(r, rows)
    const total = factor !== null && padre && padre.padre_key !== null
      ? ` (= ${factor} ${base.etiqueta})` : ''
    return `${r.etiqueta || '—'} = ${r.cantidad_padre || '?'} × ${padre?.etiqueta ?? '—'}${total}`
  }).join(' · ')
}

/** Convierte una cantidad expresada en una presentación a unidades base (exacto). */
export function aUnidadesBase(cantidad: number, factorBase: number): number {
  return cantidad * factorBase
}

/**
 * Adaptador presentaciones → la forma `NivelEstructuraDB` que ya consumen los selectores de UoM
 * de Inventario / Recepciones / LPN / Masivo (mig 282).
 *
 * Fase 5 (mig 310): la conversión dejó de vivir en `producto_estructura_niveles` y pasó a
 * `producto_presentaciones`. Mapear en vez de reescribir cada pantalla mantiene intacta la
 * aritmética ya probada (`unidades_base` es el multiplicador exacto a unidad base) — que es
 * justo lo que NO conviene tocar cuando se mueve stock (Regla #0).
 *   · `unidades_base` ← `factor_base` (mismo número, misma semántica)
 *   · `unidades_medida.nombre` ← `etiqueta` (lo que ve el operario: "Caja-12")
 */
export function presentacionesComoNiveles(filas: PresentacionFila[]) {
  return filas
    .slice()
    .sort((a, b) => a.factor_base - b.factor_base)
    .map(f => ({
      id: f.id,
      estructura_id: '',
      orden: f.orden,
      factor: f.factor_base,
      unidades_base: f.factor_base,
      // NULL cuando la presentación no tiene tipo de empaque (la BASE nunca lo tiene: es la
      // unidad suelta). No devolver '' — se escribe en `inventario_lineas.unidad_medida_id`,
      // que es uuid, y un string vacío revienta el INSERT del LPN.
      unidad_medida_id: f.nombre_empaque_id,
      peso_kg: f.peso_kg,
      alto_cm: f.alto_cm,
      ancho_cm: f.ancho_cm,
      largo_cm: f.largo_cm,
      unidades_medida: { nombre: f.etiqueta, simbolo: null as string | null },
    }))
}

/** Columnas que hay que traer de `producto_presentaciones` para usar el adaptador de arriba. */
export const PRESENTACION_COLS =
  'id, etiqueta, nombre_empaque_id, factor_base, es_base, padre_linea_id, orden, peso_kg, alto_cm, ancho_cm, largo_cm'
