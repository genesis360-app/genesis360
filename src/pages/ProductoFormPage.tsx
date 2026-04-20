import imageCompression from 'browser-image-compression'
import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Upload, X, RefreshCw, Package, Copy, DollarSign, QrCode, Sparkles, Camera, ShoppingBag, ChevronDown, ChevronUp, ScanLine } from 'lucide-react'
import { BarcodeScanner } from '@/components/BarcodeScanner'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { logActividad } from '@/lib/actividadLog'
import { usePlanLimits } from '@/hooks/usePlanLimits'
import { useCotizacion } from '@/hooks/useCotizacion'
import { PlanLimitModal } from '@/components/PlanLimitModal'
import { REGLAS_INVENTARIO } from '@/lib/rebajeSort'
import { calcularSiguienteSKU } from '@/lib/skuAuto'
import { ProductoQR } from '@/components/ProductoQR'
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
  const { limits } = usePlanLimits()
  const { cotizacion: cotizacionNum } = useCotizacion()
  const [showLimitModal, setShowLimitModal] = useState(false)
  const [showQR, setShowQR] = useState(false)

  const [form, setForm] = useState({
    nombre: '', sku: '', descripcion: '', categoria_id: '', proveedor_id: '',
    ubicacion_id: '', estado_id: '', precio_costo: '', precio_venta: '', stock_actual: '',
    stock_minimo: '', unidad_medida: 'unidad', codigo_barras: '', activo: true,
    tiene_series: false, tiene_lote: false, tiene_vencimiento: false, es_kit: false,
    regla_inventario: '', aging_profile_id: '', margen_objetivo: '', alicuota_iva: '21',
    // Marketplace
    publicado_marketplace: false, precio_marketplace: '', stock_reservado_marketplace: '0',
    descripcion_marketplace: '',
  })
  const [showMarketplace, setShowMarketplace] = useState(false)
  // Stock mínimo por sucursal (solo cuando editando)
  const [stockMinimosSucursal, setStockMinimosSucursal] = useState<Record<string, string>>({})
  const [savingMinimos, setSavingMinimos] = useState(false)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [existingImageUrl, setExistingImageUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<string | null>(null)
  const [scanPhotoCount, setScanPhotoCount] = useState(0)
  const [barcodeScannerOpen, setBarcodeScannerOpen] = useState(false) // 0=ninguna, 1=primera sacada, listo para segunda

  // USD mode (usa cotización global del sidebar)
  const [usdModoCosto, setUsdModoCosto] = useState(false)
  const [usdModoVenta, setUsdModoVenta] = useState(false)
  const [usdInputCosto, setUsdInputCosto] = useState('')
  const [usdInputVenta, setUsdInputVenta] = useState('')

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
        codigo_barras: productoData.codigo_barras ?? '', activo: productoData.activo,
        tiene_series: productoData.tiene_series ?? false,
        tiene_lote: productoData.tiene_lote ?? false,
        tiene_vencimiento: productoData.tiene_vencimiento ?? false,
        es_kit: productoData.es_kit ?? false,
        regla_inventario: productoData.regla_inventario ?? '',
        aging_profile_id: productoData.aging_profile_id ?? '',
        margen_objetivo: productoData.margen_objetivo != null ? productoData.margen_objetivo.toString() : '',
        alicuota_iva: (productoData.alicuota_iva ?? 21).toString(),
        publicado_marketplace: productoData.publicado_marketplace ?? false,
        precio_marketplace: productoData.precio_marketplace != null ? productoData.precio_marketplace.toString() : '',
        stock_reservado_marketplace: (productoData.stock_reservado_marketplace ?? 0).toString(),
        descripcion_marketplace: productoData.descripcion_marketplace ?? '',
      })
      if (productoData.publicado_marketplace) setShowMarketplace(true)
      if (productoData.imagen_url) setExistingImageUrl(productoData.imagen_url)
      setLoaded(true)
    }
  }, [productoData])

  const margen = (() => {
    const costo = parseFloat(form.precio_costo)
    const venta = parseFloat(form.precio_venta)
    if (costo > 0 && venta > 0) return (((venta - costo) / costo) * 100).toFixed(1)
    return null
  })()

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { toast.error('La imagen no puede superar 2MB'); return }
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.nombre.trim()) return toast.error('El nombre es obligatorio')

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
        const fileToUpload = imageFile.size > 2 * 1024 * 1024
          ? await imageCompression(imageFile, { maxSizeMB: 1.5, maxWidthOrHeight: 1200, useWebWorker: true })
          : imageFile
        const ext = fileToUpload.name.split('.').pop()
        const path = `${tenant!.id}/${Date.now()}.${ext}`
        const { error: uploadError } = await supabase.storage.from('productos').upload(path, fileToUpload, { upsert: true })
        if (uploadError) throw uploadError
        const { data: urlData } = supabase.storage.from('productos').getPublicUrl(path)
        imagen_url = urlData.publicUrl
      }
      const payload = {
        tenant_id: tenant!.id,
        nombre: form.nombre.trim(), sku: skuFinal,
        descripcion: form.descripcion.trim() || null,
        categoria_id: form.categoria_id || null, proveedor_id: form.proveedor_id || null,
        ubicacion_id: form.ubicacion_id || null,
        precio_costo: parseFloat(form.precio_costo) || 0,
        precio_venta: parseFloat(form.precio_venta) || 0,
        stock_minimo: parseInt(form.stock_minimo) || 0,
        unidad_medida: form.unidad_medida,
        codigo_barras: form.codigo_barras.trim() || null,
        imagen_url, activo: form.activo,
        tiene_series: form.tiene_series,
        tiene_lote: form.tiene_lote,
        tiene_vencimiento: form.tiene_vencimiento,
        es_kit: form.es_kit,
        regla_inventario: form.regla_inventario || null,
        aging_profile_id: form.aging_profile_id || null,
        margen_objetivo: form.margen_objetivo !== '' ? parseFloat(form.margen_objetivo) : null,
        alicuota_iva: parseFloat(form.alicuota_iva) || 21,
        publicado_marketplace: form.publicado_marketplace,
        precio_marketplace: form.precio_marketplace !== '' ? parseFloat(form.precio_marketplace) : null,
        stock_reservado_marketplace: parseInt(form.stock_reservado_marketplace) || 0,
        descripcion_marketplace: form.descripcion_marketplace.trim() || null,
      }
      if (isEditing) {
        const { error } = await supabase.from('productos').update(payload).eq('id', id)
        if (error) throw error
        toast.success('Producto actualizado')
        logActividad({ entidad: 'producto', entidad_id: id, entidad_nombre: form.nombre, accion: 'editar', pagina: '/productos' })
      } else {
        const { error } = await supabase.from('productos').insert(payload)
        if (error) { if (error.code === '23505') throw new Error('Ya existe un producto con ese SKU'); throw error }
        toast.success('Producto creado')
        logActividad({ entidad: 'producto', entidad_nombre: form.nombre, accion: 'crear', pagina: '/productos' })
      }
      qc.invalidateQueries({ queryKey: ['productos'] })
      navigate('/productos')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    // Verificar si tiene stock
    const { data: lineas } = await supabase.from('inventario_lineas')
      .select('id, cantidad, inventario_series(id)')
      .eq('producto_id', id!).eq('activo', true)

    const tieneStock = (lineas ?? []).some((l: any) =>
      (l.cantidad > 0) || ((l.inventario_series ?? []).length > 0)
    )

    if (tieneStock) {
      toast.error('No se puede eliminar: el producto tiene stock en inventario. Rebajá el stock primero.')
      return
    }

    if (!confirm('¿Eliminar este producto? Esta acción no se puede deshacer.')) return

    const { error } = await supabase.from('productos').update({ activo: false }).eq('id', id!)
    if (error) toast.error(error.message)
    else {
      toast.success('Producto eliminado')
      logActividad({ entidad: 'producto', entidad_id: id, entidad_nombre: form.nombre, accion: 'eliminar', pagina: '/productos' })
      qc.invalidateQueries({ queryKey: ['productos'] })
      navigate('/productos')
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
        precio_costo: parseFloat(form.precio_costo) || 0,
        precio_venta: parseFloat(form.precio_venta) || 0,
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

  const canEdit = user?.rol === 'OWNER' || user?.rol === 'SUPERVISOR' || user?.rol === 'ADMIN'

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
    <div className="max-w-3xl mx-auto space-y-6">
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
                className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-semibold border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-accent hover:border-accent transition-all bg-white dark:bg-gray-800">
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
            <button type="button" onClick={() => setShowQR(true)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-accent border border-accent/30 rounded-xl hover:bg-accent/10 transition-all">
              <QrCode size={15} /> QR
            </button>
            <button type="button" onClick={handleDuplicate} disabled={saving}
              className="flex items-center gap-2 px-3 py-2 text-sm text-primary border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all disabled:opacity-50">
              <Copy size={15} /> Duplicar
            </button>
            <button type="button" onClick={handleDelete}
              className="flex items-center gap-2 px-3 py-2 text-sm text-red-500 border border-red-200 rounded-xl hover:bg-red-50 dark:bg-red-900/20 transition-all">
              Eliminar
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
        <div className="grid lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-5">

            {/* Datos básicos */}
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 space-y-4">
              <h2 className="font-semibold text-gray-700 dark:text-gray-300">Datos básicos</h2>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nombre <span className="text-red-500">*</span></label>
                <input type="text" value={form.nombre} disabled={!canEdit}
                  onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))}
                  placeholder="Ej: Tornillo hexagonal 1/4"
                  className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:bg-gray-50 dark:bg-gray-700" />
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">SKU <span className="text-gray-400 text-xs font-normal">(auto si vacío)</span></label>
                  <div className="flex gap-2">
                    <input type="text" value={form.sku} disabled={!canEdit}
                      onChange={e => setForm(p => ({ ...p, sku: e.target.value.toUpperCase() }))}
                      placeholder="Vacío = SKU-00001 automático"
                      className="flex-1 px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-mono focus:outline-none focus:border-accent disabled:bg-gray-50 dark:bg-gray-700" />
                    {!isEditing && (
                      <button type="button" onClick={() => setForm(p => ({ ...p, sku: generateSKU(form.nombre) }))}
                        title="Generar SKU automático"
                        className="px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:text-primary transition-colors">
                        <RefreshCw size={16} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Código de barras</label>
                  <input type="text" value={form.codigo_barras} disabled={!canEdit}
                    onChange={e => setForm(p => ({ ...p, codigo_barras: e.target.value }))}
                    placeholder="7791234567890"
                    className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-mono focus:outline-none focus:border-accent disabled:bg-gray-50 dark:bg-gray-700" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descripción</label>
                <textarea value={form.descripcion} disabled={!canEdit} rows={2}
                  onChange={e => setForm(p => ({ ...p, descripcion: e.target.value }))}
                  placeholder="Descripción opcional..."
                  className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent resize-none disabled:bg-gray-50 dark:bg-gray-700" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Categoría</label>
                  <select value={form.categoria_id} disabled={!canEdit}
                    onChange={e => setForm(p => ({ ...p, categoria_id: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent disabled:bg-gray-50 dark:bg-gray-700">
                    <option value="">Sin categoría</option>
                    {(categorias as any[]).map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Proveedor</label>
                  <select value={form.proveedor_id} disabled={!canEdit}
                    onChange={e => setForm(p => ({ ...p, proveedor_id: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent disabled:bg-gray-50 dark:bg-gray-700">
                    <option value="">Sin proveedor</option>
                    {(proveedores as any[]).map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Ubicación</label>
                  <select value={form.ubicacion_id} disabled={!canEdit}
                    onChange={e => setForm(p => ({ ...p, ubicacion_id: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent disabled:bg-gray-50 dark:bg-gray-700">
                    <option value="">Sin ubicación</option>
                    {(ubicaciones as any[]).map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Precios y stock */}
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-gray-700 dark:text-gray-300">Precios y stock</h2>
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
              {(() => {
                const cotizNum = cotizacionNum
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
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Precio de costo</label>
                        {cotizNum > 0 && canEdit && (
                          <button type="button" onClick={toggleCosto}
                            className="text-xs text-accent hover:underline">
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
                          className="w-full pl-10 pr-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent disabled:bg-gray-50 dark:bg-gray-700" placeholder="0.00" />
                      </div>
                      {cotizNum > 0 && (parseFloat(form.precio_costo) || 0) > 0 && (
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                          {usdModoCosto
                            ? `= $${(parseFloat(form.precio_costo) || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })} ARS`
                            : `≈ USD ${((parseFloat(form.precio_costo) || 0) / cotizNum).toFixed(2)}`}
                        </p>
                      )}
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Precio de venta</label>
                        {cotizNum > 0 && canEdit && (
                          <button type="button" onClick={toggleVenta}
                            className="text-xs text-accent hover:underline">
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
                          className="w-full pl-10 pr-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent disabled:bg-gray-50 dark:bg-gray-700" placeholder="0.00" />
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
              {margen !== null && (
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
                    (ganancia: ${(parseFloat(form.precio_venta) - parseFloat(form.precio_costo)).toFixed(2)})
                  </span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Margen objetivo</label>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">Alerta en Métricas si el margen cae debajo</p>
                  <div className="relative">
                    <input type="number" onWheel={e => e.currentTarget.blur()} min="0" max="100" step="0.1" disabled={!canEdit}
                      value={form.margen_objetivo}
                      onChange={e => setForm(p => ({ ...p, margen_objetivo: e.target.value }))}
                      className="w-full pl-4 pr-10 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent disabled:bg-gray-50 dark:bg-gray-700"
                      placeholder="Ej: 30" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 text-sm">%</span>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Alícuota IVA</label>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">IVA incluido en el precio de venta</p>
                  <select value={form.alicuota_iva} disabled={!canEdit}
                    onChange={e => setForm(p => ({ ...p, alicuota_iva: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent disabled:opacity-50 disabled:bg-gray-50 dark:bg-gray-700">
                    <option value="0">Exento (0%)</option>
                    <option value="10.5">10,5%</option>
                    <option value="21">21% (general)</option>
                    <option value="27">27% (servicios)</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Stock mínimo</label>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">Alerta cuando el stock baje de este valor</p>
                  <input type="number" onWheel={e => e.currentTarget.blur()} min="0" value={form.stock_minimo} disabled={!canEdit}
                    onChange={e => setForm(p => ({ ...p, stock_minimo: e.target.value }))}
                    className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent disabled:bg-gray-50 dark:bg-gray-700" placeholder="0" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Unidad de medida</label>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">Cómo se mide este producto</p>
                  <select value={form.unidad_medida} disabled={!canEdit}
                    onChange={e => setForm(p => ({ ...p, unidad_medida: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent disabled:bg-gray-50 dark:bg-gray-700">
                    {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
              {!isEditing && (
                <div className="flex items-center gap-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 rounded-xl px-4 py-3 text-sm text-blue-700 dark:text-blue-400">
                  <span>💡</span>
                  <span>Para ingresar stock, usá <strong>Movimientos → Ingreso</strong> una vez creado el producto.</span>
                </div>
              )}
              {/* Stock mínimo por sucursal — solo cuando hay sucursales configuradas y editando */}
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
                          className="w-24 px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent disabled:bg-gray-50 dark:bg-gray-700 text-center" />
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
          </div>

          {/* Columna imagen + estado */}
          <div className="space-y-5">
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

            {isEditing && canEdit && (
              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100">
                <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-3">Estado</h2>
                <label className="flex items-center gap-3 cursor-pointer">
                  <div className="relative">
                    <input type="checkbox" checked={form.activo}
                      onChange={e => setForm(p => ({ ...p, activo: e.target.checked }))} className="sr-only" />
                    <div className={`w-11 h-6 rounded-full transition-colors ${form.activo ? 'bg-green-50 dark:bg-green-900/200' : 'bg-gray-300'}`}>
                      <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white dark:bg-gray-800 rounded-full shadow transition-transform ${form.activo ? 'translate-x-5' : ''}`} />
                    </div>
                  </div>
                  <span className="text-sm text-gray-700 dark:text-gray-300">{form.activo ? 'Activo' : 'Inactivo'}</span>
                </label>
              </div>
            )}

            {/* Atributos de tracking */}
            {canEdit && (
              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 space-y-3">
                <h2 className="font-semibold text-gray-700 dark:text-gray-300">Tracking de inventario</h2>
                <p className="text-xs text-gray-400 dark:text-gray-500">Activá los atributos que aplican a este producto</p>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    Regla de inventario
                    <span className="ml-1 text-gray-400 dark:text-gray-500 font-normal">(vacío = usar la regla del negocio)</span>
                  </label>
                  <select value={form.regla_inventario}
                    onChange={e => setForm(p => ({ ...p, regla_inventario: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent">
                    <option value="">— Usar regla del negocio —</option>
                    {REGLAS_INVENTARIO.map(r => (
                      <option key={r.value} value={r.value}>{r.label} — {r.desc}</option>
                    ))}
                  </select>
                </div>
                {agingProfiles.length > 0 && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      Aging Profile
                      <span className="ml-1 text-gray-400 dark:text-gray-500 font-normal">(requiere fecha de vencimiento activa)</span>
                    </label>
                    <select value={form.aging_profile_id}
                      onChange={e => setForm(p => ({ ...p, aging_profile_id: e.target.value }))}
                      disabled={!form.tiene_vencimiento}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent disabled:opacity-50 disabled:bg-gray-50 dark:bg-gray-700">
                      <option value="">— Sin aging profile —</option>
                      {(agingProfiles as any[]).map((ap: any) => (
                        <option key={ap.id} value={ap.id}>{ap.nombre}</option>
                      ))}
                    </select>
                  </div>
                )}
                {[
                  { key: 'tiene_series', label: 'Control por número de serie', desc: 'Cada unidad tiene su propio N° de serie' },
                  { key: 'tiene_lote', label: 'Control por lote', desc: 'El stock se agrupa por número de lote' },
                  { key: 'tiene_vencimiento', label: 'Fecha de vencimiento', desc: 'Registra fecha de vencimiento por línea' },
                  { key: 'es_kit', label: 'Es un KIT', desc: 'Se arma a partir de otros SKUs (kitting). Configurá la receta en Inventario → Kits.' },
                ].map(({ key, label, desc }) => (
                  <label key={key} className="flex items-start gap-3 cursor-pointer">
                    <div className="relative mt-0.5">
                      <input type="checkbox" checked={(form as any)[key]}
                        onChange={e => setForm(p => ({ ...p, [key]: e.target.checked }))} className="sr-only" />
                      <div className={`w-10 h-5 rounded-full transition-colors ${(form as any)[key] ? 'bg-accent' : 'bg-gray-300'}`}>
                        <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white dark:bg-gray-800 rounded-full shadow transition-transform ${(form as any)[key] ? 'translate-x-5' : ''}`} />
                      </div>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">{desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Marketplace — solo visible si tenant.marketplace_activo */}
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
                  <div className="relative ml-4 flex-shrink-0">
                    <input type="checkbox" checked={form.publicado_marketplace}
                      onChange={e => setForm(p => ({ ...p, publicado_marketplace: e.target.checked }))} className="sr-only" />
                    <div className={`w-11 h-6 rounded-full transition-colors ${form.publicado_marketplace ? 'bg-violet-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
                      <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.publicado_marketplace ? 'translate-x-5' : ''}`} />
                    </div>
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
    </div>
  )
}
