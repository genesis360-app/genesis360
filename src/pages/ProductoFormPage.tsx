import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Upload, X, RefreshCw, Package, Copy, DollarSign } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { usePlanLimits } from '@/hooks/usePlanLimits'
import { useCotizacion } from '@/hooks/useCotizacion'
import { PlanLimitModal } from '@/components/PlanLimitModal'
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
  const { tenant, user } = useAuthStore()
  const { limits } = usePlanLimits()
  const { cotizacion: cotizacionNum } = useCotizacion()
  const [showLimitModal, setShowLimitModal] = useState(false)

  const [form, setForm] = useState({
    nombre: '', sku: '', descripcion: '', categoria_id: '', proveedor_id: '',
    ubicacion_id: '', estado_id: '', precio_costo: '', precio_venta: '', stock_actual: '',
    stock_minimo: '', unidad_medida: 'unidad', codigo_barras: '', activo: true,
    tiene_series: false, tiene_lote: false, tiene_vencimiento: false,
  })
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [existingImageUrl, setExistingImageUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

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
      })
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
    if (!form.sku.trim()) return toast.error('El SKU es obligatorio')

    // Verificar límite de productos solo al crear (no al editar)
    if (!isEditing && limits && !limits.puede_crear_producto) {
      setShowLimitModal(true)
      return
    }

    setSaving(true)
    try {
      let imagen_url = existingImageUrl
      if (imageFile) {
        const ext = imageFile.name.split('.').pop()
        const path = `${tenant!.id}/${Date.now()}.${ext}`
        const { error: uploadError } = await supabase.storage.from('productos').upload(path, imageFile, { upsert: true })
        if (uploadError) throw uploadError
        const { data: urlData } = supabase.storage.from('productos').getPublicUrl(path)
        imagen_url = urlData.publicUrl
      }
      const payload = {
        tenant_id: tenant!.id,
        nombre: form.nombre.trim(), sku: form.sku.trim().toUpperCase(),
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
      }
      if (isEditing) {
        const { error } = await supabase.from('productos').update(payload).eq('id', id)
        if (error) throw error
        toast.success('Producto actualizado')
      } else {
        const { error } = await supabase.from('productos').insert(payload)
        if (error) { if (error.code === '23505') throw new Error('Ya existe un producto con ese SKU'); throw error }
        toast.success('Producto creado')
      }
      qc.invalidateQueries({ queryKey: ['productos'] })
      navigate('/inventario')
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
      qc.invalidateQueries({ queryKey: ['productos'] })
      navigate('/inventario')
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
      }
      const { data: newProd, error } = await supabase.from('productos').insert(payload).select().single()
      if (error) throw error
      toast.success('Producto duplicado')
      qc.invalidateQueries({ queryKey: ['productos'] })
      navigate(newProd?.id ? `/inventario/${newProd.id}/editar` : '/inventario')
    } catch (err: any) {
      toast.error(err.message ?? 'Error al duplicar')
    } finally {
      setSaving(false)
    }
  }

  const canEdit = user?.rol === 'OWNER' || user?.rol === 'SUPERVISOR' || user?.rol === 'ADMIN'

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {showLimitModal && limits && (
        <PlanLimitModal tipo="producto" limits={limits} onClose={() => setShowLimitModal(false)} />
      )}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/inventario')} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft size={20} className="text-gray-600" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-[#1E3A5F]">{isEditing ? 'Editar producto' : 'Nuevo producto'}</h1>
          <p className="text-gray-500 text-sm mt-0.5">{isEditing ? 'Modificá los datos del producto' : 'Completá los datos del nuevo producto'}</p>
        </div>
        {isEditing && canEdit && (
          <div className="flex gap-2">
            <button type="button" onClick={handleDuplicate} disabled={saving}
              className="flex items-center gap-2 px-3 py-2 text-sm text-[#1E3A5F] border border-gray-200 rounded-xl hover:bg-gray-50 transition-all disabled:opacity-50">
              <Copy size={15} /> Duplicar
            </button>
            <button type="button" onClick={handleDelete}
              className="flex items-center gap-2 px-3 py-2 text-sm text-red-500 border border-red-200 rounded-xl hover:bg-red-50 transition-all">
              Eliminar
            </button>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-5">

            {/* Datos básicos */}
            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 space-y-4">
              <h2 className="font-semibold text-gray-700">Datos básicos</h2>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre <span className="text-red-500">*</span></label>
                <input type="text" value={form.nombre} disabled={!canEdit}
                  onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))}
                  placeholder="Ej: Tornillo hexagonal 1/4"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#2E75B6] focus:ring-2 focus:ring-[#2E75B6]/20 disabled:bg-gray-50" />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">SKU <span className="text-red-500">*</span></label>
                  <div className="flex gap-2">
                    <input type="text" value={form.sku} disabled={!canEdit}
                      onChange={e => setForm(p => ({ ...p, sku: e.target.value.toUpperCase() }))}
                      placeholder="TORN-0001"
                      className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:border-[#2E75B6] disabled:bg-gray-50" />
                    {!isEditing && (
                      <button type="button" onClick={() => setForm(p => ({ ...p, sku: generateSKU(form.nombre) }))}
                        title="Generar SKU automático"
                        className="px-3 py-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-500 hover:text-[#1E3A5F] transition-colors">
                        <RefreshCw size={16} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Código de barras</label>
                  <input type="text" value={form.codigo_barras} disabled={!canEdit}
                    onChange={e => setForm(p => ({ ...p, codigo_barras: e.target.value }))}
                    placeholder="7791234567890"
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:border-[#2E75B6] disabled:bg-gray-50" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
                <textarea value={form.descripcion} disabled={!canEdit} rows={2}
                  onChange={e => setForm(p => ({ ...p, descripcion: e.target.value }))}
                  placeholder="Descripción opcional..."
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#2E75B6] resize-none disabled:bg-gray-50" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Categoría</label>
                  <select value={form.categoria_id} disabled={!canEdit}
                    onChange={e => setForm(p => ({ ...p, categoria_id: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#2E75B6] disabled:bg-gray-50">
                    <option value="">Sin categoría</option>
                    {(categorias as any[]).map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Proveedor</label>
                  <select value={form.proveedor_id} disabled={!canEdit}
                    onChange={e => setForm(p => ({ ...p, proveedor_id: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#2E75B6] disabled:bg-gray-50">
                    <option value="">Sin proveedor</option>
                    {(proveedores as any[]).map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Ubicación</label>
                  <select value={form.ubicacion_id} disabled={!canEdit}
                    onChange={e => setForm(p => ({ ...p, ubicacion_id: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#2E75B6] disabled:bg-gray-50">
                    <option value="">Sin ubicación</option>
                    {(ubicaciones as any[]).map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Precios y stock */}
            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-gray-700">Precios y stock</h2>
                {cotizacionNum > 0 ? (
                  <div className="flex items-center gap-1.5 bg-blue-50 px-2.5 py-1 rounded-lg">
                    <DollarSign size={12} className="text-blue-400" />
                    <span className="text-xs text-blue-600 font-medium">
                      $1 USD = ${cotizacionNum.toLocaleString('es-AR', { maximumFractionDigits: 0 })} ARS
                    </span>
                  </div>
                ) : (
                  <span className="text-xs text-gray-400">Sin cotización USD (configurar en el menú lateral)</span>
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
                        <label className="text-sm font-medium text-gray-700">Precio de costo</label>
                        {cotizNum > 0 && canEdit && (
                          <button type="button" onClick={toggleCosto}
                            className="text-xs text-[#2E75B6] hover:underline">
                            {usdModoCosto ? 'Ingresar en ARS' : 'Ingresar en USD'}
                          </button>
                        )}
                      </div>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">
                          {usdModoCosto ? 'USD' : '$'}
                        </span>
                        <input type="number" min="0" step="0.01" disabled={!canEdit}
                          value={usdModoCosto ? usdInputCosto : form.precio_costo}
                          onChange={e => {
                            if (usdModoCosto && cotizNum > 0) {
                              setUsdInputCosto(e.target.value)
                              setForm(p => ({ ...p, precio_costo: ((parseFloat(e.target.value) || 0) * cotizNum).toString() }))
                            } else {
                              setForm(p => ({ ...p, precio_costo: e.target.value }))
                            }
                          }}
                          className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#2E75B6] disabled:bg-gray-50" placeholder="0.00" />
                      </div>
                      {cotizNum > 0 && (parseFloat(form.precio_costo) || 0) > 0 && (
                        <p className="text-xs text-gray-400 mt-1">
                          {usdModoCosto
                            ? `= $${(parseFloat(form.precio_costo) || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })} ARS`
                            : `≈ USD ${((parseFloat(form.precio_costo) || 0) / cotizNum).toFixed(2)}`}
                        </p>
                      )}
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-sm font-medium text-gray-700">Precio de venta</label>
                        {cotizNum > 0 && canEdit && (
                          <button type="button" onClick={toggleVenta}
                            className="text-xs text-[#2E75B6] hover:underline">
                            {usdModoVenta ? 'Ingresar en ARS' : 'Ingresar en USD'}
                          </button>
                        )}
                      </div>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">
                          {usdModoVenta ? 'USD' : '$'}
                        </span>
                        <input type="number" min="0" step="0.01" disabled={!canEdit}
                          value={usdModoVenta ? usdInputVenta : form.precio_venta}
                          onChange={e => {
                            if (usdModoVenta && cotizNum > 0) {
                              setUsdInputVenta(e.target.value)
                              setForm(p => ({ ...p, precio_venta: ((parseFloat(e.target.value) || 0) * cotizNum).toString() }))
                            } else {
                              setForm(p => ({ ...p, precio_venta: e.target.value }))
                            }
                          }}
                          className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#2E75B6] disabled:bg-gray-50" placeholder="0.00" />
                      </div>
                      {cotizNum > 0 && (parseFloat(form.precio_venta) || 0) > 0 && (
                        <p className="text-xs text-gray-400 mt-1">
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
                  ${parseFloat(margen) >= 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                  Margen de ganancia: <span className="font-bold">{margen}%</span>
                  <span className="text-xs opacity-70 ml-1">
                    (ganancia: ${(parseFloat(form.precio_venta) - parseFloat(form.precio_costo)).toFixed(2)})
                  </span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Stock mínimo</label>
                  <p className="text-xs text-gray-400 mb-1">Alerta cuando el stock baje de este valor</p>
                  <input type="number" min="0" value={form.stock_minimo} disabled={!canEdit}
                    onChange={e => setForm(p => ({ ...p, stock_minimo: e.target.value }))}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#2E75B6] disabled:bg-gray-50" placeholder="0" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Unidad de medida</label>
                  <p className="text-xs text-gray-400 mb-1">Cómo se mide este producto</p>
                  <select value={form.unidad_medida} disabled={!canEdit}
                    onChange={e => setForm(p => ({ ...p, unidad_medida: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#2E75B6] disabled:bg-gray-50">
                    {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
              {!isEditing && (
                <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-sm text-blue-700">
                  <span>💡</span>
                  <span>Para ingresar stock, usá <strong>Movimientos → Ingreso</strong> una vez creado el producto.</span>
                </div>
              )}
            </div>
          </div>

          {/* Columna imagen + estado */}
          <div className="space-y-5">
            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 space-y-3">
              <h2 className="font-semibold text-gray-700">Imagen</h2>
              <div className="aspect-square rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center overflow-hidden bg-gray-50 relative">
                {imagePreview || existingImageUrl ? (
                  <>
                    <img src={imagePreview ?? existingImageUrl!} alt="Preview" className="w-full h-full object-cover" />
                    {canEdit && (
                      <button type="button"
                        onClick={() => { setImageFile(null); setImagePreview(null); setExistingImageUrl(null) }}
                        className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600">
                        <X size={14} />
                      </button>
                    )}
                  </>
                ) : (
                  <div className="text-center text-gray-400">
                    <Package size={32} className="mx-auto mb-2 opacity-40" />
                    <p className="text-xs">Sin imagen</p>
                  </div>
                )}
              </div>
              {canEdit && (
                <label className="flex items-center justify-center gap-2 w-full border border-gray-200 rounded-xl py-2.5 text-sm text-gray-600 hover:bg-gray-50 cursor-pointer transition-colors">
                  <Upload size={15} />
                  {imagePreview || existingImageUrl ? 'Cambiar imagen' : 'Subir imagen'}
                  <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
                </label>
              )}
              <p className="text-xs text-gray-400 text-center">JPG, PNG o WEBP. Máx 2MB</p>
            </div>

            {isEditing && canEdit && (
              <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                <h2 className="font-semibold text-gray-700 mb-3">Estado</h2>
                <label className="flex items-center gap-3 cursor-pointer">
                  <div className="relative">
                    <input type="checkbox" checked={form.activo}
                      onChange={e => setForm(p => ({ ...p, activo: e.target.checked }))} className="sr-only" />
                    <div className={`w-11 h-6 rounded-full transition-colors ${form.activo ? 'bg-green-500' : 'bg-gray-300'}`}>
                      <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.activo ? 'translate-x-5' : ''}`} />
                    </div>
                  </div>
                  <span className="text-sm text-gray-700">{form.activo ? 'Activo' : 'Inactivo'}</span>
                </label>
              </div>
            )}

            {/* Atributos de tracking */}
            {canEdit && (
              <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 space-y-3">
                <h2 className="font-semibold text-gray-700">Tracking de inventario</h2>
                <p className="text-xs text-gray-400">Activá los atributos que aplican a este producto</p>
                {[
                  { key: 'tiene_series', label: 'Control por número de serie', desc: 'Cada unidad tiene su propio N° de serie' },
                  { key: 'tiene_lote', label: 'Control por lote', desc: 'El stock se agrupa por número de lote' },
                  { key: 'tiene_vencimiento', label: 'Fecha de vencimiento', desc: 'Registra fecha de vencimiento por línea' },
                ].map(({ key, label, desc }) => (
                  <label key={key} className="flex items-start gap-3 cursor-pointer">
                    <div className="relative mt-0.5">
                      <input type="checkbox" checked={(form as any)[key]}
                        onChange={e => setForm(p => ({ ...p, [key]: e.target.checked }))} className="sr-only" />
                      <div className={`w-10 h-5 rounded-full transition-colors ${(form as any)[key] ? 'bg-[#2E75B6]' : 'bg-gray-300'}`}>
                        <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${(form as any)[key] ? 'translate-x-5' : ''}`} />
                      </div>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-700">{label}</p>
                      <p className="text-xs text-gray-400">{desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        {canEdit && (
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={() => navigate('/inventario')}
              className="px-6 py-2.5 border-2 border-gray-200 text-gray-600 font-semibold rounded-xl hover:border-gray-300 transition-all">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="px-6 py-2.5 bg-[#1E3A5F] hover:bg-[#2E75B6] text-white font-semibold rounded-xl transition-all disabled:opacity-60">
              {saving ? 'Guardando...' : isEditing ? 'Guardar cambios' : 'Crear producto'}
            </button>
          </div>
        )}
      </form>
    </div>
  )
}
