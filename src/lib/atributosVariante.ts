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
