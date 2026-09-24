/**
 * traerTodo.ts — traer un listado COMPLETO de PostgREST, sin el tope silencioso de 1000 filas.
 *
 * 🛑 El bug que resuelve (encontrado el 2026-09-24): PostgREST corta toda respuesta en 1000 filas.
 * Una query sin `.range()` NO falla ni avisa: devuelve 1000 y la app muestra 1000 como si fueran
 * todas. Medido contra la API real en el catálogo de pruebas:
 *
 *     Content-Range: 0-999/1177      ← 177 productos que la app no mostraba nunca
 *
 * Y como el buscador de esas páginas filtra sobre lo que ya está cargado, un registro más allá del
 * corte no aparecía **ni buscándolo por nombre**. Peor todavía en `inventario_lineas`, donde el
 * recorte no se ve como "faltan filas" sino como **stock equivocado** (REGLA #0).
 *
 * Acá se pide de a tandas hasta que la base devuelve menos de lo pedido, que es la señal de que no
 * queda nada. El tope de seguridad existe solo para que un error de filtro no cuelgue el navegador
 * pidiendo millones de filas — no es un límite de producto.
 */

/** Lo que devuelve una query de supabase-js: `{ data, error }`. */
export interface LoteRespuesta<T> {
  data: T[] | null
  error: { message: string } | null
}

/** El máximo que PostgREST devuelve por respuesta. Pedir más no sirve: lo recorta igual. */
export const TAMANO_LOTE = 1000

/** Techo de seguridad. Ningún negocio real lo alcanza; está para que un filtro roto no cuelgue todo. */
export const MAX_FILAS = 50_000

export interface OpcionesTraerTodo {
  tamanoLote?: number
  maxFilas?: number
  /** Se llama si se alcanzó el techo de seguridad: el resultado quedó incompleto y hay que saberlo. */
  onTecho?: (filas: number) => void
}

/**
 * @param traerLote recibe el rango [desde, hasta] (inclusive, como `.range()` de supabase-js) y
 *                  devuelve esa tanda.
 *
 * @example
 *   const productos = await traerTodo<Producto>((desde, hasta) =>
 *     supabase.from('productos').select('*').eq('tenant_id', id).order('nombre').range(desde, hasta))
 */
export async function traerTodo<T>(
  traerLote: (desde: number, hasta: number) => PromiseLike<LoteRespuesta<T>>,
  opciones: OpcionesTraerTodo = {},
): Promise<T[]> {
  const tamanoLote = opciones.tamanoLote ?? TAMANO_LOTE
  const maxFilas = opciones.maxFilas ?? MAX_FILAS

  const todas: T[] = []
  let desde = 0

  for (;;) {
    const { data, error } = await traerLote(desde, desde + tamanoLote - 1)
    if (error) throw new Error(error.message)

    const lote = data ?? []
    todas.push(...lote)

    // La base devolvió menos de lo que le pedimos: no queda nada más.
    if (lote.length < tamanoLote) return todas

    if (todas.length >= maxFilas) {
      // Devolver lo que hay es mejor que colgar el navegador, pero NO es "todo": que se note.
      console.error(`[traerTodo] techo de seguridad de ${maxFilas} filas alcanzado — el resultado está incompleto`)
      opciones.onTecho?.(todas.length)
      return todas
    }

    desde += tamanoLote
  }
}

/**
 * Igual que `traerTodo`, pero devolviendo `{ data, error }` como cualquier query de supabase-js.
 *
 * Existe para que sacarle el tope a una query existente sea cambiar UNA línea: el `const { data,
 * error } = await supabase.from(...)` de alrededor sigue igual, y con él todo el manejo de error
 * que ya tenía. Menos reescritura, menos chance de romper algo al pasar.
 */
export async function traerTodoConError<T>(
  traerLote: (desde: number, hasta: number) => PromiseLike<LoteRespuesta<T>>,
  opciones: OpcionesTraerTodo = {},
): Promise<LoteRespuesta<T>> {
  try {
    return { data: await traerTodo(traerLote, opciones), error: null }
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : 'Error al traer los datos' } }
  }
}
