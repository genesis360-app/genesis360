// ─── AlertasPage ──────────────────────────────────────────────────────────────
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle, Clock, Tag, DollarSign, MapPin, Truck, CalendarX, ShoppingCart, Vault, Bell } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'
import { useModoOperacion } from '@/hooks/useModoOperacion'
import { cajasSobreUmbralBovedaDelTenant } from '@/hooks/useAlertas'
import { Link, useNavigate } from 'react-router-dom'
import { capacidadCrearOC } from '@/lib/comprasPermisos'
import { armarOCsSugeridas } from '@/lib/ocSugerida'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import toast from 'react-hot-toast'
import type { Alerta } from '@/lib/supabase'

const RESERVAS_DIAS_LIMITE = 3

export default function AlertasPage() {
  const { tenant, user } = useAuthStore()
  const { sucursalId, applyFilter } = useSucursalFilter()
  const { avanzado: modoAvanzado } = useModoOperacion()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const puedeGenerarOC = capacidadCrearOC(user?.rol) !== 'ninguna'  // CO7/A3

  const fechaLimite = new Date()
  fechaLimite.setDate(fechaLimite.getDate() - RESERVAS_DIAS_LIMITE)

  // ISS-080: las alertas viven a nivel tenant (no tienen sucursal_id) y son
  // disparadas por productos.stock_actual global. Cuando hay una sucursal
  // activa, filtramos client-side para mostrar SOLO alertas que aplican a esa
  // sucursal (stock_minimo: usando stock por sucursal vs PSMSS o mínimo global).
  const { data: alertas = [], isLoading } = useQuery({
    queryKey: ['alertas-page', tenant?.id, sucursalId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('alertas')
        .select('*, productos(id,nombre,sku,stock_actual,stock_minimo)')
        .eq('tenant_id', tenant!.id)
        .eq('resuelta', false)
        .order('created_at', { ascending: false })
      if (error) throw error
      const all = (data ?? []) as Alerta[]
      if (!sucursalId || all.length === 0) return all

      const productoIds = Array.from(new Set(all.map(a => (a as any).producto_id).filter(Boolean)))
      if (productoIds.length === 0) return all

      const [{ data: lineas }, { data: psmss }] = await Promise.all([
        supabase
          .from('inventario_lineas')
          .select('producto_id, cantidad, ubicacion:ubicaciones!inner(sucursal_id)')
          .eq('tenant_id', tenant!.id)
          .eq('activo', true)
          .in('producto_id', productoIds)
          .eq('ubicacion.sucursal_id', sucursalId),
        supabase
          .from('producto_stock_minimo_sucursal')
          .select('producto_id, stock_minimo')
          .eq('tenant_id', tenant!.id)
          .eq('sucursal_id', sucursalId)
          .in('producto_id', productoIds),
      ])

      const stockEnSuc: Record<string, number> = {}
      for (const l of (lineas ?? []) as any[]) {
        stockEnSuc[l.producto_id] = (stockEnSuc[l.producto_id] ?? 0) + Number(l.cantidad ?? 0)
      }
      const minEnSuc: Record<string, number> = {}
      for (const p of (psmss ?? []) as any[]) {
        minEnSuc[p.producto_id] = Number(p.stock_minimo ?? 0)
      }

      return all.filter(a => {
        if (a.tipo !== 'stock_minimo') return true
        const productoId = (a as any).producto_id
        const actual = stockEnSuc[productoId] ?? 0
        const minimo = minEnSuc[productoId] ?? Number((a as any).productos?.stock_minimo ?? 0)
        return actual <= minimo
      })
    },
    enabled: !!tenant,
  })

  const { data: reservasViejas = [], isLoading: loadingReservas } = useQuery({
    queryKey: ['reservas-viejas', tenant?.id, sucursalId],
    queryFn: async () => {
      const { data, error } = await applyFilter(supabase
        .from('ventas')
        .select('id, numero, cliente_nombre, cliente_telefono, total, created_at')
        .eq('tenant_id', tenant!.id)
        .eq('estado', 'reservada')
        .lt('created_at', fechaLimite.toISOString()))
        .order('created_at', { ascending: true })
      if (error) throw error
      return data ?? []
    },
    enabled: !!tenant,
  })

  // ISS-080: `productos` no tiene sucursal_id (catálogo es del tenant). Si hay
  // sucursal activa, mostramos solo los productos sin categoría que tengan
  // inventario en esa sucursal — un producto sin stock en la sucursal no es
  // accionable desde ahí.
  const { data: sinCategoria = [], isLoading: loadingSinCategoria } = useQuery({
    queryKey: ['productos-sin-categoria', tenant?.id, sucursalId, modoAvanzado],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('productos')
        .select('id, nombre, sku')
        .eq('tenant_id', tenant!.id)
        .eq('activo', true)
        .is('categoria_id', null)
        .order('nombre')
      if (error) throw error
      const all = data ?? []
      if (!sucursalId || all.length === 0) return all

      // En AVANZADO el stock se ubica por `ubicaciones.sucursal_id`; en BÁSICO no hay
      // ubicaciones (ubicacion_id NULL) y la sucursal vive directo en `inventario_lineas.sucursal_id`.
      // El INNER join a ubicaciones borraba TODO el stock básico → la página quedaba vacía aunque
      // el badge contara el producto (mismatch). Ver reference_basico_stock_null_ubicacion_estado.
      const lineasQ = supabase
        .from('inventario_lineas')
        .select(modoAvanzado ? 'producto_id, ubicacion:ubicaciones!inner(sucursal_id)' : 'producto_id')
        .eq('tenant_id', tenant!.id)
        .eq('activo', true)
        .gt('cantidad', 0)
        .in('producto_id', all.map(p => p.id))
      const { data: lineas } = await (modoAvanzado
        ? lineasQ.eq('ubicacion.sucursal_id', sucursalId)
        : lineasQ.eq('sucursal_id', sucursalId))

      const enSuc = new Set<string>((lineas ?? []).map((l: any) => l.producto_id))
      return all.filter(p => enSuc.has(p.id))
    },
    enabled: !!tenant,
  })

  // Clientes con saldo pendiente (ventas pendientes/reservadas con deuda)
  const { data: lineasSinUbicacion = [], isLoading: loadingSinUbic } = useQuery({
    queryKey: ['lineas-sin-ubicacion', tenant?.id, sucursalId],
    queryFn: async () => {
      const { data, error } = await applyFilter(supabase
        .from('inventario_lineas')
        .select('id, lpn, nro_lote, cantidad, productos(nombre, sku)')
        .eq('tenant_id', tenant!.id)
        .eq('activo', true)
        .is('ubicacion_id', null))
        .gt('cantidad', 0)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
    // En modo básico el stock no usa ubicaciones (ubicacion_id siempre NULL) → la alerta
    // marcaría TODO como "sin ubicación" = ruido. Solo aplica en avanzado (WMS).
    enabled: !!tenant && modoAvanzado,
  })

  const { data: lineasSinProveedor = [], isLoading: loadingSinProv } = useQuery({
    queryKey: ['lineas-sin-proveedor', tenant?.id, sucursalId],
    queryFn: async () => {
      const { data, error } = await applyFilter(supabase
        .from('inventario_lineas')
        .select('id, lpn, nro_lote, cantidad, productos(nombre, sku)')
        .eq('tenant_id', tenant!.id)
        .eq('activo', true)
        .is('proveedor_id', null)
        .gt('cantidad', 0)
        .order('created_at', { ascending: false }))
      if (error) throw error
      return data ?? []
    },
    // Trazabilidad de proveedor por LPN es de WMS (avanzado); en básico es ruido.
    enabled: !!tenant && modoAvanzado,
  })

  const hoyStr = new Date().toISOString().split('T')[0]
  const en3dias = new Date(); en3dias.setDate(en3dias.getDate() + 3)
  const en3diasStr = en3dias.toISOString().split('T')[0]

  const { data: ocsVencidas = [], isLoading: loadingOcsVenc } = useQuery({
    queryKey: ['oc-vencidas', tenant?.id, sucursalId],
    queryFn: async () => {
      const { data } = await applyFilter(supabase
        .from('ordenes_compra')
        .select('id, numero, estado_pago, fecha_vencimiento_pago, monto_total, monto_pagado, proveedores(nombre)')
        .eq('tenant_id', tenant!.id)
        .in('estado_pago', ['pendiente_pago', 'pago_parcial', 'cuenta_corriente'])
        .not('fecha_vencimiento_pago', 'is', null)
        .lt('fecha_vencimiento_pago', hoyStr)
        .order('fecha_vencimiento_pago', { ascending: true }))
      return data ?? []
    },
    // Las OC cuentan en AMBOS modos desde v1.126.0 (el tab de OC ya no es solo avanzado).
    enabled: !!tenant,
  })

  const { data: ocsProximas = [], isLoading: loadingOcsProx } = useQuery({
    queryKey: ['oc-proximas-vencer', tenant?.id, sucursalId],
    queryFn: async () => {
      const { data } = await applyFilter(supabase
        .from('ordenes_compra')
        .select('id, numero, estado_pago, fecha_vencimiento_pago, monto_total, monto_pagado, proveedores(nombre)')
        .eq('tenant_id', tenant!.id)
        .in('estado_pago', ['pendiente_pago', 'pago_parcial', 'cuenta_corriente'])
        .not('fecha_vencimiento_pago', 'is', null)
        .gte('fecha_vencimiento_pago', hoyStr)
        .lte('fecha_vencimiento_pago', en3diasStr)
        .order('fecha_vencimiento_pago', { ascending: true }))
      return data ?? []
    },
    // Las OC cuentan en AMBOS modos desde v1.126.0 (el tab de OC ya no es solo avanzado).
    enabled: !!tenant,
  })

  const { data: lpnsVencidos = [], isLoading: loadingVencidos } = useQuery({
    queryKey: ['lpns-vencidos', tenant?.id, sucursalId],
    queryFn: async () => {
      const hoy = new Date().toISOString().split('T')[0]
      const { data, error } = await applyFilter(supabase
        .from('inventario_lineas')
        .select('id, lpn, cantidad, fecha_vencimiento, productos(id, nombre, sku)')
        .eq('tenant_id', tenant!.id)
        .eq('activo', true)
        .gt('cantidad', 0)
        .not('fecha_vencimiento', 'is', null)
        .lt('fecha_vencimiento', hoy)
        .order('fecha_vencimiento', { ascending: true }))
      if (error) throw error
      return data ?? []
    },
    // El vencimiento de lote es de WMS (modo avanzado); en básico no se gestiona.
    enabled: !!tenant && modoAvanzado,
  })

  const { data: clientesConDeuda = [], isLoading: loadingDeuda } = useQuery({
    queryKey: ['clientes-con-deuda', tenant?.id, sucursalId],
    queryFn: async () => {
      const { data, error } = await applyFilter(supabase
        .from('ventas')
        .select('id, numero, total, monto_pagado, cliente_id, clientes(id, nombre, telefono)')
        .eq('tenant_id', tenant!.id)
        .in('estado', ['pendiente', 'reservada'])
        .not('cliente_id', 'is', null))
      if (error) throw error
      // Agrupar por cliente, sumar saldo pendiente
      const mapa: Record<string, { clienteId: string; nombre: string; telefono: string; saldo: number; ventas: number }> = {}
      for (const v of data ?? []) {
        const saldo = Math.max(0, (v.total ?? 0) - (v.monto_pagado ?? 0))
        if (saldo < 0.5) continue
        const c = (v as any).clientes
        if (!c) continue
        if (!mapa[c.id]) mapa[c.id] = { clienteId: c.id, nombre: c.nombre, telefono: c.telefono ?? '', saldo: 0, ventas: 0 }
        mapa[c.id].saldo += saldo
        mapa[c.id].ventas += 1
      }
      return Object.values(mapa).sort((a, b) => b.saldo - a.saldo)
    },
    enabled: !!tenant,
  })

  // H4 — efectivo en caja sobre el umbral de bóveda (ambos modos; solo si el tenant lo configuró).
  const { data: cajasSobreUmbral = [] } = useQuery({
    queryKey: ['cajas-sobre-umbral-boveda', tenant?.id, (tenant as any)?.boveda_umbral_caja],
    queryFn: () => cajasSobreUmbralBovedaDelTenant(tenant!.id, (tenant as any)?.boveda_umbral_caja),
    enabled: !!tenant && Number((tenant as any)?.boveda_umbral_caja) > 0,
  })
  const umbralBoveda = Number((tenant as any)?.boveda_umbral_caja) || 0

  const resolver = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('alertas').update({ resuelta: true }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alertas'] })
      qc.invalidateQueries({ queryKey: ['alertas-page'] })
      toast.success('Alerta marcada como resuelta')
    },
  })

  // CO8/G2 — productos con OC pendiente (borrador/enviada/confirmada/recibida_parcial), para marcar "sin OC".
  const { data: productosConOC = new Set<string>() } = useQuery({
    queryKey: ['productos-con-oc-pendiente', tenant?.id],
    queryFn: async () => {
      const { data: ocsAbiertas } = await supabase.from('ordenes_compra')
        .select('id').eq('tenant_id', tenant!.id).in('estado', ['borrador', 'enviada', 'confirmada', 'recibida_parcial'])
      const ids = (ocsAbiertas ?? []).map((o: any) => o.id)
      if (!ids.length) return new Set<string>()
      const { data: its } = await supabase.from('orden_compra_items').select('producto_id').in('orden_compra_id', ids)
      return new Set<string>((its ?? []).map((i: any) => i.producto_id))
    },
    enabled: !!tenant,
  })

  // CO7/A3 — auto-draft de OCs sugeridas consolidando productos bajo mínimo por proveedor.
  const generarOCsSugeridas = useMutation({
    mutationFn: async () => {
      if (!sucursalId) throw new Error('Elegí una sucursal específica (no "Todas") para generar las OCs.')
      const lowStock = (alertas as any[]).filter(a => a.tipo === 'stock_minimo' && a.productos).map(a => a.productos)
      if (!lowStock.length) throw new Error('No hay productos bajo mínimo.')
      const prodIds = lowStock.map((p: any) => p.id)
      const { data: pps } = await supabase.from('proveedor_productos')
        .select('proveedor_id, producto_id, precio_compra, cantidad_minima, proveedores(nombre)')
        .in('producto_id', prodIds)
      // Armado puro (testeable) — ver src/lib/ocSugerida.ts (bugs conocidos documentados ahí).
      const { ocs, sinProveedor } = armarOCsSugeridas(lowStock, (pps ?? []) as any[])
      if (!ocs.length) throw new Error('Los productos bajo mínimo no tienen proveedor asociado (cargalos en Proveedores → Productos).')
      let creadas = 0
      for (const ocSug of ocs) {
        const { data: oc, error } = await supabase.from('ordenes_compra').insert({
          tenant_id: tenant!.id, proveedor_id: ocSug.proveedor_id, numero: 0, estado: 'borrador',
          sucursal_id: sucursalId, notas: 'OC sugerida automáticamente (stock bajo mínimo)',
          created_by: user!.id,
        }).select('id').single()
        if (error) throw error
        const { error: itErr } = await supabase.from('orden_compra_items').insert(
          ocSug.items.map(it => ({ orden_compra_id: oc.id, producto_id: it.producto_id, cantidad: it.cantidad, precio_unitario: it.precio })),
        )
        if (itErr) throw itErr
        creadas++
      }
      return { creadas, sinProveedor }
    },
    onSuccess: ({ creadas, sinProveedor }) => {
      qc.invalidateQueries({ queryKey: ['ordenes_compra'] })
      toast.success(`${creadas} OC borrador creada${creadas !== 1 ? 's' : ''}${sinProveedor.length ? ` · ${sinProveedor.length} sin proveedor` : ''}`)
      navigate('/proveedores?tab=ordenes')
    },
    onError: (e: any) => toast.error(e.message),
  })

  // Las fuentes de WMS (sin ubicación, sin proveedor, LPN vencidos) solo cuentan en modo
  // avanzado — así el total coincide con el badge del sidebar (useAlertas). Las OC cuentan
  // en AMBOS modos desde v1.126.0 (el tab de OC de Prov./Servicios ya no es solo avanzado).
  const totalAlertas = alertas.length + reservasViejas.length + sinCategoria.length + clientesConDeuda.length + cajasSobreUmbral.length
    + ocsVencidas.length + ocsProximas.length
    + (modoAvanzado ? lineasSinUbicacion.length + lineasSinProveedor.length + lpnsVencidos.length : 0)
  const isLoadingAll = isLoading || loadingReservas || loadingSinCategoria || loadingDeuda || loadingSinUbic || loadingSinProv || loadingVencidos || loadingOcsVenc || loadingOcsProx

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
          <Bell size={22} className="text-accent" /> Alertas
        </h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">{totalAlertas} alerta{totalAlertas !== 1 ? 's' : ''} activa{totalAlertas !== 1 ? 's' : ''}</p>
      </div>

      {isLoadingAll ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : totalAlertas === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-12 text-center shadow-sm border border-gray-100 dark:border-gray-700">
          <CheckCircle size={40} className="text-green-400 dark:text-green-400 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400">¡Todo en orden! No hay alertas activas.</p>
        </div>
      ) : (
        <div className="space-y-6">

          {/* H4 — efectivo en caja sobre el umbral de bóveda (ambos modos) */}
          {cajasSobreUmbral.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-amber-500 uppercase tracking-wider flex items-center gap-2">
                <Vault size={14} />
                Efectivo en caja sobre el umbral ({cajasSobreUmbral.length})
              </h2>
              {cajasSobreUmbral.map((c) => (
                <div key={c.sesionId} className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-amber-200 dark:border-amber-900/40 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 bg-amber-100 dark:bg-amber-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Vault size={18} className="text-amber-500 dark:text-amber-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-800 dark:text-gray-100">
                        {c.cajaNombre ?? 'Caja'}
                        <span className="font-normal text-gray-500 dark:text-gray-400"> — efectivo ${c.efectivo.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                      </p>
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        Supera el umbral de ${umbralBoveda.toLocaleString('es-AR', { maximumFractionDigits: 0 })} — conviene depositar el excedente en la Caja Fuerte.
                      </p>
                    </div>
                  </div>
                  <Link to="/caja" className="flex-shrink-0 text-xs font-medium text-amber-600 dark:text-amber-400 border border-amber-300 dark:border-amber-700 rounded-lg px-3 py-1.5 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors">
                    Ir a Caja
                  </Link>
                </div>
              ))}
            </div>
          )}

          {/* OC vencidas (ambos modos desde v1.126.0) */}
          {ocsVencidas.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-red-500 uppercase tracking-wider flex items-center gap-2">
                <ShoppingCart size={14} />
                OC vencidas sin pagar ({ocsVencidas.length})
              </h2>
              {(ocsVencidas as any[]).map((oc: any) => {
                const saldo = (oc.monto_total ?? 0) - (oc.monto_pagado ?? 0)
                const diasMora = Math.floor((Date.now() - new Date(oc.fecha_vencimiento_pago + 'T00:00:00').getTime()) / 86400000)
                return (
                  <div key={oc.id} className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-red-200 dark:border-red-900/40 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 bg-red-100 dark:bg-red-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
                        <ShoppingCart size={18} className="text-red-500 dark:text-red-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-800 dark:text-gray-100">
                          OC #{oc.numero}
                          {oc.proveedores?.nombre && <span className="font-normal text-gray-500 dark:text-gray-400"> — {oc.proveedores.nombre}</span>}
                        </p>
                        <p className="text-xs text-red-500 dark:text-red-400">
                          Venció {new Date(oc.fecha_vencimiento_pago + 'T00:00:00').toLocaleDateString('es-AR')} · {diasMora}d de mora
                          {saldo > 0 && ` · Saldo $${saldo.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`}
                        </p>
                      </div>
                    </div>
                    <Link to="/gastos" className="flex-shrink-0 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                      Regularizar
                    </Link>
                  </div>
                )
              })}
            </div>
          )}

          {/* OC próximas a vencer (ambos modos desde v1.126.0) */}
          {ocsProximas.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-amber-500 uppercase tracking-wider flex items-center gap-2">
                <ShoppingCart size={14} />
                OC por vencer en 3 días ({ocsProximas.length})
              </h2>
              {(ocsProximas as any[]).map((oc: any) => {
                const saldo = (oc.monto_total ?? 0) - (oc.monto_pagado ?? 0)
                const diasRestantes = Math.ceil((new Date(oc.fecha_vencimiento_pago + 'T00:00:00').getTime() - Date.now()) / 86400000)
                return (
                  <div key={oc.id} className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-amber-200 dark:border-amber-900/40 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 bg-amber-100 dark:bg-amber-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
                        <ShoppingCart size={18} className="text-amber-500 dark:text-amber-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-800 dark:text-gray-100">
                          OC #{oc.numero}
                          {oc.proveedores?.nombre && <span className="font-normal text-gray-500 dark:text-gray-400"> — {oc.proveedores.nombre}</span>}
                        </p>
                        <p className="text-xs text-amber-600 dark:text-amber-400">
                          Vence en {diasRestantes === 0 ? 'hoy' : `${diasRestantes}d`} · {new Date(oc.fecha_vencimiento_pago + 'T00:00:00').toLocaleDateString('es-AR')}
                          {saldo > 0 && ` · Saldo $${saldo.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`}
                        </p>
                      </div>
                    </div>
                    <Link to="/gastos" className="flex-shrink-0 px-3 py-1.5 text-xs font-medium text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors">
                      Pagar ahora
                    </Link>
                  </div>
                )
              })}
            </div>
          )}

          {/* LPNs vencidos (solo avanzado/WMS) */}
          {modoAvanzado && lpnsVencidos.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-red-500 uppercase tracking-wider flex items-center gap-2">
                <CalendarX size={14} />
                LPNs vencidos ({lpnsVencidos.length})
              </h2>
              {lpnsVencidos.map((l: any) => (
                <div key={l.id} className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-red-200 dark:border-red-900/40 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 bg-red-100 dark:bg-red-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
                      <CalendarX size={18} className="text-red-500 dark:text-red-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-800 dark:text-gray-100 truncate">
                        {l.lpn}
                        <span className="font-normal text-gray-500 dark:text-gray-400"> — {(l.productos as any)?.nombre}</span>
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        {(l.productos as any)?.sku} · {l.cantidad} u. · Vencido el {new Date(l.fecha_vencimiento).toLocaleDateString('es-AR')}
                      </p>
                    </div>
                  </div>
                  <Link
                    to={`/inventario?search=${encodeURIComponent(l.lpn)}`}
                    className="flex-shrink-0 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    Ver LPN
                  </Link>
                </div>
              ))}
            </div>
          )}

          {/* Reservas sin despachar */}
          {reservasViejas.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-2">
                <Clock size={14} />
                Reservas sin despachar (+{RESERVAS_DIAS_LIMITE} días)
              </h2>
              {(reservasViejas as any[]).map(v => (
                <div key={v.id} className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-amber-100 dark:border-amber-900/30 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 bg-amber-100 dark:bg-amber-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Clock size={18} className="text-amber-500 dark:text-amber-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-800 dark:text-gray-100">
                        Venta #{v.numero}
                        {v.cliente_nombre && <span className="font-normal text-gray-500 dark:text-gray-400"> — {v.cliente_nombre}</span>}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Reservada hace{' '}
                        <span className="text-amber-600 dark:text-amber-400 font-medium">
                          {formatDistanceToNow(new Date(v.created_at), { locale: es })}
                        </span>
                        {v.total != null && ` • $${Number(v.total).toLocaleString('es-AR')}`}
                        {v.cliente_telefono && ` • Tel: ${v.cliente_telefono}`}
                      </p>
                    </div>
                  </div>
                  <Link
                    to={`/ventas?id=${v.id}`}
                    className="text-xs bg-amber-500 dark:bg-amber-600 text-white px-3 py-1.5 rounded-lg hover:bg-amber-600 dark:hover:bg-amber-700 transition-all whitespace-nowrap flex-shrink-0"
                  >
                    Ver venta
                  </Link>
                </div>
              ))}
            </div>
          )}

          {/* Alertas de stock */}
          {alertas.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-2">
                  <AlertTriangle size={14} />
                  Stock bajo mínimo
                </h2>
                {puedeGenerarOC && (
                  <button
                    onClick={() => generarOCsSugeridas.mutate()}
                    disabled={generarOCsSugeridas.isPending}
                    title="Crea órdenes de compra borrador consolidando los productos bajo mínimo por proveedor"
                    className="flex items-center gap-1.5 text-xs bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-accent/90 disabled:opacity-50">
                    <ShoppingCart size={13} /> {generarOCsSugeridas.isPending ? 'Generando…' : 'Generar OC sugerida'}
                  </button>
                )}
              </div>
              {alertas.map(a => (
                <div key={a.id} className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-red-100 dark:border-red-900/30 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-red-100 dark:bg-red-900/30 rounded-lg flex items-center justify-center">
                      <AlertTriangle size={18} className="text-red-500 dark:text-red-400" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2 flex-wrap">
                        {(a as any).productos?.nombre}
                        {/* CO8/G2 — marca si ya tiene OC pendiente o no */}
                        {(a as any).productos?.id && (
                          productosConOC.has((a as any).productos.id)
                            ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium">OC en camino</span>
                            : <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 font-medium">Sin OC pendiente</span>
                        )}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        SKU: {(a as any).productos?.sku} •
                        Stock actual: <span className="text-red-600 dark:text-red-400 font-medium">{(a as any).productos?.stock_actual}</span> •
                        Mínimo: {(a as any).productos?.stock_minimo}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      to="/inventario"
                      className="text-xs bg-primary text-white px-3 py-1.5 rounded-lg hover:bg-accent transition-all"
                    >
                      Ingresar stock
                    </Link>
                    <button
                      onClick={() => {
                        const stockActual = (a as any).productos?.stock_actual ?? 0
                        const stockMinimo = (a as any).productos?.stock_minimo ?? 0
                        if (a.tipo === 'stock_minimo' && stockActual <= stockMinimo) {
                          toast.error(`Stock actual (${stockActual}) sigue bajo el mínimo (${stockMinimo}). Ingresá stock primero.`)
                          return
                        }
                        resolver.mutate(a.id)
                      }}
                      className="text-xs border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 px-3 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50"
                    >
                      Resolver
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Clientes con saldo pendiente */}
          {clientesConDeuda.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-2">
                <DollarSign size={14} />
                Clientes con saldo pendiente ({clientesConDeuda.length})
              </h2>
              {clientesConDeuda.map((c) => (
                <div key={c.clienteId} className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-yellow-100 dark:border-yellow-900/30 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
                      <DollarSign size={18} className="text-yellow-600 dark:text-yellow-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-800 dark:text-gray-100">{c.nombre}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        <span className="text-yellow-600 dark:text-yellow-400 font-medium">${c.saldo.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                        {' '}pendiente · {c.ventas} venta{c.ventas !== 1 ? 's' : ''}
                        {c.telefono && ` · ${c.telefono}`}
                      </p>
                    </div>
                  </div>
                  <Link
                    to={`/clientes?id=${c.clienteId}`}
                    className="text-xs bg-yellow-500 dark:bg-yellow-600 text-white px-3 py-1.5 rounded-lg hover:bg-yellow-600 dark:hover:bg-yellow-700 transition-all whitespace-nowrap flex-shrink-0"
                  >
                    Ver ficha
                  </Link>
                </div>
              ))}
            </div>
          )}

          {/* Inventario sin ubicación (solo avanzado/WMS) */}
          {modoAvanzado && lineasSinUbicacion.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-2">
                <MapPin size={14} />
                Inventario sin ubicación ({lineasSinUbicacion.length} LPN{lineasSinUbicacion.length !== 1 ? 's' : ''})
              </h2>
              {lineasSinUbicacion.map((l: any) => (
                <div key={l.id} className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-purple-100 dark:border-purple-900/30 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
                      <MapPin size={18} className="text-purple-500 dark:text-purple-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-800 dark:text-gray-100 truncate">
                        {l.productos?.nombre ?? 'Producto desconocido'}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {l.productos?.sku && `SKU: ${l.productos.sku} · `}
                        {l.lpn ? `LPN: ${l.lpn}` : 'Sin LPN'}
                        {l.nro_lote && ` · Lote: ${l.nro_lote}`}
                        {` · Cant: ${l.cantidad}`}
                      </p>
                    </div>
                  </div>
                  <Link
                    to="/inventario"
                    className="text-xs bg-purple-500 dark:bg-purple-600 text-white px-3 py-1.5 rounded-lg hover:bg-purple-600 dark:hover:bg-purple-700 transition-all whitespace-nowrap flex-shrink-0"
                  >
                    Ir a inventario
                  </Link>
                </div>
              ))}
            </div>
          )}

          {/* Inventario sin proveedor (solo avanzado/WMS) */}
          {modoAvanzado && lineasSinProveedor.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-2">
                <Truck size={14} />
                Inventario sin proveedor ({lineasSinProveedor.length} LPN{lineasSinProveedor.length !== 1 ? 's' : ''})
              </h2>
              {lineasSinProveedor.map((l: any) => (
                <div key={l.id} className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-teal-100 dark:border-teal-900/30 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 bg-teal-100 dark:bg-teal-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Truck size={18} className="text-teal-500 dark:text-teal-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-800 dark:text-gray-100 truncate">
                        {l.productos?.nombre ?? 'Producto desconocido'}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {l.productos?.sku && `SKU: ${l.productos.sku} · `}
                        {l.lpn ? `LPN: ${l.lpn}` : 'Sin LPN'}
                        {l.nro_lote && ` · Lote: ${l.nro_lote}`}
                        {` · Cant: ${l.cantidad}`}
                      </p>
                    </div>
                  </div>
                  <Link
                    to="/inventario"
                    className="text-xs bg-teal-500 dark:bg-teal-600 text-white px-3 py-1.5 rounded-lg hover:bg-teal-600 dark:hover:bg-teal-700 transition-all whitespace-nowrap flex-shrink-0"
                  >
                    Ir a inventario
                  </Link>
                </div>
              ))}
            </div>
          )}

          {/* Productos sin categoría */}
          {sinCategoria.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-2">
                <Tag size={14} />
                Productos sin categoría ({sinCategoria.length})
              </h2>
              {sinCategoria.map((p: any) => (
                <div key={p.id} className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-orange-100 dark:border-orange-900/30 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-orange-100 dark:bg-orange-900/30 rounded-lg flex items-center justify-center">
                      <Tag size={18} className="text-orange-500 dark:text-orange-400" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-800 dark:text-gray-100">{p.nombre}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">SKU: {p.sku} • Sin categoría asignada</p>
                    </div>
                  </div>
                  <Link
                    to={`/productos/${p.id}/editar`}
                    className="text-xs bg-orange-500 dark:bg-orange-600 text-white px-3 py-1.5 rounded-lg hover:bg-orange-600 dark:hover:bg-orange-700 transition-all whitespace-nowrap"
                  >
                    Editar producto
                  </Link>
                </div>
              ))}
            </div>
          )}

        </div>
      )}
    </div>
  )
}
