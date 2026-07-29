/** Atributos de variante por línea de inventario — talle/color/encaje/formato/sabor_aroma. */
export interface LineaConAtributos {
  talle?: string | null
  color?: string | null
  encaje?: string | null
  formato?: string | null
  sabor_aroma?: string | null
}

const ETIQUETAS: { key: keyof LineaConAtributos; label: string; emoji: string }[] = [
  { key: 'talle', label: 'Talle', emoji: '📏' },
  { key: 'color', label: 'Color', emoji: '🎨' },
  { key: 'encaje', label: 'Encaje', emoji: '✂️' },
  { key: 'formato', label: 'Formato', emoji: '📦' },
  { key: 'sabor_aroma', label: 'Sabor/Aroma', emoji: '🌸' },
]

/** Devuelve los atributos con valor cargado en esta línea, listos para mostrar como chips. */
export function atributosDeLinea(l: LineaConAtributos): { key: string; label: string; emoji: string; valor: string }[] {
  return ETIQUETAS
    .filter(e => l[e.key])
    .map(e => ({ key: e.key, label: e.label, emoji: e.emoji, valor: l[e.key] as string }))
}

/**
 * Si entre un conjunto de líneas hay MÁS DE UN valor distinto para algún atributo de variante,
 * elegir "cualquiera" (FIFO ciego) podría entregar/consumir una variante distinta de la
 * pedida — a diferencia de lote/ubicación, acá SÍ importa cuál se elige. Usado tanto en la venta
 * (VentasPage, vía `atributoAmbiguoEnStock` en ventasValidation.ts) como en rebaje masivo
 * (MasivoModal). Devuelve el primer atributo ambiguo encontrado, o null si no hay ambigüedad.
 */
export function atributoAmbiguoEnLineas(lineas: LineaConAtributos[]): { key: keyof LineaConAtributos; label: string } | null {
  for (const { key, label } of ETIQUETAS) {
    const valores = new Set(lineas.map(l => l[key]).filter((v): v is string => !!v))
    if (valores.size > 1) return { key, label }
  }
  return null
}

/**
 * Filtra líneas que coincidan con TODOS los valores de atributo seleccionados (los que vengan
 * vacíos/undefined en `seleccion` no filtran). Si `seleccion` está vacía, devuelve `lineas` tal
 * cual. Usado para no dejar que un rebaje consuma una variante distinta de la elegida.
 */
export function filtrarLineasPorAtributo<T extends LineaConAtributos>(
  lineas: T[],
  seleccion: Partial<Record<keyof LineaConAtributos, string>>,
): T[] {
  const claves = (Object.entries(seleccion) as [keyof LineaConAtributos, string | undefined][])
    .filter((entry): entry is [keyof LineaConAtributos, string] => !!entry[1])
  if (claves.length === 0) return lineas
  return lineas.filter(l => claves.every(([k, v]) => l[k] === v))
}

// ── Un producto usa UN modelo de variante, no dos (mig 314) ──────────────────────────────
// Los dos modelos coexisten en la app (decisión Eje A de GO) pero NO dentro del mismo producto:
//   · Atributos de variante (`tiene_talle`/…): UN SOLO SKU, el stock se banca junto y el talle/
//     color va en cada `inventario_lineas`.
//   · Variantes madre/hijo (`producto_padre_id`): cada variante es un SKU separado con su propio
//     stock, precio y código.
// Esto es el espejo (más amable) del CHECK `chk_productos_variante_sin_atributos` y del trigger
// `trg_productos_variante_atributos`. La DB igual revalida: la UI se cachea y el importador y las
// Edge Functions escriben con service_role sin pasar por acá.

export const CAMPOS_ATRIBUTO_VARIANTE = [
  'tiene_talle', 'tiene_color', 'tiene_encaje', 'tiene_formato', 'tiene_sabor_aroma',
] as const
export type CampoAtributoVariante = typeof CAMPOS_ATRIBUTO_VARIANTE[number]

export type ProductoConAtributos = Partial<Record<CampoAtributoVariante, boolean | null | undefined>>

/** ¿El producto tiene algún Atributo de variante activo? */
export function tieneAtributosVariante(p: ProductoConAtributos | null | undefined): boolean {
  if (!p) return false
  return CAMPOS_ATRIBUTO_VARIANTE.some(campo => !!p[campo])
}

/**
 * Por qué NO se pueden tocar los Atributos de variante de este producto (o null si sí se pueden).
 * Un hijo ya es un SKU separado; una madre agrupadora ya delegó el stock en sus hijos.
 */
export function motivoBloqueoAtributosVariante(
  ctx: { esHijo: boolean; esMadre: boolean; cantidadHijos?: number },
): string | null {
  if (ctx.esHijo) {
    return 'Esta variante ya es un SKU separado con su propio stock, así que no usa Atributos de variante. ' +
      'Los atributos son para UN SOLO SKU cuyo stock se banca junto y se distingue por talle/color en el depósito.'
  }
  if (ctx.esMadre) {
    const n = ctx.cantidadHijos ?? 0
    return `Este producto es un agrupador${n > 0 ? ` de ${n} variante${n === 1 ? '' : 's'}` : ''} y cada variante es un SKU separado con su propio stock. ` +
      'Son dos modelos incompatibles: si querés manejar talle/color dentro de un solo SKU, borrá primero las variantes.'
  }
  return null
}

/**
 * Por qué NO se le puede crear una variante a este producto (o null si sí se puede).
 * Convertirlo en agrupador teniendo Atributos de variante activos dejaría los dos modelos
 * conviviendo en el mismo SKU.
 */
export function motivoBloqueoCrearVariante(
  producto: (ProductoConAtributos & { nombre?: string | null }) | null | undefined,
): string | null {
  if (!tieneAtributosVariante(producto)) return null
  const nombre = producto?.nombre?.trim() || 'Este producto'
  return `"${nombre}" tiene Atributos de variante activos (talle/color/etc.), que manejan las variantes ` +
    'dentro de UN SOLO SKU. Las variantes madre/hijo son SKUs separados: son dos modelos incompatibles. ' +
    'Apagá los Atributos de variante más arriba y después creá las variantes.'
}
