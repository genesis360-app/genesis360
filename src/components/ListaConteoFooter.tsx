/**
 * Barra inferior finita para listas/tablas — muestra cuántos registros hay con el filtro
 * aplicado vs. el total (pedido de GO, 2026-08-06): "para saber cuántos SKU tengo en el
 * filtro aplicado o sin filtro para saber cantidad total".
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
  const plural = (n: number) => `${entidad}${n === 1 ? '' : 's'}`
  return (
    <div className="flex items-center justify-end px-3 py-1 border-t border-gray-100 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-800/60 flex-shrink-0">
      <span className="text-[11px] text-gray-400 dark:text-gray-500">
        {totalTruncado
          ? `Mostrando ${mostrados} de los últimos ${total} ${plural(total)}`
          : mostrados === total
            ? `${mostrados} ${plural(mostrados)}`
            : `Mostrando ${mostrados} de ${total} ${plural(total)}`}
      </span>
    </div>
  )
}
