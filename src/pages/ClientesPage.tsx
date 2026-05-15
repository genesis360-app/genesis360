import { useState, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, useNavigate } from 'react-router-dom'
import {
  Users, Plus, Search, Phone, Mail, FileText, X,
  ChevronDown, ChevronUp, ShoppingCart, TrendingUp, Clock, Pencil, Trash2, Award,
  Upload, Download, CheckCircle, XCircle, FileSpreadsheet, ExternalLink, MapPin, Star,
  Tag, Calendar, StickyNote, CreditCard, AlertCircle, MessageCircle, DollarSign,
} from 'lucide-react'
import { buildWhatsAppUrl } from '@/lib/whatsapp'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'
import toast from 'react-hot-toast'

interface FilaCliente {
  idx: number
  nombre: string
  dni?: string
  telefono?: string
  email?: string
  notas?: string
  estado: 'nuevo' | 'duplicado' | 'error'
  errores: string[]
}

function formatMoneda(v: number) {
  return `$${v.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}
function formatFecha(iso: string) {
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function diasDesde(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const dias = Math.floor(diff / (1000 * 60 * 60 * 24))
  if (dias === 0) return 'hoy'
  if (dias === 1) return 'ayer'
  if (dias < 30) return `hace ${dias}d`
  if (dias < 365) return `hace ${Math.floor(dias / 30)}m`
  return `hace ${Math.floor(dias / 365)}a`
}

interface ClienteForm {
  nombre: string; dni: string; telefono: string; email: string; notas: string
  cuit_receptor: string; condicion_iva_receptor: string
  fecha_nacimiento: string; etiquetas: string
  codigo_fiscal: string; regimen_fiscal: string
  cuenta_corriente_habilitada: boolean; limite_credito: string; plazo_pago_dias: string
}
const FORM_VACIO: ClienteForm = {
  nombre: '', dni: '', telefono: '', email: '', notas: '',
  cuit_receptor: '', condicion_iva_receptor: '',
  fecha_nacimiento: '', etiquetas: '',
  codigo_fiscal: '', regimen_fiscal: '',
  cuenta_corriente_habilitada: false, limite_credito: '', plazo_pago_dias: '30',
}

function validarDNI(valor: string): string | null {
  const d = valor.replace(/[\.\-\s]/g, '')
  if (!d) return null
  if (!/^\d+$/.test(d)) return 'Solo se permiten números'
  if (d.length < 7 || d.length > 8) return 'El DNI debe tener 7 u 8 dígitos'
  return null
}

function validarTelefono(valor: string): string | null {
  if (!valor) return null
  let d = valor.replace(/[\s\-\(\)\.]/g, '')
  if (d.startsWith('+549')) d = d.slice(4)
  else if (d.startsWith('+54')) d = d.slice(3)
  else if (d.startsWith('549')) d = d.slice(3)
  if (d.startsWith('0')) d = d.slice(1)
  if (d.startsWith('9') && d.length > 9) d = d.slice(1)
  if (!/^\d+$/.test(d)) return 'Solo se permiten números, +, -, paréntesis y espacios'
  if (d.length < 8 || d.length > 11) return 'Formato inválido — ej: 11 2345-6789 o +54 9 11 2345-6789'
  return null
}

const ESTADOS: Record<string, { label: string; color: string }> = {
  pendiente:  { label: 'Pendiente',  color: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400' },
  reservada:  { label: 'Reservada',  color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' },
  despachada: { label: 'Despachada', color: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' },
  cancelada:  { label: 'Cancelada',  color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' },
  facturada:  { label: 'Facturada',  color: 'bg-purple-100 text-purple-700' },
}

export default function ClientesPage() {
  const { tenant, user } = useAuthStore()
  const { sucursalId, applyFilter } = useSucursalFilter()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [pageTab, setPageTab] = useState<'lista' | 'cc'>('lista')
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<ClienteForm>(FORM_VACIO)
  const [saving, setSaving] = useState(false)
  const [dniError, setDniError] = useState<string | null>(null)
  const [telError, setTelError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(() => searchParams.get('id'))
  const [innerTab, setInnerTab] = useState<'historial' | 'domicilios' | 'notas'>('historial')
  const [filtroEtiqueta, setFiltroEtiqueta] = useState('')
  const [nuevaNota, setNuevaNota] = useState('')
  const [savingNota, setSavingNota] = useState(false)
  const [pagoInlineId, setPagoInlineId] = useState<string | null>(null)  // cliente_id con pago inline abierto
  const [pagoMonto, setPagoMonto] = useState('')
  const [pagoMetodo, setPagoMetodo] = useState('Efectivo')
  const [savingPago, setSavingPago] = useState(false)
  // ISS-107: cancelación de deuda CC
  const [cancelandoDeudaId, setCancelandoDeudaId] = useState<string | null>(null)
  const puedeGestionarCC = ['DUEÑO', 'SUPERVISOR', 'SUPER_USUARIO', 'ADMIN'].includes(user?.rol ?? '')
  const [showDomForm, setShowDomForm] = useState(false)
  const [editDomId, setEditDomId] = useState<string | null>(null)
  const [domForm, setDomForm] = useState({ nombre: '', calle: '', numero: '', piso_depto: '', ciudad: '', provincia: '', codigo_postal: '', referencias: '', es_principal: false })
  const [savingDom, setSavingDom] = useState(false)

  // Import state
  const fileRefImport = useRef<HTMLInputElement>(null)
  const [showImport, setShowImport] = useState(false)
  const [filasImport, setFilasImport] = useState<FilaCliente[]>([])
  const [importando, setImportando] = useState(false)
  const [resultadoImport, setResultadoImport] = useState<{ creados: number; errores: number } | null>(null)

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: clientes = [], isLoading } = useQuery({
    queryKey: ['clientes', tenant?.id, search],
    queryFn: async () => {
      let q = supabase.from('clientes').select('*').eq('tenant_id', tenant!.id).order('nombre')
      if (search) q = q.or(`nombre.ilike.%${search}%,dni.ilike.%${search}%`)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!tenant,
  })

  // Si viene con ?id= en la URL, expandir ese cliente y limpiar el param
  useEffect(() => {
    const id = searchParams.get('id')
    if (!id || isLoading) return
    const existe = clientes.some((c: any) => c.id === id)
    if (existe) {
      setExpandedId(id)
      setSearchParams({}, { replace: true })
    }
  }, [clientes, isLoading, searchParams, setSearchParams])

  const { data: statsMap = {} } = useQuery({
    queryKey: ['clientes-stats', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('ventas')
        .select('cliente_id, total, created_at')
        .eq('tenant_id', tenant!.id)
        .not('cliente_id', 'is', null)
        .in('estado', ['despachada', 'facturada'])
      const map: Record<string, { total: number; count: number; ultima: string; ticket: number }> = {}
      for (const v of data ?? []) {
        if (!v.cliente_id) continue
        if (!map[v.cliente_id]) map[v.cliente_id] = { total: 0, count: 0, ultima: '', ticket: 0 }
        map[v.cliente_id].total += v.total ?? 0
        map[v.cliente_id].count += 1
        if (!map[v.cliente_id].ultima || v.created_at > map[v.cliente_id].ultima)
          map[v.cliente_id].ultima = v.created_at
      }
      Object.values(map).forEach(s => { s.ticket = s.count > 0 ? s.total / s.count : 0 })
      return map
    },
    enabled: !!tenant,
  })

  const { data: historial = [] } = useQuery({
    queryKey: ['cliente-historial', expandedId],
    queryFn: async () => {
      const { data } = await supabase.from('ventas')
        .select('id, numero, total, estado, created_at, medio_pago, venta_items(cantidad, precio_unitario, productos(nombre))')
        .eq('tenant_id', tenant!.id)
        .eq('cliente_id', expandedId!)
        .order('created_at', { ascending: false })
        .limit(20)
      return data ?? []
    },
    enabled: !!expandedId,
  })

  const { data: domicilios = [], refetch: refetchDoms } = useQuery({
    queryKey: ['cliente-domicilios', expandedId],
    queryFn: async () => {
      const { data } = await supabase.from('cliente_domicilios')
        .select('*').eq('cliente_id', expandedId!).order('es_principal', { ascending: false }).order('created_at')
      return data ?? []
    },
    enabled: !!expandedId && innerTab === 'domicilios',
  })

  const { data: ventasCC = [] } = useQuery({
    queryKey: ['ventas-cc', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('ventas')
        .select('id, numero, total, monto_pagado, estado, created_at, despachado_at, cliente_id, cliente_nombre')
        .eq('tenant_id', tenant!.id)
        .eq('es_cuenta_corriente', true)
        .in('estado', ['despachada', 'facturada'])
        .order('created_at', { ascending: false })
      return (data ?? []).filter((v: any) => (v.total ?? 0) - (v.monto_pagado ?? 0) > 0.5)
    },
    enabled: !!tenant && pageTab === 'cc',
  })

  const { data: clientesCC = [] } = useQuery({
    queryKey: ['clientes-cc', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('clientes')
        .select('id, nombre, telefono, plazo_pago_dias, limite_credito')
        .eq('tenant_id', tenant!.id)
        .eq('cuenta_corriente_habilitada', true)
        .order('nombre')
      return data ?? []
    },
    enabled: !!tenant && pageTab === 'cc',
  })

  const { data: notasCliente = [], refetch: refetchNotas } = useQuery({
    queryKey: ['cliente-notas', expandedId],
    queryFn: async () => {
      const { data } = await supabase.from('cliente_notas')
        .select('*, users(nombre_display)')
        .eq('cliente_id', expandedId!)
        .order('created_at', { ascending: false })
      return data ?? []
    },
    enabled: !!expandedId && innerTab === 'notas',
  })

  const agregarNota = async () => {
    if (!nuevaNota.trim() || !expandedId) return
    setSavingNota(true)
    const { error } = await supabase.from('cliente_notas').insert({
      tenant_id: tenant!.id, cliente_id: expandedId,
      texto: nuevaNota.trim(), usuario_id: user?.id,
    })
    if (error) { toast.error(error.message) }
    else { setNuevaNota(''); refetchNotas(); toast.success('Nota guardada') }
    setSavingNota(false)
  }

  const saveDomicilio = async () => {
    if (!domForm.calle.trim()) { toast.error('La calle es obligatoria'); return }
    setSavingDom(true)
    try {
      const payload = {
        tenant_id: tenant!.id, cliente_id: expandedId!,
        nombre: domForm.nombre.trim() || null,
        calle: domForm.calle.trim(),
        numero: domForm.numero.trim() || null,
        piso_depto: domForm.piso_depto.trim() || null,
        ciudad: domForm.ciudad.trim() || null,
        provincia: domForm.provincia.trim() || null,
        codigo_postal: domForm.codigo_postal.trim() || null,
        referencias: domForm.referencias.trim() || null,
        es_principal: domForm.es_principal,
      }
      if (domForm.es_principal) {
        await supabase.from('cliente_domicilios').update({ es_principal: false }).eq('cliente_id', expandedId!)
      }
      if (editDomId) {
        const { error } = await supabase.from('cliente_domicilios').update(payload).eq('id', editDomId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('cliente_domicilios').insert(payload)
        if (error) throw error
      }
      toast.success(editDomId ? 'Domicilio actualizado' : 'Domicilio guardado')
      refetchDoms()
      setShowDomForm(false); setEditDomId(null)
      setDomForm({ nombre: '', calle: '', numero: '', piso_depto: '', ciudad: '', provincia: '', codigo_postal: '', referencias: '', es_principal: false })
    } catch (e: any) { toast.error(e.message ?? 'Error al guardar') }
    finally { setSavingDom(false) }
  }

  const deleteDomicilio = async (id: string) => {
    if (!confirm('¿Eliminar este domicilio?')) return
    await supabase.from('cliente_domicilios').delete().eq('id', id)
    refetchDoms()
  }

  // ── Stats globales ────────────────────────────────────────────────────────
  const totalFacturado = Object.values(statsMap).reduce((a, s) => a + s.total, 0)
  const clientesConCompras = Object.keys(statsMap).length
  const totalCompras = Object.values(statsMap).reduce((a, s) => a + s.count, 0)
  const ticketGlobal = totalCompras > 0 ? totalFacturado / totalCompras : 0
  const topCliente = clientes.reduce((top: any, c: any) => {
    const s = statsMap[c.id]
    if (!s) return top
    if (!top || s.total > (statsMap[top.id]?.total ?? 0)) return c
    return top
  }, null)

  // ── Modal helpers ─────────────────────────────────────────────────────────
  const abrirModal = (cliente?: any) => {
    setDniError(null)
    setTelError(null)
    if (cliente) {
      setEditId(cliente.id)
      setForm({
        nombre: cliente.nombre, dni: cliente.dni ?? '', telefono: cliente.telefono ?? '',
        email: cliente.email ?? '', notas: cliente.notas ?? '',
        cuit_receptor: cliente.cuit_receptor ?? '', condicion_iva_receptor: cliente.condicion_iva_receptor ?? '',
        fecha_nacimiento: cliente.fecha_nacimiento ?? '',
        etiquetas: Array.isArray(cliente.etiquetas) ? cliente.etiquetas.join(', ') : '',
        codigo_fiscal: cliente.codigo_fiscal ?? '', regimen_fiscal: cliente.regimen_fiscal ?? '',
        cuenta_corriente_habilitada: cliente.cuenta_corriente_habilitada ?? false,
        limite_credito: cliente.limite_credito != null ? String(cliente.limite_credito) : '',
        plazo_pago_dias: String(cliente.plazo_pago_dias ?? 30),
      })
    } else {
      setEditId(null)
      setForm(FORM_VACIO)
    }
    setModalOpen(true)
  }

  const guardar = async () => {
    if (!form.nombre.trim()) { toast.error('El nombre es obligatorio'); return }
    if (!form.dni.trim()) { toast.error('El DNI es obligatorio'); return }
    if (!form.telefono.trim()) { toast.error('El teléfono es obligatorio'); return }
    const errDni = validarDNI(form.dni)
    const errTel = validarTelefono(form.telefono)
    setDniError(errDni)
    setTelError(errTel)
    if (errDni || errTel) { toast.error('Corregí los errores antes de guardar'); return }
    setSaving(true)
    try {
      const etiquetasArr = form.etiquetas.trim()
        ? form.etiquetas.split(',').map(e => e.trim()).filter(Boolean)
        : null
      const payload = {
        nombre: form.nombre.trim(), dni: form.dni.trim(),
        telefono: form.telefono.trim(), email: form.email || null,
        notas: form.notas || null,
        cuit_receptor: form.cuit_receptor.trim() || null,
        condicion_iva_receptor: form.condicion_iva_receptor || null,
        fecha_nacimiento: form.fecha_nacimiento || null,
        etiquetas: etiquetasArr,
        codigo_fiscal: form.codigo_fiscal.trim() || null,
        regimen_fiscal: form.regimen_fiscal.trim() || null,
        cuenta_corriente_habilitada: form.cuenta_corriente_habilitada,
        limite_credito: form.limite_credito ? parseFloat(form.limite_credito) : null,
        plazo_pago_dias: form.plazo_pago_dias ? parseInt(form.plazo_pago_dias) : 30,
      }
      if (editId) {
        const { error } = await supabase.from('clientes').update(payload).eq('id', editId)
        if (error) throw error
        toast.success('Cliente actualizado')
      } else {
        const { error } = await supabase.from('clientes').insert({ tenant_id: tenant!.id, ...payload })
        if (error) throw error
        toast.success('Cliente creado')
      }
      qc.invalidateQueries({ queryKey: ['clientes'] })
      qc.invalidateQueries({ queryKey: ['clientes-stats'] })
      setModalOpen(false)
    } catch (err: any) {
      toast.error(err.message ?? 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const registrarPagoCC = async (clienteId: string) => {
    const monto = parseFloat(pagoMonto)
    if (!monto || monto <= 0) { toast.error('Ingresá un monto válido'); return }
    const ventasDelCliente = (ventasCC as any[]).filter(v => v.cliente_id === clienteId)
    if (!ventasDelCliente.length) { toast.error('Sin ventas CC pendientes'); return }
    setSavingPago(true)
    try {
      // Distribuir el pago entre las ventas más antiguas primero
      let restante = monto
      for (const venta of ventasDelCliente.sort((a: any, b: any) => a.created_at.localeCompare(b.created_at))) {
        if (restante <= 0) break
        const saldo = (venta.total ?? 0) - (venta.monto_pagado ?? 0)
        const abono = Math.min(restante, saldo)
        const nuevoMontoPagado = (venta.monto_pagado ?? 0) + abono
        const nuevoEstado = nuevoMontoPagado >= (venta.total ?? 0) - 0.5 ? 'despachada' : venta.estado
        // Acumular medio de pago
        let medios: any[] = []
        try { medios = JSON.parse(venta.medio_pago ?? '[]') } catch { medios = [] }
        medios.push({ tipo: pagoMetodo, monto: abono })
        await supabase.from('ventas').update({
          monto_pagado: nuevoMontoPagado,
          estado: nuevoEstado,
          medio_pago: JSON.stringify(medios),
        }).eq('id', venta.id)
        restante -= abono
      }
      toast.success(`Pago de ${formatMoneda(monto)} registrado`)
      qc.invalidateQueries({ queryKey: ['ventas-cc'] })
      setPagoInlineId(null); setPagoMonto(''); setPagoMetodo('Efectivo')
    } catch (e: any) { toast.error(e.message ?? 'Error al registrar pago') }
    finally { setSavingPago(false) }
  }

  // ISS-107: cancelar deuda de una venta CC (solo DUEÑO/SUPERVISOR/ADMIN)
  const cancelarDeudaCC = async (ventaId: string, ventaNumero: number) => {
    if (!confirm(`¿Cancelar la deuda de la Venta #${ventaNumero}? La deuda quedará marcada como saldada sin pago registrado.`)) return
    setCancelandoDeudaId(ventaId)
    try {
      const { data: venta } = await supabase.from('ventas').select('total, medio_pago').eq('id', ventaId).single()
      if (!venta) throw new Error('Venta no encontrada')
      // Marcar como pagada por cancelación (monto_pagado = total, agrega nota en medio_pago)
      let medios: any[] = []
      try { medios = JSON.parse(venta.medio_pago ?? '[]') } catch { medios = [] }
      const saldo = venta.total - medios.filter((m: any) => m.tipo !== 'Cuenta Corriente').reduce((acc: number, m: any) => acc + (m.monto || 0), 0)
      if (saldo > 0) medios.push({ tipo: 'Cancelación CC', monto: saldo, cancelado_por: user?.nombre_display ?? user?.id })
      const { error } = await supabase.from('ventas').update({
        monto_pagado: venta.total,
        medio_pago: JSON.stringify(medios),
      }).eq('id', ventaId)
      if (error) throw error
      toast.success(`Deuda Venta #${ventaNumero} cancelada`)
      qc.invalidateQueries({ queryKey: ['ventas-cc'] })
    } catch (e: any) { toast.error(e.message ?? 'Error al cancelar deuda') }
    finally { setCancelandoDeudaId(null) }
  }

  const eliminar = async (id: string, nombre: string) => {
    if (!confirm(`¿Eliminar a ${nombre}? Sus ventas quedarán sin cliente asignado.`)) return
    // Desasociar ventas y envíos antes de eliminar (evita error de FK)
    await Promise.all([
      supabase.from('ventas').update({ cliente_id: null }).eq('cliente_id', id),
      supabase.from('envios').update({ destino_id: null }).eq('destino_id', id),
    ])
    const { error } = await supabase.from('clientes').delete().eq('id', id)
    if (error) { toast.error('No se pudo eliminar: ' + error.message); return }
    toast.success('Cliente eliminado')
    qc.invalidateQueries({ queryKey: ['clientes'] })
    qc.invalidateQueries({ queryKey: ['clientes-stats'] })
  }

  // ── Importación masiva ───────────────────────────────────────────────────
  const descargarPlantilla = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['nombre', 'dni', 'telefono', 'email', 'notas'],
      ['Juan Pérez', '20123456', '+54 11 1234-5678', 'juan@email.com', 'Cliente frecuente'],
      ['María García', '27654321', '', 'maria@empresa.com', ''],
    ])
    const hdr = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '1E3A5F' } }, alignment: { horizontal: 'center' } }
    ;['A', 'B', 'C', 'D', 'E'].forEach(c => { if (ws[`${c}1`]) ws[`${c}1`].s = hdr })
    ws['!cols'] = [{ wch: 25 }, { wch: 20 }, { wch: 28 }, { wch: 35 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Clientes')
    XLSX.writeFile(wb, 'plantilla_clientes.xlsx')
  }

  const procesarArchivo = (file: File) => {
    setResultadoImport(null)
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target!.result as ArrayBuffer), { type: 'array' })
        const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
        if (!rows.length) { toast.error('El archivo está vacío'); return }

        const nombresActuales = new Set((clientes as any[]).map(c => c.nombre.toLowerCase()))

        const filas: FilaCliente[] = rows.map((row, idx) => {
          const errores: string[] = []
          const nombre = String(row.nombre || '').trim()
          if (!nombre) errores.push('Nombre requerido')
          const isDuplicado = nombresActuales.has(nombre.toLowerCase())
          return {
            idx,
            nombre,
            dni: String(row.dni || '').trim() || undefined,
            telefono: String(row.telefono || '').trim() || undefined,
            email: String(row.email || '').trim() || undefined,
            notas: String(row.notas || '').trim() || undefined,
            estado: errores.length > 0 ? 'error' : isDuplicado ? 'duplicado' : 'nuevo',
            errores,
          }
        })
        setFilasImport(filas)
      } catch { toast.error('Error al leer el archivo.') }
    }
    reader.readAsArrayBuffer(file)
  }

  const confirmarImport = async () => {
    setImportando(true)
    let creados = 0, errores = 0
    for (const fila of filasImport.filter(f => f.estado === 'nuevo')) {
      try {
        const { error } = await supabase.from('clientes').insert({
          tenant_id: tenant!.id,
          nombre: fila.nombre,
          dni: fila.dni ?? null,
          telefono: fila.telefono ?? null,
          email: fila.email ?? null,
          notas: fila.notas ?? null,
          sucursal_id: sucursalId || null,
        })
        if (error) throw error
        creados++
      } catch { errores++ }
    }
    qc.invalidateQueries({ queryKey: ['clientes'] })
    setResultadoImport({ creados, errores })
    setImportando(false)
    toast.success(`${creados} clientes importados`)
  }

  const exportarClientes = (format: 'json' | 'csv') => {
    const rows = (clientes as any[]).map(c => ({
      id: c.id, nombre: c.nombre, dni: c.dni ?? '', telefono: c.telefono ?? '',
      email: c.email ?? '', direccion: c.direccion ?? '',
      cuenta_corriente_habilitada: c.cuenta_corriente_habilitada ?? false,
      activo: c.activo,
    }))
    const filename = `clientes_${new Date().toISOString().slice(0,10)}`
    if (format === 'json') {
      const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${filename}.json`; a.click()
    } else {
      const headers = Object.keys(rows[0] ?? {})
      const lines = rows.map((r: any) => headers.map(h => {
        const v = String(r[h] ?? '')
        return v.includes(',') || v.includes('"') ? `"${v.replace(/"/g,'""')}"` : v
      }).join(','))
      const blob = new Blob(['﻿' + [headers.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${filename}.csv`; a.click()
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-primary">Clientes</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">{clientes.length} registrado{clientes.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex gap-2">
          {pageTab === 'lista' && <>
            <div className="relative group">
              <button className="flex items-center gap-2 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-all">
                <Download size={15} /> Exportar <ChevronDown size={13} />
              </button>
              <div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl shadow-lg overflow-hidden z-20 hidden group-hover:block w-32">
                <button onClick={() => exportarClientes('json')} className="w-full text-left px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">JSON</button>
                <button onClick={() => exportarClientes('csv')}  className="w-full text-left px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">CSV</button>
              </div>
            </div>
            <button onClick={() => { setShowImport(true); setFilasImport([]); setResultadoImport(null) }}
              className="flex items-center gap-2 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-medium px-4 py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all">
              <Upload size={16} /> Importar
            </button>
            <button onClick={() => abrirModal()}
              className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-white font-medium px-4 py-2.5 rounded-xl transition-all">
              <Plus size={18} /> Nuevo cliente
            </button>
          </>}
        </div>
      </div>

      {/* Page tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {([
          { id: 'lista' as const, label: 'Clientes', icon: Users },
          { id: 'cc' as const, label: 'Cuenta Corriente', icon: CreditCard },
        ]).map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setPageTab(id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors
              ${pageTab === id ? 'border-accent text-accent' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}>
            <Icon size={15} />{label}
          </button>
        ))}
      </div>

      {/* ═══════════════ TAB CUENTA CORRIENTE ═══════════════ */}
      {pageTab === 'cc' && (() => {
        // Agrupar ventas CC por cliente
        const deudaMap: Record<string, { total: number; count: number; masAntigua: string; masNueva: string }> = {}
        for (const v of ventasCC as any[]) {
          const cid = v.cliente_id
          if (!cid) continue
          const saldo = (v.total ?? 0) - (v.monto_pagado ?? 0)
          if (!deudaMap[cid]) deudaMap[cid] = { total: 0, count: 0, masAntigua: v.created_at, masNueva: v.created_at }
          deudaMap[cid].total += saldo
          deudaMap[cid].count += 1
          if (v.created_at < deudaMap[cid].masAntigua) deudaMap[cid].masAntigua = v.created_at
          if (v.created_at > deudaMap[cid].masNueva) deudaMap[cid].masNueva = v.created_at
        }

        const totalDeuda = Object.values(deudaMap).reduce((a, d) => a + d.total, 0)
        const clientesConDeuda = (clientesCC as any[]).filter(c => deudaMap[c.id])
        const hoy = new Date()

        return (
          <div className="space-y-5">
            {/* KPIs */}
            <div className="grid sm:grid-cols-3 gap-4">
              <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Deuda total en CC</p>
                <p className="text-2xl font-bold text-red-600 dark:text-red-400">{formatMoneda(totalDeuda)}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{clientesConDeuda.length} clientes con saldo</p>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Clientes habilitados</p>
                <p className="text-2xl font-bold text-primary">{(clientesCC as any[]).length}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">con CC activa</p>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Ventas pendientes</p>
                <p className="text-2xl font-bold text-primary">{(ventasCC as any[]).length}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">sin cobrar</p>
              </div>
            </div>

            {/* Clientes sin deuda (solo habilitados, sin ventas CC pendientes) */}
            {(clientesCC as any[]).filter(c => !deudaMap[c.id]).length > 0 && (
              <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3 flex items-center gap-2">
                <CheckCircle size={15} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                <p className="text-sm text-emerald-700 dark:text-emerald-400">
                  {(clientesCC as any[]).filter(c => !deudaMap[c.id]).length} cliente{(clientesCC as any[]).filter(c => !deudaMap[c.id]).length !== 1 ? 's' : ''} al día — sin deuda pendiente
                </p>
              </div>
            )}

            {/* Tabla de deudas */}
            {(clientesCC as any[]).length === 0 ? (
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-10 flex flex-col items-center text-gray-400 dark:text-gray-500">
                <CreditCard size={36} className="mb-3 opacity-30" />
                <p className="font-medium text-sm">No hay clientes con CC habilitada</p>
                <p className="text-xs mt-1">Habilitá la cuenta corriente desde la ficha de un cliente</p>
              </div>
            ) : (
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Detalle por cliente</p>
                </div>
                <div className="divide-y divide-gray-50 dark:divide-gray-700">
                  {(clientesCC as any[]).map((c: any) => {
                    const d = deudaMap[c.id]
                    const plazo = c.plazo_pago_dias ?? 30
                    const fechaVto = d
                      ? new Date(new Date(d.masAntigua).getTime() + plazo * 24 * 60 * 60 * 1000)
                      : null
                    const diasVto = fechaVto ? Math.ceil((fechaVto.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24)) : null
                    const vencida = diasVto !== null && diasVto < 0
                    const proxima = diasVto !== null && diasVto >= 0 && diasVto <= 5

                    return (
                      <div key={c.id} className="px-4 py-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold text-gray-800 dark:text-gray-100">{c.nombre}</p>
                              {!d && <span className="text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 rounded-full">Al día</span>}
                              {d && vencida && <span className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-2 py-0.5 rounded-full font-semibold">Vencida</span>}
                              {d && proxima && !vencida && <span className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-full">Vence en {diasVto}d</span>}
                              {d && !vencida && !proxima && <span className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded-full">Vence {fechaVto!.toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit' })}</span>}
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400">
                              {c.telefono && <span className="flex items-center gap-1"><Phone size={10} /> {c.telefono}</span>}
                              <span>Plazo: {plazo} días</span>
                              {c.limite_credito && <span>Límite: {formatMoneda(c.limite_credito)}</span>}
                              {d && <span>{d.count} venta{d.count !== 1 ? 's' : ''} pendiente{d.count !== 1 ? 's' : ''}</span>}
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            {d
                              ? <p className={`text-lg font-bold ${vencida ? 'text-red-600 dark:text-red-400' : 'text-gray-800 dark:text-gray-100'}`}>{formatMoneda(d.total)}</p>
                              : <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">$0</p>
                            }
                            {d && <p className="text-xs text-gray-400 dark:text-gray-500">desde {new Date(d.masAntigua).toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit' })}</p>}
                          </div>
                        </div>
                        {/* Acciones */}
                        <div className="flex items-center gap-2 mt-3 flex-wrap">
                          {c.telefono && (() => {
                            const msg = d
                              ? `Hola ${c.nombre}! Te recordamos que tenés un saldo pendiente de ${formatMoneda(d.total)} en cuenta corriente${fechaVto ? `, con vencimiento el ${fechaVto.toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' })}` : ''}. Por favor coordiná el pago. Gracias!`
                              : `Hola ${c.nombre}! Te contactamos desde el negocio.`
                            return (
                              <a href={buildWhatsAppUrl(c.telefono, msg)} target="_blank" rel="noreferrer"
                                className="flex items-center gap-1.5 text-xs bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg transition-colors">
                                <MessageCircle size={12} /> WhatsApp
                              </a>
                            )
                          })()}
                          <button
                            onClick={() => { setPageTab('lista'); setTimeout(() => { setExpandedId(c.id); setInnerTab('historial') }, 100) }}
                            className="flex items-center gap-1.5 text-xs border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 px-3 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                            <ShoppingCart size={12} /> Ver ventas
                          </button>
                          <button
                            onClick={() => { setPagoInlineId(pagoInlineId === c.id ? null : c.id); setPagoMonto(''); setPagoMetodo('Efectivo') }}
                            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors ${pagoInlineId === c.id ? 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200' : 'bg-accent hover:bg-accent/90 text-white'}`}>
                            <DollarSign size={12} /> {pagoInlineId === c.id ? 'Cancelar' : 'Registrar pago'}
                          </button>
                        </div>
                        {/* Ventas CC del cliente */}
                        {d && (
                          <div className="mt-3 space-y-1.5">
                            {(ventasCC as any[]).filter((v: any) => v.cliente_id === c.id).slice(0, 5).map((v: any) => (
                              <div key={v.id} className="flex items-center justify-between text-xs bg-gray-50 dark:bg-gray-700/50 rounded-lg px-3 py-2 gap-2">
                                <span className="text-gray-600 dark:text-gray-400 flex-1 min-w-0 truncate">Venta #{v.numero} · {new Date(v.created_at).toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'2-digit' })}</span>
                                <span className="font-semibold text-red-600 dark:text-red-400 flex-shrink-0">{formatMoneda((v.total ?? 0) - (v.monto_pagado ?? 0))}</span>
                                {/* ISS-107: cancelar deuda CC (solo DUEÑO/SUPERVISOR/ADMIN) */}
                                {puedeGestionarCC && (
                                  <button
                                    onClick={() => cancelarDeudaCC(v.id, v.numero)}
                                    disabled={cancelandoDeudaId === v.id}
                                    title="Cancelar deuda de esta venta (condonar)"
                                    className="flex-shrink-0 text-xs px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-red-400 hover:text-red-500 transition-colors disabled:opacity-50">
                                    {cancelandoDeudaId === v.id ? '...' : 'Cancelar deuda'}
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Panel inline de pago */}
                        {pagoInlineId === c.id && d && (
                          <div className="mt-3 bg-accent/5 border border-accent/20 rounded-xl p-4 space-y-3">
                            <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Registrar pago — Deuda total: <span className="text-red-600 dark:text-red-400">{formatMoneda(d.total)}</span></p>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Monto *</label>
                                <div className="relative">
                                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                                  <input type="number" min="0" max={d.total} value={pagoMonto}
                                    onChange={e => setPagoMonto(e.target.value)}
                                    onWheel={e => e.currentTarget.blur()}
                                    placeholder="0"
                                    className="w-full pl-7 pr-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:border-accent" />
                                </div>
                              </div>
                              <div>
                                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Método</label>
                                <select value={pagoMetodo} onChange={e => setPagoMetodo(e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-800">
                                  {['Efectivo','Transferencia','Tarjeta','MercadoPago','Otro'].map(m => (
                                    <option key={m} value={m}>{m}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button onClick={() => { setPagoInlineId(null); setPagoMonto('') }}
                                className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 py-2 rounded-xl text-sm font-medium">
                                Cancelar
                              </button>
                              <button onClick={() => registrarPagoCC(c.id)} disabled={savingPago || !pagoMonto}
                                className="flex-1 bg-accent hover:bg-accent/90 text-white py-2 rounded-xl text-sm font-semibold disabled:opacity-50">
                                {savingPago ? 'Guardando...' : 'Confirmar pago'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {/* ═══════════════ TAB LISTA ═══════════════ */}
      {pageTab === 'lista' && <>

      {/* Stats cards */}
      {clientesConCompras > 0 && (
        <div className="grid sm:grid-cols-3 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-9 h-9 rounded-xl bg-green-50 dark:bg-green-900/20 flex items-center justify-center">
                <TrendingUp size={18} className="text-green-600 dark:text-green-400" />
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Total facturado</p>
            </div>
            <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">{formatMoneda(totalFacturado)}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{clientesConCompras} cliente{clientesConCompras !== 1 ? 's' : ''} con compras</p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-9 h-9 rounded-xl bg-purple-50 flex items-center justify-center">
                <ShoppingCart size={18} className="text-accent" />
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Ticket promedio</p>
            </div>
            <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">{formatMoneda(ticketGlobal)}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{totalCompras} compra{totalCompras !== 1 ? 's' : ''} en total</p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-9 h-9 rounded-xl bg-yellow-50 dark:bg-yellow-900/20 flex items-center justify-center">
                <Award size={18} className="text-yellow-600" />
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Mejor cliente</p>
            </div>
            {topCliente ? (
              <>
                <p className="text-base font-bold text-gray-800 dark:text-gray-100 truncate">{topCliente.nombre}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{formatMoneda(statsMap[topCliente.id]?.total ?? 0)} en total</p>
              </>
            ) : <p className="text-2xl font-bold text-gray-300">—</p>}
          </div>
        </div>
      )}

      {/* Buscador + filtro etiquetas */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-48">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre o DNI..."
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
        </div>
        {/* Filtro etiquetas */}
        {(clientes as any[]).some(c => Array.isArray(c.etiquetas) && c.etiquetas.length > 0) && (
          <div className="relative">
            <Tag size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <select value={filtroEtiqueta} onChange={e => setFiltroEtiqueta(e.target.value)}
              className="pl-8 pr-8 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent appearance-none bg-white dark:bg-gray-800">
              <option value="">Todas las etiquetas</option>
              {[...new Set((clientes as any[]).flatMap(c => c.etiquetas ?? []))].map((et: string) => (
                <option key={et} value={et}>{et}</option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        )}
        {filtroEtiqueta && (
          <button onClick={() => setFiltroEtiqueta('')}
            className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <X size={14} /> Limpiar
          </button>
        )}
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent" />
        </div>
      ) : clientes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-14 text-gray-400 dark:text-gray-500">
          <Users size={36} className="mb-3 opacity-30" />
          <p className="font-medium text-sm">No hay clientes aún</p>
          <button onClick={() => abrirModal()} className="mt-3 text-accent text-sm font-medium hover:underline">Crear el primero</button>
        </div>
      ) : (
        <div className="space-y-2">
          {(clientes as any[]).filter(c =>
            !filtroEtiqueta || (Array.isArray(c.etiquetas) && c.etiquetas.includes(filtroEtiqueta))
          ).map((c: any) => {
            const stats = statsMap[c.id]
            const isExpanded = expandedId === c.id
            return (
              <div key={c.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="p-4 flex items-center gap-3">
                  {/* Avatar */}
                  <div className="w-10 h-10 bg-accent/10 rounded-full flex items-center justify-center flex-shrink-0 text-accent font-bold text-sm">
                    {c.nombre.charAt(0).toUpperCase()}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-800 dark:text-gray-100 truncate">{c.nombre}</p>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      {c.dni && <span className="text-xs text-gray-400 dark:text-gray-500">DNI {c.dni}</span>}
                      {c.cuit_receptor && <span className="text-xs text-gray-400 dark:text-gray-500">CUIT {c.cuit_receptor}</span>}
                      {c.condicion_iva_receptor && <span className="text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded">{c.condicion_iva_receptor}</span>}
                      {c.fecha_nacimiento && (() => {
                        const hoy = new Date()
                        const nac = new Date(c.fecha_nacimiento + 'T12:00:00')
                        const esCumple = nac.getDate() === hoy.getDate() && nac.getMonth() === hoy.getMonth()
                        return <span className={`text-xs px-1.5 py-0.5 rounded flex items-center gap-0.5 ${esCumple ? 'bg-pink-100 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400 font-semibold' : 'text-gray-400 dark:text-gray-500'}`}>
                          🎂 {esCumple ? '¡Hoy!' : `${nac.getDate()}/${nac.getMonth()+1}`}
                        </span>
                      })()}
                      {c.cuenta_corriente_habilitada && (
                        <span className="text-xs bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded flex items-center gap-0.5 font-medium">
                          <CreditCard size={9} /> CC
                        </span>
                      )}
                      {Array.isArray(c.etiquetas) && c.etiquetas.map((et: string) => (
                        <span key={et} className="text-xs bg-purple-50 dark:bg-purple-900/20 text-accent px-1.5 py-0.5 rounded flex items-center gap-0.5">
                          <Tag size={9} />{et}
                        </span>
                      ))}
                      {c.telefono && <span className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500"><Phone size={11} /> {c.telefono}</span>}
                      {c.email && <span className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500"><Mail size={11} /> {c.email}</span>}
                    </div>
                  </div>

                  {/* Stats inline */}
                  <div className="text-right flex-shrink-0 hidden sm:block mr-2">
                    {stats ? (
                      <>
                        <p className="font-semibold text-gray-800 dark:text-gray-100 text-sm">{formatMoneda(stats.total)}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500">
                          {stats.count} compra{stats.count !== 1 ? 's' : ''} · tk {formatMoneda(stats.ticket)}
                        </p>
                        {stats.ultima && (
                          <p className="text-xs text-gray-300 flex items-center gap-1 justify-end mt-0.5">
                            <Clock size={10} /> {diasDesde(stats.ultima)}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-xs text-gray-300">Sin compras</p>
                    )}
                  </div>

                  {/* Acciones */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => { setExpandedId(isExpanded ? null : c.id); setInnerTab('historial'); setShowDomForm(false) }}
                      className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400 dark:text-gray-500 transition-colors" title="Ver historial">
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                    <button onClick={() => abrirModal(c)}
                      className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400 dark:text-gray-500 transition-colors"
                      title="Editar cliente">
                      <Pencil size={14} />
                    </button>
                  </div>
                </div>

                {/* Sección expandida: tabs Historial / Domicilios */}
                {isExpanded && (
                  <div className="border-t border-gray-100 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 px-4 py-4">
                    {/* Sub-tabs */}
                    <div className="flex gap-0 border-b border-gray-200 dark:border-gray-600 mb-4 -mx-4 px-4">
                      {[
                        { id: 'historial' as const, label: 'Historial de compras', icon: <ShoppingCart size={12} /> },
                        { id: 'domicilios' as const, label: 'Domicilios',          icon: <MapPin size={12} /> },
                        { id: 'notas'     as const, label: 'Notas',                icon: <StickyNote size={12} /> },
                      ].map(t => (
                        <button key={t.id} onClick={() => setInnerTab(t.id)}
                          className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium border-b-2 -mb-px transition-colors
                            ${innerTab === t.id ? 'border-accent text-accent' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}>
                          {t.icon}{t.label}
                        </button>
                      ))}
                    </div>

                    {/* Tab: Historial */}
                    {innerTab === 'historial' && <>
                    {/* Mini stats del cliente */}
                    {stats && (
                      <div className="grid grid-cols-3 gap-3 mb-4">
                        <div className="bg-white dark:bg-gray-800 rounded-xl px-3 py-2.5 text-center border border-gray-100">
                          <p className="text-base font-bold text-gray-800 dark:text-gray-100">{stats.count}</p>
                          <p className="text-xs text-gray-400 dark:text-gray-500">compras</p>
                        </div>
                        <div className="bg-white dark:bg-gray-800 rounded-xl px-3 py-2.5 text-center border border-gray-100">
                          <p className="text-base font-bold text-gray-800 dark:text-gray-100">{formatMoneda(stats.ticket)}</p>
                          <p className="text-xs text-gray-400 dark:text-gray-500">ticket prom.</p>
                        </div>
                        <div className="bg-white dark:bg-gray-800 rounded-xl px-3 py-2.5 text-center border border-gray-100">
                          <p className="text-base font-bold text-gray-800 dark:text-gray-100">{formatMoneda(stats.total)}</p>
                          <p className="text-xs text-gray-400 dark:text-gray-500">total gastado</p>
                        </div>
                      </div>
                    )}
                    {historial.length === 0 ? (
                      <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-3">Sin ventas registradas</p>
                    ) : (
                      <div className="space-y-2">
                        {historial.map((v: any) => {
                          const est = ESTADOS[v.estado] ?? { label: v.estado, color: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400' }
                          const items = v.venta_items ?? []
                          return (
                            <div key={v.id} className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-100 dark:border-gray-600">
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-sm text-gray-800 dark:text-gray-100">#{v.numero ?? v.id.slice(-6)}</span>
                                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${est.color}`}>{est.label}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="text-right">
                                    <p className="font-semibold text-gray-800 dark:text-gray-100 text-sm">{formatMoneda(v.total ?? 0)}</p>
                                    <p className="text-xs text-gray-400 dark:text-gray-500">{formatFecha(v.created_at)}</p>
                                  </div>
                                  <button onClick={() => navigate(`/ventas?id=${v.id}`)} title="Ver venta"
                                    className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400 dark:text-gray-500 hover:text-accent transition-colors">
                                    <ExternalLink size={14} />
                                  </button>
                                </div>
                              </div>
                              {items.length > 0 && (
                                <div className="mt-2 space-y-0.5">
                                  {items.slice(0, 3).map((item: any, i: number) => (
                                    <p key={i} className="text-xs text-gray-400 dark:text-gray-500">
                                      {item.cantidad}× {item.productos?.nombre ?? '—'} — {formatMoneda((item.precio_unitario ?? 0) * item.cantidad)}
                                    </p>
                                  ))}
                                  {items.length > 3 && <p className="text-xs text-gray-300">+{items.length - 3} más...</p>}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                    </>}

                    {/* Tab: Domicilios */}
                    {innerTab === 'domicilios' && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-gray-500 dark:text-gray-400">{(domicilios as any[]).length} domicilio{(domicilios as any[]).length !== 1 ? 's' : ''} guardado{(domicilios as any[]).length !== 1 ? 's' : ''}</p>
                          <button onClick={() => { setShowDomForm(true); setEditDomId(null); setDomForm({ nombre: '', calle: '', numero: '', piso_depto: '', ciudad: '', provincia: '', codigo_postal: '', referencias: '', es_principal: false }) }}
                            className="flex items-center gap-1 text-xs text-accent hover:underline">
                            <Plus size={12} /> Agregar domicilio
                          </button>
                        </div>

                        {/* Formulario nuevo / editar domicilio */}
                        {showDomForm && (
                          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-600 p-4 space-y-3">
                            <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">{editDomId ? 'Editar domicilio' : 'Nuevo domicilio'}</p>
                            <input type="text" value={domForm.nombre} onChange={e => setDomForm(f => ({ ...f, nombre: e.target.value }))}
                              placeholder="Nombre / alias (ej: Casa, Trabajo) — opcional"
                              className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                            <div className="grid grid-cols-2 gap-2">
                              <div className="col-span-2">
                                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5">Calle *</label>
                                <input type="text" value={domForm.calle} onChange={e => setDomForm(f => ({ ...f, calle: e.target.value }))}
                                  placeholder="Av. Corrientes"
                                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                              </div>
                              <div>
                                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5">Número</label>
                                <input type="text" value={domForm.numero} onChange={e => setDomForm(f => ({ ...f, numero: e.target.value }))}
                                  placeholder="1234"
                                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                              </div>
                              <div>
                                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5">Piso / Depto</label>
                                <input type="text" value={domForm.piso_depto} onChange={e => setDomForm(f => ({ ...f, piso_depto: e.target.value }))}
                                  placeholder="3° B"
                                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                              </div>
                              <div>
                                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5">Ciudad</label>
                                <input type="text" value={domForm.ciudad} onChange={e => setDomForm(f => ({ ...f, ciudad: e.target.value }))}
                                  placeholder="Buenos Aires"
                                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                              </div>
                              <div>
                                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5">Provincia</label>
                                <input type="text" value={domForm.provincia} onChange={e => setDomForm(f => ({ ...f, provincia: e.target.value }))}
                                  placeholder="CABA"
                                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                              </div>
                              <div>
                                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5">Código postal</label>
                                <input type="text" value={domForm.codigo_postal} onChange={e => setDomForm(f => ({ ...f, codigo_postal: e.target.value }))}
                                  placeholder="C1043"
                                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                              </div>
                            </div>
                            <input type="text" value={domForm.referencias} onChange={e => setDomForm(f => ({ ...f, referencias: e.target.value }))}
                              placeholder="Referencias para el courier (portón verde, timbre 4, etc.)"
                              className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer">
                              <input type="checkbox" checked={domForm.es_principal} onChange={e => setDomForm(f => ({ ...f, es_principal: e.target.checked }))} className="accent-accent" />
                              Marcar como domicilio principal
                            </label>
                            <div className="flex gap-2">
                              <button onClick={() => { setShowDomForm(false); setEditDomId(null) }}
                                className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 font-medium py-2 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 text-sm">
                                Cancelar
                              </button>
                              <button onClick={saveDomicilio} disabled={savingDom}
                                className="flex-1 bg-accent hover:bg-accent/90 text-white font-semibold py-2 rounded-xl transition-all disabled:opacity-50 text-sm">
                                {savingDom ? 'Guardando…' : 'Guardar'}
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Lista de domicilios */}
                        {(domicilios as any[]).length === 0 && !showDomForm ? (
                          <div className="text-center py-6 text-gray-400 dark:text-gray-500">
                            <MapPin size={28} className="mx-auto mb-2 opacity-40" />
                            <p className="text-sm">Sin domicilios guardados</p>
                            <p className="text-xs mt-0.5">Agregá uno para usarlo en los envíos</p>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {(domicilios as any[]).map((d: any) => (
                              <div key={d.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-600 p-3">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                      {d.es_principal && <Star size={12} className="text-amber-500 fill-amber-500 flex-shrink-0" />}
                                      {d.nombre && <span className="text-xs font-semibold text-accent">{d.nombre}</span>}
                                    </div>
                                    <p className="text-sm font-medium text-gray-800 dark:text-gray-100">
                                      {d.calle}{d.numero ? ` ${d.numero}` : ''}{d.piso_depto ? `, ${d.piso_depto}` : ''}
                                    </p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                      {[d.ciudad, d.provincia, d.codigo_postal].filter(Boolean).join(' · ')}
                                    </p>
                                    {d.referencias && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 italic">{d.referencias}</p>}
                                  </div>
                                  <div className="flex items-center gap-1 flex-shrink-0">
                                    <button onClick={() => {
                                      setEditDomId(d.id); setShowDomForm(true)
                                      setDomForm({ nombre: d.nombre ?? '', calle: d.calle, numero: d.numero ?? '', piso_depto: d.piso_depto ?? '', ciudad: d.ciudad ?? '', provincia: d.provincia ?? '', codigo_postal: d.codigo_postal ?? '', referencias: d.referencias ?? '', es_principal: d.es_principal })
                                    }} className="p-1 text-gray-400 hover:text-accent rounded-lg transition-colors">
                                      <Pencil size={13} />
                                    </button>
                                    <button onClick={() => deleteDomicilio(d.id)} className="p-1 text-gray-400 hover:text-red-500 rounded-lg transition-colors">
                                      <Trash2 size={13} />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Tab: Notas */}
                    {innerTab === 'notas' && (
                      <div className="space-y-3">
                        {/* Agregar nota */}
                        <div className="flex gap-2">
                          <textarea value={nuevaNota} onChange={e => setNuevaNota(e.target.value)}
                            placeholder="Escribí una nota sobre este cliente..." rows={2}
                            className="flex-1 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent resize-none bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100" />
                          <button onClick={agregarNota} disabled={savingNota || !nuevaNota.trim()}
                            className="px-3 py-2 bg-accent text-white rounded-xl text-sm font-medium hover:bg-accent/90 disabled:opacity-50 transition-all self-end">
                            {savingNota ? '…' : 'Guardar'}
                          </button>
                        </div>
                        {/* Lista de notas */}
                        {(notasCliente as any[]).length === 0 ? (
                          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">Sin notas para este cliente</p>
                        ) : (
                          <div className="space-y-2">
                            {(notasCliente as any[]).map((n: any) => (
                              <div key={n.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-600 p-3">
                                <p className="text-sm text-gray-800 dark:text-gray-100 whitespace-pre-wrap">{n.texto}</p>
                                <div className="flex items-center gap-2 mt-2 text-xs text-gray-400 dark:text-gray-500">
                                  <Calendar size={10} />
                                  <span>{new Date(n.created_at).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })}</span>
                                  {n.users?.nombre_display && <>
                                    <span>·</span>
                                    <span>{n.users.nombre_display}</span>
                                  </>}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Fin tab Lista ── */}
      </>}

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">{editId ? 'Editar cliente' : 'Nuevo cliente'}</h2>
              <button onClick={() => setModalOpen(false)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400 dark:text-gray-500">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nombre completo *</label>
                <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                  placeholder="Nombre completo o razón social" autoFocus
                  className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">DNI *</label>
                  <input value={form.dni}
                    onChange={e => { setForm(f => ({ ...f, dni: e.target.value })); setDniError(null) }}
                    onBlur={e => setDniError(validarDNI(e.target.value))}
                    placeholder="Ej: 30123456"
                    className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent ${dniError ? 'border-red-400 dark:border-red-500' : 'border-gray-200 dark:border-gray-700'}`} />
                  {dniError && <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle size={11} />{dniError}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Teléfono *</label>
                  <input value={form.telefono}
                    onChange={e => { setForm(f => ({ ...f, telefono: e.target.value })); setTelError(null) }}
                    onBlur={e => setTelError(validarTelefono(e.target.value))}
                    placeholder="Ej: +54 11 1234-5678"
                    className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent ${telError ? 'border-red-400 dark:border-red-500' : 'border-gray-200 dark:border-gray-700'}`} />
                  {telError && <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle size={11} />{telError}</p>}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
                <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="Opcional" type="email"
                  className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent" />
              </div>
              {/* Fecha nacimiento + Etiquetas */}
              <div>
                <label className="flex items-center gap-1 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  🎂 Fecha de nacimiento
                </label>
                <input type="date" value={form.fecha_nacimiento} onChange={e => setForm(f => ({ ...f, fecha_nacimiento: e.target.value }))}
                  className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent" />
              </div>
              <div>
                <label className="flex items-center gap-1 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  <Tag size={12} /> Etiquetas
                </label>
                <input type="text" value={form.etiquetas} onChange={e => setForm(f => ({ ...f, etiquetas: e.target.value }))}
                  placeholder="mayorista, vip, zona-norte (separadas por coma)"
                  className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent" />
              </div>

              {/* Facturación */}
              <div className="col-span-2 border-t border-gray-100 dark:border-gray-700 pt-3">
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Datos fiscales (para facturación)</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">CUIT</label>
                    <input value={form.cuit_receptor} onChange={e => setForm(f => ({ ...f, cuit_receptor: e.target.value }))}
                      placeholder="20-12345678-9 (para Factura A)"
                      className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Condición IVA</label>
                    <div className="relative">
                      <select value={form.condicion_iva_receptor} onChange={e => setForm(f => ({ ...f, condicion_iva_receptor: e.target.value }))}
                        className="w-full appearance-none border border-gray-200 dark:border-gray-700 rounded-xl pl-3 pr-8 py-2.5 text-sm focus:outline-none focus:border-accent">
                        <option value="">Sin especificar</option>
                        <option value="CF">Consumidor Final</option>
                        <option value="RI">Responsable Inscripto</option>
                        <option value="Monotributista">Monotributista</option>
                        <option value="Exento">Exento</option>
                      </select>
                      <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Código fiscal</label>
                    <input value={form.codigo_fiscal} onChange={e => setForm(f => ({ ...f, codigo_fiscal: e.target.value }))}
                      placeholder="Opcional"
                      className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Régimen fiscal</label>
                    <input value={form.regimen_fiscal} onChange={e => setForm(f => ({ ...f, regimen_fiscal: e.target.value }))}
                      placeholder="Ej: Responsable Inscripto"
                      className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent" />
                  </div>
                </div>
              </div>
              {/* Cuenta Corriente */}
              <div className="border-t border-gray-100 dark:border-gray-700 pt-3">
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-3 flex items-center gap-1.5">
                  <CreditCard size={12} /> Cuenta Corriente
                </p>
                <label className="flex items-center gap-3 cursor-pointer mb-3">
                  <div
                    onClick={() => setForm(f => ({ ...f, cuenta_corriente_habilitada: !f.cuenta_corriente_habilitada }))}
                    className={`w-10 h-6 rounded-full transition-colors flex items-center px-1 ${form.cuenta_corriente_habilitada ? 'bg-accent' : 'bg-gray-200 dark:bg-gray-600'}`}>
                    <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${form.cuenta_corriente_habilitada ? 'translate-x-4' : 'translate-x-0'}`} />
                  </div>
                  <span className="text-sm text-gray-700 dark:text-gray-300">Habilitar cuenta corriente</span>
                </label>
                {form.cuenta_corriente_habilitada && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Límite de crédito ($)</label>
                      <input type="number" min="0" value={form.limite_credito}
                        onChange={e => setForm(f => ({ ...f, limite_credito: e.target.value }))}
                        onWheel={e => e.currentTarget.blur()}
                        placeholder="Sin límite"
                        className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Plazo de pago (días)</label>
                      <input type="number" min="1" max="365" value={form.plazo_pago_dias}
                        onChange={e => setForm(f => ({ ...f, plazo_pago_dias: e.target.value }))}
                        onWheel={e => e.currentTarget.blur()}
                        placeholder="30"
                        className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent" />
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notas generales</label>
                <textarea value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                  placeholder="Observaciones internas (para notas con fecha usá el tab Notas en la ficha del cliente)..." rows={2}
                  className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent resize-none" />
              </div>
            </div>
            <div className="px-5 pb-5 pt-4 flex gap-3 border-t border-gray-100 dark:border-gray-700 flex-shrink-0">
              <button onClick={() => setModalOpen(false)}
                className="flex-1 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-medium py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all text-sm">
                Cancelar
              </button>
              <button onClick={guardar} disabled={saving}
                className="flex-1 bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl transition-all disabled:opacity-50 text-sm">
                {saving ? 'Guardando...' : editId ? 'Guardar cambios' : 'Crear cliente'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal importación masiva */}
      {showImport && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-primary flex items-center gap-2">
                <FileSpreadsheet size={18} className="text-accent" /> Importar clientes
              </h2>
              <button onClick={() => setShowImport(false)} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-400"><X size={20} /></button>
            </div>

            <div className="p-6 space-y-4">
              {/* Resultado */}
              {resultadoImport && (
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 rounded-xl p-4 flex items-start gap-3">
                  <CheckCircle size={18} className="text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-semibold text-green-800 dark:text-green-400">Importación completada</p>
                    <p className="text-sm text-green-700 dark:text-green-400 mt-0.5">{resultadoImport.creados} creados · {resultadoImport.errores} errores</p>
                    <button onClick={() => setShowImport(false)} className="mt-2 text-sm text-green-700 dark:text-green-400 font-medium hover:underline">Cerrar →</button>
                  </div>
                </div>
              )}

              {/* Acciones */}
              {!resultadoImport && (
                <div className="flex gap-3 flex-wrap">
                  <button onClick={descargarPlantilla}
                    className="flex items-center gap-2 border border-accent text-accent font-medium px-4 py-2 rounded-xl hover:bg-accent/5 text-sm transition-all">
                    <Download size={14} /> Descargar plantilla
                  </button>
                  <button onClick={() => fileRefImport.current?.click()}
                    className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-white font-medium px-4 py-2 rounded-xl text-sm transition-all">
                    <Upload size={14} /> Cargar archivo
                  </button>
                  <input ref={fileRefImport} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) procesarArchivo(f); e.target.value = '' }} />
                </div>
              )}

              {/* Vista previa */}
              {filasImport.length > 0 && !resultadoImport && (
                <>
                  <div className="flex items-center gap-3 text-sm flex-wrap">
                    <span className="text-green-600 dark:text-green-400 font-medium flex items-center gap-1">
                      <CheckCircle size={14} /> {filasImport.filter(f => f.estado === 'nuevo').length} nuevos
                    </span>
                    {filasImport.filter(f => f.estado === 'duplicado').length > 0 && (
                      <span className="text-amber-600 dark:text-amber-400 font-medium">
                        ⚠ {filasImport.filter(f => f.estado === 'duplicado').length} duplicados (se omitirán)
                      </span>
                    )}
                    {filasImport.filter(f => f.estado === 'error').length > 0 && (
                      <span className="text-red-600 dark:text-red-400 font-medium flex items-center gap-1">
                        <XCircle size={14} /> {filasImport.filter(f => f.estado === 'error').length} con errores
                      </span>
                    )}
                  </div>

                  <div className="border border-gray-100 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 dark:bg-gray-700 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                          <th className="px-3 py-2 text-left">Nombre</th>
                          <th className="px-3 py-2 text-left hidden sm:table-cell">DNI</th>
                          <th className="px-3 py-2 text-left hidden sm:table-cell">Teléfono</th>
                          <th className="px-3 py-2 text-left hidden sm:table-cell">Email</th>
                          <th className="px-3 py-2 text-left">Estado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {filasImport.slice(0, 50).map(f => (
                          <tr key={f.idx} className={f.estado === 'error' ? 'bg-red-50 dark:bg-red-900/20' : f.estado === 'duplicado' ? 'bg-amber-50 dark:bg-amber-900/20/50' : ''}>
                            <td className="px-3 py-2 font-medium text-gray-800 dark:text-gray-100">{f.nombre || <span className="text-gray-400 dark:text-gray-500 italic">—</span>}</td>
                            <td className="px-3 py-2 text-gray-500 dark:text-gray-400 hidden sm:table-cell">{f.dni ?? '—'}</td>
                            <td className="px-3 py-2 text-gray-500 dark:text-gray-400 hidden sm:table-cell">{f.telefono ?? '—'}</td>
                            <td className="px-3 py-2 text-gray-500 dark:text-gray-400 hidden sm:table-cell">{f.email ?? '—'}</td>
                            <td className="px-3 py-2">
                              {f.estado === 'nuevo' && <span className="text-xs text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/30 px-1.5 py-0.5 rounded-full">Nuevo</span>}
                              {f.estado === 'duplicado' && <span className="text-xs text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30 px-1.5 py-0.5 rounded-full">Existe</span>}
                              {f.estado === 'error' && <span className="text-xs text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/30 px-1.5 py-0.5 rounded-full">{f.errores[0]}</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {filasImport.length > 50 && (
                      <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-2">Mostrando 50 de {filasImport.length} filas</p>
                    )}
                  </div>

                  <div className="flex gap-3 justify-end">
                    <button onClick={() => setFilasImport([])}
                      className="border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-medium px-4 py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 text-sm">
                      Limpiar
                    </button>
                    <button onClick={confirmarImport} disabled={importando || filasImport.filter(f => f.estado === 'nuevo').length === 0}
                      className="bg-accent hover:bg-accent/90 text-white font-semibold px-5 py-2.5 rounded-xl text-sm disabled:opacity-50 transition-all">
                      {importando ? 'Importando...' : `Importar ${filasImport.filter(f => f.estado === 'nuevo').length} clientes`}
                    </button>
                  </div>
                </>
              )}

              {filasImport.length === 0 && !resultadoImport && (
                <div
                  className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-8 text-center cursor-pointer hover:border-accent hover:bg-accent/5 transition-all"
                  onClick={() => fileRefImport.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) procesarArchivo(f) }}>
                  <FileSpreadsheet size={32} className="text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500 dark:text-gray-400">Arrastrá o hacé click para subir tu Excel</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Columnas: nombre, dni, telefono, email, notas</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
