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
