import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, ArrowLeft, Trash2, Search, CheckCircle, XCircle, ChevronDown, ChevronRight, Warehouse, AlertTriangle, GitBranch, RotateCcw, X } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'
import type { Recepcion, ProductoEstructura } from '@/lib/supabase'

// ─── Tipos internos ────────────────────────────────────────────────────────────

type ResultadoRecepcion = {
  recId: string
  numero: number
  ocId: string | null
  ocNumero: number | null
  proveedorId: string | null
  items: Array<{
    producto_id: string
    nombre: string
    sku: string
    unidad: string
    esperado: number
    recibido: number
  }>
}

type FormItem = {
  _key: string
  producto_id: string
  producto_nombre: string
  producto_sku: string
  tiene_series: boolean
  tiene_lote: boolean
  tiene_vencimiento: boolean
  unidad_medida: string
  precio_costo_default: number
  oc_item_id: string
  cantidad_esperada: number
  cantidad_recibida: string
  ubicacion_id: string
  estado_id: string
  nro_lote: string
  fecha_vencimiento: string
  lpn: string
  series_txt: string
  precio_costo: string
  estructura_id: string
  expanded: boolean
}

const ESTADO_RECEPCION_LABEL: Record<string, string> = {
  borrador: 'Borrador', confirmada: 'Confirmada', cancelada: 'Cancelada',
}
const ESTADO_RECEPCION_COLOR: Record<string, string> = {
  borrador: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  confirmada: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  cancelada: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
}

function nuevoItem(overrides: Partial<FormItem> = {}): FormItem {
  return {
    _key: crypto.randomUUID(),
    producto_id: '', producto_nombre: '', producto_sku: '',
    tiene_series: false, tiene_lote: false, tiene_vencimiento: false,
    unidad_medida: 'unidad', precio_costo_default: 0,
    oc_item_id: '', cantidad_esperada: 0, cantidad_recibida: '1',
    ubicacion_id: '', estado_id: '', nro_lote: '', fecha_vencimiento: '',
    lpn: '', series_txt: '', precio_costo: '', estructura_id: '', expanded: false,
    ...overrides,
  }
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function RecepcionesPage() {
  const { tenant, user, sucursales, sucursalId: sucursalCtx } = useAuthStore()
  const { applyFilter, sucursalId } = useSucursalFilter()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const qc = useQueryClient()

  const ocIdFromUrl = searchParams.get('oc_id')
  const provIdFromUrl = searchParams.get('proveedor_id')

  // ── Modo lista / formulario
  const [showForm, setShowForm] = useState(!!ocIdFromUrl)

  // ── Form state ──────────────────────────────────────────────────────────────
  const [fProveedorId, setFProveedorId] = useState(provIdFromUrl ?? '')
  const [fOcId, setFOcId] = useState(ocIdFromUrl ?? '')
  const [fSucursalId, setFSucursalId] = useState(sucursalCtx ?? '')
  const [fNotas, setFNotas] = useState('')
  const [items, setItems] = useState<FormItem[]>([])
  const [prodSearch, setProdSearch] = useState('')
  const [prodFocused, setProdFocused] = useState(false)
  const [saving, setSaving] = useState(false)
  const [expandedRec, setExpandedRec] = useState<string | null>(null)
  const [estructurasMap, setEstructurasMap] = useState<Record<string, ProductoEstructura[]>>({})
  const [resultadoModal, setResultadoModal] = useState<ResultadoRecepcion | null>(null)

  // Sincronizar sucursal activa al abrir el formulario
  useEffect(() => {
    setFSucursalId(sucursalCtx ?? '')
  }, [sucursalCtx])

  // ── Queries ─────────────────────────────────────────────────────────────────

  const { data: recepciones = [], isLoading } = useQuery<Recepcion[]>({
    queryKey: ['recepciones', tenant?.id, sucursalId],
    queryFn: async () => {
      const q = applyFilter(
        supabase
          .from('recepciones')
          .select('*, proveedores(nombre), ordenes_compra(numero)')
          .eq('tenant_id', tenant!.id)
          .order('created_at', { ascending: false })
      )
      const { data } = await q
      return (data ?? []) as Recepcion[]
    },
    enabled: !!tenant,
  })

  const { data: proveedores = [] } = useQuery({
    queryKey: ['proveedores-rec', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('proveedores').select('id, nombre').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant,
  })

  const { data: ocsConfirmadas = [] } = useQuery({
    queryKey: ['ocs-confirmadas', tenant?.id, fProveedorId],
    queryFn: async () => {
      let q = supabase.from('ordenes_compra').select('id, numero').eq('tenant_id', tenant!.id).eq('estado', 'confirmada').order('numero', { ascending: false })
      if (fProveedorId) q = q.eq('proveedor_id', fProveedorId)
      const { data } = await q
      return data ?? []
    },
    enabled: !!tenant && showForm,
  })

  const { data: ubicaciones = [] } = useQuery({
    queryKey: ['ubicaciones-rec', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('ubicaciones').select('id, nombre').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant && showForm,
  })

  const { data: estadosInv = [] } = useQuery({
    queryKey: ['estados-inv-rec', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('estados_inventario').select('id, nombre').eq('tenant_id', tenant!.id).order('nombre')
      return data ?? []
    },
    enabled: !!tenant && showForm,
  })

  const { data: prodsBusqueda = [] } = useQuery({
    queryKey: ['prods-busqueda-rec', tenant?.id, prodSearch],
    queryFn: async () => {
      if (!prodSearch) return []
      const { data } = await supabase
        .from('productos')
        .select('id, nombre, sku, tiene_series, tiene_lote, tiene_vencimiento, unidad_medida, precio_costo')
        .eq('tenant_id', tenant!.id)
        .eq('activo', true)
        .or(`nombre.ilike.%${prodSearch}%,sku.ilike.%${prodSearch}%`)
        .limit(8)
      return data ?? []
    },
    enabled: !!tenant && showForm && prodSearch.length > 0,
  })

  // ── Pre-populate desde OC ──────────────────────────────────────────────────

  useEffect(() => {
    if (!fOcId) return
    const cargarOC = async () => {
      const { data: oc } = await supabase
        .from('ordenes_compra')
        .select('proveedor_id, orden_compra_items(id, cantidad, precio_unitario, productos(id, nombre, sku, tiene_series, tiene_lote, tiene_vencimiento, unidad_medida, precio_costo))')
        .eq('id', fOcId)
        .single()
      if (!oc) return
      if (oc.proveedor_id) setFProveedorId(oc.proveedor_id)
      const ocItems = (oc as any).orden_compra_items ?? []
      if (ocItems.length > 0) {
        const itemsConEstructura = await Promise.all(ocItems.map(async (it: any) => {
          const p = it.productos
          const estructura_id = await cargarEstructuras(p.id)
          return nuevoItem({
            producto_id: p.id,
            producto_nombre: p.nombre,
            producto_sku: p.sku,
            tiene_series: p.tiene_series,
            tiene_lote: p.tiene_lote,
            tiene_vencimiento: p.tiene_vencimiento,
            unidad_medida: p.unidad_medida,
            precio_costo_default: p.precio_costo ?? 0,
            precio_costo: String(it.precio_unitario ?? p.precio_costo ?? ''),
            oc_item_id: it.id,
            cantidad_esperada: it.cantidad,
            cantidad_recibida: String(it.cantidad),
            estructura_id,
          })
        }))
        setItems(itemsConEstructura)
      }
    }
    cargarOC()
  }, [fOcId])

  // ── Agregar producto a items ───────────────────────────────────────────────

  const cargarEstructuras = async (productoId: string): Promise<string> => {
    if (estructurasMap[productoId]) {
      const def = estructurasMap[productoId].find(e => e.is_default) ?? estructurasMap[productoId][0]
      return def?.id ?? ''
    }
    const { data } = await supabase
      .from('producto_estructuras')
      .select('id, nombre, is_default')
      .eq('producto_id', productoId)
      .order('is_default', { ascending: false })
    const list = (data ?? []) as ProductoEstructura[]
    setEstructurasMap(prev => ({ ...prev, [productoId]: list }))
    const def = list.find(e => e.is_default) ?? list[0]
    return def?.id ?? ''
  }

  const agregarProducto = async (p: any) => {
    if (items.find(it => it.producto_id === p.id)) {
      toast('Ese producto ya está en la lista')
      return
    }
    const estructura_id = await cargarEstructuras(p.id)
    setItems(prev => [...prev, nuevoItem({
      producto_id: p.id,
      producto_nombre: p.nombre,
      producto_sku: p.sku,
      tiene_series: p.tiene_series,
      tiene_lote: p.tiene_lote,
      tiene_vencimiento: p.tiene_vencimiento,
      unidad_medida: p.unidad_medida,
      precio_costo_default: p.precio_costo ?? 0,
      precio_costo: String(p.precio_costo ?? ''),
      estructura_id,
    })])
    setProdSearch('')
    setProdFocused(false)
  }

  const updItem = (key: string, patch: Partial<FormItem>) =>
    setItems(prev => prev.map(it => it._key === key ? { ...it, ...patch } : it))

  const removeItem = (key: string) =>
    setItems(prev => prev.filter(it => it._key !== key))

  // ── Guardar (borrador o confirmar) ─────────────────────────────────────────

  const guardar = async (confirmar: boolean) => {
    if (items.length === 0) { toast.error('Agregá al menos un producto'); return }

    if (confirmar) {
      const errores: string[] = []
      for (const it of items) {
        const cant = it.tiene_series
          ? it.series_txt.split('\n').filter(s => s.trim()).length
          : Number(it.cantidad_recibida)
        if (cant === 0) continue
        if (it.tiene_lote && !it.nro_lote?.trim())
          errores.push(`"${it.producto_nombre}" requiere número de lote`)
        if (it.tiene_vencimiento && !it.fecha_vencimiento)
          errores.push(`"${it.producto_nombre}" requiere fecha de vencimiento`)
        if (it.tiene_series && !it.series_txt.trim())
          errores.push(`"${it.producto_nombre}" requiere números de serie`)
      }
      if (errores.length > 0) {
        // Auto-expandir ítems con error para que el usuario vea los campos faltantes
        setItems(prev => prev.map(it => {
          const cant = it.tiene_series
            ? it.series_txt.split('\n').filter(s => s.trim()).length
            : Number(it.cantidad_recibida)
          if (cant === 0) return it
          const conError =
            (it.tiene_lote && !it.nro_lote?.trim()) ||
            (it.tiene_vencimiento && !it.fecha_vencimiento) ||
            (it.tiene_series && !it.series_txt.trim())
          return conError ? { ...it, expanded: true } : it
        }))
        toast.error(errores[0])
        return
      }
    }

    setSaving(true)
    try {
      const estado = confirmar ? 'confirmada' : 'borrador'

      const { data: rec, error: recErr } = await supabase
        .from('recepciones')
        .insert({
          tenant_id: tenant!.id,
          oc_id: fOcId || null,
          proveedor_id: fProveedorId || null,
          estado,
          notas: fNotas || null,
          sucursal_id: fSucursalId || null,
          created_by: user!.id,
        })
        .select('id, numero')
        .single()
      if (recErr) throw recErr

      const itemsValidos = confirmar
        ? items.filter(it => {
            const cant = it.tiene_series
              ? it.series_txt.split('\n').filter(s => s.trim()).length
              : Number(it.cantidad_recibida)
            return cant > 0
          })
        : items

      for (const it of itemsValidos) {
        const cant = it.tiene_series
          ? it.series_txt.split('\n').filter(s => s.trim()).length
          : Number(it.cantidad_recibida)

        if (confirmar && cant > 0) {
          const { data: prodData } = await supabase.from('productos').select('stock_actual').eq('id', it.producto_id).single()
          const stockAntes = prodData?.stock_actual ?? 0

          const { data: linea, error: lineaErr } = await supabase
            .from('inventario_lineas')
            .insert({
              tenant_id: tenant!.id,
              producto_id: it.producto_id,
              lpn: it.lpn || null,
              cantidad: it.tiene_series ? 0 : cant,
              estado_id: it.estado_id || null,
              ubicacion_id: it.ubicacion_id || null,
              nro_lote: it.nro_lote || null,
              fecha_vencimiento: it.fecha_vencimiento || null,
              precio_costo_snapshot: it.precio_costo ? Number(it.precio_costo) : (it.precio_costo_default || null),
              sucursal_id: fSucursalId || null,
              estructura_id: it.estructura_id || null,
            })
            .select()
            .single()
          if (lineaErr) throw lineaErr

          if (it.tiene_series) {
            const seriesValidas = it.series_txt.split('\n').map(s => s.trim()).filter(Boolean)
            if (seriesValidas.length > 0) {
              await supabase.from('inventario_series').insert(
                seriesValidas.map(nro => ({ tenant_id: tenant!.id, linea_id: linea.id, nro_serie: nro, activo: true }))
              )
            }
          }

          await supabase.from('movimientos_stock').insert({
            tenant_id: tenant!.id,
            producto_id: it.producto_id,
            tipo: 'ingreso',
            cantidad: cant,
            motivo: `Recepción #${rec.numero}`,
            linea_id: linea.id,
            stock_antes: stockAntes,
            stock_despues: stockAntes + cant,
            sucursal_id: fSucursalId || null,
          })

          await supabase.from('recepcion_items').insert({
            recepcion_id: rec.id,
            producto_id: it.producto_id,
            oc_item_id: it.oc_item_id || null,
            cantidad_esperada: it.cantidad_esperada,
            cantidad_recibida: cant,
            estado_id: it.estado_id || null,
            ubicacion_id: it.ubicacion_id || null,
            nro_lote: it.nro_lote || null,
            fecha_vencimiento: it.fecha_vencimiento || null,
            lpn: it.lpn || null,
            series_txt: it.tiene_series ? it.series_txt : null,
            inventario_linea_id: linea.id,
            precio_costo: it.precio_costo ? Number(it.precio_costo) : null,
          })
        } else {
          await supabase.from('recepcion_items').insert({
            recepcion_id: rec.id,
            producto_id: it.producto_id,
            oc_item_id: it.oc_item_id || null,
            cantidad_esperada: it.cantidad_esperada,
            cantidad_recibida: 0,
            nro_lote: it.nro_lote || null,
            fecha_vencimiento: it.fecha_vencimiento || null,
            lpn: it.lpn || null,
          })
        }
      }

      // Actualizar estado de OC vinculada
      if (confirmar && fOcId) {
        const ocItems = items.filter(it => it.oc_item_id)
        const allFull = ocItems.every(it => {
          const cant = it.tiene_series
            ? it.series_txt.split('\n').filter(s => s.trim()).length
            : Number(it.cantidad_recibida)
          return cant >= it.cantidad_esperada
        })
        await supabase.from('ordenes_compra').update({
          estado: allFull ? 'recibida' : 'recibida_parcial',
        }).eq('id', fOcId)
        qc.invalidateQueries({ queryKey: ['ordenes', tenant?.id] })
      }

      // Gasto automático al confirmar recepción vinculada a una OC
      if (confirmar && fOcId && itemsValidos.length > 0) {
        const montoGasto = itemsValidos.reduce((sum, it) => {
          const cant = it.tiene_series
            ? it.series_txt.split('\n').filter(s => s.trim()).length
            : Number(it.cantidad_recibida)
          const precio = it.precio_costo ? Number(it.precio_costo) : it.precio_costo_default
          return sum + cant * precio
        }, 0)
        if (montoGasto > 0) {
          const provNombre = proveedores.find(p => p.id === fProveedorId)?.nombre ?? 'proveedor'
          const ocNumero = ocsConfirmadas.find(oc => oc.id === fOcId)?.numero
          await supabase.from('gastos').insert({
            tenant_id: tenant!.id,
            recepcion_id: rec.id,
            descripcion: ocNumero ? `Compra OC #${ocNumero} — ${provNombre}` : `Compra — ${provNombre}`,
            monto: montoGasto,
            categoria: 'Compras',
            fecha: new Date().toISOString().split('T')[0],
            notas: `Recepción #${rec.numero}`,
            sucursal_id: fSucursalId || null,
            usuario_id: user!.id,
          })
          qc.invalidateQueries({ queryKey: ['gastos', tenant?.id] })
        }
      }

      qc.invalidateQueries({ queryKey: ['recepciones', tenant?.id] })
      setShowForm(false)
      resetForm()

      if (confirmar) {
        const ocNumero = fOcId ? (ocsConfirmadas.find(oc => oc.id === fOcId)?.numero ?? null) : null
        setResultadoModal({
          recId: rec.id,
          numero: rec.numero,
          ocId: fOcId || null,
          ocNumero: ocNumero ?? null,
          proveedorId: fProveedorId || null,
          items: itemsValidos.map(it => ({
            producto_id: it.producto_id,
            nombre: it.producto_nombre,
            sku: it.producto_sku,
            unidad: it.unidad_medida || 'u',
            esperado: it.cantidad_esperada,
            recibido: it.tiene_series
              ? it.series_txt.split('\n').filter(s => s.trim()).length
              : Number(it.cantidad_recibida),
          })),
        })
      } else {
        toast.success(`Borrador #${rec.numero} guardado`)
        navigate('/recepciones', { replace: true })
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Error al guardar la recepción')
    } finally {
      setSaving(false)
    }
  }

  const resetForm = () => {
    setFProveedorId(''); setFOcId(''); setFSucursalId(sucursalCtx ?? '')
    setFNotas(''); setItems([]); setProdSearch('')
  }

  const crearOCDerivada = useMutation({
    mutationFn: async (resultado: ResultadoRecepcion) => {
      const faltantes = resultado.items.filter(it => it.recibido < it.esperado)
      const { data: newOC, error } = await supabase
        .from('ordenes_compra')
        .insert({
          tenant_id: tenant!.id,
          proveedor_id: resultado.proveedorId,
          estado: 'enviada',
          es_derivada: true,
          oc_padre_id: resultado.ocId,
          notas: `OC derivada de OC #${resultado.ocNumero ?? resultado.ocId} — ítems ya pagados, pendiente de entrega`,
          created_by: user!.id,
        })
        .select('id, numero')
        .single()
      if (error) throw error
      await supabase.from('orden_compra_items').insert(
        faltantes.map(it => ({
          orden_compra_id: newOC.id,
          producto_id: it.producto_id,
          cantidad: it.esperado - it.recibido,
          precio_unitario: 0,
          notas: 'Ya pagado — pendiente de entrega',
        }))
      )
      return newOC.numero
    },
    onSuccess: (numero) => {
      toast.success(`OC derivada #${numero} creada en Proveedores`)
      qc.invalidateQueries({ queryKey: ['ordenes', tenant?.id] })
      setResultadoModal(null)
      navigate('/proveedores')
    },
    onError: (e: any) => toast.error(e.message ?? 'Error al crear OC derivada'),
  })

  const solicitarReembolso = useMutation({
    mutationFn: async (ocId: string) => {
      const { error } = await supabase
        .from('ordenes_compra')
        .update({ tiene_reembolso_pendiente: true })
        .eq('id', ocId)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Solicitud de reembolso registrada. Revisá Gastos → OC.')
      qc.invalidateQueries({ queryKey: ['ordenes', tenant?.id] })
      qc.invalidateQueries({ queryKey: ['oc-gastos', tenant?.id] })
      setResultadoModal(null)
      navigate('/recepciones', { replace: true })
    },
    onError: (e: any) => toast.error(e.message ?? 'Error al registrar reembolso'),
  })

  const cancelarRecepcion = async (id: string) => {
    if (!confirm('¿Cancelar esta recepción?')) return
    await supabase.from('recepciones').update({ estado: 'cancelada' }).eq('id', id)
    qc.invalidateQueries({ queryKey: ['recepciones', tenant?.id] })
  }

  // ── Modal resultado de recepción ──────────────────────────────────────────

  if (resultadoModal) {
    const hayDiferencias = resultadoModal.ocId !== null &&
      resultadoModal.items.some(it => it.recibido !== it.esperado)
    const faltantes = resultadoModal.items.filter(it => it.recibido < it.esperado)
    const sobrantes = resultadoModal.items.filter(it => it.recibido > it.esperado)

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-800 dark:text-white flex items-center gap-2">
                  <CheckCircle size={20} className="text-green-500" />
                  Recepción #{resultadoModal.numero} confirmada
                </h2>
                {resultadoModal.ocNumero && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">OC #{resultadoModal.ocNumero}</p>
                )}
              </div>
              <button onClick={() => { setResultadoModal(null); navigate('/recepciones', { replace: true }) }}
                className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
                <X size={18} />
              </button>
            </div>

            {/* Tabla comparativa */}
            <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="text-left px-3 py-2 text-gray-500 font-medium">Producto</th>
                    <th className="text-right px-3 py-2 text-gray-500 font-medium">Esperado</th>
                    <th className="text-right px-3 py-2 text-gray-500 font-medium">Recibido</th>
                    <th className="text-right px-3 py-2 text-gray-500 font-medium">Diferencia</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {resultadoModal.items.map((it, i) => {
                    const diff = it.recibido - it.esperado
                    return (
                      <tr key={i}>
                        <td className="px-3 py-2">
                          <div className="font-medium text-gray-800 dark:text-gray-100">{it.nombre}</div>
                          <div className="text-xs text-gray-400 font-mono">{it.sku}</div>
                        </td>
                        <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">{it.esperado} {it.unidad}</td>
                        <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">{it.recibido} {it.unidad}</td>
                        <td className="px-3 py-2 text-right font-semibold">
                          {diff === 0
                            ? <span className="text-green-600 dark:text-green-400">✓</span>
                            : diff < 0
                              ? <span className="text-red-600 dark:text-red-400">{diff} {it.unidad}</span>
                              : <span className="text-amber-600 dark:text-amber-400">+{diff} {it.unidad}</span>
                          }
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Acciones si hay diferencias en una OC */}
            {hayDiferencias && (
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-medium text-sm">
                  <AlertTriangle size={16} />
                  Hay diferencias respecto a la OC. ¿Cómo querés proceder?
                </div>
                <div className="flex flex-wrap gap-2">
                  {faltantes.length > 0 && (
                    <button
                      onClick={() => crearOCDerivada.mutate(resultadoModal)}
                      disabled={crearOCDerivada.isPending}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border-2 border-violet-500 text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 disabled:opacity-50">
                      <GitBranch size={15} />
                      Crear OC derivada ({faltantes.reduce((s, it) => s + (it.esperado - it.recibido), 0)} unidades faltantes)
                    </button>
                  )}
                  {resultadoModal.ocId && (
                    <button
                      onClick={() => solicitarReembolso.mutate(resultadoModal.ocId!)}
                      disabled={solicitarReembolso.isPending}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border-2 border-violet-500 text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 disabled:opacity-50">
                      <RotateCcw size={15} />
                      Solicitar reembolso → Gastos OC
                    </button>
                  )}
                </div>
                {sobrantes.length > 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    ⚠ Se recibieron más unidades de las esperadas en {sobrantes.length} producto(s). Verificá con el proveedor.
                  </p>
                )}
              </div>
            )}

            <div className="flex justify-end">
              <button
                onClick={() => { setResultadoModal(null); navigate('/recepciones', { replace: true }) }}
                className="px-4 py-2 rounded-lg text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600">
                {hayDiferencias ? 'Cerrar sin acción' : 'Cerrar'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Render lista ──────────────────────────────────────────────────────────

  if (!showForm) return (
    <div className="max-w-4xl mx-auto space-y-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-primary flex items-center gap-2">
            <Warehouse size={22} className="text-accent" /> Recepciones
          </h1>
          <p className="text-sm text-muted mt-0.5">Ingreso de mercadería desde proveedores</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true) }}
          className="flex items-center gap-2 px-4 py-2.5 bg-accent text-white rounded-xl text-sm font-medium hover:bg-accent/90 transition-colors">
          <Plus size={16} /> Nueva Recepción
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent" />
          </div>
        ) : recepciones.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
            <Warehouse size={40} className="mb-3 opacity-40" />
            <p className="font-medium">No hay recepciones aún</p>
            <button onClick={() => setShowForm(true)} className="mt-3 text-accent text-sm hover:underline">
              Crear la primera →
            </button>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {recepciones.map(rec => {
              const exp = expandedRec === rec.id
              return (
                <div key={rec.id}>
                  <div
                    className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                    onClick={() => setExpandedRec(exp ? null : rec.id)}
                  >
                    <span className="text-gray-400 dark:text-gray-500 w-4 flex-shrink-0">
                      {exp ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-800 dark:text-gray-100">
                        Recepción #{rec.numero}
                        {rec.ordenes_compra && (
                          <span className="ml-2 text-xs text-gray-500 dark:text-gray-400 font-normal">OC #{rec.ordenes_compra.numero}</span>
                        )}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {rec.proveedores?.nombre ?? 'Sin proveedor'} · {new Date(rec.created_at).toLocaleDateString('es-AR')}
                      </p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${ESTADO_RECEPCION_COLOR[rec.estado]}`}>
                      {ESTADO_RECEPCION_LABEL[rec.estado]}
                    </span>
                    {rec.estado === 'borrador' && (
                      <button
                        onClick={e => { e.stopPropagation(); cancelarRecepcion(rec.id) }}
                        title="Cancelar"
                        className="p-1.5 text-gray-400 hover:text-red-500 transition-colors flex-shrink-0">
                        <XCircle size={16} />
                      </button>
                    )}
                  </div>
                  {exp && rec.notas && (
                    <div className="px-6 pb-3 pt-1">
                      <p className="text-xs text-gray-500 dark:text-gray-400">{rec.notas}</p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )

  // ── Render formulario ─────────────────────────────────────────────────────

  return (
    <div className="max-w-4xl mx-auto space-y-4 px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => { setShowForm(false); resetForm(); navigate('/recepciones', { replace: true }) }}
          className="p-2 rounded-xl text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-xl font-bold text-primary">Nueva Recepción</h1>
          <p className="text-sm text-muted">Registrá el ingreso de mercadería</p>
        </div>
      </div>

      {/* Datos de la recepción */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-5 space-y-4">
        <h2 className="text-sm font-semibold text-primary uppercase tracking-wide">Datos generales</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Proveedor</label>
            <select value={fProveedorId} onChange={e => { setFProveedorId(e.target.value); setFOcId('') }}
              className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent dark:bg-gray-700">
              <option value="">Sin proveedor</option>
              {(proveedores as any[]).map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Contra OC <span className="text-gray-400 text-xs font-normal">(opcional)</span>
            </label>
            <select value={fOcId} onChange={e => setFOcId(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent dark:bg-gray-700">
              <option value="">Sin OC vinculada</option>
              {(ocsConfirmadas as any[]).map(oc => <option key={oc.id} value={oc.id}>OC #{oc.numero}</option>)}
            </select>
          </div>
          {sucursales.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Sucursal destino</label>
              <select value={fSucursalId} onChange={e => setFSucursalId(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent dark:bg-gray-700">
                <option value="">Sin sucursal</option>
                {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </div>
          )}
          <div className={sucursales.length > 0 ? '' : 'sm:col-span-2'}>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notas</label>
            <input type="text" value={fNotas} onChange={e => setFNotas(e.target.value)}
              placeholder="Opcional..."
              className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent dark:bg-gray-700" />
          </div>
        </div>
      </div>

      {/* Items */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-primary uppercase tracking-wide">Productos a recibir</h2>
          <span className="text-xs text-muted">{items.length} ítem(s)</span>
        </div>

        {/* Buscador */}
        <div className="relative">
          <div className="flex items-center gap-2 px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
            <Search size={15} className="text-gray-400 flex-shrink-0" />
            <input
              value={prodSearch}
              onChange={e => setProdSearch(e.target.value)}
              onFocus={() => setProdFocused(true)}
              onBlur={() => setTimeout(() => setProdFocused(false), 200)}
              placeholder="Buscar producto por nombre o SKU..."
              className="flex-1 text-sm bg-transparent focus:outline-none text-gray-800 dark:text-gray-100" />
          </div>
          {(prodSearch.length > 0 && prodFocused) && (
            <div className="absolute z-20 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg max-h-52 overflow-y-auto">
              {(prodsBusqueda as any[]).length === 0 ? (
                <p className="px-4 py-3 text-sm text-gray-400">Sin resultados</p>
              ) : (
                (prodsBusqueda as any[]).map(p => (
                  <button key={p.id} type="button"
                    onMouseDown={() => agregarProducto(p)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-left">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{p.nombre}</p>
                      <p className="text-xs text-gray-400 font-mono">{p.sku}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Lista de items */}
        {items.length === 0 ? (
          <p className="text-sm text-muted text-center py-6">Buscá un producto para agregarlo</p>
        ) : (
          <div className="space-y-3">
            {items.map(it => (
              <div key={it._key} className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                {/* Fila principal */}
                <div className="flex items-center gap-3 px-4 py-3">
                  <button onClick={() => updItem(it._key, { expanded: !it.expanded })}
                    className="text-gray-400 dark:text-gray-500 flex-shrink-0">
                    {it.expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{it.producto_nombre}</p>
                    <p className="text-xs text-gray-400 font-mono">{it.producto_sku}</p>
                  </div>
                  {it.cantidad_esperada > 0 && (
                    <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
                      Esp: {it.cantidad_esperada}
                    </span>
                  )}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <label className="text-xs text-gray-500 dark:text-gray-400">Cant:</label>
                    <input
                      type="number" min="0" value={it.cantidad_recibida}
                      onChange={e => updItem(it._key, { cantidad_recibida: e.target.value })}
                      onWheel={e => e.currentTarget.blur()}
                      className="w-20 px-2 py-1 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-center focus:outline-none focus:border-accent dark:bg-gray-700" />
                  </div>
                  <button onClick={() => removeItem(it._key)}
                    className="text-gray-400 hover:text-red-500 transition-colors flex-shrink-0">
                    <Trash2 size={15} />
                  </button>
                </div>

                {/* Detalles expandibles */}
                {it.expanded && (
                  <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-3 bg-gray-50 dark:bg-gray-700/50">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                      {(estructurasMap[it.producto_id]?.length ?? 0) > 0 && (
                        <div className="col-span-2 sm:col-span-3">
                          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Estructura de embalaje</label>
                          <select value={it.estructura_id} onChange={e => updItem(it._key, { estructura_id: e.target.value })}
                            className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-xs focus:outline-none focus:border-accent dark:bg-gray-600">
                            <option value="">Sin estructura</option>
                            {estructurasMap[it.producto_id].map(e => (
                              <option key={e.id} value={e.id}>{e.nombre}{e.is_default ? ' (default)' : ''}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      <div>
                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Ubicación</label>
                        <select value={it.ubicacion_id} onChange={e => updItem(it._key, { ubicacion_id: e.target.value })}
                          className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-xs focus:outline-none focus:border-accent dark:bg-gray-600">
                          <option value="">Sin ubicación</option>
                          {(ubicaciones as any[]).map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Estado</label>
                        <select value={it.estado_id} onChange={e => updItem(it._key, { estado_id: e.target.value })}
                          className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-xs focus:outline-none focus:border-accent dark:bg-gray-600">
                          <option value="">Sin estado</option>
                          {(estadosInv as any[]).map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">LPN</label>
                        <input type="text" value={it.lpn} onChange={e => updItem(it._key, { lpn: e.target.value })}
                          placeholder="LPN-001"
                          className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-xs font-mono focus:outline-none focus:border-accent dark:bg-gray-600" />
                      </div>
                      {it.tiene_lote && (
                        <div>
                          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Nro. de lote</label>
                          <input type="text" value={it.nro_lote} onChange={e => updItem(it._key, { nro_lote: e.target.value })}
                            className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-xs font-mono focus:outline-none focus:border-accent dark:bg-gray-600" />
                        </div>
                      )}
                      {it.tiene_vencimiento && (
                        <div>
                          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Fecha vencimiento</label>
                          <input type="date" value={it.fecha_vencimiento} onChange={e => updItem(it._key, { fecha_vencimiento: e.target.value })}
                            className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-xs focus:outline-none focus:border-accent dark:bg-gray-600" />
                        </div>
                      )}
                      <div>
                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Precio costo</label>
                        <input type="number" min="0" value={it.precio_costo}
                          onChange={e => updItem(it._key, { precio_costo: e.target.value })}
                          onWheel={e => e.currentTarget.blur()}
                          placeholder={String(it.precio_costo_default)}
                          className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-xs focus:outline-none focus:border-accent dark:bg-gray-600" />
                      </div>
                      {it.tiene_series && (
                        <div className="col-span-2 sm:col-span-3">
                          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Números de serie (uno por línea)</label>
                          <textarea value={it.series_txt} rows={3}
                            onChange={e => updItem(it._key, { series_txt: e.target.value, cantidad_recibida: String(e.target.value.split('\n').filter(s => s.trim()).length) })}
                            className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-xs font-mono focus:outline-none focus:border-accent dark:bg-gray-600 resize-none" />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Acciones */}
      <div className="flex gap-3 justify-end pb-6">
        <button
          onClick={() => { setShowForm(false); resetForm(); navigate('/recepciones', { replace: true }) }}
          className="px-5 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
          Cancelar
        </button>
        <button
          disabled={saving || items.length === 0}
          onClick={() => guardar(false)}
          className="px-5 py-2.5 border border-accent text-accent rounded-xl text-sm font-medium hover:bg-accent/5 disabled:opacity-50 transition-colors">
          {saving ? 'Guardando...' : 'Guardar borrador'}
        </button>
        <button
          disabled={saving || items.length === 0}
          onClick={() => guardar(true)}
          className="flex items-center gap-2 px-5 py-2.5 bg-accent text-white rounded-xl text-sm font-medium hover:bg-accent/90 disabled:opacity-50 transition-colors">
          <CheckCircle size={16} />
          {saving ? 'Procesando...' : 'Confirmar recepción'}
        </button>
      </div>
    </div>
  )
}
