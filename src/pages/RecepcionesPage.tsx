import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, ArrowLeft, Trash2, Search, CheckCircle, XCircle, ChevronDown, ChevronRight, Warehouse, AlertTriangle, GitBranch, RotateCcw, X, Camera, Upload, Loader2, ScanBarcode } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { BarcodeScanner } from '@/components/BarcodeScanner'
import { AtributoValorSelect } from '@/components/AtributoValorSelect'
import { resolverScanCompuesto } from '@/lib/scanCompuesto'
import { useAuthStore } from '@/store/authStore'
import { estadoOCdesdeRecibido, superaOverReceipt, tieneFaltante, esAjusteCantidad } from '@/lib/recepcionLogic'
import { cambioCostoPct, superaAlertaCosto } from '@/lib/comprasCostos'
import { logActividad } from '@/lib/actividadLog'
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
  tiene_pais_origen: boolean
  tiene_talle: boolean
  tiene_color: boolean
  tiene_encaje: boolean
  tiene_formato: boolean
  tiene_sabor_aroma: boolean
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
  motivo_faltante: string  // CO2/B4 — motivo del faltante en under-receipt
  actualizar_costo: boolean // CO3/E1 — el operador decide actualizar el precio_costo del producto
  // Atributos de variante
  pais_origen: string
  talle: string
  color: string
  encaje: string
  formato: string
  sabor_aroma: string
  expanded: boolean
}

type ScanItem = {
  _key: string
  barcode: string | null
  nombre_scan: string
  cantidad: number
  precio_unitario: number
  match: {
    id: string; nombre: string; sku: string; precio_costo: number
    tiene_series: boolean; tiene_lote: boolean; tiene_vencimiento: boolean
    tiene_talle: boolean; tiene_color: boolean; tiene_encaje: boolean; tiene_formato: boolean; tiene_sabor_aroma: boolean
    unidad_medida: string
  } | null
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
    tiene_pais_origen: false, tiene_talle: false, tiene_color: false,
    tiene_encaje: false, tiene_formato: false, tiene_sabor_aroma: false,
    unidad_medida: 'unidad', precio_costo_default: 0,
    oc_item_id: '', cantidad_esperada: 0, cantidad_recibida: '1',
    ubicacion_id: '', estado_id: '', nro_lote: '', fecha_vencimiento: '',
    lpn: '', series_txt: '', precio_costo: '', estructura_id: '', motivo_faltante: '', actualizar_costo: false,
    pais_origen: '', talle: '', color: '', encaje: '', formato: '', sabor_aroma: '',
    expanded: false,
    ...overrides,
  }
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function RecepcionesPage() {
  const { tenant, user, sucursales, sucursalId: sucursalCtx } = useAuthStore()
  const { applyFilter, sucursalId } = useSucursalFilter()
  // CO2 — config + rol para over-receipt, motivo de faltante y remito
  const esSupervisorPlus = ['DUEÑO', 'SUPERVISOR', 'SUPER_USUARIO', 'ADMIN'].includes(user?.rol ?? '')
  const overReceiptCfg = { permite: !!(tenant as any)?.permite_over_receipt, pctMax: (tenant as any)?.over_receipt_pct_max }
  const remitoObligatorio = !!(tenant as any)?.recepcion_remito_obligatorio
  const costoAlertaPct = Number((tenant as any)?.compras_costo_alerta_pct ?? 10)  // CO3/E1
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
  // ISS-150: si la OC viene ya pagada, el precio costo es inmutable y se muestra como label
  const [ocPagada, setOcPagada] = useState(false)
  const [fSucursalId, setFSucursalId] = useState(sucursalCtx ?? '')
  const [fNotas, setFNotas] = useState('')
  const [remitoFile, setRemitoFile] = useState<File | null>(null)  // CO2/B7 — comprobante del proveedor
  const [items, setItems] = useState<FormItem[]>([])
  const [prodSearch, setProdSearch] = useState('')
  const [showScanner, setShowScanner] = useState(false)  // ISS-127 F3
  const [prodFocused, setProdFocused] = useState(false)
  const [saving, setSaving] = useState(false)
  const [expandedRec, setExpandedRec] = useState<string | null>(null)
  const [estructurasMap, setEstructurasMap] = useState<Record<string, ProductoEstructura[]>>({})
  const [resultadoModal, setResultadoModal] = useState<ResultadoRecepcion | null>(null)

  // ── Scan ticket ─────────────────────────────────────────────────────────────
  const [showScanModal, setShowScanModal] = useState(false)
  const [scanStep, setScanStep] = useState<'upload' | 'scanning' | 'results'>('upload')
  const [scanItems, setScanItems] = useState<ScanItem[]>([])
  const [scanPreviewUrl, setScanPreviewUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  const { data: recepcionItems = [] } = useQuery({
    queryKey: ['recepcion-items-detail', expandedRec],
    queryFn: async () => {
      const { data } = await supabase
        .from('recepcion_items')
        .select('*, productos(nombre, sku, unidad_medida)')
        .eq('recepcion_id', expandedRec!)
        .order('id')
      return data ?? []
    },
    enabled: !!expandedRec,
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
        .select('id, nombre, sku, tiene_series, tiene_lote, tiene_vencimiento, tiene_pais_origen, tiene_talle, tiene_color, tiene_encaje, tiene_formato, tiene_sabor_aroma, unidad_medida, precio_costo')
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
    if (!fOcId) { setOcPagada(false); return }
    const cargarOC = async () => {
      const { data: oc } = await supabase
        .from('ordenes_compra')
        .select('proveedor_id, estado_pago, orden_compra_items(id, cantidad, precio_unitario, productos(id, nombre, sku, tiene_series, tiene_lote, tiene_vencimiento, tiene_pais_origen, tiene_talle, tiene_color, tiene_encaje, tiene_formato, tiene_sabor_aroma, unidad_medida, precio_costo))')
        .eq('id', fOcId)
        .single()
      if (!oc) return
      if (oc.proveedor_id) setFProveedorId(oc.proveedor_id)
      setOcPagada((oc as any).estado_pago === 'pagada')
      const ocItems = (oc as any).orden_compra_items ?? []
      if (ocItems.length > 0) {
        const itemsConEstructura = await Promise.all(ocItems.map(async (it: any) => {
          const p = it.productos
          const estructura_id = await cargarEstructuras(p.id)
          // Resolver ubicación predeterminada por sucursal
          let ubicacionDefault = p.ubicacion_id ?? ''
          if (sucursalId) {
            const { data: ubSuc } = await supabase.from('producto_ubicacion_sucursal')
              .select('ubicacion_id').eq('producto_id', p.id).eq('sucursal_id', sucursalId).maybeSingle()
            if ((ubSuc as any)?.ubicacion_id) ubicacionDefault = (ubSuc as any).ubicacion_id
          }
          return nuevoItem({
            producto_id: p.id,
            producto_nombre: p.nombre,
            producto_sku: p.sku,
            tiene_series: p.tiene_series,
            tiene_lote: p.tiene_lote,
            tiene_vencimiento: p.tiene_vencimiento,
            tiene_pais_origen: p.tiene_pais_origen ?? false,
            tiene_talle: p.tiene_talle ?? false,
            tiene_color: p.tiene_color ?? false,
            tiene_encaje: p.tiene_encaje ?? false,
            tiene_formato: p.tiene_formato ?? false,
            tiene_sabor_aroma: p.tiene_sabor_aroma ?? false,
            unidad_medida: p.unidad_medida,
            precio_costo_default: p.precio_costo ?? 0,
            precio_costo: String(it.precio_unitario ?? p.precio_costo ?? ''),
            oc_item_id: it.id,
            cantidad_esperada: it.cantidad,
            cantidad_recibida: String(it.cantidad),
            estructura_id,
            ubicacion_id: ubicacionDefault,
            estado_id:    p.estado_id ?? '',
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

  // ISS-127 F3: `extra` pre-carga lote/venc/cantidad desde un código compuesto GS1.
  const agregarProducto = async (p: any, extra?: { nro_lote?: string; fecha_vencimiento?: string; cantidad_recibida?: number }) => {
    if (items.find(it => it.producto_id === p.id)) {
      toast('Ese producto ya está en la lista')
      return
    }
    const estructura_id = await cargarEstructuras(p.id)
    // Resolver ubicación predeterminada: sucursal activa primero, luego fallback del producto
    let ubicacionDefault = p.ubicacion_id ?? ''
    if (sucursalId) {
      const { data: ubSuc } = await supabase.from('producto_ubicacion_sucursal')
        .select('ubicacion_id').eq('producto_id', p.id).eq('sucursal_id', sucursalId).maybeSingle()
      if ((ubSuc as any)?.ubicacion_id) ubicacionDefault = (ubSuc as any).ubicacion_id
    }
    setItems(prev => [...prev, nuevoItem({
      producto_id: p.id,
      producto_nombre: p.nombre,
      producto_sku: p.sku,
      tiene_series: p.tiene_series,
      tiene_lote: p.tiene_lote,
      tiene_vencimiento: p.tiene_vencimiento,
      tiene_pais_origen: p.tiene_pais_origen ?? false,
      tiene_talle: p.tiene_talle ?? false,
      tiene_color: p.tiene_color ?? false,
      tiene_encaje: p.tiene_encaje ?? false,
      tiene_formato: p.tiene_formato ?? false,
      tiene_sabor_aroma: p.tiene_sabor_aroma ?? false,
      unidad_medida: p.unidad_medida,
      precio_costo_default: p.precio_costo ?? 0,
      precio_costo: String(p.precio_costo ?? ''),
      estructura_id,
      // Defaults del producto — el usuario puede modificarlos antes de confirmar
      ubicacion_id: ubicacionDefault,
      estado_id:    p.estado_id ?? '',
      // ISS-127 F3: datos pre-cargados del código GS1
      ...(extra?.nro_lote ? { nro_lote: extra.nro_lote } : {}),
      ...(extra?.fecha_vencimiento ? { fecha_vencimiento: extra.fecha_vencimiento } : {}),
      ...(extra?.cantidad_recibida != null ? { cantidad_recibida: String(extra.cantidad_recibida) } : {}),
    })])
    setProdSearch('')
    setProdFocused(false)
  }

  // CO3/E3 — alta rápida de producto desde la recepción (DUEÑO/SUPERVISOR). Queda "pendiente de revisión".
  const crearProductoRapido = async () => {
    const nombre = prodSearch.trim()
    if (!nombre) return
    if (!esSupervisorPlus) { toast.error('Solo DUEÑO/SUPERVISOR puede dar de alta un producto desde la recepción'); return }
    const sku = `REC-${Date.now().toString(36).toUpperCase()}`
    const { data, error } = await supabase.from('productos').insert({
      tenant_id: tenant!.id, nombre, sku, unidad_medida: 'unidad',
      precio_costo: 0, precio_venta: 0, activo: true, pendiente_revision: true,
      proveedor_id: fProveedorId || null,
    }).select('id, nombre, sku, tiene_series, tiene_lote, tiene_vencimiento, unidad_medida, precio_costo, estado_id').single()
    if (error) { toast.error('No se pudo crear el producto: ' + error.message); return }
    toast.success(`Producto "${nombre}" creado (pendiente de revisión)`)
    logActividad({ entidad: 'producto', entidad_id: data.id, entidad_nombre: nombre, accion: 'crear',
      valor_nuevo: 'Alta rápida desde recepción — pendiente de revisión', pagina: '/recepciones' })
    qc.invalidateQueries({ queryKey: ['productos'] })
    await agregarProducto(data)
  }

  // ISS-127 F3: leer un código (GS1 compuesto o plano) y agregarlo a la recepción.
  const REC_PROD_COLS = 'id, nombre, sku, tiene_series, tiene_lote, tiene_vencimiento, tiene_pais_origen, tiene_talle, tiene_color, tiene_encaje, tiene_formato, tiene_sabor_aroma, unidad_medida, precio_costo, codigo_barras'
  const handleScanRecepcion = async (code: string) => {
    setShowScanner(false)
    const comp = await resolverScanCompuesto(code, tenant!.id)
    if (comp) {
      if (!comp.producto) { toast.error('Código GS1 leído, pero el GTIN no coincide con ningún producto.'); return }
      const { data } = await supabase.from('productos').select(REC_PROD_COLS)
        .eq('tenant_id', tenant!.id).eq('id', comp.producto.id).limit(1)
      const prod = data?.[0]
      if (!prod) { toast.error('Producto no encontrado'); return }
      await agregarProducto(prod, {
        nro_lote: comp.fields.lote ?? undefined,
        fecha_vencimiento: comp.fields.vencimiento ?? undefined,
        cantidad_recibida: comp.fields.cantidad ?? undefined,
      })
      const partes = [
        comp.fields.lote ? `lote ${comp.fields.lote}` : null,
        comp.fields.vencimiento ? `vto ${comp.fields.vencimiento}` : null,
        comp.fields.cantidad != null ? `${comp.fields.cantidad} u` : null,
      ].filter(Boolean).join(' · ')
      toast.success(`GS1: ${(prod as any).nombre}${partes ? ` — ${partes}` : ''}`)
      return
    }
    const { data } = await supabase.from('productos').select(REC_PROD_COLS)
      .eq('tenant_id', tenant!.id).eq('activo', true)
      .or(`codigo_barras.eq.${code},sku.eq.${code}`).limit(1)
    if (!data || data.length === 0) { toast.error(`No se encontró ningún producto con código "${code}"`); return }
    await agregarProducto(data[0])
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
        if (it.tiene_talle && !it.talle?.trim())
          errores.push(`"${it.producto_nombre}" requiere talle`)
        if (it.tiene_color && !it.color?.trim())
          errores.push(`"${it.producto_nombre}" requiere color`)
        if (it.tiene_encaje && !it.encaje?.trim())
          errores.push(`"${it.producto_nombre}" requiere encaje`)
        if (it.tiene_formato && !it.formato?.trim())
          errores.push(`"${it.producto_nombre}" requiere formato`)
        if (it.tiene_sabor_aroma && !it.sabor_aroma?.trim())
          errores.push(`"${it.producto_nombre}" requiere sabor/aroma`)
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
            (it.tiene_series && !it.series_txt.trim()) ||
            (it.tiene_talle && !it.talle?.trim()) ||
            (it.tiene_color && !it.color?.trim()) ||
            (it.tiene_encaje && !it.encaje?.trim()) ||
            (it.tiene_formato && !it.formato?.trim()) ||
            (it.tiene_sabor_aroma && !it.sabor_aroma?.trim())
          return conError ? { ...it, expanded: true } : it
        }))
        toast.error(errores[0])
        return
      }

      // CO2/B2 — recepción sin OC debe tener proveedor
      if (!fOcId && !fProveedorId) { toast.error('Seleccioná un proveedor para una recepción sin OC'); return }

      // Cantidad recibida efectiva por ítem
      const cantDe = (it: FormItem) => it.tiene_series
        ? it.series_txt.split('\n').filter(s => s.trim()).length
        : Number(it.cantidad_recibida)

      // CO2/B1c — over/under requiere SUPERVISOR+ ; CO2/B4 — faltante requiere motivo
      for (const it of items) {
        const cant = cantDe(it)
        if (cant === 0) continue
        if (it.oc_item_id && esAjusteCantidad(cant, it.cantidad_esperada) && !esSupervisorPlus) {
          toast.error(`Ajustar la cantidad de "${it.producto_nombre}" (pedido ${it.cantidad_esperada}, recibís ${cant}) requiere SUPERVISOR o DUEÑO`)
          return
        }
      }

      // CO2/B3 + B4 — recibido ACUMULADO por ítem de OC (suma de recepciones confirmadas previas)
      const ocItemIds = items.filter(it => it.oc_item_id).map(it => it.oc_item_id)
      const prevPorItem = new Map<string, number>()
      if (ocItemIds.length > 0) {
        const { data: prev } = await supabase.from('recepcion_items')
          .select('oc_item_id, cantidad_recibida, recepciones!inner(estado)')
          .in('oc_item_id', ocItemIds).eq('recepciones.estado', 'confirmada')
        for (const r of (prev ?? []) as any[]) {
          prevPorItem.set(r.oc_item_id, (prevPorItem.get(r.oc_item_id) ?? 0) + Number(r.cantidad_recibida ?? 0))
        }
      }
      for (const it of items) {
        const cant = cantDe(it)
        if (cant === 0) continue
        const acum = (it.oc_item_id ? (prevPorItem.get(it.oc_item_id) ?? 0) : 0) + cant
        // B3 — over-receipt acumulado sobre el tope permitido
        if (it.oc_item_id && superaOverReceipt(acum, it.cantidad_esperada, overReceiptCfg)) {
          toast.error(`"${it.producto_nombre}": recibido acumulado ${acum} supera lo permitido sobre lo pedido (${it.cantidad_esperada})`)
          return
        }
        // B4 — faltante (acumulado por debajo de lo pedido) requiere motivo
        if (it.oc_item_id && tieneFaltante(acum, it.cantidad_esperada) && !it.motivo_faltante.trim()) {
          setItems(prev => prev.map(x => x._key === it._key ? { ...x, expanded: true } : x))
          toast.error(`Indicá el motivo del faltante de "${it.producto_nombre}" (recibís menos de lo pedido)`)
          return
        }
      }

      // CO2/B7 — remito obligatorio
      if (remitoObligatorio && !remitoFile) { toast.error('Adjuntá el remito del proveedor (obligatorio)'); return }
    }

    setSaving(true)
    try {
      const estado = confirmar ? 'confirmada' : 'borrador'

      // CO2/B7 — subir remito a Storage si se adjuntó
      let remitoUrl: string | null = null
      if (remitoFile) {
        const ext = remitoFile.name.split('.').pop() || 'pdf'
        const path = `${tenant!.id}/${crypto.randomUUID()}.${ext}`
        const { error: upErr } = await supabase.storage.from('remitos').upload(path, remitoFile, { upsert: false })
        if (upErr) { toast.error('No se pudo subir el remito: ' + upErr.message); setSaving(false); return }
        remitoUrl = path
      }

      const { data: rec, error: recErr } = await supabase
        .from('recepciones')
        .insert({
          tenant_id: tenant!.id,
          oc_id: fOcId || null,
          proveedor_id: fProveedorId || null,
          estado,
          notas: fNotas || null,
          sucursal_id: fSucursalId || null,
          remito_url: remitoUrl,  // CO2/B7
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
              ...(it.tiene_pais_origen ? { pais_origen: it.pais_origen || null } : {}),
              ...(it.tiene_talle ? { talle: it.talle || null } : {}),
              ...(it.tiene_color ? { color: it.color || null } : {}),
              ...(it.tiene_encaje ? { encaje: it.encaje || null } : {}),
              ...(it.tiene_formato ? { formato: it.formato || null } : {}),
              ...(it.tiene_sabor_aroma ? { sabor_aroma: it.sabor_aroma || null } : {}),
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
            motivo_faltante: it.motivo_faltante.trim() || null,  // CO2/B4
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
            motivo_faltante: it.motivo_faltante.trim() || null,  // CO2/B4
          })
        }
      }

      // CO2/B5 — recalcular el estado de la OC desde el ACUMULADO de TODAS sus recepciones
      // confirmadas (no solo la actual). Antes se calculaba solo con esta recepción → una OC
      // completada en varias parciales quedaba mal en 'recibida_parcial'.
      if (confirmar && fOcId) {
        const { data: ocItemsFull } = await supabase.from('orden_compra_items')
          .select('id, cantidad').eq('orden_compra_id', fOcId)
        const idsOC = (ocItemsFull ?? []).map((o: any) => o.id)
        const recibidoPorItem = new Map<string, number>()
        if (idsOC.length > 0) {
          const { data: recs } = await supabase.from('recepcion_items')
            .select('oc_item_id, cantidad_recibida, recepciones!inner(estado)')
            .in('oc_item_id', idsOC).eq('recepciones.estado', 'confirmada')
          for (const r of (recs ?? []) as any[]) {
            recibidoPorItem.set(r.oc_item_id, (recibidoPorItem.get(r.oc_item_id) ?? 0) + Number(r.cantidad_recibida ?? 0))
          }
        }
        const itemsRecibido = (ocItemsFull ?? []).map((o: any) => ({
          esperada: Number(o.cantidad ?? 0), recibidoAcum: recibidoPorItem.get(o.id) ?? 0,
        }))
        const estadoOC = estadoOCdesdeRecibido(itemsRecibido)
        await supabase.from('ordenes_compra').update({
          estado: estadoOC === 'recibida' ? 'recibida' : 'recibida_parcial',
        }).eq('id', fOcId)
        qc.invalidateQueries({ queryKey: ['ordenes', tenant?.id] })
        qc.invalidateQueries({ queryKey: ['ordenes_compra'] })
      }

      // CO3/E1 — actualizar el precio_costo del producto para los ítems donde el operador lo decidió.
      // CO3/B6 — auditar las ediciones de precio (precio recibido distinto del costo del producto).
      if (confirmar && !ocPagada) {
        for (const it of itemsValidos) {
          const nuevo = Number(it.precio_costo || 0)
          if (nuevo <= 0) continue
          const cambio = superaAlertaCosto(it.precio_costo_default, nuevo, 0)  // hubo cambio de costo
          if (it.actualizar_costo && Math.abs(nuevo - it.precio_costo_default) > 0.001) {
            await supabase.from('productos').update({ precio_costo: nuevo }).eq('id', it.producto_id)
            qc.invalidateQueries({ queryKey: ['productos'] })
            logActividad({ entidad: 'producto', entidad_id: it.producto_id, entidad_nombre: it.producto_nombre, accion: 'editar',
              campo: 'precio_costo', valor_nuevo: `Recepción #${rec.numero}: ${it.precio_costo_default} → ${nuevo}`, pagina: '/recepciones' })
          } else if (cambio) {
            // B6 — quedó registrado que el precio del remito difiere del costo del producto (sin actualizar)
            logActividad({ entidad: 'producto', entidad_id: it.producto_id, entidad_nombre: it.producto_nombre, accion: 'editar',
              campo: 'precio_costo', valor_nuevo: `Recepción #${rec.numero} (${nuevo}) difiere del costo (${it.precio_costo_default}) — no actualizado`, pagina: '/recepciones' })
          }
        }
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
    setFNotas(''); setItems([]); setProdSearch(''); setRemitoFile(null)
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

  // ── Funciones de scan ────────────────────────────────────────────────────────

  const comprimirImagen = (file: File, maxWidth = 1200, quality = 0.82): Promise<string> =>
    new Promise((resolve, reject) => {
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(url)
        const scale = Math.min(1, maxWidth / img.width)
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', quality).split(',')[1])
      }
      img.onerror = reject
      img.src = url
    })

  const procesarTicket = async (file: File) => {
    setScanPreviewUrl(URL.createObjectURL(file))
    setScanStep('scanning')
    try {
      const base64 = await comprimirImagen(file)
      const { data, error } = await supabase.functions.invoke('scan-ticket', {
        body: { image: base64, media_type: 'image/jpeg' },
      })
      if (error) throw new Error(error.message)
      if (data?.error) throw new Error(data.error)
      const rawItems: Array<{ barcode: string | null; nombre: string; cantidad: number; precio_unitario: number }> = data?.items ?? []
      if (rawItems.length === 0) { toast.error('No se detectaron productos en el ticket'); setScanStep('upload'); return }

      // Buscar cada item en la DB en paralelo
      const matched = await Promise.all(rawItems.map(async (item) => {
        let prod: any = null
        // 1. Por barcode (SKU exacto)
        if (item.barcode) {
          const { data: d } = await supabase.from('productos')
            .select('id, nombre, sku, precio_costo, tiene_series, tiene_lote, tiene_vencimiento, tiene_talle, tiene_color, tiene_encaje, tiene_formato, tiene_sabor_aroma, unidad_medida')
            .eq('tenant_id', tenant!.id).eq('activo', true).eq('sku', item.barcode).maybeSingle()
          prod = d
        }
        // 2. Por nombre (primeras 2 palabras)
        if (!prod) {
          const palabras = item.nombre.split(/\s+/).slice(0, 2).join(' ')
          const { data: d } = await supabase.from('productos')
            .select('id, nombre, sku, precio_costo, tiene_series, tiene_lote, tiene_vencimiento, tiene_talle, tiene_color, tiene_encaje, tiene_formato, tiene_sabor_aroma, unidad_medida')
            .eq('tenant_id', tenant!.id).eq('activo', true).ilike('nombre', `%${palabras}%`).limit(1).maybeSingle()
          prod = d
        }
        return {
          _key: crypto.randomUUID(),
          barcode: item.barcode,
          nombre_scan: item.nombre,
          cantidad: item.cantidad,
          precio_unitario: item.precio_unitario,
          match: prod ? {
            id: prod.id, nombre: prod.nombre, sku: prod.sku, precio_costo: prod.precio_costo ?? 0,
            tiene_series: prod.tiene_series ?? false, tiene_lote: prod.tiene_lote ?? false, tiene_vencimiento: prod.tiene_vencimiento ?? false,
            tiene_talle: prod.tiene_talle ?? false, tiene_color: prod.tiene_color ?? false, tiene_encaje: prod.tiene_encaje ?? false,
            tiene_formato: prod.tiene_formato ?? false, tiene_sabor_aroma: prod.tiene_sabor_aroma ?? false,
            unidad_medida: prod.unidad_medida ?? 'unidad',
          } : null,
        } as ScanItem
      }))
      setScanItems(matched)
      setScanStep('results')
    } catch (e: any) {
      toast.error('Error al procesar el ticket: ' + (e.message ?? 'Error desconocido'))
      setScanStep('upload')
    }
  }

  const cargarScanAlFormulario = () => {
    const encontrados = scanItems.filter(i => i.match)
    if (encontrados.length === 0) { toast.error('No hay productos encontrados para cargar'); return }
    const nuevos = encontrados.map(i => nuevoItem({
      producto_id: i.match!.id,
      producto_nombre: i.match!.nombre,
      producto_sku: i.match!.sku,
      tiene_series: i.match!.tiene_series,
      tiene_lote: i.match!.tiene_lote,
      tiene_vencimiento: i.match!.tiene_vencimiento,
      tiene_talle: i.match!.tiene_talle,
      tiene_color: i.match!.tiene_color,
      tiene_encaje: i.match!.tiene_encaje,
      tiene_formato: i.match!.tiene_formato,
      tiene_sabor_aroma: i.match!.tiene_sabor_aroma,
      unidad_medida: i.match!.unidad_medida,
      precio_costo_default: i.match!.precio_costo,
      cantidad_recibida: String(i.cantidad),
      precio_costo: i.precio_unitario > 0 ? String(i.precio_unitario) : String(i.match!.precio_costo),
      expanded: false,
    }))
    setItems(prev => [...prev, ...nuevos])
    setShowScanModal(false)
    setScanItems([])
    setScanStep('upload')
    setScanPreviewUrl(null)
    toast.success(`${encontrados.length} producto${encontrados.length !== 1 ? 's' : ''} cargado${encontrados.length !== 1 ? 's' : ''} al formulario`)
  }

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
                  {exp && (
                    <div className="px-4 pb-4 pt-1 space-y-3 bg-gray-50 dark:bg-gray-700/30">
                      {rec.notas && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 italic">{rec.notas}</p>
                      )}
                      {recepcionItems.length === 0 ? (
                        <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-2">Cargando ítems...</p>
                      ) : (
                        <div className="border border-gray-200 dark:border-gray-600 rounded-xl overflow-hidden">
                          <table className="w-full text-sm">
                            <thead className="bg-white dark:bg-gray-800">
                              <tr>
                                <th className="text-left px-3 py-2 text-xs text-gray-500 dark:text-gray-400 font-medium">Producto</th>
                                <th className="text-right px-3 py-2 text-xs text-gray-500 dark:text-gray-400 font-medium">Esperado</th>
                                <th className="text-right px-3 py-2 text-xs text-gray-500 dark:text-gray-400 font-medium">Recibido</th>
                                <th className="text-right px-3 py-2 text-xs text-gray-500 dark:text-gray-400 font-medium">P. Costo</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                              {(recepcionItems as any[]).map((it, i) => {
                                const diff = it.cantidad_recibida - it.cantidad_esperada
                                return (
                                  <tr key={i}>
                                    <td className="px-3 py-2">
                                      <div className="font-medium text-gray-800 dark:text-gray-100">{it.productos?.nombre}</div>
                                      <div className="text-xs text-gray-400 font-mono">{it.productos?.sku}</div>
                                      {it.nro_lote && <div className="text-xs text-gray-400">Lote: {it.nro_lote}</div>}
                                      {it.fecha_vencimiento && <div className="text-xs text-gray-400">Vence: {it.fecha_vencimiento}</div>}
                                    </td>
                                    <td className="px-3 py-2 text-right text-gray-500 dark:text-gray-400">
                                      {it.cantidad_esperada} {it.productos?.unidad_medida}
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                      <span className={`font-semibold ${diff < 0 ? 'text-red-600 dark:text-red-400' : diff > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-800 dark:text-gray-100'}`}>
                                        {it.cantidad_recibida} {it.productos?.unidad_medida}
                                      </span>
                                      {diff !== 0 && (
                                        <div className="text-xs">
                                          {diff < 0
                                            ? <span className="text-red-500">{diff} faltante</span>
                                            : <span className="text-amber-500">+{diff} sobrante</span>
                                          }
                                        </div>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-right text-gray-500 dark:text-gray-400">
                                      {it.precio_costo != null
                                        ? `$${Number(it.precio_costo).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`
                                        : '—'}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
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
          {/* CO2/B7 — remito del proveedor */}
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Remito del proveedor {remitoObligatorio ? <span className="text-red-500">*</span> : <span className="text-gray-400 text-xs">(opcional)</span>}
            </label>
            <input type="file" accept="image/*,application/pdf"
              onChange={e => setRemitoFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm text-gray-600 dark:text-gray-300 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-accent/10 file:text-accent file:text-sm file:font-medium" />
            {remitoFile && <p className="text-xs text-gray-500 mt-1">📎 {remitoFile.name}</p>}
          </div>
        </div>
      </div>

      {/* Items */}
      <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) procesarTicket(f); e.target.value = '' }} />
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-primary uppercase tracking-wide">Productos a recibir</h2>
          <div className="flex items-center gap-3">
            <button onClick={() => { setScanStep('upload'); setScanItems([]); setScanPreviewUrl(null); setShowScanModal(true) }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-accent border border-accent/40 rounded-lg hover:bg-accent/5 transition-colors">
              <Camera size={13} /> Escanear ticket
            </button>
            <span className="text-xs text-muted">{items.length} ítem(s)</span>
          </div>
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
            <button type="button" onClick={() => setShowScanner(true)} title="Escanear código (GS1 o barras)"
              className="flex-shrink-0 p-1 text-gray-400 hover:text-accent transition-colors">
              <ScanBarcode size={16} />
            </button>
          </div>
          {(prodSearch.length > 0 && prodFocused) && (
            <div className="absolute z-20 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg max-h-52 overflow-y-auto">
              {(prodsBusqueda as any[]).length === 0 ? (
                esSupervisorPlus ? (
                  <button type="button" onMouseDown={crearProductoRapido}
                    className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <span className="text-accent font-medium">➕ Crear producto "{prodSearch.trim()}"</span>
                    <span className="block text-xs text-gray-400">Alta rápida — queda pendiente de revisión</span>
                  </button>
                ) : (
                  <p className="px-4 py-3 text-sm text-gray-400">Sin resultados</p>
                )
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

                {/* CO2/B4 — motivo del faltante (cuando se recibe menos que lo pedido en una OC) */}
                {(() => {
                  const cant = it.tiene_series ? it.series_txt.split('\n').filter(s => s.trim()).length : Number(it.cantidad_recibida)
                  if (!(it.oc_item_id && it.cantidad_esperada > 0 && cant < it.cantidad_esperada)) return null
                  return (
                    <div className="px-4 pb-2 -mt-1">
                      <select value={it.motivo_faltante} onChange={e => updItem(it._key, { motivo_faltante: e.target.value })}
                        className="w-full px-2 py-1.5 border border-amber-300 dark:border-amber-700 rounded-lg text-xs bg-amber-50/40 dark:bg-amber-900/10 focus:outline-none">
                        <option value="">⚠ Motivo del faltante (obligatorio)…</option>
                        <option value="No entregado por proveedor">No entregado por proveedor</option>
                        <option value="Rotura / dañado">Rotura / dañado</option>
                        <option value="Faltante de stock del proveedor">Faltante de stock del proveedor</option>
                        <option value="Cancelado por proveedor">Cancelado por proveedor</option>
                        <option value="Entrega parcial (resto pendiente)">Entrega parcial (resto pendiente)</option>
                        <option value="Otro">Otro</option>
                      </select>
                    </div>
                  )
                })()}

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
                      {it.tiene_pais_origen && (
                        <div>
                          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">País de Origen</label>
                          <input type="text" value={it.pais_origen} onChange={e => updItem(it._key, { pais_origen: e.target.value })}
                            placeholder="Ej: Argentina"
                            className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-xs focus:outline-none focus:border-accent dark:bg-gray-600" />
                        </div>
                      )}
                      {it.tiene_talle && (
                        <div>
                          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Talle / Talla</label>
                          <AtributoValorSelect tenantId={tenant!.id} atributo="talle" value={it.talle}
                            onChange={v => updItem(it._key, { talle: v })} placeholder="Ej: M, 42" />
                        </div>
                      )}
                      {it.tiene_color && (
                        <div>
                          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Color</label>
                          <AtributoValorSelect tenantId={tenant!.id} atributo="color" value={it.color}
                            onChange={v => updItem(it._key, { color: v })} placeholder="Ej: Rojo" />
                        </div>
                      )}
                      {it.tiene_encaje && (
                        <div>
                          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Encaje</label>
                          <AtributoValorSelect tenantId={tenant!.id} atributo="encaje" value={it.encaje}
                            onChange={v => updItem(it._key, { encaje: v })} placeholder="Ej: Slim fit" />
                        </div>
                      )}
                      {it.tiene_formato && (
                        <div>
                          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Formato</label>
                          <AtributoValorSelect tenantId={tenant!.id} atributo="formato" value={it.formato}
                            onChange={v => updItem(it._key, { formato: v })} placeholder="Ej: 500g" />
                        </div>
                      )}
                      {it.tiene_sabor_aroma && (
                        <div>
                          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Sabor / Aroma</label>
                          <AtributoValorSelect tenantId={tenant!.id} atributo="sabor_aroma" value={it.sabor_aroma}
                            onChange={v => updItem(it._key, { sabor_aroma: v })} placeholder="Ej: Vainilla" />
                        </div>
                      )}
                      <div>
                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                          Precio costo {ocPagada && <span className="text-amber-600 dark:text-amber-400">· OC pagada (no editable)</span>}
                        </label>
                        {ocPagada ? (
                          <div className="w-full px-2 py-1.5 border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 rounded-lg text-xs text-amber-700 dark:text-amber-400 font-mono">
                            ${Number(it.precio_costo || it.precio_costo_default || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                          </div>
                        ) : (
                          <input type="number" min="0" value={it.precio_costo}
                            onChange={e => updItem(it._key, { precio_costo: e.target.value })}
                            onWheel={e => e.currentTarget.blur()}
                            placeholder={String(it.precio_costo_default)}
                            className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-xs focus:outline-none focus:border-accent dark:bg-gray-600" />
                        )}
                        {/* CO3/E1 — alerta de cambio de costo + el operador decide actualizar el maestro */}
                        {!ocPagada && (() => {
                          const nuevo = Number(it.precio_costo || 0)
                          if (!superaAlertaCosto(it.precio_costo_default, nuevo, costoAlertaPct)) return null
                          const pct = cambioCostoPct(it.precio_costo_default, nuevo)
                          return (
                            <label className="flex items-center gap-1.5 mt-1.5 text-xs cursor-pointer">
                              <input type="checkbox" checked={it.actualizar_costo}
                                onChange={e => updItem(it._key, { actualizar_costo: e.target.checked })} className="rounded" />
                              <span className={pct > 0 ? 'text-red-500' : 'text-green-600'}>
                                {pct > 0 ? '📈' : '📉'} El costo {pct > 0 ? 'subió' : 'bajó'} {Math.abs(pct).toFixed(0)}% — actualizar costo del producto
                              </span>
                            </label>
                          )
                        })()}
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

      {/* ── Scanner de código (GS1 compuesto o plano) — ISS-127 F3 ─────────────── */}
      {showScanner && (
        <BarcodeScanner
          title="Escaneá un código (GS1 o barras)"
          onDetected={handleScanRecepcion}
          onClose={() => setShowScanner(false)}
        />
      )}

      {/* ── Modal scan ticket ────────────────────────────────────────────────── */}
      {showScanModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-2">
                <Camera size={18} className="text-accent" />
                <h2 className="font-semibold text-primary">Escanear ticket de compra</h2>
              </div>
              <button onClick={() => { setShowScanModal(false); setScanStep('upload'); setScanItems([]) }}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6">

              {/* Step: upload */}
              {scanStep === 'upload' && (
                <div className="space-y-4">
                  <p className="text-sm text-muted">Fotografiá o subí el ticket del supermercado. Genesis360 va a detectar los productos, cantidades y precios automáticamente.</p>
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="flex flex-col items-center justify-center gap-3 h-48 border-2 border-dashed border-gray-200 dark:border-gray-600 rounded-2xl cursor-pointer hover:border-accent hover:bg-accent/5 transition-all">
                    <div className="w-12 h-12 bg-accent/10 rounded-xl flex items-center justify-center">
                      <Upload size={22} className="text-accent" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium text-primary">Tocá para seleccionar imagen</p>
                      <p className="text-xs text-muted mt-0.5">O usá la cámara directamente</p>
                    </div>
                  </div>
                  <button onClick={() => fileInputRef.current?.click()}
                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-accent text-white rounded-xl text-sm font-medium hover:bg-accent/90 transition-colors">
                    <Camera size={15} /> Tomar foto / seleccionar imagen
                  </button>
                </div>
              )}

              {/* Step: scanning */}
              {scanStep === 'scanning' && (
                <div className="space-y-4">
                  {scanPreviewUrl && (
                    <img src={scanPreviewUrl} alt="Ticket" className="w-full max-h-48 object-contain rounded-xl border border-gray-200 dark:border-gray-700" />
                  )}
                  <div className="flex flex-col items-center gap-3 py-6">
                    <Loader2 size={32} className="text-accent animate-spin" />
                    <p className="text-sm font-medium text-primary">Analizando ticket...</p>
                    <p className="text-xs text-muted">Claude está detectando los productos y precios</p>
                  </div>
                </div>
              )}

              {/* Step: results */}
              {scanStep === 'results' && scanItems.length > 0 && (() => {
                const encontrados = scanItems.filter(i => i.match).length
                const noEncontrados = scanItems.length - encontrados
                return (
                  <div className="space-y-4">
                    {scanPreviewUrl && (
                      <img src={scanPreviewUrl} alt="Ticket" className="w-full max-h-32 object-contain rounded-xl border border-gray-200 dark:border-gray-700" />
                    )}
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-xs px-2.5 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-full font-medium">
                        {encontrados} encontrado{encontrados !== 1 ? 's' : ''}
                      </span>
                      {noEncontrados > 0 && (
                        <span className="text-xs px-2.5 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-full font-medium">
                          {noEncontrados} no encontrado{noEncontrados !== 1 ? 's' : ''} — no se cargarán
                        </span>
                      )}
                    </div>
                    <div className="border border-gray-100 dark:border-gray-700 rounded-xl overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 dark:bg-gray-700/50">
                          <tr>
                            <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 w-6"></th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">Producto</th>
                            <th className="px-3 py-2 text-center font-semibold text-gray-500 dark:text-gray-400 w-16">Cant.</th>
                            <th className="px-3 py-2 text-right font-semibold text-gray-500 dark:text-gray-400 w-24">Precio unit.</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                          {scanItems.map(item => (
                            <tr key={item._key} className={item.match ? '' : 'opacity-50'}>
                              <td className="px-3 py-2.5">
                                {item.match
                                  ? <CheckCircle size={14} className="text-green-500" />
                                  : <XCircle size={14} className="text-gray-300 dark:text-gray-600" />}
                              </td>
                              <td className="px-3 py-2.5">
                                <p className="font-medium text-primary leading-tight">{item.match?.nombre ?? item.nombre_scan}</p>
                                {item.match && item.nombre_scan.toLowerCase() !== item.match.nombre.toLowerCase() && (
                                  <p className="text-gray-400 dark:text-gray-500 leading-tight">del ticket: {item.nombre_scan}</p>
                                )}
                                {!item.match && <p className="text-amber-500 dark:text-amber-400 leading-tight">No está en tu catálogo</p>}
                              </td>
                              <td className="px-3 py-2.5 text-center">
                                <input type="number" min="1" value={item.cantidad}
                                  onChange={e => setScanItems(prev => prev.map(i => i._key === item._key ? { ...i, cantidad: Math.max(1, parseInt(e.target.value) || 1) } : i))}
                                  className="w-14 text-center border border-gray-200 dark:border-gray-600 rounded-lg px-1 py-0.5 bg-transparent focus:outline-none focus:border-accent" />
                              </td>
                              <td className="px-3 py-2.5 text-right">
                                <input type="number" min="0" step="0.01" value={item.precio_unitario}
                                  onChange={e => setScanItems(prev => prev.map(i => i._key === item._key ? { ...i, precio_unitario: parseFloat(e.target.value) || 0 } : i))}
                                  className="w-24 text-right border border-gray-200 dark:border-gray-600 rounded-lg px-1 py-0.5 bg-transparent focus:outline-none focus:border-accent" />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {noEncontrados > 0 && (
                      <p className="text-xs text-muted">Los productos no encontrados no se agregan. Creálos en el módulo Productos y volvé a escanear.</p>
                    )}
                  </div>
                )
              })()}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-700">
              <button onClick={() => { setShowScanModal(false); setScanStep('upload'); setScanItems([]) }}
                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                Cancelar
              </button>
              {scanStep === 'results' && (
                <button onClick={cargarScanAlFormulario} disabled={scanItems.filter(i => i.match).length === 0}
                  className="flex items-center gap-2 px-5 py-2 bg-accent text-white text-sm font-medium rounded-xl hover:bg-accent/90 disabled:opacity-50 transition-colors">
                  <CheckCircle size={15} />
                  Cargar {scanItems.filter(i => i.match).length} producto{scanItems.filter(i => i.match).length !== 1 ? 's' : ''} al formulario
                </button>
              )}
              {scanStep === 'upload' && (
                <button onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 px-5 py-2 bg-accent text-white text-sm font-medium rounded-xl hover:bg-accent/90 transition-colors">
                  <Camera size={15} /> Seleccionar imagen
                </button>
              )}
            </div>
          </div>
        </div>
      )}

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
