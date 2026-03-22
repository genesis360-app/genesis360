import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  X, Edit2, Trash2, ArrowRightLeft, Hash, Plus,
  MapPin, Tag, Package, AlertTriangle, Save, ChevronDown
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { logActividad } from '@/lib/actividadLog'
import toast from 'react-hot-toast'

type AccionTab = 'editar' | 'mover' | 'series' | 'eliminar'

interface Props {
  linea: any
  producto: any
  onClose: () => void
}

export function LpnAccionesModal({ linea, producto, onClose }: Props) {
  const { tenant, user } = useAuthStore()
  const qc = useQueryClient()
  const [tab, setTab] = useState<AccionTab>('editar')
  const tieneSeries = producto.tiene_series

  // Editar campos
  const [editForm, setEditForm] = useState({
    lpn: linea.lpn ?? '',
    estado_id: linea.estado_id ?? '',
    ubicacion_id: linea.ubicacion_id ?? '',
    proveedor_id: linea.proveedor_id ?? '',
    nro_lote: linea.nro_lote ?? '',
    // Tomar solo los primeros 10 chars para evitar desfase de timezone
    fecha_vencimiento: linea.fecha_vencimiento ? String(linea.fecha_vencimiento).slice(0, 10) : '',
    cantidad: String(linea.cantidad ?? 0),
  })

  // Mover stock parcial
  const [cantMover, setCantMover] = useState('')
  const [ubicDestino, setUbicDestino] = useState('')

  // Series
  const [newSerie, setNewSerie] = useState('')
  const [editSerieId, setEditSerieId] = useState<string | null>(null)
  const [editSerieNro, setEditSerieNro] = useState('')

  // Cargar catálogos
  const { data: estados = [] } = useQuery({
    queryKey: ['estados_inventario', tenant?.id],
    queryFn: async () => { const { data } = await supabase.from('estados_inventario').select('*').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre'); return data ?? [] },
    enabled: !!tenant,
  })
  const { data: ubicaciones = [] } = useQuery({
    queryKey: ['ubicaciones', tenant?.id],
    queryFn: async () => { const { data } = await supabase.from('ubicaciones').select('*').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre'); return data ?? [] },
    enabled: !!tenant,
  })
  const { data: proveedores = [] } = useQuery({
    queryKey: ['proveedores', tenant?.id],
    queryFn: async () => { const { data } = await supabase.from('proveedores').select('*').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre'); return data ?? [] },
    enabled: !!tenant,
  })

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['inventario_lineas_all'] })
    qc.invalidateQueries({ queryKey: ['productos'] })
  }

  const registrarMovimiento = async (tipo: string, cantidad: number, motivo: string, stockAntes: number) => {
    await supabase.from('movimientos_stock').insert({
      tenant_id: tenant!.id,
      producto_id: producto.id,
      tipo,
      cantidad,
      stock_antes: stockAntes,
      stock_despues: stockAntes, // el trigger lo actualiza
      motivo,
      usuario_id: user?.id,
    })
  }

  // ── Guardar edición ──────────────────────────────────────────────────────────
  const guardarEdicion = useMutation({
    mutationFn: async () => {
      const cantNueva = tieneSeries ? linea.cantidad : parseInt(editForm.cantidad)
      const cantVieja = linea.cantidad

      if (!tieneSeries && (isNaN(cantNueva) || cantNueva < 0))
        throw new Error('Cantidad inválida')

      // Validar atributos obligatorios según el producto
      if (producto.tiene_lote && !editForm.nro_lote.trim())
        throw new Error('Este producto requiere número de lote')
      if (producto.tiene_vencimiento && !editForm.fecha_vencimiento)
        throw new Error('Este producto requiere fecha de vencimiento')

      const { data: prodAntes } = await supabase.from('productos').select('stock_actual').eq('id', producto.id).single()
      const stockAntes = prodAntes?.stock_actual ?? 0

      const { error } = await supabase.from('inventario_lineas').update({
        lpn: editForm.lpn || linea.lpn,
        estado_id: editForm.estado_id || null,
        ubicacion_id: editForm.ubicacion_id || null,
        proveedor_id: editForm.proveedor_id || null,
        nro_lote: editForm.nro_lote || null,
        fecha_vencimiento: editForm.fecha_vencimiento || null,
        ...(!tieneSeries ? { cantidad: cantNueva } : {}),
      }).eq('id', linea.id)
      if (error) throw error

      // Registrar en historial si cambió la cantidad
      if (!tieneSeries && cantNueva !== cantVieja) {
        const diff = cantNueva - cantVieja
        await registrarMovimiento(
          diff > 0 ? 'ajuste_ingreso' : 'ajuste_rebaje',
          Math.abs(diff),
          `Ajuste manual de cantidad en LPN ${linea.lpn}`,
          stockAntes
        )
      } else {
        await registrarMovimiento('edicion_lpn', 0, `Edición de datos del LPN ${linea.lpn}`, stockAntes)
      }

      // Audit log: loguear cada campo modificado
      const resolveNombre = (lista: any[], id: string) => lista.find((x: any) => x.id === id)?.nombre ?? id
      const oldLpn = linea.lpn ?? ''
      const newLpn = editForm.lpn || linea.lpn
      if (oldLpn !== newLpn)
        logActividad({ entidad: 'inventario_linea', entidad_id: linea.id, entidad_nombre: producto.nombre, accion: 'editar', campo: 'lpn', valor_anterior: oldLpn, valor_nuevo: newLpn, pagina: '/inventario' })
      if (!tieneSeries && cantNueva !== cantVieja)
        logActividad({ entidad: 'inventario_linea', entidad_id: linea.id, entidad_nombre: producto.nombre, accion: 'editar', campo: 'cantidad', valor_anterior: String(cantVieja), valor_nuevo: String(cantNueva), pagina: '/inventario' })
      if ((editForm.estado_id || '') !== (linea.estado_id || ''))
        logActividad({ entidad: 'inventario_linea', entidad_id: linea.id, entidad_nombre: producto.nombre, accion: 'cambio_estado', campo: 'estado', valor_anterior: linea.estado_id ? resolveNombre(estados, linea.estado_id) : null, valor_nuevo: editForm.estado_id ? resolveNombre(estados, editForm.estado_id) : null, pagina: '/inventario' })
      if ((editForm.ubicacion_id || '') !== (linea.ubicacion_id || ''))
        logActividad({ entidad: 'inventario_linea', entidad_id: linea.id, entidad_nombre: producto.nombre, accion: 'editar', campo: 'ubicacion', valor_anterior: linea.ubicacion_id ? resolveNombre(ubicaciones, linea.ubicacion_id) : null, valor_nuevo: editForm.ubicacion_id ? resolveNombre(ubicaciones, editForm.ubicacion_id) : null, pagina: '/inventario' })
      if ((editForm.nro_lote || '') !== (linea.nro_lote || ''))
        logActividad({ entidad: 'inventario_linea', entidad_id: linea.id, entidad_nombre: producto.nombre, accion: 'editar', campo: 'nro_lote', valor_anterior: linea.nro_lote ?? null, valor_nuevo: editForm.nro_lote || null, pagina: '/inventario' })
      const oldVenc = linea.fecha_vencimiento ? String(linea.fecha_vencimiento).slice(0, 10) : ''
      if ((editForm.fecha_vencimiento || '') !== oldVenc)
        logActividad({ entidad: 'inventario_linea', entidad_id: linea.id, entidad_nombre: producto.nombre, accion: 'editar', campo: 'fecha_vencimiento', valor_anterior: oldVenc || null, valor_nuevo: editForm.fecha_vencimiento || null, pagina: '/inventario' })
    },
    onSuccess: () => { toast.success('LPN actualizado'); invalidar(); onClose() },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Mover stock parcial ──────────────────────────────────────────────────────
  const moverStock = useMutation({
    mutationFn: async () => {
      const cant = parseInt(cantMover)
      if (!cant || cant <= 0) throw new Error('Ingresá una cantidad válida')
      if (cant >= linea.cantidad) throw new Error('La cantidad a mover debe ser menor al total del LPN')
      if (!ubicDestino) throw new Error('Seleccioná una ubicación destino')

      const { data: prodAntes } = await supabase.from('productos').select('stock_actual').eq('id', producto.id).single()
      const stockAntes = prodAntes?.stock_actual ?? 0

      // Reducir cantidad en LPN original
      const { error: e1 } = await supabase.from('inventario_lineas')
        .update({ cantidad: linea.cantidad - cant })
        .eq('id', linea.id)
      if (e1) throw e1

      // Crear nuevo LPN con la cantidad movida
      const newLpn = `LPN-${Date.now().toString(36).toUpperCase()}`
      const { error: e2 } = await supabase.from('inventario_lineas').insert({
        tenant_id: tenant!.id,
        producto_id: producto.id,
        lpn: newLpn,
        cantidad: cant,
        estado_id: linea.estado_id || null,
        ubicacion_id: ubicDestino,
        proveedor_id: linea.proveedor_id || null,
        nro_lote: linea.nro_lote || null,
        fecha_vencimiento: linea.fecha_vencimiento || null,
      })
      if (e2) throw e2

      await registrarMovimiento('traslado', cant, `Traslado parcial de ${linea.lpn} → ${newLpn} (${cant} u.)`, stockAntes)
      const ubicNombre = (ubicaciones as any[]).find(u => u.id === ubicDestino)?.nombre ?? ubicDestino
      logActividad({ entidad: 'inventario_linea', entidad_id: linea.id, entidad_nombre: producto.nombre, accion: 'editar', campo: 'traslado', valor_anterior: `${linea.lpn} (${linea.cantidad} u.)`, valor_nuevo: `${newLpn} → ${ubicNombre} (${cant} u.)`, pagina: '/inventario' })
    },
    onSuccess: () => { toast.success('Stock movido — nuevo LPN creado'); invalidar(); onClose() },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Eliminar LPN ────────────────────────────────────────────────────────────
  const eliminarLpn = useMutation({
    mutationFn: async () => {
      const { data: prodAntes } = await supabase.from('productos').select('stock_actual').eq('id', producto.id).single()
      const stockAntes = prodAntes?.stock_actual ?? 0
      const cantEliminada = tieneSeries
        ? (linea.inventario_series ?? []).filter((s: any) => s.activo).length
        : linea.cantidad

      // Desactivar series si las tiene
      if (tieneSeries) {
        await supabase.from('inventario_series').update({ activo: false }).eq('linea_id', linea.id)
      }

      // Desactivar línea
      const { error } = await supabase.from('inventario_lineas').update({ activo: false }).eq('id', linea.id)
      if (error) throw error

      await registrarMovimiento('eliminacion_lpn', cantEliminada, `Eliminación del LPN ${linea.lpn}`, stockAntes)
      logActividad({ entidad: 'inventario_linea', entidad_id: linea.id, entidad_nombre: producto.nombre, accion: 'eliminar', valor_anterior: `LPN ${linea.lpn} (${cantEliminada} u.)`, pagina: '/inventario' })
    },
    onSuccess: () => { toast.success('LPN eliminado'); invalidar(); onClose() },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Series ───────────────────────────────────────────────────────────────────
  const agregarSerie = useMutation({
    mutationFn: async () => {
      if (!newSerie.trim()) throw new Error('Ingresá un número de serie')
      const { error } = await supabase.from('inventario_series').insert({
        tenant_id: tenant!.id,
        producto_id: producto.id,
        linea_id: linea.id,
        nro_serie: newSerie.trim(),
        estado_id: linea.estado_id || null,
      })
      if (error?.code === '23505') throw new Error('Esa serie ya existe')
      if (error) throw error

      const { data: prodAntes } = await supabase.from('productos').select('stock_actual').eq('id', producto.id).single()
      await registrarMovimiento('ingreso_serie', 1, `Serie ${newSerie.trim()} agregada al LPN ${linea.lpn}`, prodAntes?.stock_actual ?? 0)
      logActividad({ entidad: 'inventario_linea', entidad_id: linea.id, entidad_nombre: producto.nombre, accion: 'editar', campo: 'serie', valor_nuevo: newSerie.trim(), pagina: '/inventario' })
    },
    onSuccess: () => { toast.success('Serie agregada'); setNewSerie(''); invalidar() },
    onError: (e: Error) => toast.error(e.message),
  })

  const editarSerie = useMutation({
    mutationFn: async ({ serieId, nroNuevo }: { serieId: string; nroNuevo: string }) => {
      if (!nroNuevo.trim()) throw new Error('Ingresá un número de serie')
      const { error } = await supabase.from('inventario_series').update({ nro_serie: nroNuevo.trim() }).eq('id', serieId)
      if (error?.code === '23505') throw new Error('Esa serie ya existe')
      if (error) throw error

      const { data: prodAntes } = await supabase.from('productos').select('stock_actual').eq('id', producto.id).single()
      await registrarMovimiento('edicion_serie', 0, `Serie editada en LPN ${linea.lpn}: → ${nroNuevo.trim()}`, prodAntes?.stock_actual ?? 0)
      logActividad({ entidad: 'inventario_linea', entidad_id: linea.id, entidad_nombre: producto.nombre, accion: 'editar', campo: 'serie', valor_nuevo: nroNuevo.trim(), pagina: '/inventario' })
    },
    onSuccess: () => { toast.success('Serie actualizada'); setEditSerieId(null); invalidar() },
    onError: (e: Error) => toast.error(e.message),
  })

  const eliminarSerie = useMutation({
    mutationFn: async (serieId: string) => {
      const { error } = await supabase.from('inventario_series').update({ activo: false }).eq('id', serieId)
      if (error) throw error
      const serie = (linea.inventario_series ?? []).find((s: any) => s.id === serieId)
      const { data: prodAntes } = await supabase.from('productos').select('stock_actual').eq('id', producto.id).single()
      await registrarMovimiento('eliminacion_serie', 1, `Serie eliminada del LPN ${linea.lpn}`, prodAntes?.stock_actual ?? 0)
      logActividad({ entidad: 'inventario_linea', entidad_id: linea.id, entidad_nombre: producto.nombre, accion: 'editar', campo: 'serie_eliminada', valor_anterior: serie?.nro_serie ?? serieId, pagina: '/inventario' })
    },
    onSuccess: () => { toast.success('Serie eliminada'); invalidar() },
    onError: (e: Error) => toast.error(e.message),
  })

  const seriesActivas = (linea.inventario_series ?? []).filter((s: any) => s.activo)

  const TABS: { id: AccionTab; label: string; icon: any }[] = [
    { id: 'editar', label: 'Editar', icon: Edit2 },
    { id: 'mover', label: 'Mover', icon: ArrowRightLeft },
    ...(tieneSeries ? [{ id: 'series' as AccionTab, label: 'Series', icon: Hash }] : []),
    { id: 'eliminar', label: 'Eliminar', icon: Trash2 },
  ]

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <p className="font-bold text-primary font-mono">{linea.lpn}</p>
            <p className="text-xs text-gray-400">{producto.nombre} · {producto.sku}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        {/* Info rápida */}
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex flex-wrap gap-3 text-xs text-gray-600">
          <span className="flex items-center gap-1">
            <Package size={12} />
            {tieneSeries ? `${seriesActivas.length} u. (series)` : `${linea.cantidad} u.`}
          </span>
          {linea.estados_inventario && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: linea.estados_inventario.color }} />
              {linea.estados_inventario.nombre}
            </span>
          )}
          {linea.ubicaciones && <span className="flex items-center gap-1"><MapPin size={12} /> {linea.ubicaciones.nombre}</span>}
          {linea.nro_lote && <span className="flex items-center gap-1"><Tag size={12} /> {linea.nro_lote}</span>}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-medium transition-all border-b-2
                ${tab === id ? 'border-accent text-primary' : 'border-transparent text-gray-400 hover:text-gray-600'}
                ${id === 'eliminar' ? 'text-red-400 hover:text-red-600' : ''}`}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        <div className="p-5">
          {/* ── EDITAR ── */}
          {tab === 'editar' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Nombre del LPN</label>
                  <input type="text" value={editForm.lpn} onChange={e => setEditForm(p => ({ ...p, lpn: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:border-accent" />
                </div>
                {!tieneSeries && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Cantidad</label>
                    <input type="number" min="0" value={editForm.cantidad}
                      onChange={e => setEditForm(p => ({ ...p, cantidad: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-accent" />
                    {parseInt(editForm.cantidad) !== linea.cantidad && (
                      <p className="text-xs text-orange-500 mt-1">
                        ⚠ Diferencia: {parseInt(editForm.cantidad) - linea.cantidad > 0 ? '+' : ''}{parseInt(editForm.cantidad) - linea.cantidad} u.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Estado</label>
                  <select value={editForm.estado_id} onChange={e => setEditForm(p => ({ ...p, estado_id: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-accent">
                    <option value="">Sin estado</option>
                    {(estados as any[]).map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Ubicación</label>
                  <select value={editForm.ubicacion_id} onChange={e => setEditForm(p => ({ ...p, ubicacion_id: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-accent">
                    <option value="">Sin ubicación</option>
                    {(ubicaciones as any[]).map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Proveedor</label>
                  <select value={editForm.proveedor_id} onChange={e => setEditForm(p => ({ ...p, proveedor_id: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-accent">
                    <option value="">Sin proveedor</option>
                    {(proveedores as any[]).map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                </div>
                {producto.tiene_lote && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Nro. lote <span className="text-red-500">*</span>
                    </label>
                    <input type="text" value={editForm.nro_lote} onChange={e => setEditForm(p => ({ ...p, nro_lote: e.target.value }))}
                      placeholder="Lote-001"
                      className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:border-accent
                        ${!editForm.nro_lote.trim() ? 'border-red-300 bg-red-50' : 'border-gray-200'}`} />
                  </div>
                )}
              </div>

              {producto.tiene_vencimiento && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Fecha de vencimiento <span className="text-red-500">*</span>
                  </label>
                  <input type="date" value={editForm.fecha_vencimiento} onChange={e => setEditForm(p => ({ ...p, fecha_vencimiento: e.target.value }))}
                    className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:border-accent
                      ${!editForm.fecha_vencimiento ? 'border-red-300 bg-red-50' : 'border-gray-200'}`} />
                </div>
              )}

              <button onClick={() => guardarEdicion.mutate()} disabled={guardarEdicion.isPending}
                className="w-full bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50 flex items-center justify-center gap-2">
                <Save size={15} /> {guardarEdicion.isPending ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          )}

          {/* ── MOVER ── */}
          {tab === 'mover' && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700">
                Mover stock parcial crea un nuevo LPN en la ubicación destino y reduce la cantidad de este LPN.
              </div>
              {tieneSeries ? (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700">
                  ⚠ Para LPNs con series, el traslado se hace desde la pestaña Series — seleccioná las series a mover individualmente.
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Cantidad a mover (disponible: {linea.cantidad - (linea.cantidad_reservada ?? 0)})
                    </label>
                    <input type="number" min="1" max={linea.cantidad - (linea.cantidad_reservada ?? 0)}
                      value={cantMover} onChange={e => setCantMover(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-accent" placeholder="0" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Ubicación destino</label>
                    <select value={ubicDestino} onChange={e => setUbicDestino(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-accent">
                      <option value="">Seleccioná ubicación...</option>
                      {(ubicaciones as any[]).map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                    </select>
                  </div>
                  {cantMover && ubicDestino && (
                    <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-600 space-y-1">
                      <p>LPN original: <span className="font-semibold">{linea.cantidad - parseInt(cantMover)} u.</span></p>
                      <p>Nuevo LPN: <span className="font-semibold">{cantMover} u.</span> en {(ubicaciones as any[]).find(u => u.id === ubicDestino)?.nombre}</p>
                    </div>
                  )}
                  <button onClick={() => moverStock.mutate()} disabled={moverStock.isPending || !cantMover || !ubicDestino}
                    className="w-full bg-accent hover:bg-primary text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50 flex items-center justify-center gap-2">
                    <ArrowRightLeft size={15} /> {moverStock.isPending ? 'Moviendo...' : 'Confirmar traslado'}
                  </button>
                </>
              )}
            </div>
          )}

          {/* ── SERIES ── */}
          {tab === 'series' && tieneSeries && (
            <div className="space-y-3">
              {/* Agregar serie */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Agregar serie nueva</label>
                <div className="flex gap-2">
                  <input type="text" value={newSerie} onChange={e => setNewSerie(e.target.value)}
                    placeholder="Nro. de serie"
                    onKeyDown={e => e.key === 'Enter' && agregarSerie.mutate()}
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:border-accent" />
                  <button onClick={() => agregarSerie.mutate()} disabled={agregarSerie.isPending || !newSerie.trim()}
                    className="px-4 py-2 bg-accent hover:bg-accent/90 text-white rounded-lg text-sm disabled:opacity-50">
                    <Plus size={16} />
                  </button>
                </div>
              </div>

              <div className="border-t border-gray-100 pt-3">
                <p className="text-xs font-medium text-gray-600 mb-2">Series activas ({seriesActivas.length})</p>
                <div className="space-y-1.5 max-h-56 overflow-y-auto">
                  {seriesActivas.map((s: any) => (
                    <div key={s.id} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                      {editSerieId === s.id ? (
                        <>
                          <input type="text" value={editSerieNro} onChange={e => setEditSerieNro(e.target.value)}
                            className="flex-1 px-2 py-1 border border-gray-200 rounded text-sm font-mono focus:outline-none focus:border-accent" />
                          <button onClick={() => editarSerie.mutate({ serieId: s.id, nroNuevo: editSerieNro })}
                            className="text-green-600 text-xs font-medium hover:underline">Guardar</button>
                          <button onClick={() => setEditSerieId(null)} className="text-gray-400 text-xs hover:underline">Cancelar</button>
                        </>
                      ) : (
                        <>
                          <Hash size={11} className="text-gray-400 flex-shrink-0" />
                          <span className="flex-1 text-sm font-mono text-gray-800">{s.nro_serie}</span>
                          {s.reservado && <span className="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded">Reservada</span>}
                          <button onClick={() => { setEditSerieId(s.id); setEditSerieNro(s.nro_serie) }}
                            className="text-gray-400 hover:text-accent p-1"><Edit2 size={12} /></button>
                          {!s.reservado && (
                            <button onClick={() => { if (confirm('¿Eliminar esta serie?')) eliminarSerie.mutate(s.id) }}
                              className="text-gray-400 hover:text-red-500 p-1"><Trash2 size={12} /></button>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── ELIMINAR ── */}
          {tab === 'eliminar' && (
            <div className="space-y-4">
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
                <AlertTriangle size={28} className="text-red-500 mx-auto mb-2" />
                <p className="font-semibold text-red-700">Eliminar LPN {linea.lpn}</p>
                <p className="text-xs text-red-600 mt-1">
                  Se eliminarán {tieneSeries ? `${seriesActivas.length} series` : `${linea.cantidad} unidades`} del inventario.
                  Esta acción quedará registrada en el historial.
                </p>
              </div>
              {(linea.cantidad_reservada ?? 0) > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700 flex items-start gap-2">
                  <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                  Este LPN tiene {linea.cantidad_reservada} unidad(es) reservada(s) en ventas pendientes. Eliminarlo puede afectar esas ventas.
                </div>
              )}
              <button onClick={() => { if (confirm(`¿Eliminar definitivamente el LPN ${linea.lpn}?`)) eliminarLpn.mutate() }}
                disabled={eliminarLpn.isPending}
                className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-3 rounded-xl text-sm disabled:opacity-50 flex items-center justify-center gap-2">
                <Trash2 size={15} /> {eliminarLpn.isPending ? 'Eliminando...' : 'Confirmar eliminación'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
