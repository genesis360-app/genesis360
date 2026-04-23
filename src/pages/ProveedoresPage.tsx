import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { logActividad } from '@/lib/actividadLog'
import { Proveedor, OrdenCompra, OrdenCompraItem, Producto } from '@/lib/supabase'
import toast from 'react-hot-toast'
import {
  Truck, Plus, Pencil, Trash2, Search, ChevronDown, ChevronUp,
  FileText, Send, CheckCircle, XCircle, Package, Hash, Calendar,
  Phone, Mail, MapPin, CreditCard, Building, Clock, ToggleLeft, ToggleRight,
  Warehouse,
} from 'lucide-react'

type Tab = 'proveedores' | 'ordenes'
type EstadoOC = 'borrador' | 'enviada' | 'confirmada' | 'cancelada'

interface FormProv {
  nombre: string
  razon_social: string
  cuit: string
  contacto: string
  telefono: string
  email: string
  condicion_iva: string
  plazo_pago_dias: string
  banco: string
  cbu: string
  domicilio: string
  notas: string
}

const FORM_PROV_EMPTY: FormProv = {
  nombre: '', razon_social: '', cuit: '', contacto: '', telefono: '',
  email: '', condicion_iva: '', plazo_pago_dias: '', banco: '', cbu: '',
  domicilio: '', notas: '',
}

interface FormOC {
  proveedor_id: string
  fecha_esperada: string
  notas: string
}

interface FormOCItem {
  _key: number
  producto_id: string
  cantidad: string
  precio_unitario: string
  notas: string
}

const ESTADO_OC_LABEL: Record<EstadoOC, string> = {
  borrador: 'Borrador', enviada: 'Enviada', confirmada: 'Confirmada', cancelada: 'Cancelada',
}
const ESTADO_OC_COLOR: Record<EstadoOC, string> = {
  borrador: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  enviada: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  confirmada: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  cancelada: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}
const CONDICION_IVA_LABEL: Record<string, string> = {
  responsable_inscripto: 'Responsable Inscripto',
  monotributo: 'Monotributo',
  exento: 'Exento',
  consumidor_final: 'Consumidor Final',
}

let itemKey = 0

export default function ProveedoresPage() {
  const { tenant } = useAuthStore()
  const qc = useQueryClient()
  const navigate = useNavigate()

  const [tab, setTab] = useState<Tab>('proveedores')

  // ── Proveedores state ──────────────────────────────────────────────────────
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<FormProv>(FORM_PROV_EMPTY)

  // ── OC state ───────────────────────────────────────────────────────────────
  const [ocSearch, setOcSearch] = useState('')
  const [ocFiltroEstado, setOcFiltroEstado] = useState<EstadoOC | ''>('')
  const [ocFiltroProv, setOcFiltroProv] = useState('')
  const [showOcForm, setShowOcForm] = useState(false)
  const [editOcId, setEditOcId] = useState<string | null>(null)
  const [ocForm, setOcForm] = useState<FormOC>({ proveedor_id: '', fecha_esperada: '', notas: '' })
  const [ocItems, setOcItems] = useState<FormOCItem[]>([])
  const [expandedOc, setExpandedOc] = useState<string | null>(null)
  const [showOcDetail, setShowOcDetail] = useState<OrdenCompra | null>(null)

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: proveedores = [], isLoading: loadingProv } = useQuery({
    queryKey: ['proveedores', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('proveedores')
        .select('*')
        .eq('tenant_id', tenant!.id)
        .order('nombre')
      return (data ?? []) as Proveedor[]
    },
    enabled: !!tenant,
  })

  const { data: ordenes = [], isLoading: loadingOC } = useQuery({
    queryKey: ['ordenes_compra', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('ordenes_compra')
        .select('*, proveedores(id, nombre)')
        .eq('tenant_id', tenant!.id)
        .order('numero', { ascending: false })
      return (data ?? []) as OrdenCompra[]
    },
    enabled: !!tenant && tab === 'ordenes',
  })

  const { data: productos = [] } = useQuery({
    queryKey: ['productos-activos', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('productos')
        .select('id, nombre, sku, unidad_medida, precio_costo')
        .eq('tenant_id', tenant!.id)
        .eq('activo', true)
        .order('nombre')
      return (data ?? []) as Pick<Producto, 'id' | 'nombre' | 'sku' | 'unidad_medida' | 'precio_costo'>[]
    },
    enabled: !!tenant && (showOcForm || tab === 'ordenes'),
  })

  const { data: ocItemsData = [] } = useQuery({
    queryKey: ['oc-items', showOcDetail?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('orden_compra_items')
        .select('*, productos(id, nombre, sku, unidad_medida, precio_costo)')
        .eq('orden_compra_id', showOcDetail!.id)
        .order('id')
      return (data ?? []) as OrdenCompraItem[]
    },
    enabled: !!showOcDetail,
  })

  // ── Proveedor mutations ────────────────────────────────────────────────────
  const saveProveedor = useMutation({
    mutationFn: async () => {
      const payload = {
        nombre: form.nombre.trim(),
        razon_social: form.razon_social.trim() || null,
        cuit: form.cuit.trim() || null,
        contacto: form.contacto.trim() || null,
        telefono: form.telefono.trim() || null,
        email: form.email.trim() || null,
        condicion_iva: form.condicion_iva || null,
        plazo_pago_dias: form.plazo_pago_dias ? parseInt(form.plazo_pago_dias) : null,
        banco: form.banco.trim() || null,
        cbu: form.cbu.trim() || null,
        domicilio: form.domicilio.trim() || null,
        notas: form.notas.trim() || null,
      }
      if (editId) {
        const { error } = await supabase.from('proveedores').update(payload).eq('id', editId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('proveedores').insert({ ...payload, tenant_id: tenant!.id })
        if (error) throw error
      }
    },
    onSuccess: () => {
      toast.success(editId ? 'Proveedor actualizado' : 'Proveedor creado')
      logActividad({ entidad: 'proveedor', entidad_nombre: form.nombre, accion: editId ? 'editar' : 'crear', pagina: '/proveedores' })
      qc.invalidateQueries({ queryKey: ['proveedores'] })
      setShowForm(false)
      setEditId(null)
      setForm(FORM_PROV_EMPTY)
    },
    onError: (e: any) => toast.error(e.message),
  })

  const toggleActivo = useMutation({
    mutationFn: async ({ id, activo }: { id: string; activo: boolean }) => {
      const { error } = await supabase.from('proveedores').update({ activo: !activo }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['proveedores'] }),
    onError: (e: any) => toast.error(e.message),
  })

  const deleteProveedor = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('proveedores').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Proveedor eliminado')
      qc.invalidateQueries({ queryKey: ['proveedores'] })
    },
    onError: () => toast.error('No se puede eliminar — tiene productos o movimientos asociados'),
  })

  // ── OC mutations ───────────────────────────────────────────────────────────
  const saveOC = useMutation({
    mutationFn: async () => {
      if (!ocForm.proveedor_id) throw new Error('Seleccioná un proveedor')
      if (ocItems.length === 0) throw new Error('Agregá al menos un producto')
      for (const it of ocItems) {
        if (!it.producto_id) throw new Error('Seleccioná un producto en cada línea')
        if (!it.cantidad || parseFloat(it.cantidad) <= 0) throw new Error('Cantidad inválida')
      }

      let ocId: string
      if (editOcId) {
        const { error } = await supabase.from('ordenes_compra').update({
          proveedor_id: ocForm.proveedor_id,
          fecha_esperada: ocForm.fecha_esperada || null,
          notas: ocForm.notas.trim() || null,
        }).eq('id', editOcId)
        if (error) throw error
        ocId = editOcId
        // reemplazar ítems
        await supabase.from('orden_compra_items').delete().eq('orden_compra_id', ocId)
      } else {
        const { data, error } = await supabase.from('ordenes_compra').insert({
          tenant_id: tenant!.id,
          proveedor_id: ocForm.proveedor_id,
          numero: 0,
          fecha_esperada: ocForm.fecha_esperada || null,
          notas: ocForm.notas.trim() || null,
          created_by: (await supabase.auth.getUser()).data.user?.id,
        }).select('id').single()
        if (error) throw error
        ocId = data.id
      }

      const itemsPayload = ocItems.map(it => ({
        orden_compra_id: ocId,
        producto_id: it.producto_id,
        cantidad: parseFloat(it.cantidad),
        precio_unitario: it.precio_unitario ? parseFloat(it.precio_unitario) : null,
        notas: it.notas.trim() || null,
      }))
      const { error: errItems } = await supabase.from('orden_compra_items').insert(itemsPayload)
      if (errItems) throw errItems
    },
    onSuccess: () => {
      toast.success(editOcId ? 'OC actualizada' : 'OC creada')
      qc.invalidateQueries({ queryKey: ['ordenes_compra'] })
      closeOcForm()
    },
    onError: (e: any) => toast.error(e.message),
  })

  const cambiarEstadoOC = useMutation({
    mutationFn: async ({ id, estado }: { id: string; estado: EstadoOC }) => {
      const { error } = await supabase.from('ordenes_compra').update({ estado }).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_, vars) => {
      toast.success(`OC ${ESTADO_OC_LABEL[vars.estado].toLowerCase()}`)
      qc.invalidateQueries({ queryKey: ['ordenes_compra'] })
      if (showOcDetail?.id === vars.id) setShowOcDetail(prev => prev ? { ...prev, estado: vars.estado } : null)
    },
    onError: (e: any) => toast.error(e.message),
  })

  const deleteOC = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('ordenes_compra').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('OC eliminada')
      qc.invalidateQueries({ queryKey: ['ordenes_compra'] })
    },
    onError: (e: any) => toast.error(e.message),
  })

  // ── Helpers ────────────────────────────────────────────────────────────────
  const openEditProv = (p: Proveedor) => {
    setEditId(p.id)
    setForm({
      nombre: p.nombre ?? '',
      razon_social: p.razon_social ?? '',
      cuit: p.cuit ?? '',
      contacto: p.contacto ?? '',
      telefono: p.telefono ?? '',
      email: p.email ?? '',
      condicion_iva: p.condicion_iva ?? '',
      plazo_pago_dias: p.plazo_pago_dias?.toString() ?? '',
      banco: p.banco ?? '',
      cbu: p.cbu ?? '',
      domicilio: p.domicilio ?? '',
      notas: p.notas ?? '',
    })
    setShowForm(true)
  }

  const closeProvForm = () => {
    setShowForm(false)
    setEditId(null)
    setForm(FORM_PROV_EMPTY)
  }

  const openNewOC = () => {
    setEditOcId(null)
    setOcForm({ proveedor_id: '', fecha_esperada: '', notas: '' })
    setOcItems([{ _key: ++itemKey, producto_id: '', cantidad: '', precio_unitario: '', notas: '' }])
    setShowOcForm(true)
  }

  const openEditOC = async (oc: OrdenCompra) => {
    const { data } = await supabase
      .from('orden_compra_items')
      .select('*')
      .eq('orden_compra_id', oc.id)
    setEditOcId(oc.id)
    setOcForm({
      proveedor_id: oc.proveedor_id,
      fecha_esperada: oc.fecha_esperada ?? '',
      notas: oc.notas ?? '',
    })
    setOcItems((data ?? []).map(it => ({
      _key: ++itemKey,
      producto_id: it.producto_id,
      cantidad: it.cantidad.toString(),
      precio_unitario: it.precio_unitario?.toString() ?? '',
      notas: it.notas ?? '',
    })))
    setShowOcForm(true)
  }

  const closeOcForm = () => {
    setShowOcForm(false)
    setEditOcId(null)
    setOcForm({ proveedor_id: '', fecha_esperada: '', notas: '' })
    setOcItems([])
  }

  const addOcItem = () =>
    setOcItems(prev => [...prev, { _key: ++itemKey, producto_id: '', cantidad: '', precio_unitario: '', notas: '' }])

  const removeOcItem = (key: number) =>
    setOcItems(prev => prev.filter(it => it._key !== key))

  const updateOcItem = (key: number, field: keyof Omit<FormOCItem, '_key'>, value: string) =>
    setOcItems(prev => prev.map(it => it._key === key ? { ...it, [field]: value } : it))

  // ── Filtered data ──────────────────────────────────────────────────────────
  const filteredProv = proveedores.filter(p => {
    if (!search) return true
    const s = search.toLowerCase()
    return p.nombre.toLowerCase().includes(s) ||
      p.razon_social?.toLowerCase().includes(s) ||
      p.cuit?.toLowerCase().includes(s) ||
      p.contacto?.toLowerCase().includes(s)
  })

  const filteredOrdenes = ordenes.filter(oc => {
    if (ocFiltroEstado && oc.estado !== ocFiltroEstado) return false
    if (ocFiltroProv && oc.proveedor_id !== ocFiltroProv) return false
    if (ocSearch) {
      const s = ocSearch.toLowerCase()
      const pNombre = (oc as any).proveedores?.nombre?.toLowerCase() ?? ''
      if (!pNombre.includes(s) && !`${oc.numero}`.includes(s)) return false
    }
    return true
  })

  // ── Tabs bar ───────────────────────────────────────────────────────────────
  const tabs: { id: Tab; label: string }[] = [
    { id: 'proveedores', label: 'Proveedores' },
    { id: 'ordenes', label: 'Órdenes de compra' },
  ]

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Truck className="w-5 h-5 text-accent" />
          <h1 className="text-xl font-bold text-primary">Proveedores</h1>
        </div>
        {tab === 'proveedores' && (
          <button
            onClick={() => { setEditId(null); setForm(FORM_PROV_EMPTY); setShowForm(true) }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white rounded-lg text-sm hover:bg-accent/90"
          >
            <Plus className="w-4 h-4" /> Nuevo proveedor
          </button>
        )}
        {tab === 'ordenes' && (
          <button
            onClick={openNewOC}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white rounded-lg text-sm hover:bg-accent/90"
          >
            <Plus className="w-4 h-4" /> Nueva OC
          </button>
        )}
      </div>

      {/* Tab bar */}
      <div className="border-b border-border-ds">
        <div className="flex gap-0 -mb-px">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-accent text-accent'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-primary'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab Proveedores ─────────────────────────────────────────────────── */}
      {tab === 'proveedores' && (
        <div className="space-y-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
            <input
              className="w-full pl-9 pr-3 py-2 border border-border-ds rounded-lg bg-surface text-sm text-primary"
              placeholder="Buscar por nombre, CUIT, contacto…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {loadingProv ? (
            <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent" /></div>
          ) : filteredProv.length === 0 ? (
            <div className="text-center py-12 text-muted">
              <Truck className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p>{search ? 'Sin resultados' : 'No hay proveedores cargados'}</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {filteredProv.map(p => (
                <div key={p.id} className={`bg-surface rounded-xl shadow-sm border border-border-ds p-4 ${!p.activo ? 'opacity-60' : ''}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-primary">{p.nombre}</span>
                        {p.razon_social && p.razon_social !== p.nombre && (
                          <span className="text-xs text-muted">({p.razon_social})</span>
                        )}
                        {!p.activo && (
                          <span className="text-xs bg-gray-100 dark:bg-gray-700 text-muted px-2 py-0.5 rounded-full">Inactivo</span>
                        )}
                        {p.condicion_iva && (
                          <span className="text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full">
                            {CONDICION_IVA_LABEL[p.condicion_iva]}
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                        {p.cuit && <span className="flex items-center gap-1"><Hash className="w-3 h-3" />{p.cuit}</span>}
                        {p.contacto && <span className="flex items-center gap-1"><Building className="w-3 h-3" />{p.contacto}</span>}
                        {p.telefono && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{p.telefono}</span>}
                        {p.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{p.email}</span>}
                        {p.domicilio && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{p.domicilio}</span>}
                        {p.plazo_pago_dias != null && (
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />Plazo {p.plazo_pago_dias}d</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => toggleActivo.mutate({ id: p.id, activo: p.activo })}
                        className="p-1.5 rounded text-muted hover:text-primary"
                        title={p.activo ? 'Desactivar' : 'Activar'}
                      >
                        {p.activo
                          ? <ToggleRight className="w-5 h-5 text-green-500" />
                          : <ToggleLeft className="w-5 h-5" />}
                      </button>
                      <button
                        onClick={() => openEditProv(p)}
                        className="p-1.5 rounded text-muted hover:text-primary"
                        title="Editar"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => { if (confirm('¿Eliminar este proveedor?')) deleteProveedor.mutate(p.id) }}
                        className="p-1.5 rounded text-muted hover:text-red-500"
                        title="Eliminar"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tab Órdenes de compra ────────────────────────────────────────────── */}
      {tab === 'ordenes' && (
        <div className="space-y-4">
          {/* Filtros */}
          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
              <input
                className="pl-9 pr-3 py-2 border border-border-ds rounded-lg bg-surface text-sm text-primary"
                placeholder="Buscar OC o proveedor…"
                value={ocSearch}
                onChange={e => setOcSearch(e.target.value)}
              />
            </div>
            <select
              className="px-3 py-2 border border-border-ds rounded-lg bg-surface text-sm text-primary"
              value={ocFiltroProv}
              onChange={e => setOcFiltroProv(e.target.value)}
            >
              <option value="">Todos los proveedores</option>
              {proveedores.filter(p => p.activo).map(p => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </select>
            <select
              className="px-3 py-2 border border-border-ds rounded-lg bg-surface text-sm text-primary"
              value={ocFiltroEstado}
              onChange={e => setOcFiltroEstado(e.target.value as EstadoOC | '')}
            >
              <option value="">Todos los estados</option>
              {(Object.keys(ESTADO_OC_LABEL) as EstadoOC[]).map(e => (
                <option key={e} value={e}>{ESTADO_OC_LABEL[e]}</option>
              ))}
            </select>
          </div>

          {loadingOC ? (
            <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent" /></div>
          ) : filteredOrdenes.length === 0 ? (
            <div className="text-center py-12 text-muted">
              <FileText className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p>No hay órdenes de compra</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {filteredOrdenes.map(oc => {
                const isExpanded = expandedOc === oc.id
                return (
                  <div key={oc.id} className="bg-surface rounded-xl shadow-sm border border-border-ds overflow-hidden">
                    <div className="flex items-center gap-3 p-4">
                      {/* OC number */}
                      <span className="text-sm font-bold text-primary shrink-0">OC #{oc.numero}</span>

                      {/* Proveedor */}
                      <span className="text-sm text-primary flex-1 truncate">
                        {(oc as any).proveedores?.nombre ?? '—'}
                      </span>

                      {/* Estado badge */}
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${ESTADO_OC_COLOR[oc.estado as EstadoOC]}`}>
                        {ESTADO_OC_LABEL[oc.estado as EstadoOC]}
                      </span>

                      {/* Fecha */}
                      {oc.fecha_esperada && (
                        <span className="text-xs text-muted shrink-0 flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(oc.fecha_esperada + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                        </span>
                      )}

                      {/* Acciones */}
                      <div className="flex items-center gap-1 shrink-0">
                        {/* Ver detalle */}
                        <button
                          onClick={() => { setShowOcDetail(oc); setExpandedOc(null) }}
                          className="p-1.5 rounded text-muted hover:text-primary"
                          title="Ver detalle"
                        >
                          <FileText className="w-4 h-4" />
                        </button>

                        {/* Editar — solo borrador */}
                        {oc.estado === 'borrador' && (
                          <button
                            onClick={() => openEditOC(oc)}
                            className="p-1.5 rounded text-muted hover:text-primary"
                            title="Editar"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        )}

                        {/* Lifecycle */}
                        {oc.estado === 'borrador' && (
                          <button
                            onClick={() => cambiarEstadoOC.mutate({ id: oc.id, estado: 'enviada' })}
                            className="p-1.5 rounded text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                            title="Enviar al proveedor"
                          >
                            <Send className="w-4 h-4" />
                          </button>
                        )}
                        {oc.estado === 'enviada' && (
                          <button
                            onClick={() => cambiarEstadoOC.mutate({ id: oc.id, estado: 'confirmada' })}
                            className="p-1.5 rounded text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20"
                            title="Confirmar"
                          >
                            <CheckCircle className="w-4 h-4" />
                          </button>
                        )}
                        {oc.estado === 'confirmada' && (
                          <button
                            onClick={() => navigate(`/recepciones?oc_id=${oc.id}&proveedor_id=${oc.proveedor_id}`)}
                            className="p-1.5 rounded text-accent hover:bg-accent/10"
                            title="Recibir mercadería"
                          >
                            <Warehouse className="w-4 h-4" />
                          </button>
                        )}
                        {(oc.estado === 'borrador' || oc.estado === 'enviada' || oc.estado === 'confirmada') && (
                          <button
                            onClick={() => { if (confirm('¿Cancelar esta OC?')) cambiarEstadoOC.mutate({ id: oc.id, estado: 'cancelada' }) }}
                            className="p-1.5 rounded text-muted hover:text-red-500"
                            title="Cancelar OC"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        )}

                        {/* Eliminar — solo borrador */}
                        {oc.estado === 'borrador' && (
                          <button
                            onClick={() => { if (confirm('¿Eliminar esta OC?')) deleteOC.mutate(oc.id) }}
                            className="p-1.5 rounded text-muted hover:text-red-500"
                            title="Eliminar"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}

                        {/* Toggle expand items */}
                        <button
                          onClick={() => setExpandedOc(isExpanded ? null : oc.id)}
                          className="p-1.5 rounded text-muted hover:text-primary"
                          title={isExpanded ? 'Colapsar' : 'Ver ítems'}
                        >
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    {/* Inline items preview */}
                    {isExpanded && (
                      <InlineOCItems ocId={oc.id} />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Modal proveedor ──────────────────────────────────────────────────── */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h2 className="text-lg font-bold text-primary mb-4">
                {editId ? 'Editar proveedor' : 'Nuevo proveedor'}
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Nombre */}
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-muted mb-1">Nombre comercial *</label>
                  <input
                    className="w-full px-3 py-2 border border-border-ds rounded-lg bg-page text-primary text-sm"
                    value={form.nombre}
                    onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                    placeholder="Ej: Distribuidora Central"
                  />
                </div>
                {/* Razón social */}
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">Razón social</label>
                  <input
                    className="w-full px-3 py-2 border border-border-ds rounded-lg bg-page text-primary text-sm"
                    value={form.razon_social}
                    onChange={e => setForm(f => ({ ...f, razon_social: e.target.value }))}
                    placeholder="Razón social jurídica"
                  />
                </div>
                {/* CUIT */}
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">CUIT</label>
                  <input
                    className="w-full px-3 py-2 border border-border-ds rounded-lg bg-page text-primary text-sm"
                    value={form.cuit}
                    onChange={e => setForm(f => ({ ...f, cuit: e.target.value }))}
                    placeholder="20-12345678-9"
                  />
                </div>
                {/* Condición IVA */}
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">Condición IVA</label>
                  <select
                    className="w-full px-3 py-2 border border-border-ds rounded-lg bg-page text-primary text-sm"
                    value={form.condicion_iva}
                    onChange={e => setForm(f => ({ ...f, condicion_iva: e.target.value }))}
                  >
                    <option value="">Sin especificar</option>
                    {Object.entries(CONDICION_IVA_LABEL).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </div>
                {/* Contacto */}
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">Contacto</label>
                  <input
                    className="w-full px-3 py-2 border border-border-ds rounded-lg bg-page text-primary text-sm"
                    value={form.contacto}
                    onChange={e => setForm(f => ({ ...f, contacto: e.target.value }))}
                    placeholder="Nombre del contacto"
                  />
                </div>
                {/* Teléfono */}
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">Teléfono</label>
                  <input
                    className="w-full px-3 py-2 border border-border-ds rounded-lg bg-page text-primary text-sm"
                    value={form.telefono}
                    onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))}
                    placeholder="+54 11 1234-5678"
                  />
                </div>
                {/* Email */}
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">Email</label>
                  <input
                    type="email"
                    className="w-full px-3 py-2 border border-border-ds rounded-lg bg-page text-primary text-sm"
                    value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="contacto@proveedor.com"
                  />
                </div>
                {/* Domicilio */}
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-muted mb-1">Domicilio</label>
                  <input
                    className="w-full px-3 py-2 border border-border-ds rounded-lg bg-page text-primary text-sm"
                    value={form.domicilio}
                    onChange={e => setForm(f => ({ ...f, domicilio: e.target.value }))}
                    placeholder="Dirección completa"
                  />
                </div>
                {/* Plazo de pago */}
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">Plazo de pago (días)</label>
                  <input
                    type="number"
                    min={0}
                    className="w-full px-3 py-2 border border-border-ds rounded-lg bg-page text-primary text-sm"
                    value={form.plazo_pago_dias}
                    onChange={e => setForm(f => ({ ...f, plazo_pago_dias: e.target.value }))}
                    onWheel={e => e.currentTarget.blur()}
                    placeholder="Ej: 30"
                  />
                </div>
                {/* Banco */}
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">Banco</label>
                  <input
                    className="w-full px-3 py-2 border border-border-ds rounded-lg bg-page text-primary text-sm"
                    value={form.banco}
                    onChange={e => setForm(f => ({ ...f, banco: e.target.value }))}
                    placeholder="Ej: Banco Nación"
                  />
                </div>
                {/* CBU */}
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-muted mb-1">CBU / Alias</label>
                  <input
                    className="w-full px-3 py-2 border border-border-ds rounded-lg bg-page text-primary text-sm"
                    value={form.cbu}
                    onChange={e => setForm(f => ({ ...f, cbu: e.target.value }))}
                    placeholder="CBU o alias para transferencias"
                  />
                </div>
                {/* Notas */}
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-muted mb-1">Notas</label>
                  <textarea
                    rows={2}
                    className="w-full px-3 py-2 border border-border-ds rounded-lg bg-page text-primary text-sm resize-none"
                    value={form.notas}
                    onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                    placeholder="Notas adicionales sobre el proveedor"
                  />
                </div>
              </div>

              <div className="flex gap-2 justify-end mt-6">
                <button onClick={closeProvForm} className="px-4 py-2 rounded-lg text-sm border border-border-ds text-primary hover:bg-page">
                  Cancelar
                </button>
                <button
                  onClick={() => { if (!form.nombre.trim()) { toast.error('El nombre es obligatorio'); return } saveProveedor.mutate() }}
                  disabled={saveProveedor.isPending}
                  className="px-4 py-2 rounded-lg text-sm bg-accent text-white hover:bg-accent/90 disabled:opacity-50"
                >
                  {saveProveedor.isPending ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal OC ─────────────────────────────────────────────────────────── */}
      {showOcForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h2 className="text-lg font-bold text-primary mb-4">
                {editOcId ? `Editar OC #${ordenes.find(o => o.id === editOcId)?.numero}` : 'Nueva orden de compra'}
              </h2>

              {/* Header OC */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">Proveedor *</label>
                  <select
                    className="w-full px-3 py-2 border border-border-ds rounded-lg bg-page text-primary text-sm"
                    value={ocForm.proveedor_id}
                    onChange={e => setOcForm(f => ({ ...f, proveedor_id: e.target.value }))}
                  >
                    <option value="">Seleccioná un proveedor…</option>
                    {proveedores.filter(p => p.activo).map(p => (
                      <option key={p.id} value={p.id}>{p.nombre}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">Fecha esperada de entrega</label>
                  <input
                    type="date"
                    className="w-full px-3 py-2 border border-border-ds rounded-lg bg-page text-primary text-sm"
                    value={ocForm.fecha_esperada}
                    onChange={e => setOcForm(f => ({ ...f, fecha_esperada: e.target.value }))}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-muted mb-1">Notas</label>
                  <textarea
                    rows={2}
                    className="w-full px-3 py-2 border border-border-ds rounded-lg bg-page text-primary text-sm resize-none"
                    value={ocForm.notas}
                    onChange={e => setOcForm(f => ({ ...f, notas: e.target.value }))}
                    placeholder="Condiciones, referencias, notas para el proveedor…"
                  />
                </div>
              </div>

              {/* Items */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-primary">Productos a pedir</h3>
                  <button
                    onClick={addOcItem}
                    className="flex items-center gap-1 text-xs text-accent hover:underline"
                  >
                    <Plus className="w-3 h-3" /> Agregar línea
                  </button>
                </div>
                <div className="space-y-2">
                  {ocItems.map(it => {
                    const prod = productos.find(p => p.id === it.producto_id)
                    return (
                      <div key={it._key} className="flex gap-2 items-start">
                        {/* Producto */}
                        <div className="flex-1 min-w-0">
                          <select
                            className="w-full px-2 py-1.5 border border-border-ds rounded-lg bg-page text-primary text-sm"
                            value={it.producto_id}
                            onChange={e => {
                              const p = productos.find(x => x.id === e.target.value)
                              updateOcItem(it._key, 'producto_id', e.target.value)
                              if (p && !it.precio_unitario) {
                                updateOcItem(it._key, 'precio_unitario', p.precio_costo?.toString() ?? '')
                              }
                            }}
                          >
                            <option value="">Seleccioná producto…</option>
                            {productos.map(p => (
                              <option key={p.id} value={p.id}>{p.nombre} ({p.sku})</option>
                            ))}
                          </select>
                        </div>
                        {/* Cantidad */}
                        <div className="w-24 shrink-0">
                          <input
                            type="number"
                            min={0}
                            step="0.001"
                            className="w-full px-2 py-1.5 border border-border-ds rounded-lg bg-page text-primary text-sm"
                            placeholder={`Cant. ${prod?.unidad_medida ?? ''}`}
                            value={it.cantidad}
                            onChange={e => updateOcItem(it._key, 'cantidad', e.target.value)}
                            onWheel={e => e.currentTarget.blur()}
                          />
                        </div>
                        {/* Precio unitario */}
                        <div className="w-28 shrink-0">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            className="w-full px-2 py-1.5 border border-border-ds rounded-lg bg-page text-primary text-sm"
                            placeholder="Precio unit."
                            value={it.precio_unitario}
                            onChange={e => updateOcItem(it._key, 'precio_unitario', e.target.value)}
                            onWheel={e => e.currentTarget.blur()}
                          />
                        </div>
                        {/* Remove */}
                        <button
                          onClick={() => removeOcItem(it._key)}
                          className="p-1.5 text-muted hover:text-red-500 mt-0.5 shrink-0"
                          title="Quitar línea"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )
                  })}
                </div>

                {/* Total estimado */}
                {ocItems.some(it => it.precio_unitario && it.cantidad) && (
                  <div className="mt-3 text-right text-sm font-semibold text-primary">
                    Total estimado: ${ocItems.reduce((sum, it) => {
                      const q = parseFloat(it.cantidad) || 0
                      const p = parseFloat(it.precio_unitario) || 0
                      return sum + q * p
                    }, 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                )}
              </div>

              <div className="flex gap-2 justify-end mt-6">
                <button onClick={closeOcForm} className="px-4 py-2 rounded-lg text-sm border border-border-ds text-primary hover:bg-page">
                  Cancelar
                </button>
                <button
                  onClick={() => saveOC.mutate()}
                  disabled={saveOC.isPending}
                  className="px-4 py-2 rounded-lg text-sm bg-accent text-white hover:bg-accent/90 disabled:opacity-50"
                >
                  {saveOC.isPending ? 'Guardando…' : 'Guardar OC'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal detalle OC ─────────────────────────────────────────────────── */}
      {showOcDetail && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-bold text-primary">OC #{showOcDetail.numero}</h2>
                  <p className="text-sm text-muted">{(showOcDetail as any).proveedores?.nombre}</p>
                </div>
                <span className={`text-sm px-3 py-1 rounded-full font-medium ${ESTADO_OC_COLOR[showOcDetail.estado as EstadoOC]}`}>
                  {ESTADO_OC_LABEL[showOcDetail.estado as EstadoOC]}
                </span>
              </div>

              {/* Info */}
              <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
                {showOcDetail.fecha_esperada && (
                  <div>
                    <span className="text-muted">Fecha esperada: </span>
                    <span className="text-primary font-medium">
                      {new Date(showOcDetail.fecha_esperada + 'T00:00:00').toLocaleDateString('es-AR')}
                    </span>
                  </div>
                )}
                <div>
                  <span className="text-muted">Creada: </span>
                  <span className="text-primary font-medium">
                    {new Date(showOcDetail.created_at).toLocaleDateString('es-AR')}
                  </span>
                </div>
              </div>
              {showOcDetail.notas && (
                <p className="text-sm text-muted italic mb-4 bg-page rounded-lg px-3 py-2">{showOcDetail.notas}</p>
              )}

              {/* Items */}
              <h3 className="text-sm font-semibold text-primary mb-2">Productos</h3>
              <div className="border border-border-ds rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-page">
                    <tr>
                      <th className="text-left px-3 py-2 text-muted font-medium">Producto</th>
                      <th className="text-right px-3 py-2 text-muted font-medium">Cant.</th>
                      <th className="text-right px-3 py-2 text-muted font-medium">P. Unit.</th>
                      <th className="text-right px-3 py-2 text-muted font-medium">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {ocItemsData.map(it => (
                      <tr key={it.id}>
                        <td className="px-3 py-2 text-primary">
                          <div>{(it as any).productos?.nombre}</div>
                          <div className="text-xs text-muted">{(it as any).productos?.sku}</div>
                        </td>
                        <td className="px-3 py-2 text-right text-primary">
                          {it.cantidad} {(it as any).productos?.unidad_medida}
                        </td>
                        <td className="px-3 py-2 text-right text-muted">
                          {it.precio_unitario != null
                            ? `$${it.precio_unitario.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`
                            : '—'}
                        </td>
                        <td className="px-3 py-2 text-right text-primary font-medium">
                          {it.precio_unitario != null
                            ? `$${(it.cantidad * it.precio_unitario).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {ocItemsData.some(it => it.precio_unitario != null) && (
                    <tfoot className="bg-page">
                      <tr>
                        <td colSpan={3} className="px-3 py-2 text-right text-sm font-semibold text-primary">Total estimado</td>
                        <td className="px-3 py-2 text-right font-bold text-primary">
                          ${ocItemsData.reduce((s, it) => s + (it.precio_unitario != null ? it.cantidad * it.precio_unitario : 0), 0)
                            .toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {/* Lifecycle desde detalle */}
              <div className="flex flex-wrap gap-2 mt-4">
                {showOcDetail.estado === 'borrador' && (
                  <button
                    onClick={() => cambiarEstadoOC.mutate({ id: showOcDetail.id, estado: 'enviada' })}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700"
                  >
                    <Send className="w-4 h-4" /> Enviar al proveedor
                  </button>
                )}
                {showOcDetail.estado === 'enviada' && (
                  <button
                    onClick={() => cambiarEstadoOC.mutate({ id: showOcDetail.id, estado: 'confirmada' })}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-green-600 text-white hover:bg-green-700"
                  >
                    <CheckCircle className="w-4 h-4" /> Confirmar OC
                  </button>
                )}
                {(showOcDetail.estado === 'borrador' || showOcDetail.estado === 'enviada' || showOcDetail.estado === 'confirmada') && (
                  <button
                    onClick={() => { if (confirm('¿Cancelar esta OC?')) cambiarEstadoOC.mutate({ id: showOcDetail.id, estado: 'cancelada' }) }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    <XCircle className="w-4 h-4" /> Cancelar OC
                  </button>
                )}
              </div>

              <div className="flex justify-end mt-4">
                <button onClick={() => setShowOcDetail(null)} className="px-4 py-2 rounded-lg text-sm border border-border-ds text-primary hover:bg-page">
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Subcomponente: inline items preview ──────────────────────────────────────
function InlineOCItems({ ocId }: { ocId: string }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ['oc-items-inline', ocId],
    queryFn: async () => {
      const { data } = await supabase
        .from('orden_compra_items')
        .select('*, productos(nombre, sku, unidad_medida)')
        .eq('orden_compra_id', ocId)
      return (data ?? []) as any[]
    },
  })

  if (isLoading) return <div className="px-4 pb-3 text-xs text-muted">Cargando…</div>
  if (data.length === 0) return <div className="px-4 pb-3 text-xs text-muted">Sin ítems</div>

  return (
    <div className="border-t border-border-ds bg-page px-4 py-3">
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1 text-xs">
        {data.map((it: any) => (
          <>
            <span key={`n-${it.id}`} className="text-primary">
              <Package className="inline w-3 h-3 mr-1 text-muted" />
              {it.productos?.nombre}
              <span className="text-muted ml-1">({it.productos?.sku})</span>
            </span>
            <span key={`q-${it.id}`} className="text-right text-primary font-medium">
              {it.cantidad} {it.productos?.unidad_medida}
            </span>
            <span key={`p-${it.id}`} className="text-right text-muted">
              {it.precio_unitario != null
                ? `$${Number(it.precio_unitario).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`
                : '—'}
            </span>
          </>
        ))}
      </div>
    </div>
  )
}
