import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'

export type AtributoVariante = 'talle' | 'color' | 'encaje' | 'formato' | 'sabor_aroma'

const NUEVO = '__nuevo__'

/**
 * Select de un valor de "atributo de variante" (talle/color/encaje/formato/sabor_aroma) contra
 * el catálogo configurable del tenant (mig 273). Si el valor tipeado no está en el catálogo
 * todavía, "+ Agregar nuevo valor…" lo crea ahí mismo (sin ir a Configuración) y queda
 * disponible para las próximas cargas — mismo objetivo que el catálogo: no fragmentar el stock
 * con variantes de tipeo ("M" vs "Mediana").
 */
export function AtributoValorSelect({
  tenantId, atributo, value, onChange, placeholder, className,
}: {
  tenantId: string
  atributo: AtributoVariante
  value: string
  onChange: (valor: string) => void
  placeholder?: string
  className?: string
}) {
  const qc = useQueryClient()
  const [modo, setModo] = useState<'select' | 'nueva'>('select')
  const [nuevoValor, setNuevoValor] = useState('')
  const [guardando, setGuardando] = useState(false)

  const { data: opciones = [] } = useQuery({
    queryKey: ['atributo-variante-valores', tenantId, atributo],
    queryFn: async () => {
      const { data } = await supabase.from('atributos_variante_valores')
        .select('id, valor').eq('tenant_id', tenantId).eq('atributo', atributo).eq('activo', true)
        .order('orden').order('valor')
      return (data ?? []) as { id: string; valor: string }[]
    },
    enabled: !!tenantId,
  })

  const cls = className ?? 'w-full px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-xs focus:outline-none focus:border-accent-text dark:bg-gray-600'

  const guardarNuevo = async () => {
    const v = nuevoValor.trim()
    if (!v) { setModo('select'); return }
    setGuardando(true)
    const { error } = await supabase.from('atributos_variante_valores').insert({ tenant_id: tenantId, atributo, valor: v })
    setGuardando(false)
    if (error && !/duplicate key|unique/i.test(error.message)) { toast.error(error.message); return }
    qc.invalidateQueries({ queryKey: ['atributo-variante-valores', tenantId, atributo] })
    onChange(v)
    setModo('select')
    setNuevoValor('')
  }

  if (modo === 'nueva') {
    return (
      <div className="flex items-center gap-1">
        <input type="text" autoFocus value={nuevoValor} onChange={e => setNuevoValor(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && guardarNuevo()}
          onBlur={guardarNuevo}
          disabled={guardando}
          placeholder={placeholder ?? 'Nuevo valor'}
          className={cls} />
        <button type="button" onClick={() => { setModo('select'); setNuevoValor('') }}
          className="text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-1" title="Cancelar">✕</button>
      </div>
    )
  }

  return (
    <select value={opciones.some(o => o.valor === value) ? value : ''}
      onChange={e => {
        const v = e.target.value
        if (v === NUEVO) { setModo('nueva'); return }
        onChange(v)
      }}
      className={cls}>
      <option value="">{placeholder ?? '— Seleccionar —'}</option>
      {opciones.map(o => <option key={o.id} value={o.valor}>{o.valor}</option>)}
      {value && !opciones.some(o => o.valor === value) && <option value={value}>{value}</option>}
      <option value={NUEVO}>+ Agregar nuevo valor…</option>
    </select>
  )
}
