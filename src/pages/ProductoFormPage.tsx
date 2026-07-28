import imageCompression from 'browser-image-compression'
import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Upload, X, RefreshCw, Package, Copy, DollarSign, QrCode, Sparkles, Camera, ShoppingBag, ChevronDown, ChevronUp, ScanLine, Plus, Trash2, Check, Boxes, ExternalLink, AlertTriangle } from 'lucide-react'
import { BarcodeScanner } from '@/components/BarcodeScanner'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { puedeVerCosto } from '@/lib/permisosCosto'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'
import { logActividad } from '@/lib/actividadLog'
import { usePlanLimits } from '@/hooks/usePlanLimits'
import { useModoOperacion } from '@/hooks/useModoOperacion'
import { moduloSoloLectura } from '@/lib/permisosModulo'
import { useCotizacion } from '@/hooks/useCotizacion'
import { PlanLimitModal } from '@/components/PlanLimitModal'
import { REGLAS_INVENTARIO } from '@/lib/rebajeSort'
import { agruparPorFamilia, mapearLegacyAFisica, ETIQUETA_FAMILIA, FAMILIAS_FISICAS, type UnidadFisica } from '@/lib/unidadMedidaFisica'
import { OPERADORES_TIER, type TierOperador } from '@/lib/tiers'
import { calcularSiguienteSKU } from '@/lib/skuAuto'
import { ProductoQR } from '@/components/ProductoQR'
import { ReasignarStockVarianteModal } from '@/components/ReasignarStockVarianteModal'
import { Toggle } from '@/components/Toggle'
import toast from 'react-hot-toast'

const UNIDADES = ['unidad', 'kg', 'g', 'litro', 'ml', 'metro', 'cm', 'caja', 'pack', 'docena']

function generateSKU(nombre: string): string {
  const prefix = nombre.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4).padEnd(4, 'X')
  const suffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0')
  return `${prefix}-${suffix}`
}

export default function ProductoFormPage() {
  const { id } = useParams()
  const isEditing = !!id
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { tenant, user, sucursales } = useAuthStore()
  const { sucursalId } = useSucursalFilter()
  const { limits } = usePlanLimits()
  const { cotizacion: cotizacionNum } = useCotizacion()
  const [showLimitModal, setShowLimitModal] = useState(false)
  const [showQR, setShowQR] = useState(false)

  const [form, setForm] = useState({
    nombre: '', sku: '', descripcion: '', categoria_id: '', proveedor_id: '',
    ubicacion_id: '', estado_id: '', precio_costo: '', precio_venta: '', stock_actual: '',
    stock_minimo: '', unidad_medida: 'unidad', unidad_medida_base_id: '', codigo_barras: '', activo: true,
    tiene_series: false, tiene_lote: false, tiene_vencimiento: false, es_kit: false,
    regla_inventario: '', aging_profile_id: '', margen_objetivo: '', alicuota_iva: '21',
    // Nuevos atributos
    marca: '',
    shelf_life_dias: '',
    tiene_pais_origen: false,
    tiene_talle: false,
    tiene_color: false,
    tiene_encaje: false,
    tiene_formato: false,
    tiene_sabor_aroma: false,
    // Marketplace
    publicado_marketplace: false, precio_marketplace: '', stock_reservado_marketplace: '0',
    descripcion_marketplace: '',
    // G5 — precio en USD + moneda de venta
    precio_usd: '', moneda_venta: 'local',
    // ISS-174 — peso/medidas para cotizar envíos (fuente 'producto')
    peso_kg: '', largo_cm: '', ancho_cm: '', alto_cm: '',
  })
  const [showMarketplace, setShowMarketplace] = useState(false)
  const [showMayorista, setShowMayorista] = useState(false)
  type TierForm = { _key: string; cantidad_minima: string; precio: string; descripcion: string; operador: TierOperador }
  const [tiersForm, setTiersForm] = useState<TierForm[]>([])
  // Stock mínimo por sucursal (solo cuando editando)
  const [stockMinimosSucursal, setStockMinimosSucursal] = useState<Record<string, string>>({})
  const [savingMinimos, setSavingMinimos] = useState(false)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [existingImageUrl, setExistingImageUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<string | null>(null)
  const [scanPhotoCount, setScanPhotoCount] = useState(0)
  const [barcodeScannerOpen, setBarcodeScannerOpen] = useState(false)
  const [skuTaken, setSkuTaken] = useState(false)

  // USD mode (usa cotización global del sidebar)
  const [usdModoCosto, setUsdModoCosto] = useState(false)
  const [usdModoVenta, setUsdModoVenta] = useState(false)
  const [usdInputCosto, setUsdInputCosto] = useState('')
  const [usdInputVenta, setUsdInputVenta] = useState('')

  // Variantes madre/hijo (rediseño UoM Fase 3, mig 305)
  const [productoPadreId, setProductoPadreId] = useState<string | null>(null)
  const [varianteDiferenciador, setVarianteDiferenciador] = useState('')
  const [crearVarianteAbierto, setCrearVarianteAbierto] = useState(false)
  const [nuevaVarianteDif, setNuevaVarianteDif] = useState('')
  // Modal de reparto del stock "sin variante asignada" (Fase 4, mig 309)
  const [reasignarAbierto, setReasignarAbierto] = useState(false)

  // "Atributos de variante" (tiene_talle/color/etc.) COEXISTE con madre/hijo (decisión Eje A de
  // GO): son dos formas de manejar variantes y cada tenant/producto elige. Ya no se bloquean.
  const ATRIBUTOS_VARIANTE_CAMPOS = ['tiene_talle', 'tiene_color', 'tiene_encaje', 'tiene_formato', 'tiene_sabor_aroma'] as const
  const toggleAtributoVariante = (campo: typeof ATRIBUTOS_VARIANTE_CAMPOS[number], checked: boolean) => {
    setForm(p => ({ ...p, [campo]: checked }))
  }

  const { data: categorias = [] } = useQuery({
    queryKey: ['categorias', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('categorias').select('*').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
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

  const { data: ubicaciones = [] } = useQuery({
    queryKey: ['ubicaciones', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('ubicaciones').select('*').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant,
  })

  // Ubicación predeterminada para la sucursal activa en el header
  const [ubicSucursalActiva, setUbicSucursalActiva] = useState('')
  useQuery({
    queryKey: ['producto-ubicacion-sucursal', id, sucursalId],
    queryFn: async () => {
      if (!sucursalId) return null
      const { data } = await supabase.from('producto_ubicacion_sucursal')
        .select('ubicacion_id').eq('producto_id', id!).eq('sucursal_id', sucursalId).maybeSingle()
      setUbicSucursalActiva((data as any)?.ubicacion_id ?? '')
      return data
    },
    enabled: !!id && !!sucursalId,
  })

  const { data: estados = [] } = useQuery({
    queryKey: ['estados_inventario', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('estados_inventario').select('*').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant,
  })

  const { data: agingProfiles = [] } = useQuery({
    queryKey: ['aging_profiles', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('aging_profiles').select('id, nombre').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant,
  })

  // Fase 1 UoM: catálogo de unidades de medida FÍSICAS (familias + conversión universal, mig 303)
  const { data: unidadesFisicas = [] } = useQuery<UnidadFisica[]>({
    queryKey: ['unidades_medida_fisicas', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('unidades_medida_fisicas')
        .select('id, familia, nombre, simbolo, factor_base_familia, es_base_familia, permite_decimales')
        .eq('tenant_id', tenant!.id).eq('activo', true).order('orden')
      return (data ?? []) as UnidadFisica[]
    },
    enabled: !!tenant,
  })

  // Preselección de la UdM física: si el producto todavía no tiene FK (nuevo, o legacy sin
  // backfill), se resuelve del texto legacy (mismo mapeo que el backfill SQL de la mig 303).
  // Solo actúa si está vacío → nunca pisa una elección del usuario.
  useEffect(() => {
    if (unidadesFisicas.length === 0 || form.unidad_medida_base_id) return
    const m = mapearLegacyAFisica(form.unidad_medida, unidadesFisicas)
    if (m) setForm(p => p.unidad_medida_base_id ? p : { ...p, unidad_medida_base_id: m.id })
  }, [unidadesFisicas, form.unidad_medida, form.unidad_medida_base_id])

  const { data: tiersData = [] } = useQuery({
    queryKey: ['precios-mayorista', id],
    queryFn: async () => {
      const { data } = await supabase
        .from('producto_precios_mayorista')
        .select('*')
        .eq('producto_id', id!)
        .order('orden')
      return data ?? []
    },
    enabled: isEditing && !!tenant,
  })

  // Rediseño UoM Fase 2 (mig 304) — precio canónico por unidad BASE. Cargamos la presentación
  // base para etiquetar los campos de precio ("por Unidad"). Ya NO hay ancla por posición.
  const { data: presentaciones = [] } = useQuery({
    queryKey: ['producto-presentaciones', id],
    queryFn: async () => {
      const { data } = await supabase.from('producto_presentaciones')
        .select('orden, etiqueta, factor_base, es_base')
        .eq('producto_id', id!).order('orden')
      return (data ?? []) as any[]
    },
    enabled: isEditing && !!tenant,
  })
  const presentacionBase = presentaciones.find((p: any) => p.es_base) ?? null

  const { data: stockMinimosSucursalData = [] } = useQuery({
    queryKey: ['producto-stock-minimo-sucursal', id],
    queryFn: async () => {
      const { data } = await supabase
        .from('producto_stock_minimo_sucursal')
        .select('*')
        .eq('tenant_id', tenant!.id)
        .eq('producto_id', id!)
      return data ?? []
    },
    enabled: isEditing && !!tenant,
  })

  // Madre (si este producto es hijo)
  const { data: madre = null } = useQuery({
    queryKey: ['producto-madre', productoPadreId],
    queryFn: async () => {
      const { data } = await supabase.from('productos').select('id, nombre').eq('id', productoPadreId!).maybeSingle()
      return data as { id: string; nombre: string } | null
    },
    enabled: !!productoPadreId,
  })

  // Hijos de ESTE producto (si es madre) — para mostrar/navegar sus variantes
  const { data: hijos = [] } = useQuery({
    queryKey: ['producto-hijos', id],
    queryFn: async () => {
      const { data } = await supabase.from('productos')
        .select('id, nombre, sku, variante_diferenciador, precio_venta, stock_actual, activo')
        .eq('producto_padre_id', id!).order('nombre')
      return data ?? []
    },
    enabled: isEditing && !!tenant,
  })

  // Hermanos (otras variantes de la misma madre) — si este producto es hijo
  const { data: hermanos = [] } = useQuery({
    queryKey: ['producto-hermanos', productoPadreId, id],
    queryFn: async () => {
      const { data } = await supabase.from('productos')
        .select('id, nombre, sku, variante_diferenciador')
        .eq('producto_padre_id', productoPadreId!).neq('id', id!).order('nombre')
      return data ?? []
    },
    enabled: !!productoPadreId && !!id,
  })

  const esHijo = !!productoPadreId
  const esMadre = hijos.length > 0

  // Stock "sin variante asignada" (Fase 4, mig 309): el que quedó colgando de la MADRE cuando se
  // le crearon variantes. Contable pero NO vendible → hay que repartirlo entre los hijos.
  // Sin filtro de sucursal: si no, quedaría stock invisible para el usuario parado en otra.
  const { data: stockSinAsignar = 0 } = useQuery({
    queryKey: ['stock-sin-variante-total', id],
    queryFn: async () => {
      // 🛑 En productos serializados el stock lo cuentan las SERIES: `inventario_lineas.cantidad`
      // es decorativa (el ingreso crea la línea en 0 y carga las series aparte). Contar la
      // cantidad de la línea acá daría un número que no es el stock real.
      // `tiene_series` se lee acá adentro y no de `productoData` porque esta query se declara
      // ANTES que esa (orden de hooks).
      const { data: prod } = await supabase.from('productos')
        .select('tiene_series').eq('id', id!).maybeSingle()
      if ((prod as any)?.tiene_series) {
        const { count } = await supabase.from('inventario_series')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenant!.id).eq('producto_id', id!)
          .eq('activo', true).eq('reservado', false)
        return count ?? 0
      }
      const { data } = await supabase.from('inventario_lineas')
        .select('cantidad').eq('tenant_id', tenant!.id).eq('producto_id', id!)
        .eq('activo', true).gt('cantidad', 0)
      return (data ?? []).reduce((a: number, l: any) => a + (l.cantidad ?? 0), 0)
    },
    enabled: isEditing && !!tenant && esMadre,
  })

  useEffect(() => {
    if (tiersData.length > 0) {
      setTiersForm(tiersData.map((t: any) => ({
        _key: t.id,
        cantidad_minima: String(t.cantidad_minima),
        precio: String(t.precio),
        descripcion: t.descripcion ?? '',
        operador: (t.operador ?? '>=') as TierOperador,
      })))
      setShowMayorista(true)
    }
  }, [tiersData])

  // Inicializar los valores editables cuando llegan los datos
  useEffect(() => {
    if (stockMinimosSucursalData.length > 0) {
      const map: Record<string, string> = {}
      stockMinimosSucursalData.forEach((r: any) => {
        map[r.sucursal_id] = String(r.stock_minimo)
      })
      setStockMinimosSucursal(map)
    }
  }, [stockMinimosSucursalData])

  const { data: productoData } = useQuery({
    queryKey: ['producto', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('productos').select('*').eq('id', id).single()
      if (error) throw error
      return data
    },
    enabled: isEditing,
    staleTime: 0, // siempre re-fetch al navegar a esta página
  })

  useEffect(() => {
    if (productoData && !loaded) {
      setForm({
        nombre: productoData.nombre, sku: productoData.sku, descripcion: productoData.descripcion ?? '',
        categoria_id: productoData.categoria_id ?? '', proveedor_id: productoData.proveedor_id ?? '',
        ubicacion_id: productoData.ubicacion_id ?? '', estado_id: productoData.estado_id ?? '',
        precio_costo: productoData.precio_costo.toString(),
        precio_venta: productoData.precio_venta.toString(), stock_actual: productoData.stock_actual.toString(),
        stock_minimo: productoData.stock_minimo.toString(), unidad_medida: productoData.unidad_medida,
        unidad_medida_base_id: (productoData as any).unidad_medida_base_id ?? '',
        codigo_barras: productoData.codigo_barras ?? '', activo: productoData.activo,
        tiene_series: productoData.tiene_series ?? false,
        tiene_lote: productoData.tiene_lote ?? false,
        tiene_vencimiento: productoData.tiene_vencimiento ?? false,
        es_kit: productoData.es_kit ?? false,
        regla_inventario: productoData.regla_inventario ?? '',
        aging_profile_id: productoData.aging_profile_id ?? '',
        margen_objetivo: productoData.margen_objetivo != null ? productoData.margen_objetivo.toString() : '',
        // El numeric de Postgres llega como "21.00"/"10.50"/"0.00"; normalizar a
        // "21"/"10.5"/"0" para que matchee las opciones del <select> (si no, el campo
        // queda en blanco al editar y parece que la alícuota guardada "se perdió").
        alicuota_iva: String(parseFloat(String(productoData.alicuota_iva ?? 21))),
        // Nuevos atributos
        marca: productoData.marca ?? '',
        shelf_life_dias: productoData.shelf_life_dias?.toString() ?? '',
        tiene_pais_origen: productoData.tiene_pais_origen ?? false,
        tiene_talle: productoData.tiene_talle ?? false,
        tiene_color: productoData.tiene_color ?? false,
        tiene_encaje: productoData.tiene_encaje ?? false,
        tiene_formato: productoData.tiene_formato ?? false,
        tiene_sabor_aroma: productoData.tiene_sabor_aroma ?? false,
        // Marketplace
        publicado_marketplace: productoData.publicado_marketplace ?? false,
        precio_marketplace: productoData.precio_marketplace != null ? productoData.precio_marketplace.toString() : '',
        precio_usd: (productoData as any).precio_usd != null ? (productoData as any).precio_usd.toString() : '',
        moneda_venta: (productoData as any).moneda_venta ?? 'local',
        stock_reservado_marketplace: (productoData.stock_reservado_marketplace ?? 0).toString(),
        descripcion_marketplace: productoData.descripcion_marketplace ?? '',
        peso_kg:  (productoData as any).peso_kg  != null ? (productoData as any).peso_kg.toString()  : '',
        largo_cm: (productoData as any).largo_cm != null ? (productoData as any).largo_cm.toString() : '',
        ancho_cm: (productoData as any).ancho_cm != null ? (productoData as any).ancho_cm.toString() : '',
        alto_cm:  (productoData as any).alto_cm  != null ? (productoData as any).alto_cm.toString()  : '',
      })
      if (productoData.publicado_marketplace) setShowMarketplace(true)
      if (productoData.imagen_url) setExistingImageUrl(productoData.imagen_url)
      setProductoPadreId((productoData as any).producto_padre_id ?? null)
      setVarianteDiferenciador((productoData as any).variante_diferenciador ?? '')
      setLoaded(true)
    }
  }, [productoData])

  // SKU uniqueness check (debounced, excludes current product when editing)
  useEffect(() => {
    const sku = form.sku.trim().toUpperCase()
    if (!sku || !tenant) { setSkuTaken(false); return }
    const timer = setTimeout(async () => {
      let q = supabase.from('productos').select('id').eq('tenant_id', tenant.id).eq('sku', sku)
      if (isEditing && id) q = q.neq('id', id)
      const { data } = await q.maybeSingle()
      setSkuTaken(!!data)
    }, 400)
    return () => clearTimeout(timer)
  }, [form.sku, tenant, isEditing, id])

  const ivaFactor = 1 + (parseFloat(form.alicuota_iva) || 0) / 100

  // Markup = (precio neto sin IVA − costo) / costo × 100
  // precio_venta en DB siempre incluye IVA → hay que extraer el neto
  const margen = (() => {
    const costo = parseFloat(form.precio_costo)
    const venta = parseFloat(form.precio_venta)
    if (costo > 0 && venta > 0) {
      const neto = venta / ivaFactor
      return (((neto - costo) / costo) * 100).toFixed(1)
    }
    return null
  })()

  // Precio sugerido según margen objetivo: costo × (1 + obj%) × (1 + IVA%)
  const precioSugerido = (() => {
    const costo = parseFloat(form.precio_costo)
    const obj = parseFloat(form.margen_objetivo)
    if (costo > 0 && obj > 0) return (costo * (1 + obj / 100) * ivaFactor)
    return null
  })()

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const compressed = file.size > 1.5 * 1024 * 1024
      ? await imageCompression(file, { maxSizeMB: 1.5, maxWidthOrHeight: 1200, useWebWorker: true })
      : file
    setImageFile(compressed)
    setImagePreview(URL.createObjectURL(compressed))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (moduloSoloLectura(user, 'inventario')) return toast.error('Tu rol tiene acceso de solo lectura en Productos.')
    if (!form.nombre.trim()) return toast.error('El nombre es obligatorio')
    if (skuTaken) return toast.error('El SKU ya está en uso. Elegí otro o dejalo vacío para autogenerar.')

    // Verificar límite de productos solo al crear (no al editar)
    if (!isEditing && limits && !limits.puede_crear_producto) {
      setShowLimitModal(true)
      return
    }

    setSaving(true)
    try {
      // Auto-generar SKU secuencial si está vacío
      let skuFinal = form.sku.trim().toUpperCase()
      if (!skuFinal) {
        const { data: skuRows } = await supabase
          .from('productos')
          .select('sku')
          .eq('tenant_id', tenant!.id)
          .like('sku', 'SKU-%')
        skuFinal = calcularSiguienteSKU((skuRows ?? []).map((r: any) => r.sku))
        setForm(p => ({ ...p, sku: skuFinal }))
      }

      let imagen_url = existingImageUrl
      if (imageFile) {
        const ext = imageFile.name.split('.').pop()
        const path = `${tenant!.id}/${Date.now()}.${ext}`
        const { error: uploadError } = await supabase.storage.from('productos').upload(path, imageFile, { upsert: true })
        if (uploadError) throw uploadError
        const { data: urlData } = supabase.storage.from('productos').getPublicUrl(path)
        imagen_url = urlData.publicUrl
      }

      // El nombre de un hijo lo compone el trigger de DB (madre.nombre — diferenciador, mig 305):
      // acá mandamos el nombre tal cual y el diferenciador; el trigger BEFORE lo recompone.
      if (productoPadreId && !varianteDiferenciador.trim()) {
        toast.error('El diferenciador de la variante es obligatorio (ej. "Rojo / M").')
        setSaving(false)
        return
      }
      const nombreFinal = form.nombre.trim()

      const payload = {
        tenant_id: tenant!.id,
        nombre: nombreFinal, sku: skuFinal,
        descripcion: form.descripcion.trim() || null,
        categoria_id: form.categoria_id || null, proveedor_id: form.proveedor_id || null,
        ubicacion_id: form.ubicacion_id || null,
        estado_id: form.estado_id || null,
        precio_costo: Math.max(0, parseFloat(form.precio_costo) || 0),
        precio_venta: Math.max(0, parseFloat(form.precio_venta) || 0),
        precio_usd: form.precio_usd !== '' ? parseFloat(form.precio_usd) : null,
        moneda_venta: form.moneda_venta || 'local',
        peso_kg:  form.peso_kg  !== '' ? parseFloat(form.peso_kg)  : null,
        largo_cm: form.largo_cm !== '' ? parseFloat(form.largo_cm) : null,
        ancho_cm: form.ancho_cm !== '' ? parseFloat(form.ancho_cm) : null,
        alto_cm:  form.alto_cm  !== '' ? parseFloat(form.alto_cm)  : null,
        stock_minimo: parseInt(form.stock_minimo) || 0,
        unidad_medida: form.unidad_medida,
        unidad_medida_base_id: form.unidad_medida_base_id || null,
        codigo_barras: form.codigo_barras.trim() || null,
        imagen_url, activo: form.activo,
        tiene_series: form.tiene_series,
        tiene_lote: form.tiene_lote,
        tiene_vencimiento: form.tiene_vencimiento,
        es_kit: form.es_kit,
        regla_inventario: form.regla_inventario || null,
        aging_profile_id: form.aging_profile_id || null,
        margen_objetivo: form.margen_objetivo !== '' ? parseFloat(form.margen_objetivo) : null,
        // No usar `|| 21`: Exento es 0 y `0 || 21` lo guardaría como 21% (IVA fantasma).
        alicuota_iva: Number.isFinite(parseFloat(form.alicuota_iva)) ? parseFloat(form.alicuota_iva) : 21,
        // Nuevos atributos
        marca: form.marca.trim() || null,
        shelf_life_dias: form.shelf_life_dias ? parseInt(form.shelf_life_dias) : null,
        tiene_pais_origen: form.tiene_pais_origen,
        tiene_talle: form.tiene_talle,
        tiene_color: form.tiene_color,
        tiene_encaje: form.tiene_encaje,
        tiene_formato: form.tiene_formato,
        tiene_sabor_aroma: form.tiene_sabor_aroma,
        // Marketplace
        publicado_marketplace: form.publicado_marketplace,
        precio_marketplace: form.precio_marketplace !== '' ? parseFloat(form.precio_marketplace) : null,
        stock_reservado_marketplace: parseInt(form.stock_reservado_marketplace) || 0,
        descripcion_marketplace: form.descripcion_marketplace.trim() || null,
        // Variantes madre/hijo (rediseño UoM Fase 3): el diferenciador solo aplica a hijos.
        // El vínculo producto_padre_id se crea/rompe por la acción "Crear variante", no acá.
        variante_diferenciador: productoPadreId ? (varianteDiferenciador.trim() || null) : null,
      }
      let productoId: string = id ?? ''
      if (isEditing) {
        const { error } = await supabase.from('productos').update(payload).eq('id', id)
        if (error) throw error
        toast.success('Producto actualizado')
        logActividad({ entidad: 'producto', entidad_id: id, entidad_nombre: nombreFinal, accion: 'editar', pagina: '/productos' })
      } else {
        const { data: newProd, error } = await supabase.from('productos').insert(payload).select('id').single()
        if (error) { if (error.code === '23505') throw new Error('Ya existe un producto con ese SKU'); throw error }
        productoId = newProd.id
        toast.success('Producto creado')
        logActividad({ entidad: 'producto', entidad_nombre: nombreFinal, accion: 'crear', pagina: '/productos' })
      }

      // Guardar ubicación predeterminada para la sucursal activa
      if (productoId && sucursalId) {
        if (ubicSucursalActiva) {
          await supabase.from('producto_ubicacion_sucursal').upsert({
            tenant_id: tenant!.id, producto_id: productoId,
            sucursal_id: sucursalId, ubicacion_id: ubicSucursalActiva,
          }, { onConflict: 'producto_id,sucursal_id' })
        } else {
          // Si quedó vacío, borrar el registro para esta sucursal
          await supabase.from('producto_ubicacion_sucursal')
            .delete().eq('producto_id', productoId).eq('sucursal_id', sucursalId)
        }
      }

      // Sincronizar tiers de precio mayorista
      if (productoId) {
        await supabase.from('producto_precios_mayorista').delete().eq('producto_id', productoId)
        if (showMayorista) {
          const tiersValidos = tiersForm.filter(t => t.cantidad_minima && t.precio !== '')
          if (tiersValidos.length > 0) {
            // `orden` = índice en el form (el vendedor los ordena; gana el primer match, mig 306).
            const { error: tiersErr } = await supabase.from('producto_precios_mayorista').insert(
              tiersValidos.map((t, i) => ({
                tenant_id: tenant!.id,
                producto_id: productoId,
                cantidad_minima: parseInt(t.cantidad_minima),
                precio: parseFloat(t.precio),
                descripcion: t.descripcion.trim() || null,
                operador: t.operador,
                orden: i,
              }))
            )
            if (tiersErr) throw tiersErr
          }
        }
      }

      qc.invalidateQueries({ queryKey: ['productos'] })
      // Bug real encontrado por GO (2026-07-22): `['producto', id]` (la query de ESTE form,
      // distinta de la lista `['productos']` de arriba) quedaba con el snapshot de ANTES de
      // guardar. React Query igual la sirve de la caché al reabrir el producto (stale-while-
      // revalidate) mientras refetchea en segundo plano — pero el useEffect que siembra `form`
      // solo corre una vez (`!loaded`), así que se quedaba pegado para siempre con el valor
      // viejo (el guardado en DB sí había funcionado). `removeQueries` (no solo invalidate) saca
      // el snapshot viejo de la caché para que la próxima apertura arranque de cero, en vez de
      // mostrar el viejo mientras refetchea.
      if (isEditing) qc.removeQueries({ queryKey: ['producto', id] })
      navigate('/productos')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm(`¿Eliminar "${form.nombre}" definitivamente? Esta acción NO se puede deshacer — se borra el registro, no solo se desactiva. Si preferís conservarlo pero ocultarlo, usá el toggle "Activo / Inactivo" en su lugar.`)) return

    setDeleting(true)
    try {
      const { data, error } = await supabase.rpc('eliminar_productos_fisico', { p_ids: [id!] })
      if (error) { toast.error(error.message); return }

      const resultado = (data ?? [])[0]
      if (!resultado?.eliminado) {
        const motivo = resultado?.motivo ?? 'error desconocido'
        if (motivo === 'tiene_actividad') {
          // El bloqueo ya lo hizo el server (fn_producto_tiene_actividad). Acá solo lo EXPLICAMOS:
          // si lo que traba es stock, el cartel nombra la/las sucursal(es) — estar parado en una
          // sucursal con 0 no alcanza si otra todavía tiene unidades (Fase 4, mig 309).
          const { data: porSucursal } = await supabase.rpc('fn_stock_por_sucursal', { p_producto_ids: [id!] })
          const conStock = (porSucursal ?? []) as { sucursal_nombre: string; cantidad: number }[]
          if (conStock.length > 0) {
            const detalle = conStock.map(s => `${s.sucursal_nombre}: ${s.cantidad} u`).join(' · ')
            toast.error(`No se puede eliminar: todavía tiene stock en ${detalle}. Dejalo en 0 en TODAS las sucursales o usá el toggle "Activo / Inactivo".`, { duration: 9000 })
          } else {
            toast.error('No se puede eliminar: el producto tiene movimientos, ventas, compras u otra actividad registrada. Usá el toggle "Activo / Inactivo" para ocultarlo en su lugar.', { duration: 7000 })
          }
        } else {
          toast.error(`No se pudo eliminar: ${motivo}`)
        }
        return
      }

      toast.success('Producto eliminado')
      logActividad({ entidad: 'producto', entidad_id: id, entidad_nombre: form.nombre, accion: 'eliminar', pagina: '/productos' })
      qc.invalidateQueries({ queryKey: ['productos'] })
      navigate('/productos')
    } finally {
      setDeleting(false)
    }
  }

  // Crear variante (rediseño UoM Fase 3): agrega un hijo. Si este producto es standalone, se
  // convierte en madre (agrupador) y el hijo hereda su ficha; si ya es madre/hijo, agrega otra
  // variante bajo la misma madre. El nombre del hijo lo compone el trigger de DB.
  const handleCrearVariante = async () => {
    const dif = nuevaVarianteDif.trim()
    if (!dif) { toast.error('Poné un diferenciador para la variante (ej. "Rojo / M")'); return }
    if (!isEditing || !id || !tenant || !productoData) return
    const madreId = productoPadreId ?? id
    // Convertir un standalone CON stock en madre deja ese stock "sin variante asignada": sigue
    // contando en inventario pero NO se puede vender (el POS excluye a las madres agrupadoras).
    // Desde la Fase 4 se permite, avisando, y se resuelve con el modal de reparto (mig 309).
    const stockQuedaSinAsignar =
      !productoPadreId && !esMadre && Number((productoData as any).stock_actual ?? 0) > 0

    if (stockQuedaSinAsignar) {
      const stock = Number((productoData as any).stock_actual ?? 0)
      if (!confirm(
        `"${form.nombre}" tiene ${stock} unidad(es) de stock.\n\n` +
        `Al crear la primera variante este producto pasa a ser un AGRUPADOR: deja de venderse ` +
        `directamente y ese stock queda "sin variante asignada" — sigue contando en inventario, ` +
        `pero no se puede vender hasta que lo repartas entre las variantes.\n\n` +
        `Después de crearla vas a poder repartirlo desde la ficha del agrupador` +
        ((productoData as any).tiene_series
          ? `, eligiendo a qué variante va cada número de serie.

¿Seguimos?`
          : `.

¿Seguimos?`)
      )) return
    }
    setSaving(true)
    try {
      const src = productoData as any
      const slug = dif.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 12) || 'VAR'
      const nuevoSku = `${src.sku}-${slug}-${crypto.randomUUID().slice(0, 4)}`
      const nuevo = {
        tenant_id: tenant.id,
        nombre: dif,  // placeholder — el trigger BEFORE recompone a "madre — diferenciador"
        sku: nuevoSku,
        producto_padre_id: madreId,
        variante_diferenciador: dif,
        categoria_id: src.categoria_id ?? null,
        proveedor_id: src.proveedor_id ?? null,
        unidad_medida: src.unidad_medida ?? 'unidad',
        unidad_medida_base_id: src.unidad_medida_base_id ?? null,
        precio_venta: src.precio_venta ?? 0,
        precio_costo: src.precio_costo ?? 0,
        alicuota_iva: src.alicuota_iva ?? 21,
        stock_actual: 0,
        stock_minimo: src.stock_minimo ?? 0,
        activo: true,
      }
      const { data: created, error } = await supabase.from('productos').insert(nuevo).select('id').single()
      if (error) throw error
      toast.success('Variante creada')
      setCrearVarianteAbierto(false); setNuevaVarianteDif('')
      qc.invalidateQueries({ queryKey: ['productos'] })
      qc.removeQueries({ queryKey: ['producto', id] })
      navigate(`/productos/${created.id}/editar`)
    } catch (e: any) {
      toast.error(e.message || 'No se pudo crear la variante')
    } finally {
      setSaving(false)
    }
  }

  const handleDuplicate = async () => {
    if (!confirm(`¿Duplicar "${form.nombre}"? Se creará una copia con stock en 0.`)) return
    setSaving(true)
    try {
      const payload = {
        tenant_id: tenant!.id,
        nombre: `Copia de ${form.nombre}`,
        sku: generateSKU(`Copia ${form.nombre}`),
        descripcion: form.descripcion.trim() || null,
        categoria_id: form.categoria_id || null,
        proveedor_id: form.proveedor_id || null,
        ubicacion_id: form.ubicacion_id || null,
        estado_id: form.estado_id || null,
        precio_costo: Math.max(0, parseFloat(form.precio_costo) || 0),
        precio_venta: Math.max(0, parseFloat(form.precio_venta) || 0),
        precio_usd: form.precio_usd !== '' ? parseFloat(form.precio_usd) : null,
        moneda_venta: form.moneda_venta || 'local',
        peso_kg:  form.peso_kg  !== '' ? parseFloat(form.peso_kg)  : null,
        largo_cm: form.largo_cm !== '' ? parseFloat(form.largo_cm) : null,
        ancho_cm: form.ancho_cm !== '' ? parseFloat(form.ancho_cm) : null,
        alto_cm:  form.alto_cm  !== '' ? parseFloat(form.alto_cm)  : null,
        stock_minimo: parseInt(form.stock_minimo) || 0,
        unidad_medida: form.unidad_medida,
        codigo_barras: null,
        imagen_url: existingImageUrl,
        activo: true,
        tiene_series: form.tiene_series,
        tiene_lote: form.tiene_lote,
        tiene_vencimiento: form.tiene_vencimiento,
        es_kit: form.es_kit,
        regla_inventario: form.regla_inventario || null,
        aging_profile_id: form.aging_profile_id || null,
        margen_objetivo: form.margen_objetivo !== '' ? parseFloat(form.margen_objetivo) : null,
      }
      const { data: newProd, error } = await supabase.from('productos').insert(payload).select().single()
      if (error) throw error
      toast.success('Producto duplicado')
      logActividad({ entidad: 'producto', entidad_id: newProd?.id, entidad_nombre: payload.nombre, accion: 'crear', campo: 'duplicado_de', valor_anterior: form.nombre, pagina: '/productos' })
      qc.invalidateQueries({ queryKey: ['productos'] })
      navigate(newProd?.id ? `/productos/${newProd.id}/editar` : '/productos')
    } catch (err: any) {
      toast.error(err.message ?? 'Error al duplicar')
    } finally {
      setSaving(false)
    }
  }

  const processScanPhoto = async (file: File, isSecondPhoto: boolean) => {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve((reader.result as string).split(',')[1])
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
    const media_type = file.type || 'image/jpeg'

    const { data, error } = await supabase.functions.invoke('scan-product', {
      body: { image: base64, media_type },
    })
    if (error) throw error
    if (data?.error) throw new Error(data.error)

    // Combinar con lo ya detectado: la segunda foto completa sin pisar campos ya llenos
    const fields: string[] = []
    setForm(prev => {
      const next = { ...prev }
      if (data.nombre        && (!isSecondPhoto || !prev.nombre))        { next.nombre = data.nombre;               fields.push('nombre') }
      if (data.descripcion   && (!isSecondPhoto || !prev.descripcion))   { next.descripcion = data.descripcion;     fields.push('descripción') }
      if (data.unidad_medida && (!isSecondPhoto || !prev.unidad_medida)) { next.unidad_medida = data.unidad_medida; fields.push('unidad') }
      if (data.codigo_barras && (!isSecondPhoto || !prev.codigo_barras)) { next.codigo_barras = data.codigo_barras; fields.push('código de barras') }
      if (data.nombre && !prev.nombre) next.sku = generateSKU(data.nombre)
      return next
    })

    // Solo la primera foto se usa como imagen del producto
    if (!isSecondPhoto) {
      setImageFile(file)
      setImagePreview(URL.createObjectURL(file))
    }

    return { fields, fuente: data.fuente }
  }

  const handleScanPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    const isSecondPhoto = scanPhotoCount === 1
    setScanning(true)
    if (!isSecondPhoto) setScanResult(null)

    try {
      const { fields, fuente } = await processScanPhoto(file, isSecondPhoto)
      const fuente_label = fuente === 'open_food_facts' ? 'Open Food Facts' : 'IA'
      const prefix = isSecondPhoto ? 'Foto 2 agregó' : `Detectado por ${fuente_label}`
      setScanResult(fields.length > 0
        ? `${prefix}: ${fields.join(', ')}`
        : isSecondPhoto ? 'Foto 2: sin datos nuevos detectados' : 'No se detectaron datos en la imagen'
      )
      setScanPhotoCount(prev => prev + 1)
    } catch (err: any) {
      toast.error(err.message ?? 'No se pudo analizar la imagen')
    } finally {
      setScanning(false)
    }
  }

  const canEdit = user?.rol === 'DUEÑO' || user?.rol === 'SUPERVISOR' || user?.rol === 'SUPER_USUARIO'
  const verCosto = puedeVerCosto(user?.rol)  // G4 — costo/margen oculto para CAJERO/DEPOSITO
  const { avanzado: modoAvanzado } = useModoOperacion()
  // Producto heredado con tracking: en básico se muestra solo-lectura (los flujos de datos se conservan)
  const tieneTrackingActivo = form.tiene_series || form.tiene_lote || form.tiene_vencimiento
  const mostrarTracking = modoAvanzado || tieneTrackingActivo

  const saveMinimos = async () => {
    if (!id || !tenant) return
    setSavingMinimos(true)
    try {
      for (const suc of sucursales) {
        const val = parseInt(stockMinimosSucursal[suc.id] ?? '')
        if (isNaN(val)) continue
        await supabase.from('producto_stock_minimo_sucursal').upsert({
          tenant_id: tenant.id,
          producto_id: id,
          sucursal_id: suc.id,
          stock_minimo: val,
        }, { onConflict: 'tenant_id,producto_id,sucursal_id' })
      }
      toast.success('Mínimos por sucursal guardados')
      qc.invalidateQueries({ queryKey: ['producto-stock-minimo-sucursal', id] })
    } catch {
      toast.error('Error al guardar mínimos')
    } finally {
      setSavingMinimos(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {showLimitModal && limits && (
        <PlanLimitModal tipo="producto" limits={limits} onClose={() => setShowLimitModal(false)} />
      )}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/productos')} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
          <ArrowLeft size={20} className="text-gray-600 dark:text-gray-400" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-primary">{isEditing ? 'Editar producto' : 'Nuevo producto'}</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">{isEditing ? 'Modificá los datos del producto' : 'Completá los datos del nuevo producto'}</p>
        </div>
        {!isEditing && canEdit && (
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setBarcodeScannerOpen(true)}
                title="Escanear código de barras"
                className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-semibold border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-accent-text hover:border-accent-text transition-all bg-white dark:bg-gray-800">
                <ScanLine size={15} /> Escanear barcode
              </button>
            <label className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold cursor-pointer transition-all
              ${scanning
                ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-400 cursor-not-allowed'
                : scanPhotoCount === 0
                  ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-700 hover:to-blue-700 shadow-sm'
                  : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-700'}`}>
              {scanning
                ? <><RefreshCw size={15} className="animate-spin" /> Analizando...</>
                : scanPhotoCount === 0
                  ? <><Sparkles size={15} /> Completar desde foto</>
                  : <><Camera size={15} /> Agregar 2da foto</>}
              <input type="file" accept="image/*" capture="environment" className="hidden"
                disabled={scanning} onChange={handleScanPhoto} />
            </label>
            </div>
            {scanPhotoCount > 0 && (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {scanPhotoCount === 1 ? 'Foto 1 ✓ — podés agregar el reverso' : 'Foto 1 ✓ · Foto 2 ✓'}
              </span>
            )}
          </div>
        )}
        {isEditing && canEdit && (
          <div className="flex gap-2">
            <button type="button" onClick={handleDuplicate} disabled={saving}
              className="flex items-center gap-2 px-3 py-2 text-sm text-primary border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all disabled:opacity-50">
              <Copy size={15} /> Duplicar
            </button>
            <button type="button" onClick={handleDelete} disabled={deleting}
              className="flex items-center gap-2 px-3 py-2 text-sm text-red-500 border border-red-200 rounded-xl hover:bg-red-50 dark:bg-red-900/20 transition-all disabled:opacity-50">
              {deleting ? 'Eliminando...' : 'Eliminar'}
            </button>
          </div>
        )}
      </div>

      {scanResult && (
        <div className="flex items-center gap-2 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 rounded-xl px-4 py-3 text-sm text-purple-700">
          <Sparkles size={15} className="flex-shrink-0" />
          <span>{scanResult}. Revisá y completá los campos restantes.</span>
          <button type="button" onClick={() => setScanResult(null)} className="ml-auto text-purple-400 hover:text-purple-600">
            <X size={14} />
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ── Columna principal ── */}
          <div className="lg:col-span-2 space-y-5">

            {/* Card 1 — Identificación */}
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 space-y-4">
              <h2 className="font-semibold text-gray-700 dark:text-gray-300">Identificación</h2>

              {/* Nombre */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nombre <span className="text-red-500">*</span></label>
                <input type="text" value={form.nombre} disabled={!canEdit}
                  onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))}
                  placeholder="Ej: Tornillo hexagonal 1/4"
                  className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text focus:ring-2 focus:ring-accent-text/20 disabled:bg-gray-50 dark:bg-gray-700" />
              </div>

              {/* SKU | Código de barras */}
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">SKU <span className="text-gray-400 text-xs font-normal">(autogenera si vacío)</span></label>
                  <div className="flex gap-2">
                    <input type="text" value={form.sku} disabled={!canEdit}
                      onChange={e => setForm(p => ({ ...p, sku: e.target.value.toUpperCase() }))}
                      placeholder="Ej: SKU-00001"
                      className={`flex-1 px-4 py-2.5 border rounded-xl text-sm font-mono focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700 ${skuTaken ? 'border-red-400 dark:border-red-500' : 'border-gray-200 dark:border-gray-700'}`} />
                    {!isEditing && (
                      <button type="button" onClick={() => setForm(p => ({ ...p, sku: generateSKU(form.nombre) }))}
                        title="Generar SKU automático"
                        className="px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:text-primary transition-colors">
                        <RefreshCw size={16} />
                      </button>
                    )}
                  </div>
                  {skuTaken && <p className="text-xs text-red-500 mt-1">Este SKU ya está en uso por otro producto.</p>}
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Código de barras</label>
                  <input type="text" value={form.codigo_barras} disabled={!canEdit}
                    onChange={e => setForm(p => ({ ...p, codigo_barras: e.target.value }))}
                    placeholder="7791234567890"
                    className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-mono focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700" />
                </div>
              </div>

              {/* Marca */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Marca</label>
                <input type="text" value={form.marca} disabled={!canEdit}
                  onChange={e => setForm(p => ({ ...p, marca: e.target.value }))}
                  placeholder="Ej: Hellmans"
                  className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700" />
              </div>

              {/* Descripción */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descripción</label>
                <textarea value={form.descripcion} disabled={!canEdit} rows={2}
                  onChange={e => setForm(p => ({ ...p, descripcion: e.target.value }))}
                  placeholder="Descripción opcional..."
                  className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text resize-none disabled:bg-gray-50 dark:bg-gray-700" />
              </div>
            </div>

            {/* Card 2 — Clasificación */}
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 space-y-4">
              <h2 className="font-semibold text-gray-700 dark:text-gray-300">Clasificación</h2>

              {/* Categoría | Proveedor */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Categoría</label>
                  <select value={form.categoria_id} disabled={!canEdit}
                    onChange={e => setForm(p => ({ ...p, categoria_id: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700">
                    <option value="">Sin categoría</option>
                    {(categorias as any[]).map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Proveedor</label>
                  <select value={form.proveedor_id} disabled={!canEdit}
                    onChange={e => setForm(p => ({ ...p, proveedor_id: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700">
                    <option value="">Sin proveedor</option>
                    {(proveedores as any[]).map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                </div>
              </div>

              {/* Separador */}
              <hr className="border-gray-100 dark:border-gray-700" />

              {/* Toggle Activo / Inactivo */}
              <label className="flex items-center gap-3 cursor-pointer">
                <Toggle size="lg" colorOn="bg-green-500" checked={form.activo}
                  onChange={v => setForm(p => ({ ...p, activo: v }))}
                  aria-label="Activo / Inactivo" />
                <span className="text-sm text-gray-700 dark:text-gray-300">Activo / Inactivo</span>
              </label>
            </div>

            {/* Card 3 — Precios */}
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-gray-700 dark:text-gray-300">Precios</h2>
                {cotizacionNum > 0 ? (
                  <div className="flex items-center gap-1.5 bg-blue-50 dark:bg-blue-900/20 px-2.5 py-1 rounded-lg">
                    <DollarSign size={12} className="text-blue-400" />
                    <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                      $1 USD = ${cotizacionNum.toLocaleString('es-AR', { maximumFractionDigits: 0 })} ARS
                    </span>
                  </div>
                ) : (
                  <span className="text-xs text-gray-400 dark:text-gray-500">Sin cotización USD (configurar en el menú lateral)</span>
                )}
              </div>

              {/* Rediseño UoM Fase 2-bis (mig 307): el precio es SIEMPRE por unidad BASE. El
                  empaque es logística pura, sin precio propio: las presentaciones (Caja/Pallet)
                  cobran base × factor. El descuento por volumen se carga como precio mayorista
                  por cantidad (tiers), más abajo. */}
              {presentacionBase && presentaciones.length > 1 && (
                <p className="text-xs text-gray-500 dark:text-gray-400 bg-blue-50 dark:bg-blue-900/20 rounded-lg px-3 py-2">
                  Estos precios son por <strong>{presentacionBase.etiqueta}</strong> (unidad base). Las demás presentaciones
                  ({presentaciones.filter((p: any) => !p.es_base).map((p: any) => p.etiqueta).join(', ')}) cobran
                  base × factor. Para un precio por volumen, usá el precio mayorista por cantidad.
                </p>
              )}

              {/* Precios costo + venta con toggles ARS/USD */}
              {(() => {
                const cotizNum = cotizacionNum
                // Rediseño UoM Fase 2: los precios son por la unidad base; el sufijo lo aclara
                // solo si el producto tiene presentaciones (Caja/Pallet) sobre una base con nombre.
                const sufijoAncla = (presentacionBase && presentaciones.length > 1)
                  ? ` (por ${presentacionBase.etiqueta})` : ''
                const toggleCosto = () => {
                  if (!usdModoCosto && cotizNum > 0)
                    setUsdInputCosto(((parseFloat(form.precio_costo) || 0) / cotizNum).toFixed(2))
                  setUsdModoCosto(v => !v)
                }
                const toggleVenta = () => {
                  if (!usdModoVenta && cotizNum > 0)
                    setUsdInputVenta(((parseFloat(form.precio_venta) || 0) / cotizNum).toFixed(2))
                  setUsdModoVenta(v => !v)
                }
                return (
                  <div className={`grid ${verCosto ? 'grid-cols-2' : 'grid-cols-1'} gap-4`}>
                    {verCosto && (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Precio de costo{sufijoAncla}</label>
                        {cotizNum > 0 && canEdit && (
                          <button type="button" onClick={toggleCosto}
                            className="text-xs text-accent-text hover:underline">
                            {usdModoCosto ? 'Ingresar en ARS' : 'Ingresar en USD'}
                          </button>
                        )}
                      </div>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 text-sm font-medium">
                          {usdModoCosto ? 'USD' : '$'}
                        </span>
                        <input type="number" onWheel={e => e.currentTarget.blur()} min="0" step="0.01" disabled={!canEdit}
                          value={usdModoCosto ? usdInputCosto : form.precio_costo}
                          onChange={e => {
                            if (usdModoCosto && cotizNum > 0) {
                              setUsdInputCosto(e.target.value)
                              setForm(p => ({ ...p, precio_costo: ((parseFloat(e.target.value) || 0) * cotizNum).toString() }))
                            } else {
                              setForm(p => ({ ...p, precio_costo: e.target.value }))
                            }
                          }}
                          className="w-full pl-10 pr-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700" placeholder="0.00" />
                      </div>
                      {cotizNum > 0 && (parseFloat(form.precio_costo) || 0) > 0 && (
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                          {usdModoCosto
                            ? `= $${(parseFloat(form.precio_costo) || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })} ARS`
                            : `≈ USD ${((parseFloat(form.precio_costo) || 0) / cotizNum).toFixed(2)}`}
                        </p>
                      )}
                    </div>
                    )}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Precio de venta{sufijoAncla}</label>
                        {cotizNum > 0 && canEdit && (
                          <button type="button" onClick={toggleVenta}
                            className="text-xs text-accent-text hover:underline">
                            {usdModoVenta ? 'Ingresar en ARS' : 'Ingresar en USD'}
                          </button>
                        )}
                      </div>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 text-sm font-medium">
                          {usdModoVenta ? 'USD' : '$'}
                        </span>
                        <input type="number" onWheel={e => e.currentTarget.blur()} min="0" step="0.01" disabled={!canEdit}
                          value={usdModoVenta ? usdInputVenta : form.precio_venta}
                          onChange={e => {
                            if (usdModoVenta && cotizNum > 0) {
                              setUsdInputVenta(e.target.value)
                              setForm(p => ({ ...p, precio_venta: ((parseFloat(e.target.value) || 0) * cotizNum).toString() }))
                            } else {
                              setForm(p => ({ ...p, precio_venta: e.target.value }))
                            }
                          }}
                          className="w-full pl-10 pr-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700" placeholder="0.00" />
                      </div>
                      {cotizNum > 0 && (parseFloat(form.precio_venta) || 0) > 0 && (
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                          {usdModoVenta
                            ? `= $${(parseFloat(form.precio_venta) || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })} ARS`
                            : `≈ USD ${((parseFloat(form.precio_venta) || 0) / cotizNum).toFixed(2)}`}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })()}

              {verCosto && margen !== null && (
                <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium
                  ${parseFloat(margen) >= 0 ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'}`}>
                  Margen actual: <span className="font-bold">{margen}%</span>
                  {form.margen_objetivo !== '' && (() => {
                    const obj = parseFloat(form.margen_objetivo)
                    const actual = parseFloat(margen)
                    const ok = actual >= obj
                    return (
                      <span className={`text-xs ml-auto font-semibold ${ok ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                        {ok ? '▲' : '▼'} Objetivo: {obj}%
                      </span>
                    )
                  })()}
                  <span className="text-xs opacity-70">
                    (ganancia neta: ${(parseFloat(form.precio_venta) / ivaFactor - parseFloat(form.precio_costo)).toFixed(2)})
                  </span>
                </div>
              )}
              {verCosto && precioSugerido !== null && (
                <p className="text-xs text-blue-600 dark:text-blue-400 px-1">
                  💡 Precio sugerido con {form.margen_objetivo}% de margen{parseFloat(form.alicuota_iva) > 0 ? ` + IVA ${form.alicuota_iva}%` : ''}: <span className="font-semibold">${precioSugerido.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </p>
              )}

              {/* Alícuota IVA | Margen objetivo % */}
              <div className={`grid ${verCosto ? 'grid-cols-2' : 'grid-cols-1'} gap-4`}>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Alícuota IVA</label>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">IVA incluido en el precio de venta</p>
                  <select value={form.alicuota_iva} disabled={!canEdit}
                    onChange={e => setForm(p => ({ ...p, alicuota_iva: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:opacity-50 disabled:bg-gray-50 dark:bg-gray-700">
                    <option value="0">Exento (0%)</option>
                    <option value="10.5">10,5%</option>
                    <option value="21">21% (general)</option>
                    <option value="27">27% (servicios)</option>
                  </select>
                </div>
                {verCosto && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Margen objetivo %</label>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">Alerta en Métricas si el margen cae debajo</p>
                  <div className="relative">
                    <input type="number" onWheel={e => e.currentTarget.blur()} min="0" max="100" step="0.1" disabled={!canEdit}
                      value={form.margen_objetivo}
                      onChange={e => setForm(p => ({ ...p, margen_objetivo: e.target.value }))}
                      className="w-full pl-4 pr-10 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700"
                      placeholder="Ej: 30" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 text-sm">%</span>
                  </div>
                </div>
                )}
              </div>

              {/* G5 — Moneda de venta + precio USD */}
              <div className="border-t border-gray-100 dark:border-gray-700 pt-4 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Moneda de venta</label>
                  <select value={form.moneda_venta} disabled={!canEdit}
                    onChange={e => setForm(p => ({ ...p, moneda_venta: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700">
                    <option value="local">Moneda local (precio en pesos)</option>
                    <option value="usd">Precio en USD (se convierte a pesos en el POS)</option>
                  </select>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Si elegís USD, el POS toma el precio en dólares y lo convierte a la cotización vigente al cargarlo.</p>
                </div>
                {form.moneda_venta === 'usd' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Precio en USD</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 text-sm font-medium">USD</span>
                      <input type="number" onWheel={e => e.currentTarget.blur()} min="0" step="0.01" disabled={!canEdit}
                        value={form.precio_usd}
                        onChange={e => setForm(p => ({ ...p, precio_usd: e.target.value }))}
                        className="w-full pl-12 pr-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700" placeholder="0.00" />
                    </div>
                    {cotizacionNum > 0 && (parseFloat(form.precio_usd) || 0) > 0 && (
                      <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
                        ≈ ${((parseFloat(form.precio_usd) || 0) * cotizacionNum).toLocaleString('es-AR', { maximumFractionDigits: 0 })} a la cotización actual (${cotizacionNum.toLocaleString('es-AR', { maximumFractionDigits: 0 })})
                      </p>
                    )}
                    {!(cotizacionNum > 0) && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Sin cotización USD configurada — el POS no podrá convertir. Configurala en el menú lateral.</p>
                    )}
                  </div>
                )}
              </div>

              {/* Accordion Precios mayoristas — venta mayorista = modo avanzado */}
              {canEdit && modoAvanzado && (
                <div className="border-t border-gray-100 dark:border-gray-700 pt-4 space-y-3">
                  <button type="button" onClick={() => setShowMayorista(v => !v)}
                    className="flex items-center gap-3 w-full text-left group">
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors
                      ${showMayorista ? 'bg-accent border-accent-text' : 'border-gray-300 dark:border-gray-600 group-hover:border-accent-text'}`}>
                      {showMayorista && <Check size={12} className="text-white" />}
                    </div>
                    <div>
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Precios mayoristas</span>
                      <p className="text-xs text-gray-400 dark:text-gray-500">Precios especiales por cantidad mínima (adicionales al precio minorista)</p>
                    </div>
                  </button>
                  {showMayorista && (
                    <div className="space-y-2 pl-8">
                      {tiersForm.length === 0 && (
                        <p className="text-xs text-gray-400 dark:text-gray-500 italic">Sin tiers aún. Agregá uno abajo.</p>
                      )}
                      {tiersForm.map((tier, idx) => (
                        <div key={tier._key} className="flex items-center gap-2">
                          <select value={tier.operador}
                            onChange={e => setTiersForm(prev => prev.map((t, i) => i === idx ? { ...t, operador: e.target.value as TierOperador } : t))}
                            className="w-16 px-1 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent-text dark:bg-gray-700"
                            title="Operador de la regla — se evalúan de arriba hacia abajo, gana la primera que coincide">
                            {OPERADORES_TIER.map(o => <option key={o.valor} value={o.valor}>{o.valor}</option>)}
                          </select>
                          <div className="w-20">
                            <input type="number" min="1" step="1" onWheel={e => e.currentTarget.blur()}
                              placeholder="Cant."
                              value={tier.cantidad_minima}
                              onChange={e => setTiersForm(prev => prev.map((t, i) => i === idx ? { ...t, cantidad_minima: e.target.value } : t))}
                              className="w-full px-2 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent-text dark:bg-gray-700" />
                          </div>
                          <div className="relative flex-1">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                            <input type="number" min="0" step="0.01" onWheel={e => e.currentTarget.blur()}
                              placeholder="Precio"
                              value={tier.precio}
                              onChange={e => setTiersForm(prev => prev.map((t, i) => i === idx ? { ...t, precio: e.target.value } : t))}
                              className="w-full pl-6 pr-2 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent-text dark:bg-gray-700" />
                          </div>
                          <div className="flex-1">
                            <input type="text" placeholder="Etiqueta (ej: Docena)"
                              value={tier.descripcion}
                              onChange={e => setTiersForm(prev => prev.map((t, i) => i === idx ? { ...t, descripcion: e.target.value } : t))}
                              className="w-full px-2 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent-text dark:bg-gray-700" />
                          </div>
                          <button type="button" onClick={() => setTiersForm(prev => prev.filter((_, i) => i !== idx))}
                            className="text-red-400 hover:text-red-600 flex-shrink-0 transition-colors">
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ))}
                      <button type="button"
                        onClick={() => setTiersForm(prev => [...prev, { _key: crypto.randomUUID(), cantidad_minima: '', precio: '', descripcion: '', operador: '>=' }])}
                        className="flex items-center gap-1.5 text-xs text-accent-text hover:underline transition-colors">
                        <Plus size={13} /> Agregar tier
                      </button>
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        Se evalúan de arriba hacia abajo (gana el primero que coincide con la cantidad total del producto en la venta). Poné los umbrales más grandes arriba. Usá <strong>=</strong> para un precio exacto (ej. un pallet completo).
                      </p>
                      {tiersForm.length > 0 && parseFloat(form.precio_venta) > 0 && (
                        <p className="text-xs text-gray-400 dark:text-gray-500">
                          Precio minorista (1 u.): <span className="font-medium">${parseFloat(form.precio_venta).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Card 4 — Stock e inventario */}
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 space-y-4">
              <h2 className="font-semibold text-gray-700 dark:text-gray-300">Stock e inventario</h2>

              {/* Stock mínimo | Unidad de medida */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Stock mínimo</label>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">Alerta cuando el stock baje de este valor</p>
                  <input type="number" onWheel={e => e.currentTarget.blur()} min="0" value={form.stock_minimo} disabled={!canEdit}
                    onChange={e => setForm(p => ({ ...p, stock_minimo: e.target.value }))}
                    className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700" placeholder="0" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Unidad de medida</label>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">Cómo se mide/cuenta este producto (Peso/Volumen/Longitud admiten decimales; Conteo no)</p>
                  {unidadesFisicas.length > 0 ? (
                    <select value={form.unidad_medida_base_id} disabled={!canEdit}
                      onChange={e => {
                        const sel = unidadesFisicas.find(x => x.id === e.target.value)
                        setForm(p => ({ ...p, unidad_medida_base_id: e.target.value, unidad_medida: sel ? sel.nombre : p.unidad_medida }))
                      }}
                      className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700">
                      <option value="">— Elegí una unidad —</option>
                      {FAMILIAS_FISICAS.map(fam => {
                        const us = agruparPorFamilia(unidadesFisicas)[fam]
                        if (us.length === 0) return null
                        return (
                          <optgroup key={fam} label={ETIQUETA_FAMILIA[fam]}>
                            {us.map(u => <option key={u.id} value={u.id}>{u.nombre}{u.simbolo ? ` (${u.simbolo})` : ''}</option>)}
                          </optgroup>
                        )
                      })}
                    </select>
                  ) : (
                    // Fallback si el catálogo de UdM físicas todavía no cargó (o tenant sin seed)
                    <select value={form.unidad_medida} disabled={!canEdit}
                      onChange={e => setForm(p => ({ ...p, unidad_medida: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700">
                      {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  )}
                </div>
              </div>

              {/* ISS-174 — Peso y dimensiones para cotizar envíos (Envíos = modo avanzado) */}
              {modoAvanzado && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Peso y dimensiones <span className="font-normal text-gray-400">(para cotizar envíos)</span></label>
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">Se usan cuando la cotización de envíos toma el peso del producto (Config → Envíos). Opcionales.</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {([
                    { k: 'peso_kg'  as const, label: 'Peso (kg)', step: '0.001' },
                    { k: 'largo_cm' as const, label: 'Largo (cm)', step: '0.1' },
                    { k: 'ancho_cm' as const, label: 'Ancho (cm)', step: '0.1' },
                    { k: 'alto_cm'  as const, label: 'Alto (cm)', step: '0.1' },
                  ]).map(f => (
                    <div key={f.k}>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{f.label}</label>
                      <input type="number" onWheel={e => e.currentTarget.blur()} min="0" step={f.step} value={form[f.k]} disabled={!canEdit}
                        onChange={e => setForm(p => ({ ...p, [f.k]: e.target.value }))}
                        className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700" placeholder="0" />
                    </div>
                  ))}
                </div>
              </div>
              )}

              {/* Ubicación predeterminada | Estado de inventario predeterminado (WMS = modo avanzado) */}
              {modoAvanzado && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Ubicación predeterminada
                    {sucursalId && sucursales.length > 1 && (
                      <span className="ml-1.5 text-xs font-normal text-accent-text">
                        · {(sucursales as any[]).find(s => s.id === sucursalId)?.nombre}
                      </span>
                    )}
                  </label>
                  {sucursalId ? (
                    // Con sucursal activa: muestra ubicaciones de esa sucursal + globales
                    <select
                      disabled={!canEdit}
                      value={ubicSucursalActiva}
                      onChange={e => setUbicSucursalActiva(e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700">
                      <option value="">Sin ubicación</option>
                      {(ubicaciones as any[])
                        .filter((u: any) => u.sucursal_id === sucursalId || u.sucursal_id === null)
                        .map((u: any) => (
                          <option key={u.id} value={u.id}>{u.nombre}</option>
                        ))}
                    </select>
                  ) : (
                    // Sin sucursal activa (vista global): selector global/fallback
                    <select value={form.ubicacion_id} disabled={!canEdit}
                      onChange={e => setForm(p => ({ ...p, ubicacion_id: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700">
                      <option value="">Sin ubicación</option>
                      {(ubicaciones as any[]).map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                    </select>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Estado de inventario predeterminado</label>
                  <select value={form.estado_id} disabled={!canEdit}
                    onChange={e => setForm(p => ({ ...p, estado_id: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700">
                    <option value="">Sin estado</option>
                    {(estados as any[]).map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                  </select>
                </div>
              </div>
              )}

              {/* Regla de inventario (FIFO/FEFO = modo avanzado; en básico aplica la default) */}
              {modoAvanzado && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Regla de inventario
                  <span className="ml-1 text-gray-400 dark:text-gray-500 font-normal text-xs">(vacío = usar la regla del negocio)</span>
                </label>
                <select value={form.regla_inventario}
                  onChange={e => setForm(p => ({ ...p, regla_inventario: e.target.value }))}
                  disabled={!canEdit}
                  className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700">
                  <option value="">— Usar regla del negocio —</option>
                  {REGLAS_INVENTARIO.map(r => (
                    <option key={r.value} value={r.value}>{r.label} — {r.desc}</option>
                  ))}
                </select>
              </div>
              )}

              {!isEditing && (
                <div className="flex items-center gap-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 rounded-xl px-4 py-3 text-sm text-blue-700 dark:text-blue-400">
                  <span>💡</span>
                  <span>Para ingresar stock, usá <strong>Movimientos → Ingreso</strong> una vez creado el producto.</span>
                </div>
              )}

              {/* Stock mínimo por sucursal */}
              {isEditing && sucursales.length > 0 && (
                <div className="border border-gray-100 dark:border-gray-700 rounded-xl p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Stock mínimo por sucursal</h3>
                  <p className="text-xs text-gray-400 dark:text-gray-500">Override del valor global para cada sucursal. Dejá vacío para usar el global ({form.stock_minimo || '0'}).</p>
                  <div className="space-y-2">
                    {sucursales.map(suc => (
                      <div key={suc.id} className="flex items-center gap-3">
                        <span className="flex-1 text-sm text-gray-600 dark:text-gray-400">{suc.nombre}</span>
                        <input
                          type="number" min="0" onWheel={e => e.currentTarget.blur()}
                          placeholder={form.stock_minimo || '0'}
                          value={stockMinimosSucursal[suc.id] ?? ''}
                          onChange={e => setStockMinimosSucursal(p => ({ ...p, [suc.id]: e.target.value }))}
                          disabled={!canEdit}
                          className="w-24 px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent-text disabled:bg-gray-50 dark:bg-gray-700 text-center" />
                      </div>
                    ))}
                  </div>
                  {canEdit && (
                    <button type="button" onClick={saveMinimos} disabled={savingMinimos}
                      className="text-sm px-4 py-1.5 bg-accent hover:bg-accent/90 text-white rounded-lg disabled:opacity-50 transition-all">
                      {savingMinimos ? 'Guardando...' : 'Guardar mínimos'}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Card 5 — Trazabilidad */}
            {canEdit && (
              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 space-y-4">
                <div>
                  <h2 className="font-semibold text-gray-700 dark:text-gray-300">Trazabilidad</h2>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Activá los atributos que aplican a este producto</p>
                </div>

                {/* Subsección Tracking — solo en modo avanzado; si el producto heredó tracking, solo-lectura */}
                <div className="space-y-3">
                  {mostrarTracking && (<>
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Tracking</p>
                  {!modoAvanzado && (
                    <p className="text-xs bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 rounded-lg px-3 py-2">
                      Este producto tiene trazabilidad activa (modo avanzado). Sus flujos se conservan, pero la edición de tracking requiere el modo avanzado (Configuración → Modo de operación).
                    </p>
                  )}

                  {/* tiene_series */}
                  <label className={`flex items-start gap-3 ${modoAvanzado ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'}`}>
                    <div className="mt-0.5"><Toggle checked={form.tiene_series} disabled={!modoAvanzado} onChange={v => setForm(p => ({ ...p, tiene_series: v }))} aria-label="tiene_series" /></div>
                    <div>
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Control por número de serie</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">Cada unidad tiene su propio N° de serie</p>
                    </div>
                  </label>

                  {/* tiene_lote */}
                  <label className={`flex items-start gap-3 ${modoAvanzado ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'}`}>
                    <div className="mt-0.5"><Toggle checked={form.tiene_lote} disabled={!modoAvanzado} onChange={v => setForm(p => ({ ...p, tiene_lote: v }))} aria-label="tiene_lote" /></div>
                    <div>
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Control por lote</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">El stock se agrupa por número de lote</p>
                    </div>
                  </label>

                  {/* tiene_vencimiento + inline shelf_life_dias + aging_profile_id */}
                  <div>
                    <label className={`flex items-start gap-3 ${modoAvanzado ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'}`}>
                      <div className="mt-0.5"><Toggle checked={form.tiene_vencimiento} disabled={!modoAvanzado} onChange={v => setForm(p => ({ ...p, tiene_vencimiento: v }))} aria-label="tiene_vencimiento" /></div>
                      <div>
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Fecha de vencimiento</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500">Registra fecha de vencimiento por línea</p>
                      </div>
                    </label>
                    {form.tiene_vencimiento && (
                      <div className="mt-3 ml-13 pl-13 space-y-3" style={{ marginLeft: '52px' }}>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                            Vida útil (días)
                            <span className="ml-1 text-gray-400 dark:text-gray-500 font-normal" title="Días desde la fabricación hasta el vencimiento. Usado para calcular alertas de vencimiento próximo.">(días de shelf life)</span>
                          </label>
                          <input type="number" onWheel={e => e.currentTarget.blur()} min="1" step="1"
                            value={form.shelf_life_dias} disabled={!modoAvanzado}
                            onChange={e => setForm(p => ({ ...p, shelf_life_dias: e.target.value }))}
                            placeholder="Ej: 365"
                            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent-text" />
                        </div>
                        {agingProfiles.length > 0 && (
                          <div>
                            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                              Aging Profile
                              <span className="ml-1 text-gray-400 dark:text-gray-500 font-normal">(requiere fecha de vencimiento activa)</span>
                            </label>
                            <select value={form.aging_profile_id} disabled={!modoAvanzado}
                              onChange={e => setForm(p => ({ ...p, aging_profile_id: e.target.value }))}
                              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent-text">
                              <option value="">— Sin aging profile —</option>
                              {(agingProfiles as any[]).map((ap: any) => (
                                <option key={ap.id} value={ap.id}>{ap.nombre}</option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* tiene_pais_origen */}
                  <label className={`flex items-start gap-3 ${modoAvanzado ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'}`}>
                    <div className="mt-0.5"><Toggle checked={form.tiene_pais_origen} disabled={!modoAvanzado} onChange={v => setForm(p => ({ ...p, tiene_pais_origen: v }))} aria-label="tiene_pais_origen" /></div>
                    <div>
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">País de origen</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">Registra el país de origen en cada ingreso de inventario</p>
                    </div>
                  </label>
                  </>)}

                  {/* es_kit — kitting es modo avanzado; si el producto ya es kit, solo-lectura */}
                  {(modoAvanzado || form.es_kit) && (
                  <label className={`flex items-start gap-3 ${modoAvanzado ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'}`}>
                    <div className="mt-0.5"><Toggle checked={form.es_kit} disabled={!modoAvanzado} onChange={v => setForm(p => ({ ...p, es_kit: v }))} aria-label="es_kit" /></div>
                    <div>
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Es un KIT</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">Se arma a partir de otros SKUs (kitting). Configurá la receta en Inventario → Kits.</p>
                    </div>
                  </label>
                  )}
                </div>

                {/* Separador visual */}
                <hr className="border-gray-100 dark:border-gray-700" />

                {/* Subsección Atributos de variante */}
                {canEdit && (
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Atributos de variante</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        Para UN SOLO producto/SKU cuyo stock se banca junto pero se distingue por talle/color en el
                        depósito (te lo va a pedir en cada ingreso y venta). Si cada talle/color tiene precio o SKU
                        propio, usá <strong>&quot;Variantes&quot;</strong> más abajo (madre/hijo) en su lugar.
                      </p>
                    </div>

                    {/* tiene_talle */}
                    <label className="flex items-start gap-3 cursor-pointer">
                      <div className="mt-0.5"><Toggle checked={form.tiene_talle} onChange={v => toggleAtributoVariante('tiene_talle', v)} aria-label="tiene_talle" /></div>
                      <div>
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Talle / Talla</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500">Registra el talle de cada unidad (ropa, calzado)</p>
                      </div>
                    </label>

                    {/* tiene_color */}
                    <label className="flex items-start gap-3 cursor-pointer">
                      <div className="mt-0.5"><Toggle checked={form.tiene_color} onChange={v => toggleAtributoVariante('tiene_color', v)} aria-label="tiene_color" /></div>
                      <div>
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Color</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500">Identifica el color de cada unidad</p>
                      </div>
                    </label>

                    {/* tiene_encaje */}
                    <label className="flex items-start gap-3 cursor-pointer">
                      <div className="mt-0.5"><Toggle checked={form.tiene_encaje} onChange={v => toggleAtributoVariante('tiene_encaje', v)} aria-label="tiene_encaje" /></div>
                      <div>
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Encaje</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500">Variante de encaje o ajuste</p>
                      </div>
                    </label>

                    {/* tiene_formato */}
                    <label className="flex items-start gap-3 cursor-pointer">
                      <div className="mt-0.5"><Toggle checked={form.tiene_formato} onChange={v => toggleAtributoVariante('tiene_formato', v)} aria-label="tiene_formato" /></div>
                      <div>
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Formato</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500">Formato o presentación del producto</p>
                      </div>
                    </label>

                    {/* tiene_sabor_aroma */}
                    <label className="flex items-start gap-3 cursor-pointer">
                      <div className="mt-0.5"><Toggle checked={form.tiene_sabor_aroma} onChange={v => toggleAtributoVariante('tiene_sabor_aroma', v)} aria-label="tiene_sabor_aroma" /></div>
                      <div>
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Sabor / Aroma</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500">Sabor o aroma de cada unidad</p>
                      </div>
                    </label>
                  </div>
                )}
              </div>
            )}

            {/* Card — Variantes (madre/hijo, rediseño UoM Fase 3) */}
            {canEdit && isEditing && (
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100 dark:border-gray-700">
                  <Boxes size={16} className="text-accent-text" />
                  <span className="font-semibold text-gray-700 dark:text-gray-300">Variantes</span>
                  {esHijo && <span className="ml-auto px-2 py-0.5 text-xs font-medium bg-accent/10 text-accent-text rounded-full">Variante</span>}
                  {esMadre && <span className="ml-auto px-2 py-0.5 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-full">Agrupador</span>}
                </div>

                <div className="px-5 py-4 space-y-4">
                  {esHijo ? (
                    /* Es un hijo: mostrar la madre + hermanos + diferenciador editable */
                    <div className="space-y-4">
                      <div className="flex items-center gap-3 p-3 bg-accent/5 dark:bg-accent/10 rounded-xl border border-accent-text/20">
                        <Boxes size={16} className="text-accent-text flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">Variante de: &quot;{madre?.nombre ?? '…'}&quot;</p>
                        </div>
                        {madre && (
                          <button type="button" onClick={() => navigate(`/productos/${madre.id}/editar`)} className="text-xs text-accent-text hover:underline flex-shrink-0">
                            Ver madre
                          </button>
                        )}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Diferenciador</label>
                        <input type="text" value={varianteDiferenciador}
                          onChange={e => setVarianteDiferenciador(e.target.value)}
                          placeholder="Ej. Rojo / M"
                          className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 focus:outline-none focus:border-accent-text" />
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">El nombre completo (&quot;{madre?.nombre ?? '…'} — {varianteDiferenciador || '…'}&quot;) se arma solo al guardar.</p>
                      </div>
                      {hermanos.length > 0 && (
                        <div>
                          <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">Otras variantes:</p>
                          <div className="flex flex-wrap gap-1">
                            {(hermanos as any[]).slice(0, 8).map(h => (
                              <button key={h.id} type="button" onClick={() => navigate(`/productos/${h.id}/editar`)}
                                className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:text-accent-text transition-colors">
                                {h.variante_diferenciador ?? h.sku} <ExternalLink size={10} />
                              </button>
                            ))}
                            {hermanos.length > 8 && <span className="text-xs text-gray-400 dark:text-gray-500 px-2 py-0.5">+{hermanos.length - 8} más</span>}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : esMadre ? (
                    /* Es una madre: mostrar los hijos + agregar variante */
                    <div className="space-y-3">
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Este producto es un <strong>agrupador</strong>: no se vende directamente, se venden sus variantes.
                      </p>

                      {/* Stock sin variante asignada (Fase 4): contable pero NO vendible */}
                      {stockSinAsignar > 0 && (
                        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3 space-y-2">
                          <div className="flex gap-2">
                            <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                            <p className="text-xs text-amber-800 dark:text-amber-300">
                              <strong>{stockSinAsignar} unidad(es) sin variante asignada.</strong> Este stock
                              sigue contando en inventario, pero <strong>no se puede vender</strong> hasta
                              repartirlo entre las variantes.
                            </p>
                          </div>
                          {canEdit && (
                            <button type="button" onClick={() => setReasignarAbierto(true)}
                              className="w-full bg-amber-600 hover:bg-amber-700 text-white py-2 rounded-lg text-xs font-semibold transition-colors">
                              Repartir entre las variantes
                            </button>
                          )}
                        </div>
                      )}

                      <div className="border border-gray-200 dark:border-gray-700 rounded-xl divide-y divide-gray-50 dark:divide-gray-700">
                        {(hijos as any[]).map(h => (
                          <button key={h.id} type="button" onClick={() => navigate(`/productos/${h.id}/editar`)}
                            className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors">
                            <span className="flex-1 min-w-0 text-sm text-gray-800 dark:text-gray-100 truncate">{h.variante_diferenciador}</span>
                            <span className="text-xs text-gray-500 dark:text-gray-400">${(h.precio_venta ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                            <ExternalLink size={12} className="text-gray-400" />
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    /* Standalone: opción de crear la primera variante */
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Si este producto viene en variantes (talle/color/sabor) con precio y stock propios,
                      creá la primera con <strong>&quot;Crear variante&quot;</strong>. El producto pasa a ser un agrupador.
                    </p>
                  )}

                  {/* Crear variante — disponible para madre o standalone (agrega un hijo) */}
                  {!esHijo && (
                    crearVarianteAbierto ? (
                      <div className="space-y-2 pt-2 border-t border-gray-100 dark:border-gray-700">
                        <input type="text" value={nuevaVarianteDif}
                          onChange={e => setNuevaVarianteDif(e.target.value)}
                          placeholder="Diferenciador de la nueva variante (ej. Rojo / M)"
                          className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 focus:outline-none focus:border-accent-text" />
                        <div className="flex gap-2">
                          <button type="button" onClick={() => { setCrearVarianteAbierto(false); setNuevaVarianteDif('') }}
                            className="flex-1 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 py-2 rounded-xl text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                            Cancelar
                          </button>
                          <button type="button" onClick={handleCrearVariante} disabled={saving}
                            className="flex-1 bg-accent hover:bg-accent/90 text-white py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-60">
                            Crear variante
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button type="button" onClick={() => setCrearVarianteAbierto(true)}
                        className="w-full flex items-center justify-center gap-2 border border-dashed border-accent-text/40 text-accent-text py-2.5 rounded-xl text-sm hover:bg-accent/5 transition-colors">
                        <Plus size={15} /> Crear variante
                      </button>
                    )
                  )}
                </div>
              </div>
            )}

            {/* Card 6 — Marketplace */}
            {canEdit && tenant?.marketplace_activo && (
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowMarketplace(v => !v)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <ShoppingBag size={16} className="text-violet-500" />
                    <span className="font-semibold text-gray-700 dark:text-gray-300">Marketplace</span>
                    {form.publicado_marketplace && (
                      <span className="ml-1 px-2 py-0.5 text-xs font-medium bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 rounded-full">Publicado</span>
                    )}
                  </div>
                  {showMarketplace ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                </button>

                {showMarketplace && (
                  <div className="px-5 pb-5 space-y-4 border-t border-gray-100 dark:border-gray-700 pt-4">
                    {/* Toggle publicar */}
                    <label className="flex items-center justify-between cursor-pointer">
                      <div>
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Publicar en marketplace</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500">Visible para compradores del marketplace externo</p>
                      </div>
                      <div className="ml-4 flex-shrink-0">
                        <Toggle size="lg" colorOn="bg-violet-500" checked={form.publicado_marketplace}
                          onChange={v => setForm(p => ({ ...p, publicado_marketplace: v }))}
                          aria-label="Publicado en marketplace" />
                      </div>
                    </label>

                    {form.publicado_marketplace && (
                      <>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                              Precio marketplace
                              <span className="ml-1 text-xs text-gray-400 font-normal">(vacío = usar precio de venta)</span>
                            </label>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 text-sm font-medium">$</span>
                              <input
                                type="number" onWheel={e => e.currentTarget.blur()} min="0" step="0.01"
                                value={form.precio_marketplace}
                                onChange={e => setForm(p => ({ ...p, precio_marketplace: e.target.value }))}
                                placeholder={form.precio_venta || '0.00'}
                                className="w-full pl-8 pr-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-violet-400"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                              Stock reservado
                              <span className="ml-1 text-xs text-gray-400 font-normal">(destinado al marketplace)</span>
                            </label>
                            <input
                              type="number" onWheel={e => e.currentTarget.blur()} min="0"
                              value={form.stock_reservado_marketplace}
                              onChange={e => setForm(p => ({ ...p, stock_reservado_marketplace: e.target.value }))}
                              className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-violet-400"
                            />
                            {form.stock_reservado_marketplace !== '0' && form.stock_reservado_marketplace !== '' && (
                              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                                Stock disponible en marketplace: {Math.max(0, parseInt(form.stock_actual || '0') - parseInt(form.stock_reservado_marketplace || '0'))} u.
                              </p>
                            )}
                          </div>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Descripción pública
                            <span className="ml-1 text-xs text-gray-400 font-normal">(opcional — si está vacía se usa la descripción interna)</span>
                          </label>
                          <textarea
                            value={form.descripcion_marketplace}
                            onChange={e => setForm(p => ({ ...p, descripcion_marketplace: e.target.value }))}
                            rows={3}
                            placeholder="Descripción orientada al comprador externo..."
                            className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-violet-400 resize-none"
                          />
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Columna derecha ── */}
          <div className="lg:col-span-1 space-y-5">

            {/* Card Imagen */}
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 space-y-3">
              <h2 className="font-semibold text-gray-700 dark:text-gray-300">Imagen</h2>
              <div className="aspect-square rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 flex items-center justify-center overflow-hidden bg-gray-50 dark:bg-gray-700 relative">
                {imagePreview || existingImageUrl ? (
                  <>
                    <img src={imagePreview ?? existingImageUrl!} alt="Preview" className="w-full h-full object-cover" />
                    {canEdit && (
                      <button type="button"
                        onClick={() => { setImageFile(null); setImagePreview(null); setExistingImageUrl(null) }}
                        className="absolute top-2 right-2 bg-red-50 dark:bg-red-900/200 text-white rounded-full p-1 hover:bg-red-600">
                        <X size={14} />
                      </button>
                    )}
                  </>
                ) : (
                  <div className="text-center text-gray-400 dark:text-gray-500">
                    <Package size={32} className="mx-auto mb-2 opacity-40" />
                    <p className="text-xs">Sin imagen</p>
                  </div>
                )}
              </div>
              {canEdit && (
                <label className="flex items-center justify-center gap-2 w-full border border-gray-200 dark:border-gray-700 rounded-xl py-2.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors">
                  <Upload size={15} />
                  {imagePreview || existingImageUrl ? 'Cambiar imagen' : 'Subir imagen'}
                  <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
                </label>
              )}
              <p className="text-xs text-gray-400 dark:text-gray-500 text-center">JPG, PNG o WEBP. Máx 2MB</p>
            </div>

            {/* Botón QR — solo si editando */}
            {isEditing && canEdit && (
              <button type="button" onClick={() => setShowQR(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm text-accent-text border border-accent-text/30 rounded-xl hover:bg-accent/10 transition-all bg-white dark:bg-gray-800">
                <QrCode size={16} /> Ver QR del producto
              </button>
            )}
          </div>
        </div>

        {canEdit && (
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={() => navigate('/productos')}
              className="px-6 py-2.5 border-2 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 font-semibold rounded-xl hover:border-gray-300 dark:hover:border-gray-500 transition-all">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="px-6 py-2.5 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl transition-all disabled:opacity-60">
              {saving ? 'Guardando...' : isEditing ? 'Guardar cambios' : 'Crear producto'}
            </button>
          </div>
        )}
      </form>

      {showQR && productoData && (
        <ProductoQR
          productoId={productoData.id}
          nombre={productoData.nombre}
          sku={productoData.sku}
          onClose={() => setShowQR(false)}
        />
      )}

      {barcodeScannerOpen && (
        <BarcodeScanner
          title="Escanear código de barras"
          onDetected={code => { setForm(p => ({ ...p, codigo_barras: code })); setBarcodeScannerOpen(false) }}
          onClose={() => setBarcodeScannerOpen(false)}
        />
      )}

      {reasignarAbierto && id && (
        <ReasignarStockVarianteModal
          madreId={id}
          madreNombre={form.nombre}
          hijos={hijos as any[]}
          serializado={!!(productoData as any)?.tiene_series}
          onClose={() => { setReasignarAbierto(false); qc.invalidateQueries({ queryKey: ['stock-sin-variante-total', id] }) }}
        />
      )}
    </div>
  )
}
