import { create } from 'zustand'

/**
 * El contador "Mostrando N de M..." lo calcula cada página (Productos/Inventario/Clientes/Envíos),
 * pero la BARRA visual la pinta `AppLayout` como hermana fija de `<main>` — igual que el header — para
 * que el contenido se achique y quede clippeado arriba de ella en vez de superponerse (`position:
 * sticky` dentro de una lista larga no reserva espacio: el footer terminaba flotando encima de la
 * última fila en vez de cortar la lista como corta el header, pedido de GO 2026-08-11).
 *
 * Desde el 2026-09-24 la barra también lleva el PAGINADO (pedido de GO): cuántos registros mostrar
 * —50, 100 o 500— y con qué botones pasar de página. Vive acá y no en cada página por lo mismo de
 * siempre: es una sola barra, y así cualquier listado que la adopte lo hereda gratis.
 */
export interface PaginacionLista {
  pagina: number
  tamano: number
  totalPaginas: number
  /** Índices 1-based del primer y último registro visible, para el texto "101-200 de 1.177". */
  desde: number
  hasta: number
  setPagina: (p: number) => void
  setTamano: (t: number) => void
}

export interface ListaConteo {
  mostrados: number
  total: number
  entidad: string
  totalTruncado?: boolean
  /** Ausente = la página no pagina y la barra es solo el contador de siempre. */
  paginacion?: PaginacionLista
}

interface ListaConteoState {
  conteo: ListaConteo | null
  setConteo: (conteo: ListaConteo) => void
  clearConteo: () => void
}

export const useListaConteoStore = create<ListaConteoState>((set) => ({
  conteo: null,
  setConteo: (conteo) => set({ conteo }),
  clearConteo: () => set({ conteo: null }),
}))
