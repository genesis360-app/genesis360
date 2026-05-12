import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { logActividad } from '@/lib/actividadLog'
import { Proveedor, OrdenCompra, OrdenCompraItem, Producto } from '@/lib/supabase'
import { esDecimal } from '@/lib/ventasValidation'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import toast from 'react-hot-toast'
import {
  Truck, Plus, Pencil, Trash2, Search, ChevronDown, ChevronUp,
  FileText, Send, CheckCircle, XCircle, Package, Hash, Calendar,
  Phone, Mail, MapPin, CreditCard, Building, Clock, ToggleLeft, ToggleRight,
  Warehouse, Wrench, ChevronRight, Paperclip, ExternalLink, Tag, X,
  Upload, Download, DollarSign, AlertCircle, TrendingDown, FileDown,
} from 'lucide-react'

type Tab = 'proveedores' | 'servicios' | 'ordenes'
type EstadoOC = 'borrador' | 'enviada' | 'confirmada' | 'cancelada'

interface FormProv {
  tipo: 'proveedor' | 'servicio'
  nombre: string
  razon_social: string
  dni: string
  cuit: string
  codigo_fiscal: string
  regimen_fiscal: string
  contacto: string
  telefono: string
  email: string
  condicion_iva: string
  plazo_pago_dias: string
  banco: string
  cbu: string
  domicilio: string
  notas: string
  etiquetas: string  // comma-separated, stored as TEXT[]
}

const FORM_PROV_EMPTY: FormProv = {
  tipo: 'proveedor', nombre: '', razon_social: '', dni: '', cuit: '',
  codigo_fiscal: '', regimen_fiscal: '', contacto: '', telefono: '',
  email: '', condicion_iva: '', plazo_pago_dias: '', banco: '', cbu: '',
  domicilio: '', notas: '', etiquetas: '',
}

interface FormProdProv {
  producto_id: string; precio_compra: string; cantidad_minima: string
  costo_envio: string; costos_extra: string; notas: string
}
interface FormServItem {
  nombre: string; detalle: string; costo: string
  forma_pago: string; hace_factura: boolean; notas: string
}
interface FormPresupuesto {
  nombre: string; fecha: string; monto: string; notas: string
  servicio_item_id: string
}

interface FormOC {
  proveedor_id: string
  fecha_esperada: string
  notas: string
  tiene_envio: boolean
  costo_envio: string
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
  const { tenant, user } = useAuthStore()
  const qc = useQueryClient()
  const navigate = useNavigate()

  const [tab, setTab] = useState<Tab>('proveedores')

  // ── Proveedores state ──────────────────────────────────────────────────────
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<FormProv>(FORM_PROV_EMPTY)

  // Contactos múltiples
  type ContactoForm = { id?: string; nombre: string; puesto: string; email: string; telefono: string }
  const CONTACTO_VACIO: ContactoForm = { nombre: '', puesto: '', email: '', telefono: '' }
  const [contactos, setContactos] = useState<ContactoForm[]>([])
  const [contactoEditIdx, setContactoEditIdx] = useState<number | null>(null)

  // ── Servicios state ────────────────────────────────────────────────────────
  const [serviciosSearch, setServiciosSearch] = useState('')
  const [expandedServId, setExpandedServId] = useState<string | null>(null)
  const [showServItemForm, setShowServItemForm] = useState<string | null>(null) // proveedor_id
  const [editServItemId, setEditServItemId] = useState<string | null>(null)
  const [servItemForm, setServItemForm] = useState<FormServItem>({ nombre: '', detalle: '', costo: '', forma_pago: '', hace_factura: false, notas: '' })
  const [showPresupForm, setShowPresupForm] = useState<string | null>(null) // proveedor_id
  const [editPresupId, setEditPresupId] = useState<string | null>(null)
  const [presupForm, setPresupForm] = useState<FormPresupuesto>({ nombre: '', fecha: new Date().toISOString().split('T')[0], monto: '', notas: '', servicio_item_id: '' })
  const [presupFile, setPresupFile] = useState<File | null>(null)
  const presupFileRef = useRef<HTMLInputElement>(null)

  // ── Proveedor productos state ───────────────────────────────────────────────
  const [expandedProvId, setExpandedProvId] = useState<string | null>(null)
  const [showProdProvForm, setShowProdProvForm] = useState<string | null>(null) // proveedor_id
  const [editProdProvId, setEditProdProvId] = useState<string | null>(null)
  const [prodProvForm, setProdProvForm] = useState<FormProdProv>({ producto_id: '', precio_compra: '', cantidad_minima: '1', costo_envio: '', costos_extra: '', notas: '' })

  // ── OC state ───────────────────────────────────────────────────────────────
  const [ocSearch, setOcSearch] = useState('')
  const [ocFiltroEstado, setOcFiltroEstado] = useState<EstadoOC | ''>('')
  const [ocFiltroProv, setOcFiltroProv] = useState('')
  const [showOcForm, setShowOcForm] = useState(false)
  const [editOcId, setEditOcId] = useState<string | null>(null)
  const [ocForm, setOcForm] = useState<FormOC>({ proveedor_id: '', fecha_esperada: '', notas: '', tiene_envio: false, costo_envio: '' })
  const [ocItems, setOcItems] = useState<FormOCItem[]>([])
  const [expandedOc, setExpandedOc] = useState<string | null>(null)
  const [showOcDetail, setShowOcDetail] = useState<OrdenCompra | null>(null)
  const [ocDetailTab, setOcDetailTab] = useState<'pedido' | 'entregas' | 'diferencias'>('pedido')

  const abrirOcDetail = (oc: OrdenCompra) => {
    abrirOcDetail(oc)
    setOcDetailTab(['recibida', 'recibida_parcial'].includes(oc.estado) ? 'diferencias' : 'pedido')
  }

  // ── Proveedor CC state ─────────────────────────────────────────────────────
  const [ccProvId, setCcProvId]             = useState<string | null>(null)
  const [ccPagoMonto, setCcPagoMonto]       = useState('')
  const [ccPagoMedio, setCcPagoMedio]       = useState('Transferencia')
  const [ccGuardando, setCcGuardando]       = useState(false)

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

  // CC proveedor — historial movimientos
  const { data: ccMovimientos = [], refetch: refetchCC } = useQuery({
    queryKey: ['proveedor-cc', ccProvId],
    queryFn: async () => {
      const { data } = await supabase.from('proveedor_cc_movimientos')
        .select('*, ordenes_compra(numero)')
        .eq('proveedor_id', ccProvId!)
        .order('fecha', { ascending: false })
        .limit(50)
      return data ?? []
    },
    enabled: !!ccProvId,
  })

  const { data: cajasAbiertasProv = [] } = useQuery({
    queryKey: ['caja-sesiones-abiertas', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('caja_sesiones')
        .select('id, cajas(nombre)').eq('tenant_id', tenant!.id).is('cerrada_at', null)
      return data ?? []
    },
    enabled: !!ccProvId,
  })

  const saldoCC = (ccMovimientos as any[]).reduce((s: number, m: any) => s + Number(m.monto ?? 0), 0)

  const registrarPagoCC = async () => {
    if (!ccProvId) return
    const monto = parseFloat(ccPagoMonto.replace(',', '.'))
    if (isNaN(monto) || monto <= 0) { toast.error('Ingresá un monto válido'); return }
    setCcGuardando(true)
    try {
      const hoy = new Date().toISOString().split('T')[0]
      const sesionId = (cajasAbiertasProv as any[])[0]?.id ?? null
      await supabase.from('proveedor_cc_movimientos').insert({
        tenant_id:    tenant!.id,
        proveedor_id: ccProvId,
        tipo:         'pago',
        monto:        -monto,
        fecha:        hoy,
        medio_pago:   ccPagoMedio,
        descripcion:  `Pago — ${ccPagoMedio}`,
        caja_sesion_id: sesionId,
        created_by:   user!.id,
      })
      if (ccPagoMedio === 'Efectivo' && sesionId) {
        await supabase.from('caja_movimientos').insert({
          tenant_id:  tenant!.id,
          sesion_id:  sesionId,
          tipo:       'egreso',
          monto,
          concepto:   `Pago proveedor CC`,
          created_by: user!.id,
        })
      }
      toast.success('Pago registrado')
      setCcPagoMonto('')
      refetchCC()
      qc.invalidateQueries({ queryKey: ['oc-gastos'] })
    } catch (e: any) {
      toast.error(e.message ?? 'Error')
    } finally {
      setCcGuardando(false)
    }
  }

  function descargarOCpdf(oc: OrdenCompra, items: OrdenCompraItem[]) {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    const W = 210
    doc.setFontSize(16).setFont('helvetica', 'bold')
    doc.text('Orden de Compra', 14, 18)
    doc.setFontSize(10).setFont('helvetica', 'normal').setTextColor(80)
    doc.text(`OC #${oc.numero}`, 14, 26)
    doc.text(`Proveedor: ${(oc as any).proveedores?.nombre ?? '—'}`, 14, 32)
    doc.text(`Estado: ${ESTADO_OC_LABEL[oc.estado as EstadoOC] ?? oc.estado}`, 14, 38)
    if (oc.fecha_esperada) doc.text(`Fecha esperada: ${new Date(oc.fecha_esperada + 'T00:00:00').toLocaleDateString('es-AR')}`, 14, 44)
    doc.text(`Emitida: ${new Date(oc.created_at).toLocaleDateString('es-AR')}`, W - 14, 38, { align: 'right' })
    if (oc.notas) {
      doc.setTextColor(100)
      doc.text(`Notas: ${oc.notas}`, 14, 52)
    }
    const startY = oc.notas ? 58 : 50
    autoTable(doc, {
      startY,
      margin: { left: 14, right: 14 },
      head: [['Producto', 'SKU', 'Cant.', 'U.M.', 'P. Unit.', 'Subtotal']],
      body: items.map(it => {
        const p = (it as any).productos
        const sub = it.precio_unitario != null ? it.cantidad * it.precio_unitario : null
        return [
          p?.nombre ?? '—',
          p?.sku ?? '—',
          it.cantidad % 1 === 0 ? String(it.cantidad) : it.cantidad.toFixed(3),
          p?.unidad_medida ?? '',
          it.precio_unitario != null ? `$${it.precio_unitario.toLocaleString('es-AR', { minimumFractionDigits: 2 })}` : '—',
          sub != null ? `$${sub.toLocaleString('es-AR', { minimumFractionDigits: 2 })}` : '—',
        ]
      }),
      headStyles: { fillColor: [30, 58, 95], fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      columnStyles: {
        0: { cellWidth: 55 }, 1: { cellWidth: 22 },
        2: { halign: 'right', cellWidth: 16 }, 3: { cellWidth: 14 },
        4: { halign: 'right', cellWidth: 26 }, 5: { halign: 'right', cellWidth: 26 },
      },
    })
    const total = items.reduce((s, it) => s + (it.precio_unitario != null ? it.cantidad * it.precio_unitario : 0), 0)
    if (total > 0) {
      const ty = (doc as any).lastAutoTable.finalY + 6
      doc.setFontSize(10).setFont('helvetica', 'bold').setTextColor(0)
      doc.text(`Total estimado: $${total.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`, W - 14, ty, { align: 'right' })
    }
    doc.save(`OC_${String(oc.numero).padStart(4, '0')}_${((oc as any).proveedores?.nombre ?? 'proveedor').replace(/\s+/g, '_')}.pdf`)
  }

  function descargarOCcsv(oc: OrdenCompra, items: OrdenCompraItem[]) {
    const header = ['Producto', 'SKU', 'Cantidad', 'Unidad', 'Precio Unitario', 'Subtotal']
    const rows = items.map(it => {
      const p = (it as any).productos
      const sub = it.precio_unitario != null ? it.cantidad * it.precio_unitario : ''
      return [p?.nombre ?? '', p?.sku ?? '', it.cantidad, p?.unidad_medida ?? '', it.precio_unitario ?? '', sub]
    })
    const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    a.download = `OC_${String(oc.numero).padStart(4, '0')}_${((oc as any).proveedores?.nombre ?? 'proveedor').replace(/\s+/g, '_')}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

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

  const { data: recepcionItemsOC = [] } = useQuery({
    queryKey: ['recepcion-items-oc', showOcDetail?.id, ocItemsData.length],
    queryFn: async () => {
      const itemIds = ocItemsData.map(it => it.id)
      if (itemIds.length === 0) return []
      const { data } = await supabase
        .from('recepcion_items')
        .select('*, productos(nombre, sku, unidad_medida), recepciones(numero, created_at)')
        .in('oc_item_id', itemIds)
      return data ?? []
    },
    enabled: !!showOcDetail && ocItemsData.length > 0 &&
      ['recibida', 'recibida_parcial'].includes(showOcDetail.estado),
  })

  const { data: provProductos = [] } = useQuery({
    queryKey: ['proveedor-productos', expandedProvId],
    queryFn: async () => {
      const { data } = await supabase.from('proveedor_productos')
        .select('*, productos(id, nombre, sku, unidad_medida, precio_costo)')
        .eq('proveedor_id', expandedProvId!)
        .order('id')
      return data ?? []
    },
    enabled: !!expandedProvId,
  })

  const { data: servicioItems = [] } = useQuery({
    queryKey: ['servicio-items', expandedServId],
    queryFn: async () => {
      const { data } = await supabase.from('servicio_items')
        .select('*').eq('proveedor_id', expandedServId!).order('nombre')
      return data ?? []
    },
    enabled: !!expandedServId,
  })

  const { data: presupuestos = [] } = useQuery({
    queryKey: ['servicio-presupuestos', expandedServId],
    queryFn: async () => {
      const { data } = await supabase.from('servicio_presupuestos')
        .select('*, servicio_items(nombre)').eq('proveedor_id', expandedServId!).order('fecha', { ascending: false })
      return data ?? []
    },
    enabled: !!expandedServId,
  })

  const { data: productosAll = [] } = useQuery({
    queryKey: ['productos-todos', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('productos')
        .select('id, nombre, sku, unidad_medida, precio_costo')
        .eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant && (!!showProdProvForm || !!expandedProvId),
  })

  // ── Proveedor mutations ────────────────────────────────────────────────────
  const saveProveedor = useMutation({
    mutationFn: async () => {
      const etiquetasArr = form.etiquetas.trim()
        ? form.etiquetas.split(',').map(e => e.trim()).filter(Boolean)
        : null
      const payload = {
        tipo: form.tipo,
        nombre: form.nombre.trim(),
        razon_social: form.razon_social.trim() || null,
        dni: form.dni.trim() || null,
        cuit: form.cuit.trim() || null,
        codigo_fiscal: form.codigo_fiscal.trim() || null,
        regimen_fiscal: form.regimen_fiscal.trim() || null,
        contacto: form.contacto.trim() || null,
        telefono: form.telefono.trim() || null,
        email: form.email.trim() || null,
        condicion_iva: form.condicion_iva || null,
        plazo_pago_dias: form.plazo_pago_dias ? parseInt(form.plazo_pago_dias) : null,
        banco: form.banco.trim() || null,
        cbu: form.cbu.trim() || null,
        domicilio: form.domicilio.trim() || null,
        notas: form.notas.trim() || null,
        etiquetas: etiquetasArr,
      }
      let provId = editId
      if (editId) {
        const { error } = await supabase.from('proveedores').update(payload).eq('id', editId)
        if (error) throw error
      } else {
        const { data: newProv, error } = await supabase.from('proveedores')
          .insert({ ...payload, tenant_id: tenant!.id })
          .select('id').single()
        if (error) throw error
        provId = newProv.id
      }
      // Guardar contactos: borrar existentes y volver a insertar
      if (provId) {
        await supabase.from('proveedor_contactos').delete().eq('proveedor_id', provId)
        const contactosValidos = contactos.filter(c => c.nombre.trim())
        if (contactosValidos.length > 0) {
          await supabase.from('proveedor_contactos').insert(
            contactosValidos.map(c => ({
              tenant_id: tenant!.id,
              proveedor_id: provId!,
              nombre: c.nombre.trim(),
              puesto: c.puesto.trim() || null,
              email: c.email.trim() || null,
              telefono: c.telefono.trim() || null,
            }))
          )
        }
      }
    },
    onSuccess: () => {
      toast.success(editId ? 'Proveedor actualizado' : 'Proveedor creado')
      logActividad({ entidad: 'proveedor', entidad_nombre: form.nombre, accion: editId ? 'editar' : 'crear', pagina: '/proveedores' })
      qc.invalidateQueries({ queryKey: ['proveedores'] })
      qc.invalidateQueries({ queryKey: ['proveedor-contactos'] })
      setShowForm(false)
      setEditId(null)
      setForm(FORM_PROV_EMPTY)
      setContactos([])
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

  // ── Proveedor productos mutations ──────────────────────────────────────────
  const saveProdProv = useMutation({
    mutationFn: async (provId: string) => {
      if (!prodProvForm.producto_id) throw new Error('Seleccioná un producto')
      const payload = {
        tenant_id: tenant!.id, proveedor_id: provId, producto_id: prodProvForm.producto_id,
        precio_compra: prodProvForm.precio_compra ? parseFloat(prodProvForm.precio_compra) : null,
        cantidad_minima: prodProvForm.cantidad_minima ? parseInt(prodProvForm.cantidad_minima) : 1,
        costo_envio: prodProvForm.costo_envio ? parseFloat(prodProvForm.costo_envio) : null,
        costos_extra: prodProvForm.costos_extra ? parseFloat(prodProvForm.costos_extra) : null,
        notas: prodProvForm.notas.trim() || null,
      }
      if (editProdProvId) {
        const { error } = await supabase.from('proveedor_productos').update(payload).eq('id', editProdProvId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('proveedor_productos').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      toast.success(editProdProvId ? 'Producto actualizado' : 'Producto vinculado')
      qc.invalidateQueries({ queryKey: ['proveedor-productos', expandedProvId] })
      setShowProdProvForm(null); setEditProdProvId(null)
      setProdProvForm({ producto_id: '', precio_compra: '', cantidad_minima: '1', costo_envio: '', costos_extra: '', notas: '' })
    },
    onError: (e: any) => toast.error(e.message),
  })

  const deleteProdProv = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('proveedor_productos').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Producto desvinculado'); qc.invalidateQueries({ queryKey: ['proveedor-productos', expandedProvId] }) },
    onError: (e: any) => toast.error(e.message),
  })

  // ── Servicio items mutations ────────────────────────────────────────────────
  const saveServItem = useMutation({
    mutationFn: async (provId: string) => {
      if (!servItemForm.nombre.trim()) throw new Error('El nombre es requerido')
      const payload = {
        tenant_id: tenant!.id, proveedor_id: provId,
        nombre: servItemForm.nombre.trim(), detalle: servItemForm.detalle.trim() || null,
        costo: servItemForm.costo ? parseFloat(servItemForm.costo) : null,
        forma_pago: servItemForm.forma_pago.trim() || null,
        hace_factura: servItemForm.hace_factura,
        notas: servItemForm.notas.trim() || null,
      }
      if (editServItemId) {
        const { error } = await supabase.from('servicio_items').update(payload).eq('id', editServItemId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('servicio_items').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      toast.success(editServItemId ? 'Servicio actualizado' : 'Servicio agregado')
      qc.invalidateQueries({ queryKey: ['servicio-items', expandedServId] })
      setShowServItemForm(null); setEditServItemId(null)
      setServItemForm({ nombre: '', detalle: '', costo: '', forma_pago: '', hace_factura: false, notas: '' })
    },
    onError: (e: any) => toast.error(e.message),
  })

  const deleteServItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('servicio_items').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Servicio eliminado'); qc.invalidateQueries({ queryKey: ['servicio-items', expandedServId] }) },
    onError: (e: any) => toast.error(e.message),
  })

  // ── Presupuestos mutations ─────────────────────────────────────────────────
  const resetPresupForm = () => {
    setShowPresupForm(null); setEditPresupId(null); setPresupFile(null)
    setPresupForm({ nombre: '', fecha: new Date().toISOString().split('T')[0], monto: '', notas: '', servicio_item_id: '' })
  }

  const savePresupuesto = useMutation({
    mutationFn: async (provId: string) => {
      const payload = {
        tenant_id: tenant!.id, proveedor_id: provId,
        servicio_item_id: presupForm.servicio_item_id || null,
        nombre: presupForm.nombre.trim() || null,
        fecha: presupForm.fecha,
        monto: presupForm.monto ? parseFloat(presupForm.monto) : null,
        notas: presupForm.notas.trim() || null,
      }
      let presupId = editPresupId
      if (editPresupId) {
        const { error } = await supabase.from('servicio_presupuestos').update(payload).eq('id', editPresupId)
        if (error) throw error
      } else {
        const { data: inserted, error } = await supabase.from('servicio_presupuestos').insert(payload).select('id').single()
        if (error) throw error
        presupId = inserted.id
      }
      if (presupFile && presupId) {
        const ext = presupFile.name.split('.').pop()?.toLowerCase() ?? 'pdf'
        const path = `${tenant!.id}/${presupId}.${ext}`
        await supabase.storage.from('presupuestos-servicios').upload(path, presupFile, { upsert: true })
        await supabase.from('servicio_presupuestos').update({ archivo_url: path }).eq('id', presupId)
      }
    },
    onSuccess: () => {
      toast.success(editPresupId ? 'Presupuesto actualizado' : 'Presupuesto guardado')
      qc.invalidateQueries({ queryKey: ['servicio-presupuestos', expandedServId] })
      resetPresupForm()
    },
    onError: (e: any) => toast.error(e.message),
  })

  const deletePresupuesto = useMutation({
    mutationFn: async ({ id, archivo_url }: { id: string; archivo_url?: string }) => {
      if (archivo_url) await supabase.storage.from('presupuestos-servicios').remove([archivo_url])
      const { error } = await supabase.from('servicio_presupuestos').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Presupuesto eliminado'); qc.invalidateQueries({ queryKey: ['servicio-presupuestos', expandedServId] }) },
    onError: (e: any) => toast.error(e.message),
  })

  const aprobarPresupuesto = useMutation({
    mutationFn: async (ps: any) => {
      const prov = (proveedores as any[]).find(p => p.id === expandedServId)
      const { data: gasto, error: gErr } = await supabase.from('gastos').insert({
        tenant_id: tenant!.id,
        descripcion: ps.nombre ?? `Presupuesto aprobado — ${prov?.nombre ?? 'proveedor'}`,
        monto: ps.monto ?? 0,
        fecha: new Date().toISOString().split('T')[0],
        categoria: 'Honorarios profesionales',
        notas: `Presupuesto aprobado. Proveedor: ${prov?.nombre ?? ''}${ps.notas ? ` | ${ps.notas}` : ''}`,
      }).select('id').single()
      if (gErr) throw gErr
      const { error: pErr } = await supabase.from('servicio_presupuestos')
        .update({ estado: 'convertido', gasto_id: gasto.id })
        .eq('id', ps.id)
      if (pErr) throw pErr
      return gasto.id
    },
    onSuccess: (gastoId) => {
      toast.success('Presupuesto aprobado — gasto creado')
      qc.invalidateQueries({ queryKey: ['servicio-presupuestos', expandedServId] })
      qc.invalidateQueries({ queryKey: ['gastos'] })
    },
    onError: (e: any) => toast.error(e.message),
  })

  const rechazarPresupuesto = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('servicio_presupuestos').update({ estado: 'rechazado' }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Presupuesto rechazado'); qc.invalidateQueries({ queryKey: ['servicio-presupuestos', expandedServId] }) },
    onError: (e: any) => toast.error(e.message),
  })

  const verPresupuesto = async (url: string) => {
    const { data } = await supabase.storage.from('presupuestos-servicios').createSignedUrl(url, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
    else toast.error('No se pudo abrir el archivo')
  }

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
          tiene_envio: ocForm.tiene_envio,
          costo_envio: ocForm.tiene_envio && ocForm.costo_envio ? parseFloat(ocForm.costo_envio) : null,
          created_by: (await supabase.auth.getUser()).data.user?.id,
        }).select('id').single()
        if (error) throw error
        ocId = data.id
      }

      const itemsPayload = ocItems.map(it => {
        const prod = productos.find(p => p.id === it.producto_id)
        const dec = prod ? esDecimal(prod.unidad_medida ?? '') : false
        return {
          orden_compra_id: ocId,
          producto_id: it.producto_id,
          cantidad: dec ? parseFloat(it.cantidad) : parseInt(it.cantidad, 10),
          precio_unitario: it.precio_unitario ? parseFloat(it.precio_unitario) : null,
          notas: it.notas.trim() || null,
        }
      })
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

  const solicitarReembolsoOC = useMutation({
    mutationFn: async (ocId: string) => {
      const { error } = await supabase
        .from('ordenes_compra').update({ tiene_reembolso_pendiente: true }).eq('id', ocId)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Solicitud de reembolso registrada. Revisá Gastos → OC.')
      qc.invalidateQueries({ queryKey: ['ordenes', tenant?.id] })
      qc.invalidateQueries({ queryKey: ['oc-gastos', tenant?.id] })
      if (showOcDetail) setShowOcDetail({ ...showOcDetail, tiene_reembolso_pendiente: true })
    },
    onError: (e: any) => toast.error(e.message),
  })

  const crearOCDerivadaOC = useMutation({
    mutationFn: async ({ oc, faltantes }: { oc: OrdenCompra; faltantes: Array<{ producto_id: string; cantidad: number }> }) => {
      const { data: newOC, error } = await supabase
        .from('ordenes_compra')
        .insert({
          tenant_id: tenant!.id,
          proveedor_id: oc.proveedor_id,
          estado: 'enviada',
          es_derivada: true,
          oc_padre_id: oc.id,
          notas: `OC derivada de OC #${oc.numero} — ítems ya pagados, pendiente de entrega`,
          created_by: user!.id,
        })
        .select('id, numero')
        .single()
      if (error) throw error
      await supabase.from('orden_compra_items').insert(
        faltantes.map(f => ({
          orden_compra_id: newOC.id,
          producto_id: f.producto_id,
          cantidad: f.cantidad,
          precio_unitario: 0,
          notas: 'Ya pagado — pendiente de entrega',
        }))
      )
      return newOC.numero
    },
    onSuccess: (numero) => {
      toast.success(`OC derivada #${numero} creada`)
      qc.invalidateQueries({ queryKey: ['ordenes', tenant?.id] })
      setShowOcDetail(null)
    },
    onError: (e: any) => toast.error(e.message ?? 'Error al crear OC derivada'),
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
  const openEditProv = (p: any) => {
    setEditId(p.id)
    setForm({
      tipo: p.tipo ?? 'proveedor',
      nombre: p.nombre ?? '',
      razon_social: p.razon_social ?? '',
      dni: p.dni ?? '',
      cuit: p.cuit ?? '',
      codigo_fiscal: p.codigo_fiscal ?? '',
      regimen_fiscal: p.regimen_fiscal ?? '',
      contacto: p.contacto ?? '',
      telefono: p.telefono ?? '',
      email: p.email ?? '',
      condicion_iva: p.condicion_iva ?? '',
      plazo_pago_dias: p.plazo_pago_dias?.toString() ?? '',
      banco: p.banco ?? '',
      cbu: p.cbu ?? '',
      domicilio: p.domicilio ?? '',
      notas: p.notas ?? '',
      etiquetas: Array.isArray(p.etiquetas) ? p.etiquetas.join(', ') : '',
    })
    // Cargar contactos existentes del proveedor
    supabase.from('proveedor_contactos')
      .select('id, nombre, puesto, email, telefono')
      .eq('proveedor_id', p.id)
      .order('created_at')
      .then(({ data }) => setContactos((data ?? []).map(c => ({ id: c.id, nombre: c.nombre, puesto: c.puesto ?? '', email: c.email ?? '', telefono: c.telefono ?? '' }))))
    setShowForm(true)
  }

  const closeProvForm = () => {
    setShowForm(false)
    setEditId(null)
    setForm(FORM_PROV_EMPTY)
    setContactos([])
  }

  const openNewOC = () => {
    setEditOcId(null)
    setOcForm({ proveedor_id: '', fecha_esperada: '', notas: '', tiene_envio: false, costo_envio: '' })
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
      tiene_envio: (oc as any).tiene_envio ?? false,
      costo_envio: (oc as any).costo_envio ? String((oc as any).costo_envio) : '',
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
    setOcForm({ proveedor_id: '', fecha_esperada: '', notas: '', tiene_envio: false, costo_envio: '' })
    setOcItems([])
  }

  const addOcItem = () =>
    setOcItems(prev => [...prev, { _key: ++itemKey, producto_id: '', cantidad: '', precio_unitario: '', notas: '' }])

  const removeOcItem = (key: number) =>
    setOcItems(prev => prev.filter(it => it._key !== key))

  const updateOcItem = (key: number, field: keyof Omit<FormOCItem, '_key'>, value: string) =>
    setOcItems(prev => prev.map(it => it._key === key ? { ...it, [field]: value } : it))

  // ── Filtered data ──────────────────────────────────────────────────────────
  const filteredProv = (proveedores as any[]).filter(p => {
    if (p.tipo === 'servicio') return false
    if (!search) return true
    const s = search.toLowerCase()
    return p.nombre?.toLowerCase().includes(s) ||
      p.razon_social?.toLowerCase().includes(s) ||
      p.cuit?.toLowerCase().includes(s) ||
      p.dni?.toLowerCase().includes(s) ||
      p.contacto?.toLowerCase().includes(s)
  })

  const filteredServicios = (proveedores as any[]).filter(p => {
    if (p.tipo !== 'servicio') return false
    if (!serviciosSearch) return true
    const s = serviciosSearch.toLowerCase()
    return p.nombre?.toLowerCase().includes(s) ||
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
    { id: 'servicios',   label: 'Servicios' },
    { id: 'ordenes',     label: 'Órdenes de compra' },
  ]

  const exportarProveedores = (format: 'json' | 'csv') => {
    const rows = filteredProv.map((p: any) => ({
      id: p.id, nombre: p.nombre, razon_social: p.razon_social ?? '',
      cuit: p.cuit ?? '', condicion_iva: p.condicion_iva ?? '',
      plazo_pago_dias: p.plazo_pago_dias ?? '', banco: p.banco ?? '',
      cbu: p.cbu ?? '', activo: p.activo,
    }))
    const filename = `proveedores_${new Date().toISOString().slice(0,10)}`
    if (format === 'json') {
      const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${filename}.json`; a.click()
    } else {
      const headers = Object.keys(rows[0] ?? {})
      const lines = rows.map((r: any) => headers.map((h: string) => {
        const v = String(r[h] ?? '')
        return v.includes(',') || v.includes('"') ? `"${v.replace(/"/g,'""')}"` : v
      }).join(','))
      const blob = new Blob(['﻿' + [headers.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${filename}.csv`; a.click()
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Truck className="w-5 h-5 text-accent" />
          <h1 className="text-xl font-bold text-primary">Proveedores / Servicios</h1>
        </div>
        {tab === 'proveedores' && (
          <div className="flex gap-2">
            <div className="relative group">
              <button className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                <Download size={14} /> Exportar <ChevronDown size={12} />
              </button>
              <div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl shadow-lg overflow-hidden z-20 hidden group-hover:block w-28">
                <button onClick={() => exportarProveedores('json')} className="w-full text-left px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">JSON</button>
                <button onClick={() => exportarProveedores('csv')}  className="w-full text-left px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">CSV</button>
              </div>
            </div>
            <button
              onClick={() => { setEditId(null); setForm({ ...FORM_PROV_EMPTY, tipo: 'proveedor' }); setShowForm(true) }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white rounded-lg text-sm hover:bg-accent/90"
            >
              <Plus className="w-4 h-4" /> Nuevo proveedor
            </button>
          </div>
        )}
        {tab === 'servicios' && (
          <button
            onClick={() => { setEditId(null); setForm({ ...FORM_PROV_EMPTY, tipo: 'servicio' }); setShowForm(true) }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white rounded-lg text-sm hover:bg-accent/90"
          >
            <Plus className="w-4 h-4" /> Nuevo servicio
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
                      <button onClick={() => { setCcProvId(p.id); setCcPagoMonto(''); setCcPagoMedio('Transferencia') }}
                        className="p-1.5 rounded text-muted hover:text-purple-600" title="Cuenta Corriente">
                        <CreditCard className="w-4 h-4" />
                      </button>
                      <button onClick={() => setExpandedProvId(expandedProvId === p.id ? null : p.id)}
                        className="p-1.5 rounded text-muted hover:text-accent" title="Ver productos">
                        <ChevronRight className={`w-4 h-4 transition-transform ${expandedProvId === p.id ? 'rotate-90' : ''}`} />
                      </button>
                      <button onClick={() => toggleActivo.mutate({ id: p.id, activo: p.activo })}
                        className="p-1.5 rounded text-muted hover:text-primary"
                        title={p.activo ? 'Desactivar' : 'Activar'}>
                        {p.activo ? <ToggleRight className="w-5 h-5 text-green-500" /> : <ToggleLeft className="w-5 h-5" />}
                      </button>
                      <button onClick={() => openEditProv(p)} className="p-1.5 rounded text-muted hover:text-primary" title="Editar">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => { if (confirm('¿Eliminar este proveedor?')) deleteProveedor.mutate(p.id) }}
                        className="p-1.5 rounded text-muted hover:text-red-500" title="Eliminar">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Etiquetas */}
                  {Array.isArray((p as any).etiquetas) && (p as any).etiquetas.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {(p as any).etiquetas.map((et: string) => (
                        <span key={et} className="flex items-center gap-0.5 text-xs bg-purple-50 dark:bg-purple-900/20 text-accent px-2 py-0.5 rounded-full">
                          <Tag className="w-2.5 h-2.5" />{et}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Detalle expandible: productos */}
                  {expandedProvId === p.id && (
                    <div className="mt-3 border-t border-border-ds pt-3 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-primary flex items-center gap-1.5">
                          <Package className="w-4 h-4 text-accent" /> Productos de este proveedor
                        </p>
                        <button onClick={() => { setShowProdProvForm(p.id); setEditProdProvId(null); setProdProvForm({ producto_id: '', precio_compra: '', cantidad_minima: '1', costo_envio: '', costos_extra: '', notas: '' }) }}
                          className="flex items-center gap-1 text-xs text-accent hover:underline">
                          <Plus className="w-3 h-3" /> Vincular producto
                        </button>
                      </div>

                      {showProdProvForm === p.id && (
                        <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-3 space-y-2">
                          <div className="relative">
                            <select value={prodProvForm.producto_id}
                              onChange={e => setProdProvForm(f => ({ ...f, producto_id: e.target.value }))}
                              className="w-full appearance-none border border-border-ds rounded-lg pl-3 pr-7 py-2 text-sm bg-surface text-primary focus:outline-none focus:border-accent">
                              <option value="">Seleccioná un producto…</option>
                              {(productosAll as any[]).map((pr: any) => (
                                <option key={pr.id} value={pr.id}>{pr.nombre} ({pr.sku})</option>
                              ))}
                            </select>
                            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted pointer-events-none" />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            {[
                              { label: 'Precio compra ($)', field: 'precio_compra' as const },
                              { label: 'Cant. mínima', field: 'cantidad_minima' as const },
                              { label: 'Costo envío ($)', field: 'costo_envio' as const },
                              { label: 'Costos extra ($)', field: 'costos_extra' as const },
                            ].map(({ label, field }) => (
                              <div key={field}>
                                <label className="block text-xs text-muted mb-0.5">{label}</label>
                                <input type="number" onWheel={e => e.currentTarget.blur()} value={prodProvForm[field]}
                                  onChange={e => setProdProvForm(f => ({ ...f, [field]: e.target.value }))} min="0"
                                  className="w-full border border-border-ds rounded-lg px-3 py-1.5 text-sm bg-surface text-primary focus:outline-none focus:border-accent" />
                              </div>
                            ))}
                          </div>
                          <input type="text" value={prodProvForm.notas}
                            onChange={e => setProdProvForm(f => ({ ...f, notas: e.target.value }))}
                            placeholder="Notas (opcional)"
                            className="w-full border border-border-ds rounded-lg px-3 py-1.5 text-sm bg-surface text-primary focus:outline-none focus:border-accent" />
                          <div className="flex gap-2">
                            <button onClick={() => { setShowProdProvForm(null); setEditProdProvId(null) }}
                              className="flex-1 border border-border-ds text-muted py-1.5 rounded-lg text-sm hover:bg-gray-100 dark:hover:bg-gray-600">Cancelar</button>
                            <button onClick={() => saveProdProv.mutate(p.id)} disabled={saveProdProv.isPending}
                              className="flex-1 bg-accent text-white py-1.5 rounded-lg text-sm hover:bg-accent/90 disabled:opacity-50">
                              {saveProdProv.isPending ? 'Guardando…' : editProdProvId ? 'Actualizar' : 'Vincular'}
                            </button>
                          </div>
                        </div>
                      )}

                      {(provProductos as any[]).length === 0 ? (
                        <p className="text-xs text-muted text-center py-2">Sin productos vinculados</p>
                      ) : (
                        <div className="space-y-1">
                          {(provProductos as any[]).map((pp: any) => (
                            <div key={pp.id} className="flex items-center justify-between text-sm p-2 bg-gray-50 dark:bg-gray-700 rounded-lg">
                              <div>
                                <span className="font-medium text-primary">{pp.productos?.nombre}</span>
                                <span className="text-xs text-muted ml-2">{pp.productos?.sku}</span>
                              </div>
                              <div className="flex items-center gap-3 text-xs text-muted">
                                {pp.precio_compra != null && <span className="text-green-600 dark:text-green-400 font-medium">${Number(pp.precio_compra).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>}
                                {pp.cantidad_minima > 1 && <span>Mín. {pp.cantidad_minima}</span>}
                                <button onClick={() => { if (confirm('¿Desvincular?')) deleteProdProv.mutate(pp.id) }}
                                  className="text-muted hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tab Servicios ───────────────────────────────────────────────────── */}
      {tab === 'servicios' && (
        <div className="space-y-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
            <input className="w-full pl-9 pr-3 py-2 border border-border-ds rounded-lg bg-surface text-sm text-primary"
              placeholder="Buscar por nombre, contacto…"
              value={serviciosSearch} onChange={e => setServiciosSearch(e.target.value)} />
          </div>

          {loadingProv ? (
            <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent" /></div>
          ) : filteredServicios.length === 0 ? (
            <div className="text-center py-12 text-muted">
              <Wrench className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p>{serviciosSearch ? 'Sin resultados' : 'No hay proveedores de servicios cargados'}</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {filteredServicios.map((s: any) => (
                <div key={s.id} className={`bg-surface rounded-xl shadow-sm border border-border-ds p-4 ${!s.activo ? 'opacity-60' : ''}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Wrench className="w-4 h-4 text-accent flex-shrink-0" />
                        <span className="font-semibold text-primary">{s.nombre}</span>
                        {s.razon_social && s.razon_social !== s.nombre && <span className="text-xs text-muted">({s.razon_social})</span>}
                        {!s.activo && <span className="text-xs bg-gray-100 dark:bg-gray-700 text-muted px-2 py-0.5 rounded-full">Inactivo</span>}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                        {s.cuit && <span className="flex items-center gap-1"><Hash className="w-3 h-3" />{s.cuit}</span>}
                        {s.telefono && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{s.telefono}</span>}
                        {s.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{s.email}</span>}
                      </div>
                      {Array.isArray(s.etiquetas) && s.etiquetas.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {s.etiquetas.map((et: string) => (
                            <span key={et} className="flex items-center gap-0.5 text-xs bg-purple-50 dark:bg-purple-900/20 text-accent px-2 py-0.5 rounded-full">
                              <Tag className="w-2.5 h-2.5" />{et}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => setExpandedServId(expandedServId === s.id ? null : s.id)}
                        className="p-1.5 rounded text-muted hover:text-accent" title="Ver detalle">
                        <ChevronRight className={`w-4 h-4 transition-transform ${expandedServId === s.id ? 'rotate-90' : ''}`} />
                      </button>
                      <button onClick={() => toggleActivo.mutate({ id: s.id, activo: s.activo })}
                        className="p-1.5 rounded text-muted hover:text-primary">
                        {s.activo ? <ToggleRight className="w-5 h-5 text-green-500" /> : <ToggleLeft className="w-5 h-5" />}
                      </button>
                      <button onClick={() => openEditProv(s)} className="p-1.5 rounded text-muted hover:text-primary" title="Editar">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => { if (confirm('¿Eliminar?')) deleteProveedor.mutate(s.id) }}
                        className="p-1.5 rounded text-muted hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>

                  {/* Detalle expandible: servicios + presupuestos */}
                  {expandedServId === s.id && (
                    <div className="mt-3 border-t border-border-ds pt-3 space-y-4">
                      {/* Servicios que ofrece */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-sm font-semibold text-primary">Servicios que ofrece</p>
                          <button onClick={() => { setShowServItemForm(s.id); setEditServItemId(null); setServItemForm({ nombre: '', detalle: '', costo: '', forma_pago: '', hace_factura: false, notas: '' }) }}
                            className="flex items-center gap-1 text-xs text-accent hover:underline">
                            <Plus className="w-3 h-3" /> Agregar servicio
                          </button>
                        </div>

                        {showServItemForm === s.id && (
                          <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-3 space-y-2 mb-2">
                            <input type="text" value={servItemForm.nombre} onChange={e => setServItemForm(f => ({ ...f, nombre: e.target.value }))}
                              placeholder="Nombre del servicio *"
                              className="w-full border border-border-ds rounded-lg px-3 py-1.5 text-sm bg-surface text-primary focus:outline-none focus:border-accent" />
                            <textarea value={servItemForm.detalle} onChange={e => setServItemForm(f => ({ ...f, detalle: e.target.value }))}
                              placeholder="Detalle del servicio" rows={2}
                              className="w-full border border-border-ds rounded-lg px-3 py-1.5 text-sm bg-surface text-primary focus:outline-none focus:border-accent resize-none" />
                            <div className="grid grid-cols-2 gap-2">
                              <input type="number" onWheel={e => e.currentTarget.blur()} value={servItemForm.costo}
                                onChange={e => setServItemForm(f => ({ ...f, costo: e.target.value }))} placeholder="Costo ($)"
                                className="border border-border-ds rounded-lg px-3 py-1.5 text-sm bg-surface text-primary focus:outline-none focus:border-accent" />
                              <div className="relative">
                              <select value={servItemForm.forma_pago}
                                onChange={e => setServItemForm(f => ({ ...f, forma_pago: e.target.value }))}
                                className="w-full appearance-none border border-border-ds rounded-lg pl-3 pr-7 py-1.5 text-sm bg-surface text-primary focus:outline-none focus:border-accent">
                                <option value="">Forma de pago…</option>
                                {['Efectivo','Transferencia','Tarjeta débito','Tarjeta crédito','Cheque','Mercado Pago','Otro'].map(m => <option key={m} value={m}>{m}</option>)}
                              </select>
                              <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
                            </div>
                            </div>
                            <label className="flex items-center gap-2 text-sm text-primary cursor-pointer">
                              <input type="checkbox" checked={servItemForm.hace_factura}
                                onChange={e => setServItemForm(f => ({ ...f, hace_factura: e.target.checked }))} className="accent-accent" />
                              Emite factura
                            </label>
                            <div className="flex gap-2">
                              <button onClick={() => { setShowServItemForm(null); setEditServItemId(null) }}
                                className="flex-1 border border-border-ds text-muted py-1.5 rounded-lg text-sm hover:bg-gray-100 dark:hover:bg-gray-600">Cancelar</button>
                              <button onClick={() => saveServItem.mutate(s.id)} disabled={saveServItem.isPending}
                                className="flex-1 bg-accent text-white py-1.5 rounded-lg text-sm hover:bg-accent/90 disabled:opacity-50">
                                {saveServItem.isPending ? 'Guardando…' : 'Guardar'}
                              </button>
                            </div>
                          </div>
                        )}

                        {(servicioItems as any[]).length === 0 ? (
                          <p className="text-xs text-muted text-center py-1">Sin servicios cargados</p>
                        ) : (
                          <div className="space-y-1">
                            {(servicioItems as any[]).map((si: any) => (
                              <div key={si.id} className="flex items-start justify-between p-2.5 bg-gray-50 dark:bg-gray-700 rounded-lg">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-sm text-primary">{si.nombre}</span>
                                    {si.hace_factura && <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-1.5 py-0.5 rounded">Factura</span>}
                                  </div>
                                  {si.detalle && <p className="text-xs text-muted mt-0.5">{si.detalle}</p>}
                                  <div className="flex gap-3 mt-1 text-xs text-muted">
                                    {si.costo != null && <span className="text-green-600 dark:text-green-400 font-medium">${Number(si.costo).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>}
                                    {si.forma_pago && <span>{si.forma_pago}</span>}
                                  </div>
                                </div>
                                <button onClick={() => { if (confirm('¿Eliminar este servicio?')) deleteServItem.mutate(si.id) }}
                                  className="text-muted hover:text-red-500 ml-2 flex-shrink-0"><X className="w-3.5 h-3.5" /></button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Presupuestos */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-sm font-semibold text-primary">Presupuestos</p>
                          <button onClick={() => { setShowPresupForm(s.id); setPresupForm({ nombre: '', fecha: new Date().toISOString().split('T')[0], monto: '', notas: '', servicio_item_id: '' }); setPresupFile(null) }}
                            className="flex items-center gap-1 text-xs text-accent hover:underline">
                            <Plus className="w-3 h-3" /> Añadir presupuesto
                          </button>
                        </div>

                        {showPresupForm === s.id && (
                          <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-3 space-y-2 mb-2">
                            <input type="text" value={presupForm.nombre}
                              onChange={e => setPresupForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Nombre del presupuesto"
                              className="w-full border border-border-ds rounded-lg px-3 py-1.5 text-sm bg-surface text-primary focus:outline-none focus:border-accent" />
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-xs text-muted mb-0.5">Fecha</label>
                                <input type="date" value={presupForm.fecha}
                                  onChange={e => setPresupForm(f => ({ ...f, fecha: e.target.value }))}
                                  className="w-full border border-border-ds rounded-lg px-3 py-1.5 text-sm bg-surface text-primary focus:outline-none focus:border-accent" />
                              </div>
                              <div>
                                <label className="block text-xs text-muted mb-0.5">Monto ($)</label>
                                <input type="number" onWheel={e => e.currentTarget.blur()} value={presupForm.monto}
                                  onChange={e => setPresupForm(f => ({ ...f, monto: e.target.value }))} placeholder="0"
                                  className="w-full border border-border-ds rounded-lg px-3 py-1.5 text-sm bg-surface text-primary focus:outline-none focus:border-accent" />
                              </div>
                            </div>
                            <textarea value={presupForm.notas} onChange={e => setPresupForm(f => ({ ...f, notas: e.target.value }))}
                              placeholder="Notas" rows={2}
                              className="w-full border border-border-ds rounded-lg px-3 py-1.5 text-sm bg-surface text-primary focus:outline-none focus:border-accent resize-none" />
                            <div>
                              <input ref={presupFileRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden"
                                onChange={e => setPresupFile(e.target.files?.[0] ?? null)} />
                              <button type="button" onClick={() => presupFileRef.current?.click()}
                                className="flex items-center gap-2 border border-border-ds rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-gray-100 dark:hover:bg-gray-600">
                                <Paperclip className="w-3.5 h-3.5" />
                                {presupFile ? presupFile.name : 'Adjuntar archivo (PDF/imagen)'}
                              </button>
                            </div>
                            <div className="flex gap-2">
                              <button onClick={resetPresupForm}
                                className="flex-1 border border-border-ds text-muted py-1.5 rounded-lg text-sm hover:bg-gray-100 dark:hover:bg-gray-600">Cancelar</button>
                              <button onClick={() => savePresupuesto.mutate(s.id)} disabled={savePresupuesto.isPending}
                                className="flex-1 bg-accent text-white py-1.5 rounded-lg text-sm hover:bg-accent/90 disabled:opacity-50">
                                {savePresupuesto.isPending ? 'Guardando…' : editPresupId ? 'Actualizar' : 'Guardar'}
                              </button>
                            </div>
                          </div>
                        )}

                        {(presupuestos as any[]).length === 0 ? (
                          <p className="text-xs text-muted text-center py-1">Sin presupuestos cargados</p>
                        ) : (
                          <div className="space-y-2">
                            {(presupuestos as any[]).map((ps: any) => {
                              const estadoColor: Record<string, string> = {
                                pendiente:   'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
                                aprobado:    'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
                                rechazado:   'bg-red-100 dark:bg-red-900/30 text-red-500 dark:text-red-400',
                                convertido:  'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
                              }
                              const estado = ps.estado ?? 'pendiente'
                              const puedeAccionar = estado === 'pendiente'
                              return (
                                <div key={ps.id} className="border border-border-ds rounded-xl p-3 bg-surface space-y-2">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-sm font-medium text-primary">{ps.nombre ?? 'Presupuesto'}</span>
                                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${estadoColor[estado] ?? estadoColor.pendiente}`}>
                                          {estado.charAt(0).toUpperCase() + estado.slice(1)}
                                        </span>
                                        {ps.gasto_id && <span className="text-xs text-blue-500">→ Gasto creado</span>}
                                      </div>
                                      <div className="text-xs text-muted mt-0.5 flex gap-3 flex-wrap">
                                        <span>{ps.fecha}</span>
                                        {ps.monto != null && <span className="text-green-600 dark:text-green-400 font-medium">${Number(ps.monto).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>}
                                        {ps.servicio_items?.nombre && <span className="text-accent">{ps.servicio_items.nombre}</span>}
                                        {ps.notas && <span className="italic">{ps.notas}</span>}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1 flex-shrink-0">
                                      {ps.archivo_url && (
                                        <button onClick={() => verPresupuesto(ps.archivo_url)}
                                          title="Ver archivo" className="p-1 text-blue-500 hover:text-blue-700">
                                          <ExternalLink className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                      {puedeAccionar && (
                                        <button onClick={() => {
                                          setEditPresupId(ps.id)
                                          setShowPresupForm(s.id)
                                          setPresupForm({
                                            nombre: ps.nombre ?? '',
                                            fecha: ps.fecha ?? new Date().toISOString().split('T')[0],
                                            monto: ps.monto ? String(ps.monto) : '',
                                            notas: ps.notas ?? '',
                                            servicio_item_id: ps.servicio_item_id ?? '',
                                          })
                                        }} className="p-1 text-muted hover:text-accent" title="Editar">
                                          <Pencil className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                      {puedeAccionar && (
                                        <button onClick={() => { if (confirm('¿Eliminar presupuesto?')) deletePresupuesto.mutate({ id: ps.id, archivo_url: ps.archivo_url }) }}
                                          className="p-1 text-muted hover:text-red-500" title="Eliminar">
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                  {/* Acciones de aprobación */}
                                  {puedeAccionar && (
                                    <div className="flex gap-2 pt-1 border-t border-border-ds">
                                      <button
                                        onClick={() => { if (confirm(`¿Aprobar y crear gasto de $${Number(ps.monto ?? 0).toLocaleString('es-AR')}?`)) aprobarPresupuesto.mutate(ps) }}
                                        disabled={aprobarPresupuesto.isPending}
                                        className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs bg-green-500 hover:bg-green-600 text-white rounded-lg disabled:opacity-50 transition-colors">
                                        ✓ Aprobar → Crear gasto
                                      </button>
                                      <button
                                        onClick={() => { if (confirm('¿Rechazar este presupuesto?')) rechazarPresupuesto.mutate(ps.id) }}
                                        disabled={rechazarPresupuesto.isPending}
                                        className="flex items-center justify-center gap-1 px-3 py-1.5 text-xs border border-red-200 dark:border-red-800 text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors">
                                        ✗ Rechazar
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )
                            })}
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

                      {/* Estado pago badge */}
                      {(() => {
                        const ep = (oc as any).estado_pago
                        const fvp = (oc as any).fecha_vencimiento_pago
                        const hoyStr = new Date().toISOString().split('T')[0]
                        const vencida = fvp && fvp < hoyStr && !['pagada','cuenta_corriente'].includes(ep)
                        if (vencida) return <span className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">Vencida</span>
                        if (ep === 'pendiente_pago') return <span className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">Pago pendiente</span>
                        if (ep === 'pago_parcial') return <span className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Pago parcial</span>
                        if (ep === 'cuenta_corriente') return <span className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">CC</span>
                        return null
                      })()}

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
                          onClick={() => { abrirOcDetail(oc); setExpandedOc(null) }}
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
                        {oc.estado === 'enviada' && (() => {
                          const bloqueada = !['pagada','cuenta_corriente'].includes((oc as any).estado_pago)
                          const tooltipMsg = (oc as any).estado_pago === 'pendiente_pago'
                            ? 'Pago pendiente — pagá o asigná a CC en Gastos → OC'
                            : (oc as any).estado_pago === 'pago_parcial'
                              ? 'Pago parcial — completá el pago o asigná el saldo a CC en Gastos → OC'
                              : 'Confirmar'
                          return (
                            <button
                              onClick={() => bloqueada
                                ? toast.error(tooltipMsg)
                                : cambiarEstadoOC.mutate({ id: oc.id, estado: 'confirmada' })}
                              className={`p-1.5 rounded ${bloqueada ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed' : 'text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20'}`}
                              title={tooltipMsg}
                            >
                              <CheckCircle className="w-4 h-4" />
                            </button>
                          )
                        })()}
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
                {editId ? `Editar ${form.tipo === 'servicio' ? 'proveedor de servicio' : 'proveedor'}` : `Nuevo ${form.tipo === 'servicio' ? 'proveedor de servicio' : 'proveedor'}`}
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
                {/* DNI */}
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">DNI</label>
                  <input className="w-full px-3 py-2 border border-border-ds rounded-lg bg-page text-primary text-sm"
                    value={form.dni} onChange={e => setForm(f => ({ ...f, dni: e.target.value }))} placeholder="Para personas físicas" />
                </div>
                {/* CUIT */}
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">CUIT</label>
                  <input className="w-full px-3 py-2 border border-border-ds rounded-lg bg-page text-primary text-sm"
                    value={form.cuit} onChange={e => setForm(f => ({ ...f, cuit: e.target.value }))} placeholder="20-12345678-9" />
                </div>
                {/* Código fiscal */}
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">Código fiscal</label>
                  <input className="w-full px-3 py-2 border border-border-ds rounded-lg bg-page text-primary text-sm"
                    value={form.codigo_fiscal} onChange={e => setForm(f => ({ ...f, codigo_fiscal: e.target.value }))} placeholder="Código interno" />
                </div>
                {/* Régimen fiscal */}
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">Régimen fiscal</label>
                  <input className="w-full px-3 py-2 border border-border-ds rounded-lg bg-page text-primary text-sm"
                    value={form.regimen_fiscal} onChange={e => setForm(f => ({ ...f, regimen_fiscal: e.target.value }))} placeholder="Ej: Responsable Inscripto" />
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
                {/* Contacto principal (legacy — único campo rápido) */}
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">Contacto principal</label>
                  <input
                    className="w-full px-3 py-2 border border-border-ds rounded-lg bg-page text-primary text-sm"
                    value={form.contacto}
                    onChange={e => setForm(f => ({ ...f, contacto: e.target.value }))}
                    placeholder="Nombre del contacto"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">Teléfono principal</label>
                  <input
                    className="w-full px-3 py-2 border border-border-ds rounded-lg bg-page text-primary text-sm"
                    value={form.telefono}
                    onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))}
                    placeholder="+54 11 1234-5678"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">Email principal</label>
                  <input
                    type="email"
                    className="w-full px-3 py-2 border border-border-ds rounded-lg bg-page text-primary text-sm"
                    value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="contacto@proveedor.com"
                  />
                </div>

                {/* Contactos adicionales */}
                <div className="md:col-span-2">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-xs font-semibold text-primary uppercase tracking-wide">Contactos adicionales</label>
                    <button type="button"
                      onClick={() => setContactos(prev => [...prev, { ...CONTACTO_VACIO }])}
                      className="flex items-center gap-1 text-xs text-accent hover:text-accent/80 font-medium">
                      <Plus size={12} /> Agregar contacto
                    </button>
                  </div>
                  {contactos.length === 0 && (
                    <p className="text-xs text-muted italic">Sin contactos adicionales. Hacé click en "Agregar contacto" para sumar uno.</p>
                  )}
                  <div className="space-y-2">
                    {contactos.map((c, idx) => (
                      <div key={idx} className="border border-border-ds rounded-xl p-3 bg-page space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <input value={c.nombre}
                            onChange={e => setContactos(prev => prev.map((x, i) => i === idx ? { ...x, nombre: e.target.value } : x))}
                            placeholder="Nombre *"
                            className="border border-border-ds rounded-lg px-2.5 py-1.5 text-sm bg-surface text-primary focus:outline-none focus:border-accent" />
                          <input value={c.puesto}
                            onChange={e => setContactos(prev => prev.map((x, i) => i === idx ? { ...x, puesto: e.target.value } : x))}
                            placeholder="Puesto / Cargo"
                            className="border border-border-ds rounded-lg px-2.5 py-1.5 text-sm bg-surface text-primary focus:outline-none focus:border-accent" />
                          <input value={c.email}
                            onChange={e => setContactos(prev => prev.map((x, i) => i === idx ? { ...x, email: e.target.value } : x))}
                            placeholder="Email"
                            className="border border-border-ds rounded-lg px-2.5 py-1.5 text-sm bg-surface text-primary focus:outline-none focus:border-accent" />
                          <input value={c.telefono}
                            onChange={e => setContactos(prev => prev.map((x, i) => i === idx ? { ...x, telefono: e.target.value } : x))}
                            placeholder="Teléfono"
                            className="border border-border-ds rounded-lg px-2.5 py-1.5 text-sm bg-surface text-primary focus:outline-none focus:border-accent" />
                        </div>
                        <div className="flex justify-end">
                          <button type="button" onClick={() => setContactos(prev => prev.filter((_, i) => i !== idx))}
                            className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1">
                            <Trash2 size={12} /> Eliminar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
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
                {/* Etiquetas */}
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-muted mb-1">Etiquetas (separadas por coma)</label>
                  <input className="w-full px-3 py-2 border border-border-ds rounded-lg bg-page text-primary text-sm"
                    value={form.etiquetas}
                    onChange={e => setForm(f => ({ ...f, etiquetas: e.target.value }))}
                    placeholder="Ej: mayorista, importador, local" />
                  <p className="text-xs text-muted mt-0.5">Usá comas para separar. Se usan para filtrar en la lista.</p>
                </div>
                {/* Notas */}
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-muted mb-1">Notas</label>
                  <textarea rows={2}
                    className="w-full px-3 py-2 border border-border-ds rounded-lg bg-page text-primary text-sm resize-none"
                    value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                    placeholder="Notas adicionales" />
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
                {/* Costo de envío */}
                <div>
                  <label className="block text-sm font-medium text-primary mb-2">Costo de envío</label>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setOcForm(f => ({ ...f, tiene_envio: !f.tiene_envio, costo_envio: !f.tiene_envio ? f.costo_envio : '' }))}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 text-sm font-medium transition-colors
                        ${ocForm.tiene_envio ? 'border-accent bg-accent/5 text-accent' : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-accent/40'}`}>
                      <Truck size={14} />
                      {ocForm.tiene_envio ? 'Con envío' : 'Sin envío'}
                    </button>
                    {ocForm.tiene_envio && (
                      <div className="flex items-center gap-2 flex-1">
                        <span className="text-sm text-muted">$</span>
                        <input
                          type="number" min="0" step="0.01" onWheel={e => e.currentTarget.blur()}
                          value={ocForm.costo_envio}
                          onChange={e => setOcForm(f => ({ ...f, costo_envio: e.target.value }))}
                          placeholder="0.00"
                          className="flex-1 px-3 py-2 border border-border-ds rounded-lg bg-page text-primary text-sm focus:outline-none focus:border-accent" />
                      </div>
                    )}
                  </div>
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
                    const decimal = prod ? esDecimal(prod.unidad_medida ?? '') : false
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
                              // reset cantidad al cambiar producto para evitar valor inválido
                              updateOcItem(it._key, 'cantidad', '')
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
                            min={decimal ? 0.001 : 1}
                            step={decimal ? 0.001 : 1}
                            className="w-full px-2 py-1.5 border border-border-ds rounded-lg bg-page text-primary text-sm"
                            placeholder={prod?.unidad_medida ? `Cant. (${prod.unidad_medida})` : 'Cant.'}
                            value={it.cantidad}
                            onChange={e => {
                              const v = e.target.value
                              // para enteros: bloquear punto/coma en keyDown no aplica a onChange, pero parsear como int
                              if (!decimal && v.includes('.')) return
                              updateOcItem(it._key, 'cantidad', v)
                            }}
                            onKeyDown={e => {
                              if (!decimal && (e.key === '.' || e.key === ',')) e.preventDefault()
                            }}
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
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-lg font-bold text-primary flex items-center gap-2">
                    OC #{showOcDetail.numero}
                    {showOcDetail.tiene_reembolso_pendiente && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 font-medium">Reembolso pendiente</span>
                    )}
                    {showOcDetail.es_derivada && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 font-medium">OC derivada</span>
                    )}
                  </h2>
                  <p className="text-sm text-muted">{(showOcDetail as any).proveedores?.nombre}</p>
                </div>
                <span className={`text-sm px-3 py-1 rounded-full font-medium ${ESTADO_OC_COLOR[showOcDetail.estado as EstadoOC]}`}>
                  {ESTADO_OC_LABEL[showOcDetail.estado as EstadoOC]}
                </span>
              </div>

              {/* Tabs — visibles cuando hay recepciones */}
              {['recibida', 'recibida_parcial'].includes(showOcDetail.estado) && (() => {
                const diferenciasOC = ocItemsData.map(item => {
                  const totalRecibido = (recepcionItemsOC as any[])
                    .filter(ri => ri.oc_item_id === item.id)
                    .reduce((sum: number, ri: any) => sum + (ri.cantidad_recibida || 0), 0)
                  return {
                    producto_id: item.producto_id,
                    nombre: (item as any).productos?.nombre ?? '—',
                    sku: (item as any).productos?.sku ?? '—',
                    unidad: (item as any).productos?.unidad_medida ?? 'u',
                    esperado: item.cantidad,
                    recibido: totalRecibido,
                    diferencia: totalRecibido - item.cantidad,
                  }
                })
                const hayDiferencias = diferenciasOC.some(d => d.diferencia !== 0)

                return (
                  <>
                    <div className="flex gap-1 mb-4 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
                      {(['pedido', 'entregas', 'diferencias'] as const).map(t => (
                        <button key={t} onClick={() => setOcDetailTab(t)}
                          className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors
                            ${ocDetailTab === t ? 'bg-white dark:bg-gray-800 text-primary shadow-sm' : 'text-muted hover:text-primary'}`}>
                          {t === 'pedido' ? 'Pedido' : t === 'entregas' ? 'Entregado' : `Diferencias${hayDiferencias ? ' ⚠' : ''}`}
                        </button>
                      ))}
                    </div>

                    {/* Tab Entregado */}
                    {ocDetailTab === 'entregas' && (
                      <div className="border border-border-ds rounded-xl overflow-hidden mb-4">
                        <table className="w-full text-sm">
                          <thead className="bg-page">
                            <tr>
                              <th className="text-left px-3 py-2 text-muted font-medium">Producto</th>
                              <th className="text-right px-3 py-2 text-muted font-medium">Recibido</th>
                              <th className="text-right px-3 py-2 text-muted font-medium">Recepción</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                            {(recepcionItemsOC as any[]).map((ri, i) => (
                              <tr key={i}>
                                <td className="px-3 py-2 text-primary">
                                  <div>{ri.productos?.nombre}</div>
                                  <div className="text-xs text-muted font-mono">{ri.productos?.sku}</div>
                                </td>
                                <td className="px-3 py-2 text-right text-primary">{ri.cantidad_recibida} {ri.productos?.unidad_medida}</td>
                                <td className="px-3 py-2 text-right text-muted text-xs">
                                  #{ri.recepciones?.numero} · {new Date(ri.recepciones?.created_at).toLocaleDateString('es-AR')}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Tab Diferencias */}
                    {ocDetailTab === 'diferencias' && (
                      <div className="space-y-3 mb-4">
                        <div className="border border-border-ds rounded-xl overflow-hidden">
                          <table className="w-full text-sm">
                            <thead className="bg-page">
                              <tr>
                                <th className="text-left px-3 py-2 text-muted font-medium">Producto</th>
                                <th className="text-right px-3 py-2 text-muted font-medium">Esperado</th>
                                <th className="text-right px-3 py-2 text-muted font-medium">Recibido</th>
                                <th className="text-right px-3 py-2 text-muted font-medium">Diferencia</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                              {diferenciasOC.map((d, i) => (
                                <tr key={i} className={d.diferencia !== 0 ? 'bg-red-50/50 dark:bg-red-900/10' : ''}>
                                  <td className="px-3 py-2 text-primary">
                                    <div>{d.nombre}</div>
                                    <div className="text-xs text-muted font-mono">{d.sku}</div>
                                  </td>
                                  <td className="px-3 py-2 text-right text-muted">{d.esperado} {d.unidad}</td>
                                  <td className="px-3 py-2 text-right text-primary">{d.recibido} {d.unidad}</td>
                                  <td className="px-3 py-2 text-right font-semibold">
                                    {d.diferencia === 0
                                      ? <span className="text-green-600 dark:text-green-400">✓</span>
                                      : d.diferencia < 0
                                        ? <span className="text-red-600 dark:text-red-400">{d.diferencia} {d.unidad}</span>
                                        : <span className="text-amber-600 dark:text-amber-400">+{d.diferencia} {d.unidad}</span>
                                    }
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {hayDiferencias && (
                          <div className="flex flex-wrap gap-2">
                            {diferenciasOC.some(d => d.diferencia < 0) && !showOcDetail.tiene_reembolso_pendiente && (
                              <button
                                onClick={() => solicitarReembolsoOC.mutate(showOcDetail.id)}
                                disabled={solicitarReembolsoOC.isPending}
                                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border-2 border-violet-500 text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 disabled:opacity-50">
                                Solicitar reembolso → Gastos OC
                              </button>
                            )}
                            {diferenciasOC.some(d => d.diferencia < 0) && (
                              <button
                                onClick={() => crearOCDerivadaOC.mutate({
                                  oc: showOcDetail,
                                  faltantes: diferenciasOC.filter(d => d.diferencia < 0).map(d => ({
                                    producto_id: d.producto_id,
                                    cantidad: Math.abs(d.diferencia),
                                  })),
                                })}
                                disabled={crearOCDerivadaOC.isPending}
                                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border-2 border-violet-500 text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 disabled:opacity-50">
                                Crear OC derivada (entrega pendiente)
                              </button>
                            )}
                          </div>
                        )}
                        {!hayDiferencias && (
                          <p className="text-sm text-green-600 dark:text-green-400 text-center py-2">✓ Sin diferencias — recepción completa</p>
                        )}
                      </div>
                    )}
                  </>
                )
              })()}

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
                        <td colSpan={3} className="px-3 py-2 text-right text-sm font-semibold text-primary">Subtotal productos</td>
                        <td className="px-3 py-2 text-right font-bold text-primary">
                          ${ocItemsData.reduce((s, it) => s + (it.precio_unitario != null ? it.cantidad * it.precio_unitario : 0), 0)
                            .toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                      {(showOcDetail as any).tiene_envio && (
                        <tr>
                          <td colSpan={3} className="px-3 py-2 text-right text-sm text-muted flex items-center justify-end gap-1">
                            <Truck size={12} /> Costo envío
                          </td>
                          <td className="px-3 py-2 text-right text-primary">
                            ${((showOcDetail as any).costo_envio ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      )}
                      {(showOcDetail as any).tiene_envio && (
                        <tr className="border-t border-border-ds">
                          <td colSpan={3} className="px-3 py-2 text-right text-sm font-semibold text-primary">Total estimado</td>
                          <td className="px-3 py-2 text-right font-bold text-primary">
                            ${(ocItemsData.reduce((s, it) => s + (it.precio_unitario != null ? it.cantidad * it.precio_unitario : 0), 0) + ((showOcDetail as any).costo_envio ?? 0))
                              .toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      )}
                    </tfoot>
                  )}
                </table>
              </div>

              {/* Descargar */}
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => descargarOCpdf(showOcDetail, ocItemsData)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-border-ds text-primary hover:bg-page"
                  title="Descargar PDF"
                >
                  <FileDown className="w-4 h-4" /> PDF
                </button>
                <button
                  onClick={() => descargarOCcsv(showOcDetail, ocItemsData)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-border-ds text-primary hover:bg-page"
                  title="Descargar CSV (abre en Excel)"
                >
                  <FileDown className="w-4 h-4" /> CSV
                </button>
              </div>

              {/* Lifecycle desde detalle */}
              <div className="flex flex-wrap gap-2 mt-3">
                {showOcDetail.estado === 'borrador' && (
                  <button
                    onClick={() => cambiarEstadoOC.mutate({ id: showOcDetail.id, estado: 'enviada' })}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700"
                  >
                    <Send className="w-4 h-4" /> Enviar al proveedor
                  </button>
                )}
                {showOcDetail.estado === 'enviada' && (() => {
                  const bloqueada = !['pagada','cuenta_corriente'].includes((showOcDetail as any).estado_pago)
                  const tooltipMsg = (showOcDetail as any).estado_pago === 'pendiente_pago'
                    ? 'Pago pendiente — pagá o asigná a CC en Gastos → OC'
                    : (showOcDetail as any).estado_pago === 'pago_parcial'
                      ? 'Pago parcial — completá el pago o asigná el saldo a CC en Gastos → OC'
                      : 'Confirmar OC'
                  return (
                    <div className="flex flex-col items-start gap-1">
                      <button
                        onClick={() => bloqueada
                          ? toast.error(tooltipMsg)
                          : cambiarEstadoOC.mutate({ id: showOcDetail.id, estado: 'confirmada' })}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm ${bloqueada ? 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed' : 'bg-green-600 text-white hover:bg-green-700'}`}
                      >
                        <CheckCircle className="w-4 h-4" /> Confirmar OC
                      </button>
                      {bloqueada && (
                        <p className="text-xs text-amber-600 dark:text-amber-400">⚠ Ir a Gastos → Órdenes de Compra para regularizar el pago</p>
                      )}
                    </div>
                  )
                })()}
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
      {/* ── Modal Cuenta Corriente Proveedor ── */}
      {ccProvId && (() => {
        const prov = (proveedores as any[]).find((p: any) => p.id === ccProvId)
        const hoy = new Date().toISOString().split('T')[0]
        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
                <div>
                  <h3 className="font-semibold text-primary dark:text-white">Cuenta Corriente</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{prov?.nombre ?? '—'}</p>
                </div>
                <button onClick={() => setCcProvId(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
              </div>

              {/* Saldo */}
              <div className={`mx-5 mt-4 rounded-xl px-4 py-3 flex items-center justify-between ${saldoCC > 0 ? 'bg-red-50 dark:bg-red-900/20' : 'bg-green-50 dark:bg-green-900/20'}`}>
                <div className="flex items-center gap-2">
                  {saldoCC > 0 ? <AlertCircle className="w-4 h-4 text-red-500" /> : <CheckCircle className="w-4 h-4 text-green-500" />}
                  <span className="text-sm font-medium text-primary dark:text-white">Saldo adeudado</span>
                </div>
                <span className={`text-lg font-bold ${saldoCC > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                  ${saldoCC.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </span>
              </div>

              {/* Registrar pago */}
              {saldoCC > 0.5 && (
                <div className="mx-5 mt-3 bg-gray-50 dark:bg-gray-700 rounded-xl p-4 space-y-3">
                  <p className="text-sm font-medium text-primary dark:text-white">Registrar pago</p>
                  <div className="flex gap-2">
                    <input type="number" onWheel={e => e.currentTarget.blur()} value={ccPagoMonto} onChange={e => setCcPagoMonto(e.target.value)}
                      placeholder={`Hasta $${saldoCC.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`}
                      className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-800 text-primary" />
                    <select value={ccPagoMedio} onChange={e => setCcPagoMedio(e.target.value)}
                      className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-800 text-primary">
                      {['Efectivo','Transferencia','Tarjeta de débito','Cheque','Otro'].map(m => <option key={m}>{m}</option>)}
                    </select>
                  </div>
                  {ccPagoMedio === 'Efectivo' && (cajasAbiertasProv as any[]).length === 0 && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">⚠ No hay caja abierta. El egreso no se registrará en caja.</p>
                  )}
                  <button onClick={registrarPagoCC} disabled={ccGuardando || !ccPagoMonto}
                    className="w-full py-2 bg-accent text-white rounded-xl text-sm font-semibold hover:bg-accent/90 disabled:opacity-50 flex items-center justify-center gap-2">
                    <DollarSign className="w-4 h-4" />
                    {ccGuardando ? 'Guardando…' : 'Confirmar pago'}
                  </button>
                </div>
              )}

              {/* Historial */}
              <div className="flex-1 overflow-y-auto mx-5 mt-3 mb-5 space-y-2">
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Historial de movimientos</p>
                {(ccMovimientos as any[]).length === 0 ? (
                  <p className="text-sm text-gray-400 py-4 text-center">Sin movimientos registrados</p>
                ) : (
                  (ccMovimientos as any[]).map((m: any) => {
                    const esDeuda = m.monto > 0
                    const venc = m.fecha_vencimiento
                    const vencida = venc && venc < hoy
                    return (
                      <div key={m.id} className="flex items-start justify-between gap-3 py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-primary dark:text-white truncate">
                            {m.descripcion ?? (m.tipo === 'oc' ? 'Orden de Compra' : m.tipo === 'pago' ? 'Pago' : m.tipo)}
                            {m.ordenes_compra && <span className="text-gray-400 ml-1 text-xs">OC #{m.ordenes_compra.numero}</span>}
                          </p>
                          <div className="flex gap-2 text-xs text-gray-400 flex-wrap mt-0.5">
                            <span>{new Date(m.fecha + 'T00:00:00').toLocaleDateString('es-AR')}</span>
                            {m.medio_pago && <span>· {m.medio_pago}</span>}
                            {venc && <span className={vencida ? 'text-red-500 font-medium' : 'text-amber-500'}>· Vence {new Date(venc + 'T00:00:00').toLocaleDateString('es-AR')}</span>}
                          </div>
                        </div>
                        <span className={`text-sm font-bold flex-shrink-0 ${esDeuda ? 'text-red-500' : 'text-green-600'}`}>
                          {esDeuda ? '+' : ''}{m.monto < 0 ? '-' : ''}${Math.abs(m.monto).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                        </span>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        )
      })()}
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
