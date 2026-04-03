/**
 * MasivoModal — Ingreso o Rebaje de múltiples SKUs en una sola operación.
 *
 * Ingreso masivo:
 *   - Productos serializados: series (una por línea); cantidad se deriva del conteo.
 *   - Productos no serializados: campo cantidad + campos opcionales (ubicación, estado,
 *     proveedor, lote, vencimiento, LPN).
 *
 * Rebaje masivo:
 *   - Solo productos NO serializados (serializado = fila deshabilitada con aviso).
 *   - Auto-selección FIFO/FEFO/etc. desde las líneas existentes.
 *   - Campos: cantidad + motivo.
 */

import { useState, useRef, useEffect } from 'react'
import { Search, X, Plus, Trash2, ChevronDown, ChevronUp, AlertTriangle, Package, Camera } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'
import { getRebajeSort } from '@/lib/rebajeSort'
import { BarcodeScanner } from '@/components/BarcodeScanner'
import toast from 'react-hot-toast'

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type MasivoTipo = 'ingreso' | 'rebaje'

type MasivoItem = {
  localId: string
  productoId: string
  productoNombre: string
  productoSku: string
  unidadMedida: string
  stockActual: number
  tieneSeries: boolean
  tieneLote: boolean
  tieneVencimiento: boolean
  reglaInventario?: string | null
  precioCoste: number
  // Campos del formulario
  cantidad: string
  ubicacionId: string
  estadoId: string
  proveedorId: string
  motivo: string
  nroLote: string
  fechaVencimiento: string
  lpn: string
  seriesText: string   // una por línea (solo serializado + ingreso)
  expanded: boolean    // opcionales expandidos
}

function mkItem(p: any): MasivoItem {
  return {
    localId: crypto.randomUUID(),
    productoId: p.id,
    productoNombre: p.nombre,
    productoSku: p.sku,
    unidadMedida: p.unidad_medida ?? '',
    stockActual: p.stock_actual ?? 0,
    tieneSeries: p.tiene_series ?? false,
    tieneLote: p.tiene_lote ?? false,
    tieneVencimiento: p.tiene_vencimiento ?? false,
    reglaInventario: p.regla_inventario ?? null,
    precioCoste: p.precio_costo ?? 0,
    cantidad: '',
    ubicacionId: p.ubicacion_id ?? '',
    estadoId: '',
    proveedorId: '',
    motivo: '',
    nroLote: '',
    fechaVencimiento: '',
    lpn: '',
    seriesText: '',
    expanded: false,
  }
}

// ─── Componente ───────────────────────────────────────────────────────────────

interface Props {
  tipo: MasivoTipo
  onClose: () => void
  onSuccess: () => void
}

export function MasivoModal({ tipo, onClose, onSuccess }: Props) {
  const { tenant, user } = useAuthStore()
  const qc = useQueryClient()
  const { sucursalId } = useSucursalFilter()
  const [items, setItems] = useState<MasivoItem[]>([])
  const [prodSearch, setProdSearch] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  // Cerrar dropdown al click fuera
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setDropdownOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: prodResultados = [] } = useQuery({
    queryKey: ['masivo-prod-search', tenant?.id, prodSearch],
    queryFn: async () => {
      let q = supabase.from('productos')
        .select('id, nombre, sku, stock_actual, unidad_medida, tiene_series, tiene_lote, tiene_vencimiento, ubicacion_id, precio_costo, regla_inventario')
        .eq('tenant_id', tenant!.id).eq('activo', true).order('nombre').limit(6)
      if (prodSearch)
        q = q.or(`nombre.ilike.%${prodSearch}%,sku.ilike.%${prodSearch}%,codigo_barras.eq.${prodSearch}`)
      const { data } = await q
      return data ?? []
    },
    enabled: !!tenant && (prodSearch.length > 0 || dropdownOpen),
  })

  const { data: ubicaciones = [] } = useQuery({
    queryKey: ['ubicaciones', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('ubicaciones').select('*').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant,
  })

  const { data: estados = [] } = useQuery({
    queryKey: ['estados_inventario', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('estados_inventario').select('*').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant,
  })

  const { data: proveedores = [] } = useQuery({
    queryKey: ['proveedores', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('proveedores').select('*').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant,
  })

  const { data: motivos = [] } = useQuery({
    queryKey: ['motivos', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('motivos_movimiento').select('*').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant,
  })

  // ── Helpers ────────────────────────────────────────────────────────────────

  function upd(localId: string, patch: Partial<MasivoItem>) {
    setItems(prev => prev.map(it => it.localId === localId ? { ...it, ...patch } : it))
  }

  function addProduct(p: any) {
    const yaExiste = items.find(it => it.productoId === p.id)
    if (yaExiste) { toast.error('Ese producto ya está en la lista'); return }
    setItems(prev => [...prev, mkItem(p)])
    setProdSearch('')
    setDropdownOpen(false)
  }

  function removeItem(localId: string) {
    setItems(prev => prev.filter(it => it.localId !== localId))
  }

  function getCantidad(it: MasivoItem): number {
    if (tipo === 'ingreso' && it.tieneSeries) {
      return it.seriesText.split('\n').map(s => s.trim()).filter(Boolean).length
    }
    return parseInt(it.cantidad) || 0
  }

  // ── Validación ─────────────────────────────────────────────────────────────

  function validate(): string | null {
    if (items.length === 0) return 'Agregá al menos un producto.'
    for (const it of items) {
      if (tipo === 'rebaje' && it.tieneSeries) continue  // se ignoran en rebaje
      const cant = getCantidad(it)
      if (cant <= 0) return `${it.productoNombre}: ingresá una cantidad válida.`
      if (tipo === 'rebaje' && cant > it.stockActual)
        return `${it.productoNombre}: stock insuficiente (disponible: ${it.stockActual}).`
      if (tipo === 'ingreso' && it.tieneLote && !it.nroLote.trim())
        return `${it.productoNombre}: requiere número de lote.`
      if (tipo === 'ingreso' && it.tieneVencimiento && !it.fechaVencimiento)
        return `${it.productoNombre}: requiere fecha de vencimiento.`
    }
    return null
  }

  // ── Mutation ───────────────────────────────────────────────────────────────

  const mutation = useMutation({
    mutationFn: async () => {
      const err = validate()
      if (err) throw new Error(err)

      const itemsAProcess = tipo === 'rebaje'
        ? items.filter(it => !it.tieneSeries)
        : items

      for (const it of itemsAProcess) {
        const cant = getCantidad(it)

        const { data: prodAntes } = await supabase.from('productos')
          .select('stock_actual').eq('id', it.productoId).single()
        const stockAntes = prodAntes?.stock_actual ?? 0

        if (tipo === 'ingreso') {
          // Crear línea de inventario
          const { data: linea, error: lineaErr } = await supabase.from('inventario_lineas')
            .insert({
              tenant_id: tenant!.id,
              producto_id: it.productoId,
              cantidad: it.tieneSeries ? 0 : cant,
              estado_id: it.estadoId || null,
              ubicacion_id: it.ubicacionId || null,
              proveedor_id: it.proveedorId || null,
              nro_lote: it.nroLote || null,
              fecha_vencimiento: it.fechaVencimiento || null,
              precio_costo_snapshot: it.precioCoste || null,
              lpn: it.lpn || null,
              sucursal_id: sucursalId || null,
            })
            .select().single()
          if (lineaErr) throw new Error(`${it.productoNombre}: ${lineaErr.message}`)

          // Series (si aplica)
          if (it.tieneSeries) {
            const seriesArr = it.seriesText.split('\n').map(s => s.trim()).filter(Boolean)
            const { error: seriesErr } = await supabase.from('inventario_series').insert(
              seriesArr.map(nro => ({
                tenant_id: tenant!.id,
                producto_id: it.productoId,
                linea_id: linea.id,
                nro_serie: nro,
                estado_id: it.estadoId || null,
              }))
            )
            if (seriesErr) {
              if (seriesErr.code === '23505') throw new Error(`${it.productoNombre}: una o más series ya existen.`)
              throw new Error(`${it.productoNombre}: ${seriesErr.message}`)
            }
          }

          await supabase.from('movimientos_stock').insert({
            tenant_id: tenant!.id,
            producto_id: it.productoId,
            tipo: 'ingreso',
            cantidad: cant,
            stock_antes: stockAntes,
            stock_despues: stockAntes + cant,
            motivo: it.motivo || null,
            estado_id: it.estadoId || null,
            usuario_id: user?.id,
            linea_id: linea.id,
            sucursal_id: sucursalId || null,
          })

        } else {
          // REBAJE — auto-FIFO desde líneas existentes
          const { data: lineasRaw } = await supabase.from('inventario_lineas')
            .select('*, ubicaciones(prioridad)')
            .eq('producto_id', it.productoId)
            .eq('activo', true)
            .gt('cantidad', 0)
          const { data: prodInfo } = await supabase.from('productos')
            .select('regla_inventario, tiene_vencimiento').eq('id', it.productoId).single()
          const sortFn = getRebajeSort(prodInfo?.regla_inventario, tenant!.regla_inventario, prodInfo?.tiene_vencimiento ?? false)
          const lineas = (lineasRaw ?? []).sort(sortFn)

          let restante = cant
          let primeraLinea: any = null
          for (const linea of lineas) {
            if (restante <= 0) break
            const consume = Math.min(restante, linea.cantidad)
            const nuevaCant = linea.cantidad - consume
            await supabase.from('inventario_lineas')
              .update({ cantidad: nuevaCant, activo: nuevaCant > 0 })
              .eq('id', linea.id)
            restante -= consume
            if (!primeraLinea) primeraLinea = linea
          }
          if (restante > 0) throw new Error(`${it.productoNombre}: stock insuficiente en líneas disponibles.`)

          await supabase.from('movimientos_stock').insert({
            tenant_id: tenant!.id,
            producto_id: it.productoId,
            tipo: 'rebaje',
            cantidad: cant,
            stock_antes: stockAntes,
            stock_despues: Math.max(0, stockAntes - cant),
            motivo: it.motivo || null,
            usuario_id: user?.id,
            linea_id: primeraLinea?.id ?? null,
            sucursal_id: sucursalId || null,
          })
        }
      }
    },
    onSuccess: () => {
      const total = tipo === 'rebaje' ? items.filter(it => !it.tieneSeries).length : items.length
      toast.success(`${tipo === 'ingreso' ? 'Ingreso' : 'Rebaje'} masivo registrado (${total} SKU${total !== 1 ? 's' : ''})`)
      qc.invalidateQueries({ queryKey: ['movimientos'] })
      qc.invalidateQueries({ queryKey: ['productos'] })
      qc.invalidateQueries({ queryKey: ['inventario_lineas_all'] })
      qc.invalidateQueries({ queryKey: ['alertas'] })
      onSuccess()
      onClose()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Render ─────────────────────────────────────────────────────────────────

  const inp = 'w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 focus:outline-none focus:border-accent'
  const sel = `${inp} cursor-pointer`
  const esTitulo = tipo === 'ingreso' ? 'Ingreso masivo' : 'Rebaje masivo'
  const itemsValidos = tipo === 'rebaje' ? items.filter(it => !it.tieneSeries) : items

  async function handleBarcodeScan(code: string) {
    setScannerOpen(false)
    const { data: prods } = await supabase.from('productos')
      .select('id, nombre, sku, stock_actual, unidad_medida, tiene_series, tiene_lote, tiene_vencimiento, ubicacion_id, precio_costo, regla_inventario')
      .eq('tenant_id', tenant!.id).eq('activo', true)
      .or(`codigo_barras.eq.${code},sku.eq.${code}`).limit(1)
    if (!prods || prods.length === 0) { toast.error(`No se encontró ningún producto con código "${code}"`); return }
    addProduct(prods[0])
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-primary">{esTitulo}</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              {tipo === 'ingreso'
                ? 'Agregá múltiples SKUs y confirmá todo de una vez.'
                : 'Rebaje automático por FIFO/FEFO. Solo productos no serializados.'}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors" title="Cerrar">
            <X size={18} />
          </button>
        </div>

        {/* Buscador de productos */}
        <div className="px-6 pt-4 pb-3 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
          <div className="flex gap-2" ref={dropRef}>
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
              <input
                type="text"
                value={prodSearch}
                onChange={e => { setProdSearch(e.target.value); setDropdownOpen(true) }}
                onFocus={() => setDropdownOpen(true)}
                placeholder="Buscar y agregar producto..."
                className="w-full pl-9 pr-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-800"
              />
              {dropdownOpen && prodResultados.length > 0 && (
                <div className="absolute z-30 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg max-h-52 overflow-y-auto">
                  {prodResultados.map((p: any) => {
                    const yaEsta = items.some(it => it.productoId === p.id)
                    return (
                      <button key={p.id} type="button" disabled={yaEsta}
                        onClick={() => addProduct(p)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                        <div className="w-7 h-7 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center flex-shrink-0">
                          <Package size={13} className="text-gray-400 dark:text-gray-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{p.nombre}</p>
                          <p className="text-xs text-gray-400 dark:text-gray-500 font-mono">{p.sku} · Stock: {p.stock_actual} {p.unidad_medida}</p>
                        </div>
                        {yaEsta && <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">Ya agregado</span>}
                        {!yaEsta && <Plus size={15} className="text-accent flex-shrink-0" />}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            <button onClick={() => setScannerOpen(true)}
              className="px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:text-accent transition-colors bg-white dark:bg-gray-800"
              title="Escanear código de barras">
              <Camera size={17} />
            </button>
          </div>
        </div>

        {/* Lista de ítems */}
        <div className="flex-1 overflow-y-auto px-6 py-3 space-y-3">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400 dark:text-gray-500">
              <Package size={32} className="mb-2 opacity-40" />
              <p className="text-sm">Buscá y agregá productos arriba.</p>
            </div>
          ) : (
            items.map(it => {
              const esSerializadoRebaje = tipo === 'rebaje' && it.tieneSeries
              const cant = getCantidad(it)

              return (
                <div key={it.localId}
                  className={`rounded-xl border-2 transition-colors
                    ${esSerializadoRebaje ? 'border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10 opacity-70' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'}`}>

                  {/* Fila principal */}
                  <div className="flex items-start gap-3 px-4 pt-3 pb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-800 dark:text-gray-100 text-sm truncate">{it.productoNombre}</p>
                        <span className="text-xs text-gray-400 dark:text-gray-500 font-mono flex-shrink-0">{it.productoSku}</span>
                        {esSerializadoRebaje && (
                          <span className="inline-flex items-center gap-1 text-xs text-amber-600 bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 rounded-full flex-shrink-0">
                            <AlertTriangle size={10} /> Usar rebaje individual
                          </span>
                        )}
                      </div>
                      {!esSerializadoRebaje && (
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                          Stock actual: {it.stockActual} {it.unidadMedida}
                          {cant > 0 && (
                            <span className={`ml-2 font-medium ${tipo === 'rebaje' && cant > it.stockActual ? 'text-red-500' : 'text-accent'}`}>
                              → {tipo === 'ingreso' ? it.stockActual + cant : Math.max(0, it.stockActual - cant)} {it.unidadMedida}
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                    <button onClick={() => removeItem(it.localId)} title="Quitar"
                      className="p-1.5 text-gray-400 hover:text-red-500 transition-colors flex-shrink-0 mt-0.5">
                      <Trash2 size={15} />
                    </button>
                  </div>

                  {!esSerializadoRebaje && (
                    <div className="px-4 pb-3 space-y-3">
                      {/* Serializado ingreso: series text */}
                      {tipo === 'ingreso' && it.tieneSeries ? (
                        <div>
                          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                            Series (una por línea) — cantidad: {cant || 0}
                          </label>
                          <textarea
                            value={it.seriesText}
                            onChange={e => upd(it.localId, { seriesText: e.target.value })}
                            rows={3}
                            className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 focus:outline-none focus:border-accent font-mono resize-none"
                            placeholder={'SN-001\nSN-002\nSN-003'}
                          />
                        </div>
                      ) : (
                        /* Cantidad normal */
                        <div className="flex items-end gap-3">
                          <div className="w-32">
                            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                              Cantidad ({it.unidadMedida}) *
                            </label>
                            <input type="number" step="1" min="1" value={it.cantidad}
                              onChange={e => upd(it.localId, { cantidad: e.target.value })}
                              onWheel={e => e.currentTarget.blur()}
                              className={inp} placeholder="0" />
                          </div>
                          {tipo === 'rebaje' && (
                            <div className="flex-1">
                              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Motivo</label>
                              <input type="text" value={it.motivo}
                                onChange={e => upd(it.localId, { motivo: e.target.value })}
                                className={inp} placeholder="Opcional" />
                            </div>
                          )}
                        </div>
                      )}

                      {/* Opciones avanzadas (solo ingreso) */}
                      {tipo === 'ingreso' && (
                        <div>
                          <button type="button"
                            onClick={() => upd(it.localId, { expanded: !it.expanded })}
                            className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 hover:text-accent transition-colors">
                            {it.expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                            {it.expanded ? 'Ocultar opciones' : 'Más opciones (ubicación, estado, lote…)'}
                          </button>

                          {it.expanded && (
                            <div className="mt-3 grid grid-cols-2 gap-3">
                              <div>
                                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Ubicación</label>
                                <select value={it.ubicacionId} onChange={e => upd(it.localId, { ubicacionId: e.target.value })} className={sel}>
                                  <option value="">Sin ubicación</option>
                                  {(ubicaciones as any[]).map((u: any) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                                </select>
                              </div>
                              <div>
                                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Estado</label>
                                <select value={it.estadoId} onChange={e => upd(it.localId, { estadoId: e.target.value })} className={sel}>
                                  <option value="">Sin estado</option>
                                  {(estados as any[]).map((e: any) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                                </select>
                              </div>
                              <div>
                                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Proveedor</label>
                                <select value={it.proveedorId} onChange={e => upd(it.localId, { proveedorId: e.target.value })} className={sel}>
                                  <option value="">Sin proveedor</option>
                                  {(proveedores as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                                </select>
                              </div>
                              <div>
                                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Motivo</label>
                                <input type="text" value={it.motivo}
                                  onChange={e => upd(it.localId, { motivo: e.target.value })}
                                  className={inp} placeholder="Opcional" />
                              </div>
                              {it.tieneLote && (
                                <div>
                                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">N° Lote *</label>
                                  <input type="text" value={it.nroLote}
                                    onChange={e => upd(it.localId, { nroLote: e.target.value })}
                                    className={inp} placeholder="Lote-001" />
                                </div>
                              )}
                              {it.tieneVencimiento && (
                                <div>
                                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Vencimiento *</label>
                                  <input type="date" value={it.fechaVencimiento}
                                    onChange={e => upd(it.localId, { fechaVencimiento: e.target.value })}
                                    className={inp} />
                                </div>
                              )}
                              <div>
                                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">LPN</label>
                                <input type="text" value={it.lpn}
                                  onChange={e => upd(it.localId, { lpn: e.target.value })}
                                  className={inp} placeholder="Opcional" />
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between gap-3 flex-shrink-0">
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {itemsValidos.length} SKU{itemsValidos.length !== 1 ? 's' : ''} a procesar
            {tipo === 'rebaje' && items.some(it => it.tieneSeries) && (
              <span className="ml-2 text-amber-500">({items.filter(it => it.tieneSeries).length} serializados excluidos)</span>
            )}
          </p>
          <div className="flex gap-3">
            <button type="button" onClick={onClose}
              className="border-2 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-semibold rounded-xl px-4 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all">
              Cancelar
            </button>
            <button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || itemsValidos.length === 0}
              className="bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl px-5 py-2.5 text-sm transition-all disabled:opacity-50">
              {mutation.isPending
                ? 'Procesando…'
                : `Confirmar ${itemsValidos.length} ${tipo === 'ingreso' ? 'ingreso' : 'rebaje'}${itemsValidos.length !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </div>

      {scannerOpen && (
        <BarcodeScanner
          title="Escanear producto"
          onDetected={handleBarcodeScan}
          onClose={() => setScannerOpen(false)}
        />
      )}
    </div>
  )
}
