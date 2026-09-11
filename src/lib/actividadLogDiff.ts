// actividadLogDiff — el detalle de "qué se editó" que va al historial.
//
// Vive APARTE de `actividadLog.ts` a propósito: esto es lógica pura y `actividadLog.ts` importa
// `@/lib/supabase`, que hace `throw` en tiempo de IMPORT si faltan las env vars de Vite. Testear
// una función pura no puede depender de tener credenciales: en CI no hay `.env.local` y el
// `import.meta.env` que arma `tests/unit/setup.ts` llega tarde — Vite resuelve `import.meta.env.VITE_*`
// en tiempo de transform, no en runtime. Mismo patrón que el resto de la lógica pura del repo
// (`ccLogic`, `tiers`, `cajaBoveda`, …): sin I/O, testeable sola.
//
// Pedido de Fede (2026-09-08): "en el módulo historial debería aparecer el detalle cuando alguien
// edita un producto, ver los campos o cosas que se editaron".

export interface CampoCambiado {
  campo: string
  anterior: string | null
  nuevo: string | null
}

/** `null`, `undefined` y `''` son lo mismo a los ojos del historial: "vacío". */
function normalizar(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'boolean') return v ? 'sí' : 'no'
  const s = String(v).trim()
  return s === '' ? null : s
}

/**
 * Compara los valores viejos contra el payload que se va a guardar y devuelve SOLO lo que cambió.
 *
 * 🛑 El `numeric` de Postgres llega como STRING (`"1500.00"`), así que comparar en crudo contra el
 * `1500` del formulario marcaría como "cambiado" un precio que nadie tocó — y el historial se
 * llenaría de ruido en cada guardado. Por eso, si los dos lados son numéricos, se comparan como
 * números. (Es el mismo gotcha que ya mordió con la alícuota de IVA.)
 *
 * Solo mira las claves que están en `etiquetas`: el historial es para humanos, no un dump de fila.
 */
export function diffCampos(
  original: Record<string, unknown> | null | undefined,
  nuevo: Record<string, unknown>,
  etiquetas: Record<string, string>,
): CampoCambiado[] {
  if (!original) return []
  const cambios: CampoCambiado[] = []
  for (const [clave, etiqueta] of Object.entries(etiquetas)) {
    if (!(clave in nuevo)) continue
    const a = normalizar(original[clave])
    const b = normalizar(nuevo[clave])
    if (a === b) continue
    // Ambos numéricos → comparar como números, no como texto.
    if (a !== null && b !== null && a !== '' && b !== '' && !isNaN(Number(a)) && !isNaN(Number(b))) {
      if (Number(a) === Number(b)) continue
    }
    cambios.push({ campo: etiqueta, anterior: a, nuevo: b })
  }
  return cambios
}
