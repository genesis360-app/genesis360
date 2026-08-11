import { useEffect } from 'react'
import { useListaConteoStore } from '@/store/listaConteoStore'

/**
 * Barra inferior finita para listas/tablas — muestra cuántos registros hay con el filtro
 * aplicado vs. el total (pedido de GO, 2026-08-06): "para saber cuántos SKU tengo en el
 * filtro aplicado o sin filtro para saber cantidad total".
 *
 * No pinta nada acá: publica el conteo a `useListaConteoStore` y es `AppLayout` quien pinta la
 * barra real, como hermana fija de `<main>` — mismo mecanismo que el header. Antes usaba
 * `position: sticky` dentro de la lista (pedido de GO 2026-08-10), pero eso no reserva espacio en
 * el flujo: en listas largas el footer terminaba flotando ENCIMA de la última fila en vez de
 * cortar la lista como corta el header (bug real reportado por GO 2026-08-11, con captura).
 */
interface ListaConteoFooterProps {
  mostrados: number
  total: number
  /** Singular de la entidad, ej. "producto", "cliente" — se pluraliza agregando "s". */
  entidad: string
  /** El `total` viene de una query con límite (ej. `.limit(100)`) y puede no ser exacto. */
  totalTruncado?: boolean
}

export function ListaConteoFooter({ mostrados, total, entidad, totalTruncado = false }: ListaConteoFooterProps) {
  const setConteo = useListaConteoStore(s => s.setConteo)
  const clearConteo = useListaConteoStore(s => s.clearConteo)

  useEffect(() => {
    setConteo({ mostrados, total, entidad, totalTruncado })
    return () => clearConteo()
  }, [mostrados, total, entidad, totalTruncado, setConteo, clearConteo])

  return null
}
