import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X, Plus, ChevronDown, ChevronUp, Sparkles, ExternalLink, Edit2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import toast from 'react-hot-toast'

// ─── Types ────────────────────────────────────────────────────────────────────

export type GrupoAtributo = { nombre: string; valores: string[] }

export type ProductoGrupo = {
  id: string
  tenant_id: string
  nombre: string
  descripcion: string | null
  imagen_url: string | null
  precio_base: number | null
  categoria_id: string | null
  atributos: GrupoAtributo[] | null
  activo: boolean
  categorias?: { nombre: string } | null
}

// ─── Sugerencias rápidas ──────────────────────────────────────────────────────

const SUGERENCIAS_ATRIBUTOS = ['Talle', 'Color', 'Sabor', 'Formato', 'Encaje']

// ─── TagInput ────────────────────────────────────────────────────────────────

function TagInput({
  valores,
  onChange,
}: {
  valores: string[]
  onChange: (vals: string[]) => void
}) {
  const [input, setInput] = useState('')

  const addValor = (val: string) => {
    const v = val.trim()
    if (!v || valores.includes(v)) return
    onChange([...valores, v])
    setInput('')
  }

  const removeValor = (idx: number) => {
    onChange(valores.filter((_, i) => i !== idx))
  }

  return (
    <div className="border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 min-h-[36px] flex flex-wrap gap-1 bg-white dark:bg-gray-700 focus-within:border-accent transition-colors">
      {valores.map((v, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-accent/10 text-accent font-medium"
        >
          {v}
          <button
            type="button"
            onClick={() => removeValor(i)}
            className="text-accent/60 hover:text-accent transition-colors"
            title="Eliminar"
          >
            <X size={10} />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            addValor(input)
          } else if (e.key === 'Backspace' && !input && valores.length > 0) {
            removeValor(valores.length - 1)
          }
        }}
        onBlur={() => { if (input.trim()) addValor(input) }}
        placeholder={valores.length === 0 ? 'Escribí un valor y presioná Enter…' : ''}
        className="flex-1 min-w-[120px] outline-none text-xs bg-transparent text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
      />
    </div>
  )
}

// ─── Función para producto cartesiano ────────────────────────────────────────

function cartesiano(atributos: GrupoAtributo[]): Record<string, string>[] {
  const activos = atributos.filter(a => a.nombre.trim() && a.valores.length > 0)
  if (activos.length === 0) return []
  const result: Record<string, string>[] = [{}]
  for (const attr of activos) {
    const expanded: Record<string, string>[] = []
    for (const combo of result) {
      for (const val of attr.valores) {
        expanded.push({ ...combo, [attr.nombre]: val })
      }
    }
    result.splice(0, result.length, ...expanded)
  }
  return result
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function ProductoGrupoModal({
  grupo,
  onClose,
}: {
  grupo: ProductoGrupo | null
  onClose: () => void
}) {
  const { tenant } = useAuthStore()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const isEditing = !!grupo

  const [nombre, setNombre] = useState(grupo?.nombre ?? '')
  const [descripcion, setDescripcion] = useState(grupo?.descripcion ?? '')
  const [categoriaId, setCategoriaId] = useState(grupo?.categoria_id ?? '')
  const [precioBase, setPrecioBase] = useState(grupo?.precio_base != null ? grupo.precio_base.toString() : '')
  const [atributos, setAtributos] = useState<GrupoAtributo[]>(grupo?.atributos ?? [])
  const [showVariantes, setShowVariantes] = useState(false)
  const [saving, setSaving] = useState(false)
  const [generando, setGenerando] = useState(false)
  const [grupoId, setGrupoId] = useState<string | null>(grupo?.id ?? null)

  // Queries
  const { data: categorias = [] } = useQuery({
    queryKey: ['categorias', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('categorias').select('*').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant,
  })

  const { data: variantesExistentes = [], refetch: refetchVariantes } = useQuery({
    queryKey: ['grupo-variantes', grupoId],
    queryFn: async () => {
      const { data } = await supabase
        .from('productos')
        .select('id, nombre, sku, precio_venta, stock_actual, variante_valores, activo')
        .eq('grupo_id', grupoId!)
        .eq('activo', true)
        .order('nombre')
      return data ?? []
    },
    enabled: !!grupoId,
  })

  const combinaciones = cartesiano(atributos)

  // ESC para cerrar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  // ── Helpers atributos ─────────────────────────────────────────────────────

  const agregarAtributo = (nombreSug?: string) => {
    const n = nombreSug ?? ''
    if (nombreSug && atributos.some(a => a.nombre === n)) return
    setAtributos(prev => [...prev, { nombre: n, valores: [] }])
  }

  const updateAtributo = (idx: number, patch: Partial<GrupoAtributo>) => {
    setAtributos(prev => prev.map((a, i) => i === idx ? { ...a, ...patch } : a))
  }

  const eliminarAtributo = (idx: number) => {
    setAtributos(prev => prev.filter((_, i) => i !== idx))
  }

  // ── Guardar grupo ─────────────────────────────────────────────────────────

  const guardarGrupo = async (): Promise<string | null> => {
    if (!nombre.trim()) { toast.error('El nombre del grupo es obligatorio'); return null }
    setSaving(true)
    try {
      const payload = {
        tenant_id: tenant!.id,
        nombre: nombre.trim(),
        descripcion: descripcion.trim() || null,
        categoria_id: categoriaId || null,
        precio_base: precioBase !== '' ? parseFloat(precioBase) : null,
        atributos: atributos.filter(a => a.nombre.trim()).map(a => ({ nombre: a.nombre.trim(), valores: a.valores })),
        activo: true,
      }

      if (isEditing && grupoId) {
        const { error } = await supabase.from('producto_grupos').update(payload).eq('id', grupoId)
        if (error) throw error
        toast.success('Grupo actualizado')
        qc.invalidateQueries({ queryKey: ['producto-grupos', tenant?.id] })
        return grupoId
      } else {
        const { data, error } = await supabase.from('producto_grupos').insert(payload).select('id').single()
        if (error) throw error
        setGrupoId(data.id)
        toast.success('Grupo creado')
        qc.invalidateQueries({ queryKey: ['producto-grupos', tenant?.id] })
        return data.id
      }
    } catch (err: any) {
      toast.error(err.message ?? 'Error al guardar el grupo')
      return null
    } finally {
      setSaving(false)
    }
  }

  // ── Generar variantes ─────────────────────────────────────────────────────

  const generarVariantes = async () => {
    const gId = await guardarGrupo()
    if (!gId) return

    setGenerando(true)
    try {
      // Traer variantes que ya existen para este grupo
      const { data: existentes } = await supabase
        .from('productos')
        .select('variante_valores')
        .eq('grupo_id', gId)
        .eq('activo', true)

      const existentesSet = new Set(
        (existentes ?? []).map(e => JSON.stringify(e.variante_valores))
      )

      const nuevas = combinaciones.filter(combo => !existentesSet.has(JSON.stringify(combo)))
      const precioNum = precioBase !== '' ? parseFloat(precioBase) : 0
      const catId = categoriaId || null

      let creadas = 0
      for (const combo of nuevas) {
        const sufijo = Object.values(combo).join(' / ')
        const nombreVariante = `${nombre.trim()} — ${sufijo}`
        const prefix = nombre.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4).padEnd(4, 'X')
        const rand4 = Math.floor(Math.random() * 10000).toString().padStart(4, '0')
        const sufSku = Object.values(combo).map(v => v.slice(0, 2).toUpperCase()).join('')
        const sku = `${prefix}-${rand4}-${sufSku}`

        await supabase.from('productos').insert({
          tenant_id: tenant!.id,
          nombre: nombreVariante,
          sku,
          precio_venta: precioNum,
          precio_costo: 0,
          stock_actual: 0,
          stock_minimo: 0,
          unidad_medida: 'unidad',
          activo: true,
          categoria_id: catId,
          grupo_id: gId,
          variante_valores: combo,
        })
        creadas++
      }

      const yaExistian = combinaciones.length - nuevas.length
      if (creadas > 0 && yaExistian > 0) {
        toast.success(`${creadas} variante${creadas !== 1 ? 's' : ''} creada${creadas !== 1 ? 's' : ''} · ${yaExistian} ya existían`)
      } else if (creadas > 0) {
        toast.success(`${creadas} variante${creadas !== 1 ? 's' : ''} creada${creadas !== 1 ? 's' : ''}`)
      } else {
        toast(`Todas las variantes ya existen (${yaExistian})`)
      }

      qc.invalidateQueries({ queryKey: ['productos'] })
      refetchVariantes()
    } catch (err: any) {
      toast.error(err.message ?? 'Error al generar variantes')
    } finally {
      setGenerando(false)
    }
  }

  const inp = 'w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-700 focus:outline-none focus:border-accent transition-colors text-gray-800 dark:text-gray-100'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-800 z-10">
          <h2 className="text-lg font-bold text-primary">
            {isEditing ? 'Editar grupo de variantes' : 'Nuevo grupo de variantes'}
          </h2>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors" title="Cerrar">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-6">

          {/* ── Datos básicos ─────────────────────────────────────────────── */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">Datos básicos</h3>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Nombre del grupo <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={nombre}
                onChange={e => setNombre(e.target.value)}
                placeholder="Ej: Remera Básica, Zapatilla Running"
                className={inp}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descripción</label>
              <textarea
                value={descripcion}
                onChange={e => setDescripcion(e.target.value)}
                rows={2}
                placeholder="Descripción opcional del grupo..."
                className={`${inp} resize-none`}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Categoría</label>
                <select
                  value={categoriaId}
                  onChange={e => setCategoriaId(e.target.value)}
                  className={inp}
                >
                  <option value="">Sin categoría</option>
                  {(categorias as any[]).map(c => (
                    <option key={c.id} value={c.id}>{c.nombre}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Precio base</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 text-sm">$</span>
                  <input
                    type="number"
                    onWheel={e => e.currentTarget.blur()}
                    min="0"
                    step="0.01"
                    value={precioBase}
                    onChange={e => setPrecioBase(e.target.value)}
                    placeholder="Precio base para todas las variantes"
                    className={`${inp} pl-7`}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ── Atributos de variante ──────────────────────────────────────── */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">Atributos de variante</h3>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Definí los ejes de variación (talle, color, etc.) y sus posibles valores</p>
              </div>
              <button
                type="button"
                onClick={() => agregarAtributo()}
                className="flex items-center gap-1.5 text-xs text-accent hover:bg-accent/10 px-2.5 py-1.5 rounded-lg transition-colors border border-accent/30"
              >
                <Plus size={13} /> Agregar atributo
              </button>
            </div>

            {/* Sugerencias rápidas */}
            <div className="flex flex-wrap gap-1.5">
              {SUGERENCIAS_ATRIBUTOS.map(sug => {
                const existe = atributos.some(a => a.nombre === sug)
                return (
                  <button
                    key={sug}
                    type="button"
                    disabled={existe}
                    onClick={() => agregarAtributo(sug)}
                    className={`px-2.5 py-1 text-xs rounded-full border transition-colors
                      ${existe
                        ? 'border-gray-200 dark:border-gray-700 text-gray-300 dark:text-gray-600 cursor-not-allowed'
                        : 'border-accent/40 text-accent hover:bg-accent/10 cursor-pointer'}`}
                  >
                    + {sug}
                  </button>
                )
              })}
            </div>

            {atributos.length === 0 && (
              <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4 border border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
                Sin atributos. Usá los chips de arriba o "+ Agregar atributo".
              </p>
            )}

            {atributos.map((attr, idx) => (
              <div key={idx} className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 space-y-3 bg-gray-50 dark:bg-gray-700/30">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={attr.nombre}
                    onChange={e => updateAtributo(idx, { nombre: e.target.value })}
                    placeholder="Nombre del atributo (ej: Talle, Color)"
                    className="flex-1 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 focus:outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    onClick={() => eliminarAtributo(idx)}
                    className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                    title="Eliminar atributo"
                  >
                    <X size={16} />
                  </button>
                </div>
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Valores posibles:</p>
                  <TagInput
                    valores={attr.valores}
                    onChange={vals => updateAtributo(idx, { valores: vals })}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* ── Variantes existentes (solo al editar) ─────────────────────── */}
          {grupoId && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setShowVariantes(v => !v)}
                className="w-full flex items-center justify-between text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
              >
                <span>Variantes existentes ({variantesExistentes.length})</span>
                {showVariantes ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>

              {showVariantes && (
                variantesExistentes.length === 0 ? (
                  <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-3">Sin variantes aún. Generá combinaciones abajo.</p>
                ) : (
                  <div className="space-y-1.5">
                    {(variantesExistentes as any[]).map(v => (
                      <div key={v.id} className="flex items-center gap-3 px-3 py-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-100 dark:border-gray-700">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{v.nombre}</p>
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">{v.sku}</span>
                            {v.variante_valores && Object.entries(v.variante_valores as Record<string, string>).map(([k, val]) => (
                              <span key={k} className="px-1.5 py-0.5 rounded-full text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                                {k}: {val}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="text-right text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
                          <p>${(v.precio_venta ?? 0).toLocaleString('es-AR')}</p>
                          <p>{v.stock_actual} u.</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => navigate(`/productos/${v.id}/editar`)}
                          className="p-1.5 text-gray-400 hover:text-accent transition-colors flex-shrink-0"
                          title="Abrir producto"
                        >
                          <ExternalLink size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>
          )}

          {/* ── Generar combinaciones ──────────────────────────────────────── */}
          {combinaciones.length > 0 && (
            <div className="border border-accent/30 rounded-xl p-4 space-y-3 bg-accent/5 dark:bg-accent/10">
              <div className="flex items-center gap-2">
                <Sparkles size={15} className="text-accent flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                    Generar {combinaciones.length} variante{combinaciones.length !== 1 ? 's' : ''}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {atributos.filter(a => a.valores.length > 0).map(a => `${a.valores.length} ${a.nombre}`).join(' × ')}
                    {' '}= {combinaciones.length} combinacion{combinaciones.length !== 1 ? 'es' : ''}
                  </p>
                </div>
              </div>

              {/* Preview de las primeras combinaciones */}
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                {combinaciones.slice(0, 20).map((combo, i) => (
                  <span key={i} className="px-2 py-0.5 text-xs rounded-full bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300">
                    {Object.values(combo).join(' / ')}
                  </span>
                ))}
                {combinaciones.length > 20 && (
                  <span className="px-2 py-0.5 text-xs text-gray-400 dark:text-gray-500">+{combinaciones.length - 20} más…</span>
                )}
              </div>

              <button
                type="button"
                onClick={generarVariantes}
                disabled={generando || saving}
                className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl text-sm transition-all disabled:opacity-50"
              >
                <Sparkles size={14} />
                {generando ? 'Generando…' : `Generar ${combinaciones.length} variante${combinaciones.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-700 sticky bottom-0 bg-white dark:bg-gray-800">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 border-2 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-semibold rounded-xl py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={async () => { const ok = await guardarGrupo(); if (ok) onClose() }}
            disabled={saving}
            className="flex-1 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl py-2.5 text-sm transition-all disabled:opacity-50"
          >
            {saving ? 'Guardando…' : isEditing ? 'Guardar cambios' : 'Crear grupo'}
          </button>
        </div>
      </div>
    </div>
  )
}
