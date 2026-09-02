/**
 * ComercialPage — módulo NUEVO "Comercial" (Fede 25/7, Fase D).
 *
 * Consolida en una superficie DELEGABLE (no exclusiva del DUEÑO, a diferencia de Configuración)
 * el trabajo operativo de descuentos: Combos y Cupones se MUEVEN acá desde
 * Config → Ventas → Descuentos y combos (mismo modelo de datos, mismas queries — es
 * relocalización de UI, no un rediseño). Suma una vista nueva de "qué inventario está en
 * descuento y hasta cuándo" (lee `estados_inventario.descuento_pct`, configurado en
 * Config → Inventario → Estados — esa configuración NO se mueve, solo se visualiza acá).
 *
 * Acceso: DUEÑO/SUPERVISOR por default (`supervisorOnly`, ver AppLayout.tsx). Para delegar a un
 * empleado puntual sin darle el resto de los módulos de supervisor, el DUEÑO le asigna el rol
 * base SUPERVISOR y crea un rol custom "Comercial" (Usuarios → Roles) que oculta todo lo demás —
 * mismo patrón que ya usa la app para restringir cualquier otro módulo.
 */
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Gift, Tag, Plus, X, Trash2, ChevronDown, ChevronUp, Copy, ToggleLeft, ToggleRight, Percent,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'
import { logActividad } from '@/lib/actividadLog'
import { PageTabs } from '@/components/PageTabs'
import { InfoTip } from '@/components/InfoTip'
import { useConfirm, usePrompt } from '@/hooks/useConfirm'
import { estadoVigenciaCombo, hoyLocalISO } from '@/lib/ventasValidation'
import { generarCodigosCupon, CUPON_CODIGOS_MAXIMO } from '@/lib/cupones'
import { moduloSoloLectura } from '@/lib/permisosModulo'
import toast from 'react-hot-toast'

type ComercialTab = 'combos' | 'cupones' | 'descuentos-estado'

export default function ComercialPage() {
  const { tenant, user } = useAuthStore()
  const { sucursalId } = useSucursalFilter()
  const qc = useQueryClient()
  const confirmar = useConfirm()
  const preguntar = usePrompt()
  const [comercialTab, setComercialTab] = useState<ComercialTab>('combos')
  // Rol custom marcado 'ver' en 'comercial' → solo lectura (mismo criterio que el resto de la app).
  const canEdit = !moduloSoloLectura(user, 'comercial')

  // ── Combos ──────────────────────────────────────────────────────────────────
  const [comboForm, setComboForm] = useState({ nombre: '', descuento_tipo: 'pct', descuento_valor: '0', vigencia_desde: '', vigencia_hasta: '' })
  const [comboItems, setComboItems] = useState<{ producto_id: string; cantidad: string }[]>([{ producto_id: '', cantidad: '1' }])
  const [savingCombo, setSavingCombo] = useState(false)

  const applyComboPreset = async (preset: '3x2' | '2x1' | '2da') => {
    if (preset === '3x2') {
      setComboForm(p => ({ ...p, nombre: p.nombre || '3x2', descuento_tipo: 'pct', descuento_valor: '33' }))
      setComboItems(prev => [{ ...prev[0], cantidad: '3' }, ...prev.slice(1)])
    } else if (preset === '2x1') {
      setComboForm(p => ({ ...p, nombre: p.nombre || '2x1', descuento_tipo: 'pct', descuento_valor: '50' }))
      setComboItems(prev => [{ ...prev[0], cantidad: '2' }, ...prev.slice(1)])
    } else {
      const pct = await preguntar('% de descuento en la 2da unidad (ej: 30):', { placeholder: '30' })
      if (!pct || isNaN(parseInt(pct))) return
      const efectivo = Math.round(parseInt(pct) / 2)
      setComboForm(p => ({ ...p, nombre: p.nombre || `2da unidad ${pct}%`, descuento_tipo: 'pct', descuento_valor: String(efectivo) }))
      setComboItems(prev => [{ ...prev[0], cantidad: '2' }, ...prev.slice(1)])
    }
  }

  const { data: productosAll = [] } = useQuery({
    queryKey: ['productos-all', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('productos').select('id, nombre, sku')
        .eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant && comercialTab === 'combos',
  })

  const { data: combos = [], isLoading: loadingCombos } = useQuery({
    queryKey: ['combos', tenant?.id, sucursalId],
    queryFn: async () => {
      let q = supabase.from('combos')
        .select('*, combo_items(producto_id, cantidad, productos(nombre, sku))')
        .eq('tenant_id', tenant!.id).eq('activo', true)
        .order('created_at', { ascending: false })
      if (sucursalId) q = q.or(`sucursal_id.eq.${sucursalId},sucursal_id.is.null`)
      const { data } = await q
      return data ?? []
    },
    enabled: !!tenant && comercialTab === 'combos',
  })

  const addCombo = async () => {
    if (!comboForm.nombre.trim()) { toast.error('Ingresá un nombre'); return }
    if (comboItems.some(i => !i.producto_id)) { toast.error('Seleccioná un producto para cada ítem'); return }
    if (comboItems.some(i => parseInt(i.cantidad) < 1)) { toast.error('La cantidad mínima es 1'); return }
    const valor = parseFloat(comboForm.descuento_valor)
    if (isNaN(valor) || valor < 0) { toast.error('Valor de descuento inválido'); return }
    if (comboForm.descuento_tipo === 'pct' && valor > 100) { toast.error('El porcentaje no puede superar 100'); return }
    const descuento_pct = comboForm.descuento_tipo === 'pct' ? valor : 0
    const descuento_monto = comboForm.descuento_tipo !== 'pct' ? valor : 0
    if (comboForm.vigencia_desde && comboForm.vigencia_hasta && comboForm.vigencia_desde > comboForm.vigencia_hasta) {
      toast.error('La fecha "desde" no puede ser posterior a "hasta"'); return
    }
    setSavingCombo(true)
    try {
      const { data: combo, error: eC } = await supabase.from('combos').insert({
        tenant_id: tenant!.id,
        nombre: comboForm.nombre.trim(),
        descuento_pct,
        descuento_tipo: comboForm.descuento_tipo,
        descuento_monto,
        sucursal_id: sucursalId || null,
        vigencia_desde: comboForm.vigencia_desde || null,
        vigencia_hasta: comboForm.vigencia_hasta || null,
        activo: true,
      }).select().single()
      if (eC) throw eC
      const { error: eI } = await supabase.from('combo_items').insert(
        comboItems.map(i => ({ tenant_id: tenant!.id, combo_id: combo.id, producto_id: i.producto_id, cantidad: parseInt(i.cantidad) || 1 }))
      )
      if (eI) throw eI
      toast.success('Combo creado')
      logActividad({ entidad: 'combo', entidad_nombre: comboForm.nombre.trim(), accion: 'crear', pagina: '/comercial' })
      setComboForm({ nombre: '', descuento_tipo: 'pct', descuento_valor: '0', vigencia_desde: '', vigencia_hasta: '' })
      setComboItems([{ producto_id: '', cantidad: '1' }])
      qc.invalidateQueries({ queryKey: ['combos'] })
    } catch (err: any) { toast.error(err.message ?? 'Error al crear combo') }
    setSavingCombo(false)
  }

  const deleteCombo = async (id: string) => {
    if (!(await confirmar('¿Eliminar este combo?', { danger: true }))) return
    const old = (combos as any[]).find(c => c.id === id)
    const { error } = await supabase.from('combos').update({ activo: false }).eq('id', id)
    if (error) toast.error(error.message)
    else { toast.success('Combo eliminado'); qc.invalidateQueries({ queryKey: ['combos'] }); logActividad({ entidad: 'combo', entidad_id: id, entidad_nombre: old?.nombre, accion: 'eliminar', pagina: '/comercial' }) }
  }

  // ── Cupones ─────────────────────────────────────────────────────────────────
  const [showCuponForm, setShowCuponForm] = useState(false)
  const [cuponForm, setCuponForm] = useState({ nombre: '', motivo: '', monto: '', vigencia_desde: '', vigencia_hasta: '', cantidad: '10' })
  const [savingCupon, setSavingCupon] = useState(false)
  const [expandedCuponId, setExpandedCuponId] = useState<string | null>(null)

  const { data: cupones = [], isLoading: loadingCupones } = useQuery({
    queryKey: ['cupones', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('cupones').select('*').eq('tenant_id', tenant!.id).order('created_at', { ascending: false })
      return (data ?? []) as any[]
    },
    enabled: !!tenant && comercialTab === 'cupones',
  })
  const { data: cuponesCodigos = [] } = useQuery({
    queryKey: ['cupones_codigos', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('cupones_codigos')
        .select('id, cupon_id, codigo, usado_en_venta_id, usado_at')
        .eq('tenant_id', tenant!.id)
      return (data ?? []) as any[]
    },
    enabled: !!tenant && comercialTab === 'cupones',
  })

  const crearCupon = async () => {
    if (!cuponForm.nombre.trim()) { toast.error('Ingresá un nombre para el cupón'); return }
    const monto = parseFloat(cuponForm.monto)
    if (!(monto > 0)) { toast.error('El monto tiene que ser mayor a 0'); return }
    if (!cuponForm.vigencia_desde || !cuponForm.vigencia_hasta) { toast.error('Cargá la vigencia (desde/hasta)'); return }
    if (cuponForm.vigencia_hasta < cuponForm.vigencia_desde) { toast.error('La fecha de fin no puede ser anterior al inicio'); return }
    const cantidad = Math.max(1, Math.min(CUPON_CODIGOS_MAXIMO, parseInt(cuponForm.cantidad) || 1))
    setSavingCupon(true)
    const { data: cupon, error } = await supabase.from('cupones').insert({
      tenant_id: tenant!.id,
      nombre: cuponForm.nombre.trim(),
      motivo: cuponForm.motivo.trim() || null,
      monto,
      vigencia_desde: cuponForm.vigencia_desde,
      vigencia_hasta: cuponForm.vigencia_hasta,
      created_by: user?.id,
    }).select().single()
    if (error) { toast.error(error.message); setSavingCupon(false); return }
    const codigos = generarCodigosCupon(cantidad)
    const { error: errCodigos } = await supabase.from('cupones_codigos').insert(
      codigos.map(codigo => ({ tenant_id: tenant!.id, cupon_id: cupon.id, codigo }))
    )
    setSavingCupon(false)
    if (errCodigos) toast.error(`Cupón creado, pero fallaron los códigos: ${errCodigos.message}`)
    else toast.success(`Cupón "${cupon.nombre}" creado con ${cantidad} código${cantidad !== 1 ? 's' : ''}`)
    logActividad({ entidad: 'cupon', entidad_id: cupon.id, entidad_nombre: cupon.nombre, accion: 'crear', pagina: '/comercial' })
    setCuponForm({ nombre: '', motivo: '', monto: '', vigencia_desde: '', vigencia_hasta: '', cantidad: '10' })
    setShowCuponForm(false)
    qc.invalidateQueries({ queryKey: ['cupones'] })
    qc.invalidateQueries({ queryKey: ['cupones_codigos'] })
  }

  const toggleCuponActivo = async (id: string, value: boolean) => {
    const { error } = await supabase.from('cupones').update({ activo: value }).eq('id', id)
    if (error) toast.error(error.message)
    else qc.invalidateQueries({ queryKey: ['cupones'] })
  }

  const copiarCodigosCupon = async (cuponId: string, nombre: string) => {
    const codigos = (cuponesCodigos as any[]).filter(c => c.cupon_id === cuponId).map(c => c.codigo)
    try {
      await navigator.clipboard.writeText(codigos.join('\n'))
      toast.success(`${codigos.length} código(s) de "${nombre}" copiados`)
    } catch { toast.error('No se pudo copiar al portapapeles') }
  }

  // ── Descuentos por estado (vista nueva) ───────────────────────────────────────
  // La CONFIGURACIÓN (qué % lleva cada estado) sigue viviendo en Config → Inventario →
  // Estados (mig 284) — acá solo se VISUALIZA qué inventario real está hoy bajo un estado
  // con descuento, y "hasta cuándo" (la fecha de vencimiento del lote, si tiene).
  const { data: estadosConDescuento = [] } = useQuery({
    queryKey: ['estados-con-descuento', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('estados_inventario')
        .select('id, nombre, color, descuento_pct')
        .eq('tenant_id', tenant!.id).gt('descuento_pct', 0)
      return (data ?? []) as any[]
    },
    enabled: !!tenant && comercialTab === 'descuentos-estado',
  })
  const idsEstadosConDescuento = (estadosConDescuento as any[]).map(e => e.id)
  const { data: inventarioEnDescuento = [], isLoading: loadingInvDesc } = useQuery({
    queryKey: ['inventario-en-descuento', tenant?.id, sucursalId, idsEstadosConDescuento.join(',')],
    queryFn: async () => {
      let q = supabase.from('inventario_lineas')
        .select('id, lpn, cantidad, fecha_vencimiento, estado_id, productos(nombre, sku)')
        .eq('tenant_id', tenant!.id).eq('activo', true).in('estado_id', idsEstadosConDescuento).gt('cantidad', 0)
      if (sucursalId) q = q.eq('sucursal_id', sucursalId)
      const { data } = await q.order('fecha_vencimiento', { ascending: true, nullsFirst: false })
      return (data ?? []) as any[]
    },
    enabled: !!tenant && comercialTab === 'descuentos-estado' && idsEstadosConDescuento.length > 0,
  })

  return (
    <div className="max-w-4xl mx-auto space-y-4 pb-8">
      <div>
        <h1 className="text-2xl font-bold text-primary">Comercial</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">Combos, cupones y descuentos por estado de inventario.</p>
      </div>

      <PageTabs
        tabs={[
          { id: 'combos', label: 'Combos', icon: Gift },
          { id: 'cupones', label: 'Cupones', icon: Tag },
          { id: 'descuentos-estado', label: 'Descuentos vigentes', icon: Percent },
        ]}
        active={comercialTab}
        onChange={id => setComercialTab(id as ComercialTab)}
      />

      {comercialTab === 'combos' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 space-y-5">
          <div className="flex items-center gap-2">
            <Gift size={18} className="text-accent-text" />
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Combos de productos</h2>
            <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">{combos.length} activos</span>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 -mt-2">
            Definí reglas de precio por volumen. Cuando se alcanza la cantidad en el carrito, aparece una sugerencia para aplicar el descuento.
          </p>

          {canEdit && (
          <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Nuevo combo</p>
              <div className="flex gap-1">
                {(['3x2', '2x1', '2da'] as const).map(p => (
                  <button key={p} onClick={() => applyComboPreset(p)} title={p === '2da' ? '2da unidad X% off' : p}
                    className="px-2 py-0.5 text-xs rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-900/50">
                    {p === '2da' ? '2da ud.' : p}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2">
                <input type="text" value={comboForm.nombre} onChange={e => setComboForm(p => ({ ...p, nombre: e.target.value }))}
                  placeholder="Nombre del combo (ej: 3x Coca-Cola 10% off)"
                  className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text" />
              </div>

              <div className="col-span-2 space-y-2">
                <p className="text-xs text-gray-500 dark:text-gray-400">Productos del combo</p>
                {comboItems.map((ci, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <select value={ci.producto_id} onChange={e => setComboItems(prev => prev.map((x, i) => i === idx ? { ...x, producto_id: e.target.value } : x))}
                      className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text">
                      <option value="">Seleccionar producto...</option>
                      {(productosAll as any[]).map((p: any) => (
                        <option key={p.id} value={p.id}>{p.nombre} ({p.sku})</option>
                      ))}
                    </select>
                    <input type="number" onWheel={e => e.currentTarget.blur()} min="1" value={ci.cantidad}
                      onChange={e => setComboItems(prev => prev.map((x, i) => i === idx ? { ...x, cantidad: e.target.value } : x))}
                      placeholder="Cant." className="w-16 px-2 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text text-center" />
                    {comboItems.length > 1 && (
                      <button onClick={() => setComboItems(prev => prev.filter((_, i) => i !== idx))}
                        className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg" title="Quitar">
                        <X size={13} />
                      </button>
                    )}
                  </div>
                ))}
                <button onClick={() => setComboItems(prev => [...prev, { producto_id: '', cantidad: '1' }])}
                  className="text-xs text-accent-text hover:underline flex items-center gap-1">
                  <Plus size={12} /> Agregar producto al combo
                </button>
              </div>

              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Tipo de descuento</label>
                <select value={comboForm.descuento_tipo} onChange={e => setComboForm(p => ({ ...p, descuento_tipo: e.target.value, descuento_valor: '0' }))}
                  className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text">
                  <option value="pct">Porcentaje (%)</option>
                  <option value="monto_ars">Monto fijo ($)</option>
                  <option value="monto_usd">Monto fijo (USD)</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                  {comboForm.descuento_tipo === 'pct' ? 'Descuento (%)' : comboForm.descuento_tipo === 'monto_usd' ? 'Descuento (USD)' : 'Descuento ($)'}
                </label>
                <input type="number" onWheel={e => e.currentTarget.blur()} min="0" max={comboForm.descuento_tipo === 'pct' ? '100' : undefined} step={comboForm.descuento_tipo === 'pct' ? '0.5' : '1'}
                  value={comboForm.descuento_valor}
                  onChange={e => setComboForm(p => ({ ...p, descuento_valor: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                  Vigencia (opcional) <InfoTip text="El combo se aplica solo entre estas fechas (ambas inclusive). Dejá los campos vacíos para que aplique siempre. Un combo vencido deja de ofrecerse solo en el POS — no hace falta apagarlo a mano." />
                </label>
                <div className="flex items-center gap-2">
                  <input type="date" value={comboForm.vigencia_desde}
                    onChange={e => setComboForm(p => ({ ...p, vigencia_desde: e.target.value }))}
                    className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-700" />
                  <span className="text-xs text-gray-400">a</span>
                  <input type="date" value={comboForm.vigencia_hasta}
                    onChange={e => setComboForm(p => ({ ...p, vigencia_hasta: e.target.value }))}
                    className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-700" />
                </div>
              </div>
            </div>
            <button onClick={addCombo} disabled={savingCombo}
              className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl text-sm transition-all disabled:opacity-50">
              <Plus size={15} /> {savingCombo ? 'Creando...' : 'Crear combo'}
            </button>
          </div>
          )}

          {loadingCombos ? (
            <div className="flex justify-center py-6"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" /></div>
          ) : combos.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">No hay combos definidos</p>
          ) : (
            <div className="space-y-2">
              {(combos as any[]).map((c: any) => (
                <div key={c.id} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-xl">
                  <div className="w-8 h-8 bg-amber-100 dark:bg-amber-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Gift size={15} className="text-amber-600 dark:text-amber-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-100 flex items-center gap-2">
                      {c.nombre}
                      {(() => {
                        if (!c.vigencia_desde && !c.vigencia_hasta) return null
                        const estado = estadoVigenciaCombo(c, hoyLocalISO())
                        const cls = estado === 'vigente' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          : estado === 'programado' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                          : 'bg-gray-200 dark:bg-gray-600 text-gray-500 dark:text-gray-300'
                        return <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${cls}`}>{estado}</span>
                      })()}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
                      {(c.combo_items ?? []).map((ci: any, i: number) => (
                        <span key={i}>{i > 0 ? ' + ' : ''}{ci.productos?.nombre ?? '?'} ×{ci.cantidad}</span>
                      ))} ·{' '}
                      {(c.descuento_tipo ?? 'pct') === 'pct'
                        ? `${c.descuento_pct}% off`
                        : (c.descuento_tipo === 'monto_usd' ? `USD ${c.descuento_monto} off` : `$${c.descuento_monto} off`)}
                      {(c.vigencia_desde || c.vigencia_hasta) && (
                        <> · {c.vigencia_desde ?? '…'} → {c.vigencia_hasta ?? '…'}</>
                      )}
                    </p>
                  </div>
                  {canEdit && (
                    <button onClick={() => deleteCombo(c.id)}
                      className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-red-500 hover:bg-red-50 dark:bg-red-900/20 rounded-lg flex-shrink-0">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {comercialTab === 'cupones' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <Tag size={18} className="text-accent-text" />
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Cupones</h2>
            <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">{cupones.length} campaña{cupones.length !== 1 ? 's' : ''}</span>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Descuento en <strong>$ fijos sobre el total de la compra</strong> — independiente de cualquier
            descuento que ya tenga un producto del carrito. Se canjea con un código único de un solo uso.
          </p>

          {canEdit && (!showCuponForm ? (
            <button onClick={() => setShowCuponForm(true)}
              className="flex items-center gap-2 text-sm text-accent-text hover:underline">
              <Plus size={15} /> Nueva campaña de cupón
            </button>
          ) : (
            <div className="bg-gray-50 dark:bg-gray-700/40 rounded-xl p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Nombre</label>
                  <input type="text" value={cuponForm.nombre} onChange={e => setCuponForm(p => ({ ...p, nombre: e.target.value }))}
                    placeholder="Ej: Día del amigo"
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-800" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Motivo / intención</label>
                  <input type="text" value={cuponForm.motivo} onChange={e => setCuponForm(p => ({ ...p, motivo: e.target.value }))}
                    placeholder="Ej: fidelización clientes VIP"
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-800" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Monto ($ fijo)</label>
                  <input type="number" onWheel={e => e.currentTarget.blur()} min="1" step="1" value={cuponForm.monto}
                    onChange={e => setCuponForm(p => ({ ...p, monto: e.target.value }))}
                    placeholder="1000"
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-800" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Cantidad de códigos (máx. {CUPON_CODIGOS_MAXIMO})</label>
                  <input type="number" onWheel={e => e.currentTarget.blur()} min="1" max={CUPON_CODIGOS_MAXIMO} step="1" value={cuponForm.cantidad}
                    onChange={e => setCuponForm(p => ({ ...p, cantidad: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-800" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Vigencia desde</label>
                  <input type="date" value={cuponForm.vigencia_desde} onChange={e => setCuponForm(p => ({ ...p, vigencia_desde: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-800" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Vigencia hasta</label>
                  <input type="date" value={cuponForm.vigencia_hasta} onChange={e => setCuponForm(p => ({ ...p, vigencia_hasta: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-800" />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowCuponForm(false)}
                  className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 py-2.5 rounded-xl text-sm font-medium">
                  Cancelar
                </button>
                <button onClick={crearCupon} disabled={savingCupon}
                  className="flex-1 bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50">
                  {savingCupon ? 'Creando...' : 'Crear cupón'}
                </button>
              </div>
            </div>
          ))}

          {loadingCupones ? (
            <div className="flex justify-center py-6"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" /></div>
          ) : cupones.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">No hay cupones definidos</p>
          ) : (
            <div className="space-y-2">
              {(cupones as any[]).map((c: any) => {
                const codigosDelCupon = (cuponesCodigos as any[]).filter(cc => cc.cupon_id === c.id)
                const usados = codigosDelCupon.filter(cc => cc.usado_en_venta_id).length
                const montoGenerado = usados * Number(c.monto)
                const expandido = expandedCuponId === c.id
                return (
                  <div key={c.id} className="p-3 bg-gray-50 dark:bg-gray-700 rounded-xl space-y-2">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-violet-100 dark:bg-violet-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Tag size={15} className="text-violet-600 dark:text-violet-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-100 flex items-center gap-2">
                          {c.nombre}
                          {!c.activo && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-gray-200 dark:bg-gray-600 text-gray-500 dark:text-gray-300">inactivo</span>}
                        </p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
                          ${Number(c.monto).toLocaleString('es-AR')} off · {c.vigencia_desde} → {c.vigencia_hasta} · {usados}/{codigosDelCupon.length} usados · ${montoGenerado.toLocaleString('es-AR')} generado
                          {c.motivo && <> · {c.motivo}</>}
                        </p>
                      </div>
                      <button onClick={() => setExpandedCuponId(expandido ? null : c.id)}
                        className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-accent-text rounded-lg flex-shrink-0" title="Ver códigos">
                        {expandido ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                      </button>
                      <button onClick={() => copiarCodigosCupon(c.id, c.nombre)}
                        className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-accent-text rounded-lg flex-shrink-0" title="Copiar todos los códigos">
                        <Copy size={15} />
                      </button>
                      {canEdit && (
                        <button onClick={() => toggleCuponActivo(c.id, !c.activo)}
                          className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-red-500 rounded-lg flex-shrink-0"
                          title={c.activo ? 'Desactivar cupón' : 'Reactivar cupón'}>
                          {c.activo ? <ToggleRight size={15} className="text-emerald-500" /> : <ToggleLeft size={15} />}
                        </button>
                      )}
                    </div>
                    {expandido && (
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 pt-2 border-t border-dashed border-gray-200 dark:border-gray-600">
                        {codigosDelCupon.map((cc: any) => (
                          <span key={cc.id}
                            className={`px-2 py-1 rounded-lg text-xs font-mono text-center ${cc.usado_en_venta_id
                              ? 'bg-gray-200 dark:bg-gray-600 text-gray-400 dark:text-gray-500 line-through'
                              : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600'}`}>
                            {cc.codigo}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {comercialTab === 'descuentos-estado' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <Percent size={18} className="text-accent-text" />
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Descuentos por estado — vigentes</h2>
            <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">{inventarioEnDescuento.length} línea{inventarioEnDescuento.length !== 1 ? 's' : ''}</span>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            El % de descuento de cada estado (ej. "Próximo a vencer") se configura en Config → Inventario
            → Estados. Acá se ve qué inventario está HOY bajo un estado con descuento y hasta cuándo — la
            fecha de vencimiento del lote, si tiene una cargada.
          </p>

          {estadosConDescuento.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">
              Ningún estado tiene un % de descuento configurado todavía (Config → Inventario → Estados).
            </p>
          ) : loadingInvDesc ? (
            <div className="flex justify-center py-6"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" /></div>
          ) : inventarioEnDescuento.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">No hay inventario hoy en un estado con descuento</p>
          ) : (
            <div className="space-y-2">
              {(inventarioEnDescuento as any[]).map((l: any) => {
                const est = (estadosConDescuento as any[]).find(e => e.id === l.estado_id)
                return (
                  <div key={l.id} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-xl">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: est?.color || '#9ca3af' }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{l.productos?.nombre ?? '—'}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
                        LPN {l.lpn ?? '—'} · {l.cantidad} u · {est?.nombre} (−{est?.descuento_pct}%)
                        {l.fecha_vencimiento && <> · hasta {String(l.fecha_vencimiento).slice(0, 10)}</>}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
