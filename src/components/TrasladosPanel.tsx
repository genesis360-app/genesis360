/**
 * TrasladosPanel — Traslados de stock entre sucursales (mig 205).
 * Auditoría de procesos 2026-06-11, ítem #4. Decisiones relevadas con GO:
 * tránsito + confirmación · detalle por LPN/línea (lote/venc/series viajan con la línea) ·
 * DEPOSITO+ crea/despacha · el destino confirma · recepción parcial con faltante auditado.
 *
 * Flujo: Despachar (origen) → stock sale + traslado `en_transito` → Confirmar recepción
 * (destino) → stock entra (mismo LPN/lote/series) · faltantes auditados. Cancelar en
 * tránsito → reingreso al origen.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Truck, Plus, X, Check, PackageCheck, AlertTriangle, ChevronDown, ChevronUp, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'
import { useConteoBloqueante } from '@/hooks/useConteoBloqueante'
import { logActividad } from '@/lib/actividadLog'
import { esDecimal } from '@/lib/ventasValidation'
import {
  puedeCrearTraslado, puedeConfirmarRecepcion, disponibleLinea,
  validarCantidadTraslado, validarRecepcion, estadoDesdeRecepcion, totalFaltante,
} from '@/lib/trasladoLogic'

const ESTADO_BADGE: Record<string, { label: string; cls: string }> = {
  en_transito:      { label: 'En tránsito',       cls: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' },
  recibido:         { label: 'Recibido',          cls: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' },
  recibido_parcial: { label: 'Recibido parcial',  cls: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400' },
  cancelado:        { label: 'Cancelado',         cls: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400' },
}

interface ItemDraft {
  linea: any            // inventario_lineas row (+productos, +ubicaciones)
  cantidad: string      // input
  seriesSel: string[]   // serie_ids elegidas (serializado)
  seriesDisp: any[]     // series activas no reservadas de la línea
}

export default function TrasladosPanel() {
  const { tenant, user } = useAuthStore()
  const { sucursalId, sucursales, puedeVerTodas } = useSucursalFilter()
  const qc = useQueryClient()
  const rol = user?.rol as any
  const { data: conteoBloqueante } = useConteoBloqueante(tenant?.id, sucursalId)

  // ── State ──────────────────────────────────────────────────────────────────
  const [showNuevo, setShowNuevo] = useState(false)
  const [destinoId, setDestinoId] = useState('')
  const [notas, setNotas] = useState('')
  const [lineaSearch, setLineaSearch] = useState('')
  const [items, setItems] = useState<ItemDraft[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [recibirTraslado, setRecibirTraslado] = useState<any | null>(null)
  const [recibirCants, setRecibirCants] = useState<Record<string, string>>({})       // item_id → cantidad recibida
  const [recibirSeries, setRecibirSeries] = useState<Record<string, string[]>>({})   // item_id → serie_ids recibidas
  const [recibirUbicacionId, setRecibirUbicacionId] = useState('')

  const sucursalNombre = (id: string | null | undefined) =>
    (sucursales as any[]).find(s => s.id === id)?.nombre ?? '—'

  // ── Traslados del tenant ───────────────────────────────────────────────────
  const { data: traslados = [], isLoading } = useQuery({
    queryKey: ['traslados', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('traslados')
        .select('*, traslado_items(*, productos(nombre, sku, unidad_medida, tiene_series))')
        .eq('tenant_id', tenant!.id)
        .order('created_at', { ascending: false })
        .limit(100)
      return data ?? []
    },
    enabled: !!tenant,
  })

  const entrantes = (traslados as any[]).filter(t =>
    t.estado === 'en_transito' && (puedeVerTodas || t.sucursal_destino_id === sucursalId))

  // ── Líneas de la sucursal origen (para armar el traslado) ──────────────────
  const { data: lineasOrigen = [] } = useQuery({
    queryKey: ['traslado-lineas-origen', tenant?.id, sucursalId, lineaSearch],
    queryFn: async () => {
      let q = supabase.from('inventario_lineas')
        .select('*, productos!inner(id, nombre, sku, unidad_medida, tiene_series), ubicaciones(nombre)')
        .eq('tenant_id', tenant!.id)
        .eq('activo', true)
        .gt('cantidad', 0)
        .eq('sucursal_id', sucursalId!)
        .limit(30)
      const s = lineaSearch.trim()
      if (s) q = q.or(`nombre.ilike.%${s}%,sku.ilike.%${s}%`, { foreignTable: 'productos' })
      const { data } = await q
      return data ?? []
    },
    enabled: !!tenant && !!sucursalId && showNuevo,
  })

  // ── Ubicaciones de la sucursal destino (para la recepción) ─────────────────
  const { data: ubicacionesDestino = [] } = useQuery({
    queryKey: ['traslado-ubic-destino', tenant?.id, recibirTraslado?.sucursal_destino_id],
    queryFn: async () => {
      const { data } = await supabase.from('ubicaciones')
        .select('id, nombre')
        .eq('tenant_id', tenant!.id)
        .or(`sucursal_id.eq.${recibirTraslado!.sucursal_destino_id},sucursal_id.is.null`)
        .order('prioridad', { ascending: true })
      return data ?? []
    },
    enabled: !!tenant && !!recibirTraslado,
  })

  // ── Agregar línea al borrador ──────────────────────────────────────────────
  const agregarLinea = async (linea: any) => {
    if (items.some(i => i.linea.id === linea.id)) { toast.error('Esa línea ya está en el traslado'); return }
    let seriesDisp: any[] = []
    if (linea.productos?.tiene_series) {
      const { data } = await supabase.from('inventario_series')
        .select('id, nro_serie')
        .eq('linea_id', linea.id).eq('activo', true).eq('reservado', false)
      seriesDisp = data ?? []
      if (!seriesDisp.length) { toast.error('La línea no tiene series disponibles (sin reservar)'); return }
    }
    const disp = disponibleLinea(linea.cantidad, linea.cantidad_reservada)
    if (disp <= 0) { toast.error('La línea no tiene stock disponible (todo reservado)'); return }
    setItems(prev => [...prev, { linea, cantidad: String(disp), seriesSel: [], seriesDisp }])
    setLineaSearch('')
  }

  // ── Despachar ──────────────────────────────────────────────────────────────
  const despachar = useMutation({
    mutationFn: async () => {
      if (!puedeCrearTraslado(rol)) throw new Error('No tenés permiso para crear traslados')
      if (!sucursalId) throw new Error('Seleccioná una sucursal de origen específica (no "Todas")')
      if (conteoBloqueante) throw new Error('Hay un conteo wall-to-wall en curso en esta sucursal. Finalizalo antes de trasladar stock.')
      if (!destinoId) throw new Error('Seleccioná la sucursal destino')
      if (destinoId === sucursalId) throw new Error('El destino debe ser distinto al origen')
      if (!items.length) throw new Error('Agregá al menos una línea al traslado')

      // Validación por ítem (cantidad o series)
      for (const it of items) {
        const p = it.linea.productos
        if (p?.tiene_series) {
          if (!it.seriesSel.length) throw new Error(`Elegí las series de ${p.nombre} (${it.linea.lpn})`)
        } else {
          const err = validarCantidadTraslado({
            cantidad: parseFloat(it.cantidad),
            disponible: disponibleLinea(it.linea.cantidad, it.linea.cantidad_reservada),
            esDecimal: esDecimal(p?.unidad_medida),
          })
          if (err) throw new Error(`${p?.nombre} (${it.linea.lpn}): ${err}`)
        }
      }

      // Cabecera (el trigger asigna numero)
      const { data: cab, error: eCab } = await supabase.from('traslados').insert({
        tenant_id: tenant!.id,
        sucursal_origen_id: sucursalId,
        sucursal_destino_id: destinoId,
        estado: 'en_transito',
        notas: notas.trim() || null,
        despachado_por: user?.id ?? null,
      }).select('id, numero').single()
      if (eCab) throw eCab

      // Ítems: sale el stock del origen + snapshot en traslado_items
      for (const it of items) {
        const linea = it.linea
        const p = linea.productos
        const cant = p?.tiene_series ? it.seriesSel.length : parseFloat(it.cantidad)

        // Re-chequeo fresco contra carreras (otro usuario pudo vender/reservar)
        const { data: fresh } = await supabase.from('inventario_lineas')
          .select('cantidad, cantidad_reservada, activo').eq('id', linea.id).single()
        const dispFresh = fresh?.activo ? disponibleLinea(fresh.cantidad, fresh.cantidad_reservada) : 0
        if (cant > dispFresh) throw new Error(`${p?.nombre} (${linea.lpn}): el disponible cambió (quedan ${dispFresh})`)

        if (p?.tiene_series) {
          await supabase.from('inventario_series').update({ activo: false }).in('id', it.seriesSel)
          const { count } = await supabase.from('inventario_series')
            .select('id', { count: 'exact', head: true }).eq('linea_id', linea.id).eq('activo', true)
          const nueva = (fresh!.cantidad ?? 0) - cant
          await supabase.from('inventario_lineas')
            .update({ cantidad: Math.max(0, nueva), activo: (count ?? 0) > 0 && nueva > 0 }).eq('id', linea.id)
        } else {
          const nueva = (fresh!.cantidad ?? 0) - cant
          await supabase.from('inventario_lineas')
            .update({ cantidad: nueva, activo: nueva > 0 }).eq('id', linea.id)
        }

        const seriesSnapshot = p?.tiene_series
          ? it.seriesDisp.filter(s => it.seriesSel.includes(s.id)).map(s => ({ serie_id: s.id, nro_serie: s.nro_serie }))
          : null

        const { error: eItem } = await supabase.from('traslado_items').insert({
          tenant_id: tenant!.id,
          traslado_id: cab.id,
          producto_id: p.id,
          linea_origen_id: linea.id,
          lpn: linea.lpn,
          nro_lote: linea.nro_lote ?? null,
          fecha_vencimiento: linea.fecha_vencimiento ?? null,
          estado_id: linea.estado_id ?? null,
          precio_costo_snapshot: linea.precio_costo_snapshot ?? null,
          series: seriesSnapshot,
          cantidad: cant,
          // Snapshot de atributos de variante — la recepción/cancelación los propaga a la
          // línea nueva sin re-preguntar (es la misma mercadería física que viaja).
          talle: linea.talle ?? null,
          color: linea.color ?? null,
          encaje: linea.encaje ?? null,
          formato: linea.formato ?? null,
          sabor_aroma: linea.sabor_aroma ?? null,
        })
        if (eItem) throw eItem

        // Ledger: movimiento tipo 'traslado' (ya en el CHECK desde mig 055) en el origen
        const { data: stockRows } = await supabase.from('inventario_lineas')
          .select('cantidad').eq('tenant_id', tenant!.id).eq('producto_id', p.id)
          .eq('sucursal_id', sucursalId).eq('activo', true)
        const stockDespues = (stockRows ?? []).reduce((a: number, r: any) => a + (r.cantidad ?? 0), 0)
        await supabase.from('movimientos_stock').insert({
          tenant_id: tenant!.id,
          producto_id: p.id,
          tipo: 'traslado',
          cantidad: cant,
          stock_antes: stockDespues + cant,
          stock_despues: stockDespues,
          motivo: `Traslado #${cab.numero} → ${sucursalNombre(destinoId)}`,
          usuario_id: user?.id ?? null,
          linea_id: linea.id,
          sucursal_id: sucursalId,
        })
        logActividad({
          entidad: 'traslado', entidad_id: cab.id, entidad_nombre: p.nombre,
          accion: 'despacho_traslado', campo: `${cant} ${p.unidad_medida ?? 'u'}`,
          valor_anterior: sucursalNombre(sucursalId), valor_nuevo: sucursalNombre(destinoId),
          pagina: '/inventario', tipo_transaccion: 'traslado',
          producto_id: p.id, lpn: linea.lpn, lote: linea.nro_lote ?? null, sucursal_id: sucursalId,
        })
      }
      return { numero: cab.numero }
    },
    onSuccess: (d: any) => {
      toast.success(`Traslado #${d.numero} despachado — en tránsito`)
      setShowNuevo(false); setItems([]); setDestinoId(''); setNotas('')
      qc.invalidateQueries({ queryKey: ['traslados'] })
      qc.invalidateQueries({ queryKey: ['inventario_lineas_all'] })
      qc.invalidateQueries({ queryKey: ['productos'] })
      qc.invalidateQueries({ queryKey: ['movimientos'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Confirmar recepción ────────────────────────────────────────────────────
  const abrirRecepcion = (t: any) => {
    const cants: Record<string, string> = {}
    const series: Record<string, string[]> = {}
    for (const it of t.traslado_items ?? []) {
      cants[it.id] = String(it.cantidad)
      series[it.id] = ((it.series as any[]) ?? []).map(s => s.serie_id)   // default: llegaron todas
    }
    // Precarga la ubicación destino si TODOS los ítems sugieren la misma (mig 276 — hoy solo
    // la setea el movimiento parcial desde LpnAccionesModal, que siempre despacha 1 ítem).
    // El destino puede cambiarla igual; no es vinculante.
    const items: any[] = t.traslado_items ?? []
    const sugeridas = new Set(items.map(it => it.ubicacion_sugerida_id ?? null))
    const sugeridaUnica = sugeridas.size === 1 ? [...sugeridas][0] : null

    setRecibirCants(cants); setRecibirSeries(series); setRecibirUbicacionId(sugeridaUnica ?? '')
    setRecibirTraslado(t)
  }

  const confirmarRecepcion = useMutation({
    mutationFn: async () => {
      const t = recibirTraslado!
      if (!puedeConfirmarRecepcion({ rol, sucursalActivaId: sucursalId, puedeVerTodas, sucursalDestinoId: t.sucursal_destino_id }))
        throw new Error('Solo un usuario de la sucursal destino puede confirmar esta recepción')

      const itemsT: any[] = t.traslado_items ?? []
      const recepcion = itemsT.map(it => ({
        cantidad: Number(it.cantidad),
        cantidad_recibida: it.productos?.tiene_series
          ? (recibirSeries[it.id]?.length ?? 0)
          : parseFloat(recibirCants[it.id] || '0'),
      }))
      const err = validarRecepcion(recepcion)
      if (err) throw new Error(err)

      for (let i = 0; i < itemsT.length; i++) {
        const it = itemsT[i]
        const recibida = recepcion[i].cantidad_recibida
        let lineaDestinoId: string | null = null

        if (recibida > 0) {
          // El stock entra al destino con el MISMO LPN/lote/vencimiento (identidad trazable)
          lineaDestinoId = crypto.randomUUID()
          const { error: eLin } = await supabase.from('inventario_lineas').insert({
            id: lineaDestinoId,
            tenant_id: tenant!.id,
            producto_id: it.producto_id,
            lpn: it.lpn,
            cantidad: recibida,
            estado_id: it.estado_id ?? null,
            ubicacion_id: recibirUbicacionId || null,
            sucursal_id: t.sucursal_destino_id,
            nro_lote: it.nro_lote ?? null,
            fecha_vencimiento: it.fecha_vencimiento ?? null,
            precio_costo_snapshot: it.precio_costo_snapshot ?? null,
            notas: `Traslado #${t.numero} desde ${sucursalNombre(t.sucursal_origen_id)}`,
            talle: it.talle ?? null,
            color: it.color ?? null,
            encaje: it.encaje ?? null,
            formato: it.formato ?? null,
            sabor_aroma: it.sabor_aroma ?? null,
          })
          if (eLin) throw eLin

          // Series recibidas: se reactivan apuntando a la línea destino (misma identidad)
          const serieIdsRecibidas = recibirSeries[it.id] ?? []
          if (it.productos?.tiene_series && serieIdsRecibidas.length) {
            await supabase.from('inventario_series')
              .update({ activo: true, reservado: false, linea_id: lineaDestinoId })
              .in('id', serieIdsRecibidas)
          }

          // Ledger en el destino
          const { data: stockRows } = await supabase.from('inventario_lineas')
            .select('cantidad').eq('tenant_id', tenant!.id).eq('producto_id', it.producto_id)
            .eq('sucursal_id', t.sucursal_destino_id).eq('activo', true)
          const stockDespues = (stockRows ?? []).reduce((a: number, r: any) => a + (r.cantidad ?? 0), 0)
          await supabase.from('movimientos_stock').insert({
            tenant_id: tenant!.id,
            producto_id: it.producto_id,
            tipo: 'traslado',
            cantidad: recibida,
            stock_antes: Math.max(0, stockDespues - recibida),
            stock_despues: stockDespues,
            motivo: `Traslado #${t.numero} recibido de ${sucursalNombre(t.sucursal_origen_id)}`,
            usuario_id: user?.id ?? null,
            linea_id: lineaDestinoId,
            sucursal_id: t.sucursal_destino_id,
          })
        }

        await supabase.from('traslado_items')
          .update({ cantidad_recibida: recibida, linea_destino_id: lineaDestinoId })
          .eq('id', it.id)

        // Faltante auditado (las series no recibidas quedan inactivas = perdidas en tránsito)
        const faltante = Number(it.cantidad) - recibida
        if (faltante > 0) {
          logActividad({
            entidad: 'traslado', entidad_id: t.id, entidad_nombre: it.productos?.nombre ?? '',
            accion: 'faltante_traslado', campo: `${faltante} ${it.productos?.unidad_medida ?? 'u'}`,
            valor_anterior: `Despachado ${it.cantidad}`, valor_nuevo: `Recibido ${recibida}`,
            pagina: '/inventario', tipo_transaccion: 'traslado',
            producto_id: it.producto_id, lpn: it.lpn ?? null, lote: it.nro_lote ?? null,
            sucursal_id: t.sucursal_destino_id,
          })
        } else {
          logActividad({
            entidad: 'traslado', entidad_id: t.id, entidad_nombre: it.productos?.nombre ?? '',
            accion: 'recepcion_traslado', campo: `${recibida} ${it.productos?.unidad_medida ?? 'u'}`,
            valor_anterior: sucursalNombre(t.sucursal_origen_id), valor_nuevo: sucursalNombre(t.sucursal_destino_id),
            pagina: '/inventario', tipo_transaccion: 'traslado',
            producto_id: it.producto_id, lpn: it.lpn ?? null, lote: it.nro_lote ?? null,
            sucursal_id: t.sucursal_destino_id,
          })
        }
      }

      const estadoFinal = estadoDesdeRecepcion(recepcion)
      await supabase.from('traslados').update({
        estado: estadoFinal,
        recibido_por: user?.id ?? null,
        recibido_at: new Date().toISOString(),
      }).eq('id', t.id)

      return { numero: t.numero, estadoFinal, faltante: totalFaltante(recepcion) }
    },
    onSuccess: (d: any) => {
      if (d.estadoFinal === 'recibido_parcial') {
        toast(`Traslado #${d.numero} recibido con FALTANTE de ${d.faltante} u. — quedó auditado`, { icon: '⚠️', duration: 8000 })
      } else {
        toast.success(`Traslado #${d.numero} recibido completo`)
      }
      setRecibirTraslado(null)
      qc.invalidateQueries({ queryKey: ['traslados'] })
      qc.invalidateQueries({ queryKey: ['inventario_lineas_all'] })
      qc.invalidateQueries({ queryKey: ['productos'] })
      qc.invalidateQueries({ queryKey: ['movimientos'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Cancelar traslado en tránsito (reingreso al origen) ───────────────────
  const cancelar = useMutation({
    mutationFn: async (t: any) => {
      if (!puedeCrearTraslado(rol)) throw new Error('No tenés permiso para cancelar traslados')
      for (const it of (t.traslado_items ?? [])) {
        let lineaId: string | null = it.linea_origen_id
        const { data: lin } = lineaId
          ? await supabase.from('inventario_lineas').select('id, cantidad, activo').eq('id', lineaId).single()
          : { data: null }
        if (lin) {
          await supabase.from('inventario_lineas')
            .update({ cantidad: (lin.cantidad ?? 0) + Number(it.cantidad), activo: true }).eq('id', lin.id)
        } else {
          lineaId = crypto.randomUUID()
          await supabase.from('inventario_lineas').insert({
            id: lineaId, tenant_id: tenant!.id, producto_id: it.producto_id,
            lpn: it.lpn, cantidad: Number(it.cantidad), estado_id: it.estado_id ?? null,
            sucursal_id: t.sucursal_origen_id, nro_lote: it.nro_lote ?? null,
            fecha_vencimiento: it.fecha_vencimiento ?? null,
            precio_costo_snapshot: it.precio_costo_snapshot ?? null,
            notas: `Reingreso por cancelación de traslado #${t.numero}`,
            talle: it.talle ?? null,
            color: it.color ?? null,
            encaje: it.encaje ?? null,
            formato: it.formato ?? null,
            sabor_aroma: it.sabor_aroma ?? null,
          })
        }
        const serieIds = ((it.series as any[]) ?? []).map(s => s.serie_id)
        if (serieIds.length) {
          await supabase.from('inventario_series')
            .update({ activo: true, reservado: false, linea_id: lineaId }).in('id', serieIds)
        }
        const { data: stockRows } = await supabase.from('inventario_lineas')
          .select('cantidad').eq('tenant_id', tenant!.id).eq('producto_id', it.producto_id)
          .eq('sucursal_id', t.sucursal_origen_id).eq('activo', true)
        const stockDespues = (stockRows ?? []).reduce((a: number, r: any) => a + (r.cantidad ?? 0), 0)
        await supabase.from('movimientos_stock').insert({
          tenant_id: tenant!.id, producto_id: it.producto_id, tipo: 'traslado',
          cantidad: Number(it.cantidad),
          stock_antes: Math.max(0, stockDespues - Number(it.cantidad)),
          stock_despues: stockDespues,
          motivo: `Traslado #${t.numero} cancelado — reingreso a ${sucursalNombre(t.sucursal_origen_id)}`,
          usuario_id: user?.id ?? null, linea_id: lineaId, sucursal_id: t.sucursal_origen_id,
        })
      }
      await supabase.from('traslados').update({ estado: 'cancelado' }).eq('id', t.id)
      return { numero: t.numero }
    },
    onSuccess: (d: any) => {
      toast.success(`Traslado #${d.numero} cancelado — stock devuelto al origen`)
      qc.invalidateQueries({ queryKey: ['traslados'] })
      qc.invalidateQueries({ queryKey: ['inventario_lineas_all'] })
      qc.invalidateQueries({ queryKey: ['productos'] })
      qc.invalidateQueries({ queryKey: ['movimientos'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Render ─────────────────────────────────────────────────────────────────
  const inputCls = 'w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-800'

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <Truck size={16} className="text-accent" />
          Traslados entre sucursales — el stock sale al despachar y entra cuando el destino confirma.
        </div>
        {puedeCrearTraslado(rol) && (
          <button
            onClick={() => {
              if (!sucursalId) { toast.error('Elegí una sucursal de origen específica en el selector (no "Todas")'); return }
              if ((sucursales as any[]).length < 2) { toast.error('Necesitás al menos 2 sucursales para trasladar'); return }
              setShowNuevo(true)
            }}
            className="flex items-center gap-1.5 bg-accent text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-accent/90 transition-colors flex-shrink-0">
            <Plus size={15} /> Nuevo traslado
          </button>
        )}
      </div>

      {/* Entrantes pendientes de confirmar */}
      {entrantes.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 space-y-2">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
            <PackageCheck size={15} /> {entrantes.length === 1 ? 'Hay 1 traslado' : `Hay ${entrantes.length} traslados`} en tránsito hacia {puedeVerTodas ? 'tus sucursales' : 'tu sucursal'}
          </p>
        </div>
      )}

      {/* Lista */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
        {isLoading ? (
          <p className="p-6 text-sm text-gray-400 text-center">Cargando…</p>
        ) : (traslados as any[]).length === 0 ? (
          <div className="p-10 text-center">
            <Truck size={32} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
            <p className="text-sm text-gray-500 dark:text-gray-400">Sin traslados todavía</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Mové stock entre sucursales con trazabilidad completa (LPN, lote, series).</p>
          </div>
        ) : (traslados as any[]).map(t => {
          const badge = ESTADO_BADGE[t.estado] ?? ESTADO_BADGE.en_transito
          const isExp = expandedId === t.id
          const nItems = (t.traslado_items ?? []).length
          const puedeRecibir = t.estado === 'en_transito' &&
            puedeConfirmarRecepcion({ rol, sucursalActivaId: sucursalId, puedeVerTodas, sucursalDestinoId: t.sucursal_destino_id })
          return (
            <div key={t.id}>
              <div className="p-4 flex items-center gap-3 flex-wrap">
                <button onClick={() => setExpandedId(isExp ? null : t.id)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                  {isExp ? <ChevronUp size={15} className="text-gray-400 flex-shrink-0" /> : <ChevronDown size={15} className="text-gray-400 flex-shrink-0" />}
                  <span className="font-semibold text-sm text-primary dark:text-white">#{t.numero}</span>
                  <span className="text-sm text-gray-600 dark:text-gray-300 truncate">
                    {sucursalNombre(t.sucursal_origen_id)} → {sucursalNombre(t.sucursal_destino_id)}
                  </span>
                  <span className="text-xs text-gray-400">{nItems} ítem{nItems !== 1 ? 's' : ''} · {new Date(t.despachado_at).toLocaleDateString('es-AR')}</span>
                </button>
                <span className={`text-xs font-medium px-2 py-1 rounded-full ${badge.cls}`}>{badge.label}</span>
                {puedeRecibir && (
                  <button onClick={() => abrirRecepcion(t)}
                    className="flex items-center gap-1.5 text-xs font-semibold bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 transition-colors">
                    <Check size={13} /> Confirmar recepción
                  </button>
                )}
                {t.estado === 'en_transito' && puedeCrearTraslado(rol) && (
                  <button
                    onClick={() => { if (confirm(`¿Cancelar el traslado #${t.numero}? El stock vuelve a ${sucursalNombre(t.sucursal_origen_id)}.`)) cancelar.mutate(t) }}
                    disabled={cancelar.isPending}
                    className="text-xs text-red-500 hover:text-red-600 px-2 py-1.5 disabled:opacity-50">
                    Cancelar
                  </button>
                )}
              </div>
              {isExp && (
                <div className="px-5 pb-4 space-y-1.5">
                  {(t.traslado_items ?? []).map((it: any) => {
                    const faltante = it.cantidad_recibida != null ? Number(it.cantidad) - Number(it.cantidad_recibida) : 0
                    return (
                      <div key={it.id} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 flex-wrap">
                        <span className="font-medium">{it.productos?.nombre}</span>
                        {it.lpn && <span className="text-gray-400">LPN {it.lpn}</span>}
                        {it.nro_lote && <span className="text-gray-400">Lote {it.nro_lote}</span>}
                        <span>· {Number(it.cantidad)} {it.productos?.unidad_medida ?? 'u'}</span>
                        {((it.series as any[]) ?? []).length > 0 && <span className="text-gray-400">({(it.series as any[]).length} series)</span>}
                        {it.cantidad_recibida != null && (
                          faltante > 0
                            ? <span className="text-orange-600 dark:text-orange-400 font-medium flex items-center gap-1"><AlertTriangle size={11} /> Recibido {Number(it.cantidad_recibida)} — faltó {faltante}</span>
                            : <span className="text-green-600 dark:text-green-400">✓ recibido</span>
                        )}
                      </div>
                    )
                  })}
                  {t.notas && <p className="text-xs text-gray-400 italic pt-1">{t.notas}</p>}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Modal nuevo traslado */}
      {showNuevo && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-700">
              <h2 className="text-lg font-bold text-primary dark:text-white flex items-center gap-2"><Truck size={18} className="text-accent" /> Nuevo traslado</h2>
              <button onClick={() => { setShowNuevo(false); setItems([]) }} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Origen</label>
                  <input value={sucursalNombre(sucursalId)} disabled className={`${inputCls} opacity-60`} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Destino *</label>
                  <select value={destinoId} onChange={e => setDestinoId(e.target.value)} className={inputCls}>
                    <option value="">Elegir sucursal…</option>
                    {(sucursales as any[]).filter(s => s.id !== sucursalId).map(s => (
                      <option key={s.id} value={s.id}>{s.nombre}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Buscador de líneas del origen */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Agregar stock a trasladar</label>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input value={lineaSearch} onChange={e => setLineaSearch(e.target.value)}
                    placeholder="Buscar producto por nombre o SKU…" className={`${inputCls} pl-9`} />
                </div>
                {lineaSearch.trim() && (
                  <div className="mt-1 border border-gray-200 dark:border-gray-700 rounded-xl divide-y divide-gray-100 dark:divide-gray-700 max-h-44 overflow-y-auto">
                    {(lineasOrigen as any[]).length === 0 ? (
                      <p className="p-3 text-xs text-gray-400">Sin líneas con stock en {sucursalNombre(sucursalId)}</p>
                    ) : (lineasOrigen as any[]).map(l => (
                      <button key={l.id} onClick={() => agregarLinea(l)}
                        className="w-full p-2.5 text-left text-xs hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-primary dark:text-white">{l.productos?.nombre}</span>
                        <span className="text-gray-400">LPN {l.lpn}</span>
                        {l.nro_lote && <span className="text-gray-400">Lote {l.nro_lote}</span>}
                        {l.ubicaciones?.nombre && <span className="text-gray-400">📍{l.ubicaciones.nombre}</span>}
                        <span className="ml-auto text-gray-600 dark:text-gray-300">{disponibleLinea(l.cantidad, l.cantidad_reservada)} disp.</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Ítems agregados */}
              {items.length > 0 && (
                <div className="space-y-2">
                  {items.map((it, idx) => {
                    const p = it.linea.productos
                    return (
                      <div key={it.linea.id} className="border border-gray-200 dark:border-gray-700 rounded-xl p-3 space-y-2">
                        <div className="flex items-center gap-2 text-sm flex-wrap">
                          <span className="font-medium text-primary dark:text-white">{p?.nombre}</span>
                          <span className="text-xs text-gray-400">LPN {it.linea.lpn}{it.linea.nro_lote ? ` · Lote ${it.linea.nro_lote}` : ''}</span>
                          <button onClick={() => setItems(prev => prev.filter((_, i) => i !== idx))}
                            className="ml-auto text-gray-400 hover:text-red-500"><X size={14} /></button>
                        </div>
                        {p?.tiene_series ? (
                          <div className="flex flex-wrap gap-1.5">
                            {it.seriesDisp.map(s => (
                              <label key={s.id} className={`text-[11px] px-2 py-1 rounded-lg border cursor-pointer transition-colors
                                ${it.seriesSel.includes(s.id) ? 'border-accent bg-accent/10 text-accent' : 'border-gray-200 dark:border-gray-600 text-gray-500'}`}>
                                <input type="checkbox" className="hidden" checked={it.seriesSel.includes(s.id)}
                                  onChange={() => setItems(prev => prev.map((x, i) => i !== idx ? x : {
                                    ...x, seriesSel: x.seriesSel.includes(s.id) ? x.seriesSel.filter(id => id !== s.id) : [...x.seriesSel, s.id],
                                  }))} />
                                {s.nro_serie}
                              </label>
                            ))}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <input type="number" min="0" step={esDecimal(p?.unidad_medida) ? 'any' : '1'}
                              value={it.cantidad}
                              onChange={e => setItems(prev => prev.map((x, i) => i === idx ? { ...x, cantidad: e.target.value } : x))}
                              onWheel={e => e.currentTarget.blur()}
                              className={`${inputCls} max-w-[120px]`} />
                            <span className="text-xs text-gray-400">de {disponibleLinea(it.linea.cantidad, it.linea.cantidad_reservada)} disp. ({p?.unidad_medida ?? 'u'})</span>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notas (opcional)</label>
                <input value={notas} onChange={e => setNotas(e.target.value)} placeholder="Transportista, motivo, referencia…" className={inputCls} />
              </div>
            </div>
            <div className="p-5 border-t border-gray-100 dark:border-gray-700 flex justify-end gap-3">
              <button onClick={() => { setShowNuevo(false); setItems([]) }}
                className="border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-medium px-4 py-2 rounded-xl text-sm">Cancelar</button>
              <button onClick={() => despachar.mutate()} disabled={despachar.isPending || !items.length || !destinoId}
                className="bg-accent text-white font-semibold px-5 py-2 rounded-xl text-sm disabled:opacity-50 hover:bg-accent/90 transition-colors">
                {despachar.isPending ? 'Despachando…' : 'Despachar traslado'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal confirmar recepción */}
      {recibirTraslado && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-700">
              <h2 className="text-lg font-bold text-primary dark:text-white flex items-center gap-2">
                <PackageCheck size={18} className="text-green-600" /> Confirmar recepción — Traslado #{recibirTraslado.numero}
              </h2>
              <button onClick={() => setRecibirTraslado(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Desde <b>{sucursalNombre(recibirTraslado.sucursal_origen_id)}</b>. Confirmá lo que llegó físicamente — si llegó menos, la diferencia queda auditada como faltante de traslado.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Ubicación destino</label>
                <select value={recibirUbicacionId} onChange={e => setRecibirUbicacionId(e.target.value)} className={inputCls}>
                  <option value="">Sin ubicación</option>
                  {(ubicacionesDestino as any[]).map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                {(recibirTraslado.traslado_items ?? []).map((it: any) => (
                  <div key={it.id} className="border border-gray-200 dark:border-gray-700 rounded-xl p-3 space-y-2">
                    <div className="flex items-center gap-2 text-sm flex-wrap">
                      <span className="font-medium text-primary dark:text-white">{it.productos?.nombre}</span>
                      <span className="text-xs text-gray-400">LPN {it.lpn}{it.nro_lote ? ` · Lote ${it.nro_lote}` : ''}</span>
                      <span className="ml-auto text-xs text-gray-500">Despachado: {Number(it.cantidad)} {it.productos?.unidad_medida ?? 'u'}</span>
                    </div>
                    {it.productos?.tiene_series ? (
                      <div className="flex flex-wrap gap-1.5">
                        {((it.series as any[]) ?? []).map(s => (
                          <label key={s.serie_id} className={`text-[11px] px-2 py-1 rounded-lg border cursor-pointer transition-colors
                            ${(recibirSeries[it.id] ?? []).includes(s.serie_id) ? 'border-green-500 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'border-gray-200 dark:border-gray-600 text-gray-400 line-through'}`}>
                            <input type="checkbox" className="hidden" checked={(recibirSeries[it.id] ?? []).includes(s.serie_id)}
                              onChange={() => setRecibirSeries(prev => {
                                const cur = prev[it.id] ?? []
                                return { ...prev, [it.id]: cur.includes(s.serie_id) ? cur.filter(id => id !== s.serie_id) : [...cur, s.serie_id] }
                              })} />
                            {s.nro_serie}
                          </label>
                        ))}
                        <span className="text-[11px] text-gray-400 self-center">(destildá las que no llegaron)</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">Recibido:</span>
                        <input type="number" min="0" step={esDecimal(it.productos?.unidad_medida) ? 'any' : '1'}
                          value={recibirCants[it.id] ?? ''}
                          onChange={e => setRecibirCants(prev => ({ ...prev, [it.id]: e.target.value }))}
                          onWheel={e => e.currentTarget.blur()}
                          className={`${inputCls} max-w-[120px]`} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="p-5 border-t border-gray-100 dark:border-gray-700 flex justify-end gap-3">
              <button onClick={() => setRecibirTraslado(null)}
                className="border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-medium px-4 py-2 rounded-xl text-sm">Cancelar</button>
              <button onClick={() => confirmarRecepcion.mutate()} disabled={confirmarRecepcion.isPending}
                className="bg-green-600 text-white font-semibold px-5 py-2 rounded-xl text-sm disabled:opacity-50 hover:bg-green-700 transition-colors">
                {confirmarRecepcion.isPending ? 'Confirmando…' : 'Confirmar recepción'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
