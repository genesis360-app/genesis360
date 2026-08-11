import { create } from 'zustand'

/**
 * El contador "Mostrando N de M..." lo calcula cada página (Productos/Inventario/Clientes/Envíos),
 * pero la BARRA visual la pinta `AppLayout` como hermana fija de `<main>` — igual que el header — para
 * que el contenido se achique y quede clippeado arriba de ella en vez de superponerse (`position:
 * sticky` dentro de una lista larga no reserva espacio: el footer terminaba flotando encima de la
 * última fila en vez de cortar la lista como corta el header, pedido de GO 2026-08-11).
 */
export interface ListaConteo {
  mostrados: number
  total: number
  entidad: string
  totalTruncado?: boolean
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
