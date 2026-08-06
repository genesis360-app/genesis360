import { X } from 'lucide-react'
import { operadoresValidosParaCampo, operadorAjustado, type OperadorFiltro, type Combinador } from '@/lib/pildorasFiltro'

// Buscador tipo "chips": cada criterio queda como una píldora (Campo):operador+valor, editable
// sin perder el valor/operador al cambiar el campo. Varias píldoras se combinan con UN solo
// combinador Y/O global (no árbol de expresiones anidado — no lo pidieron). Nació en /picking
// (escribir un número a secas se tomaba como LPN/SKU/pedido/venta/envío a la vez) y se generalizó
// para reusarse en /productos y /inventario: cada página pasa su propio `camposFiltro` (ver
// `pildorasFiltro.ts` + `productosFiltro.ts`/`inventarioFiltro.ts`/`pickingFiltro.ts`).
//
// El campo queda tipado como `string` a propósito (no genérico sobre la unión de cada página):
// simplifica la inferencia en los 3 call sites a cambio de que cada página haga un `as CampoX`
// puntual en su callback — el valor siempre sale de la lista `camposFiltro` que ELLA misma pasó,
// así que el cast es seguro en runtime.
export interface CampoFiltroDef {
  campo: string
  label: string
  numerico?: boolean
}

export interface PildoraGenerica {
  id: string
  campo: string // 'libre' o uno de los `campo` de `camposFiltro`
  operador: OperadorFiltro
  valor: string
}

interface Props {
  camposFiltro: ReadonlyArray<CampoFiltroDef>
  pildoras: PildoraGenerica[]
  entrada: string
  combinador: Combinador
  placeholder?: string
  onEntradaChange: (v: string) => void
  onCommitEntrada: () => void
  onCampoChange: (id: string, campo: string) => void
  onOperadorChange: (id: string, operador: OperadorFiltro) => void
  onValorChange: (id: string, valor: string) => void
  onRemove: (id: string) => void
  onRemoveLast: () => void
  onCombinadorChange: (c: Combinador) => void
}

export function BuscadorPildoras({
  camposFiltro, pildoras, entrada, combinador, placeholder, onEntradaChange, onCommitEntrada,
  onCampoChange, onOperadorChange, onValorChange, onRemove, onRemoveLast, onCombinadorChange,
}: Props) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 w-full min-h-[46px] px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 focus-within:border-accent-text">
        {pildoras.map(p => (
          <span key={p.id} data-testid="pildora" data-pildora-campo={p.campo} data-pildora-valor={p.valor}
            className="inline-flex items-center gap-0.5 pl-1.5 pr-1 py-0.5 rounded-full bg-accent/10 border border-accent/30 text-xs text-accent-text whitespace-nowrap">
            {p.campo === 'libre' ? (
              <span className="px-0.5">{p.valor}</span>
            ) : (
              <>
                <select value={p.campo} onChange={e => onCampoChange(p.id, e.target.value)}
                  data-testid="pildora-campo"
                  className="bg-transparent font-semibold outline-none cursor-pointer appearance-none pr-0.5">
                  {camposFiltro.map(c => <option key={c.campo} value={c.campo}>{c.label}</option>)}
                </select>
                <select value={p.operador} onChange={e => onOperadorChange(p.id, e.target.value as OperadorFiltro)}
                  data-testid="pildora-operador"
                  className="bg-transparent outline-none cursor-pointer appearance-none font-bold px-0.5">
                  {operadoresValidosParaCampo(p.campo, camposFiltro).map(o => <option key={o.operador} value={o.operador}>{o.simbolo}</option>)}
                </select>
                <input type="text" value={p.valor} onChange={e => onValorChange(p.id, e.target.value)}
                  data-testid="pildora-valor"
                  style={{ width: `${Math.max(2, p.valor.length + 1)}ch` }}
                  className="bg-transparent outline-none min-w-0" />
              </>
            )}
            <button type="button" onClick={() => onRemove(p.id)} title="Quitar" data-testid="pildora-quitar"
              className="ml-0.5 text-accent-text/60 hover:text-red-500 flex-shrink-0">
              <X size={12} />
            </button>
          </span>
        ))}
        <input type="text" value={entrada}
          onChange={e => onEntradaChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && entrada.trim()) { e.preventDefault(); onCommitEntrada() }
            else if (e.key === 'Backspace' && !entrada && pildoras.length > 0) onRemoveLast()
          }}
          placeholder={pildoras.length === 0 ? placeholder : ''}
          data-testid="buscador-entrada"
          className="flex-1 min-w-[100px] bg-transparent outline-none text-sm py-1" />
      </div>
      {pildoras.length + (entrada.trim() ? 1 : 0) > 1 && (
        <div className="flex items-center gap-1.5 mt-1.5 text-xs text-gray-500 dark:text-gray-400">
          Combinar con
          <button type="button" onClick={() => onCombinadorChange('Y')} data-testid="combinador-y"
            className={`px-2 py-0.5 rounded-full font-medium ${combinador === 'Y' ? 'bg-accent text-white' : 'bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>Y</button>
          <button type="button" onClick={() => onCombinadorChange('O')} data-testid="combinador-o"
            className={`px-2 py-0.5 rounded-full font-medium ${combinador === 'O' ? 'bg-accent text-white' : 'bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>O</button>
        </div>
      )}
    </div>
  )
}

/** Al cambiar el campo de una píldora existente, conserva operador/valor — ajusta el operador
 * SOLO si deja de ser válido para el campo nuevo (ej. "mayor" sobre un campo de texto). */
export function pildoraConCampoNuevo<P extends { operador: OperadorFiltro }>(
  p: P, campo: string, camposFiltro: ReadonlyArray<CampoFiltroDef>,
): P & { campo: string } {
  return { ...p, campo, operador: operadorAjustado(p.operador, campo, camposFiltro) }
}
