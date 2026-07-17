import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Receipt, BarChart2, BookOpen, Scale, Plus, Send, CheckCircle,
  AlertTriangle, Download, X, ChevronDown, Filter, RefreshCw,
  FileText, ExternalLink, Info, Building, Calendar, Printer,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import QRCode from 'qrcode'
import { supabase } from '@/lib/supabase'
import { PageTabs } from '@/components/PageTabs'
import { useAuthStore } from '@/store/authStore'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'
import { usePlanLimits } from '@/hooks/usePlanLimits'
import { generarFacturaPDF, generarFacturaPDFBase64, normalizarCondIVA, type FacturaPDFData } from '@/lib/facturasPDF'
import { detectarTipoComprobante, tiposComprobantePermitidos } from '@/lib/facturacionLogic'
import { puntoVentaDelEmisor } from '@/lib/emisorFiscal'
import { camposEmisorPDF } from '@/lib/emisorPdf'
import { mapDevolucionNc, filasLibroNc, ivaNcTotal, type NcEmitida } from '@/lib/libroIva'
import { useEmisoresFiscales } from '@/hooks/useEmisoresFiscales'
import toast from 'react-hot-toast'

type Tab = 'panel' | 'emitir' | 'libros' | 'liquidacion'
type LibroSubTab = 'ventas' | 'compras'

const TIPO_COMPROBANTE_OPTS = [
  { value: 'B', label: 'Factura B — Consumidor Final / Monotributista' },
  { value: 'A', label: 'Factura A — Responsable Inscripto' },
  { value: 'C', label: 'Factura C — Emisor Monotributista' },
]

import { formatMoneda as formatMonedaLib } from '@/lib/formato'
// formatMoneda local: usa moneda del tenant (v1.8.44)
function mesLabel(m: string) {
  const [y, mo] = m.split('-')
  return new Date(parseInt(y), parseInt(mo) - 1).toLocaleDateString('es-AR', { month: 'short', year: 'numeric' })
}

const DISCLAIMER = `Los valores de IVA mostrados son de carácter estimado, basados en los datos ingresados por el usuario. Genesis360 no reemplaza la labor de un profesional contable matriculado ni constituye representación contable legal ante ARCA/AFIP. La emisión de comprobantes depende de la disponibilidad de los servicios de ARCA y del proveedor del SDK.`

export default function FacturacionPage() {
  const { tenant, user } = useAuthStore()
  const formatMoneda = (v: number) => formatMonedaLib(v, (tenant as any)?.moneda ?? 'ARS')
  const { sucursalId } = useSucursalFilter()
  const { limits } = usePlanLimits()
  const qc = useQueryClient()

  const [tab, setTab]               = useState<Tab>('panel')
  const [libroSub, setLibroSub]     = useState<LibroSubTab>('ventas')
  const [periodoDesde, setPeriodoDesde] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0]
  })
  const [periodoHasta, setPeriodoHasta] = useState(() => new Date().toISOString().split('T')[0])
  const [filtroAlicuota, setFiltroAlicuota] = useState('')
  const [showEmitirModal, setShowEmitirModal] = useState(false)
  const [ventaAFacturar, setVentaAFacturar]   = useState<any | null>(null)
  const [tipoComprobante, setTipoComprobante]  = useState('B')
  const [puntoVenta, setPuntoVenta]            = useState(1)
  // Multi-CUIT (F4/F5): emisor del modal de emisión (default = el de la sucursal de la
  // venta, override con confirmación) + filtro de emisor de los REPORTES fiscales (los
  // libros/posición son POR CUIT — nunca se mezclan emisores). Con 1 emisor, nada cambia.
  const { emisores: emisoresFiscales, principal: emisorPrincipal, multiEmisor, emisorDeSucursal } = useEmisoresFiscales()
  const [emisorModalId, setEmisorModalId] = useState<string | null>(null)
  const [emisorModalDefaultId, setEmisorModalDefaultId] = useState<string | null>(null)
  const [confirmoEmisorOverride, setConfirmoEmisorOverride] = useState(false)
  const emisorModal = emisoresFiscales.find(e => e.id === emisorModalId) ?? emisorPrincipal
  const emisorEsOverride = multiEmisor && !!emisorModalId && !!emisorModalDefaultId && emisorModalId !== emisorModalDefaultId
  const [emisorFiltroId, setEmisorFiltroId] = useState<string | null>(null)
  // Filtro efectivo de reportes: con multi-emisor SIEMPRE hay uno elegido (default: principal)
  const emisorFiltro = multiEmisor ? (emisoresFiscales.find(e => e.id === emisorFiltroId) ?? emisorPrincipal) : null
  // Condición OR de PostgREST para filtrar por emisor (las filas legacy sin emisor_id
  // cuentan como del PRINCIPAL — así el backfill y los datos viejos no desaparecen).
  const emisorOr = emisorFiltro
    ? (emisorFiltro.es_default ? `emisor_id.eq.${emisorFiltro.id},emisor_id.is.null` : `emisor_id.eq.${emisorFiltro.id}`)
    : null
  const [emitiendo, setEmitiendo]              = useState(false)
  const [descargandoPdf, setDescargandoPdf]    = useState<string | null>(null)
  const [enviandoEmail, setEnviandoEmail]      = useState<string | null>(null)
  // Modal "Enviar factura por email": precarga el correo del cliente (editable)
  const [facturaEmailModal, setFacturaEmailModal] = useState<{ facturaId: string } | null>(null)
  const [facturaEmailValue, setFacturaEmailValue] = useState('')

  // Arma el FacturaPDFData + email del cliente para una factura emitida (descargar/imprimir/email)
  async function buildFacturaPDFDataById(facturaId: string): Promise<{ data: FacturaPDFData; email: string | null } | null> {
    const { data: venta, error: vErr } = await supabase.from('ventas')
      .select('*, clientes(*, cliente_domicilios(calle, numero, piso_depto, ciudad, provincia, es_principal)), venta_items(cantidad, precio_unitario, subtotal, alicuota_iva, iva_monto, productos(nombre, sku))')
      .eq('id', facturaId).single()
    if (vErr) throw new Error(vErr.message)
    if (!venta) throw new Error('Venta no encontrada')
    const formaPago = parseFormaPago((venta as any).medio_pago)
    const saldo = Number(venta.total) - Number((venta as any).monto_pagado ?? 0)
    const pagoMpQr = saldo > 0.5 ? await crearPagoMpQR(facturaId, saldo) : null

    // 🛑 Identidad del EMISOR de la venta (fuente única, mig 271) + su punto de venta.
    // Antes leía la identidad del TENANT y el PV con limit(1) del tenant entero → con
    // multi-CUIT imprimía el CUIT/PV de OTRO emisor que el registrado en AFIP.
    const { emisor, campos } = await camposEmisorPDF(tenant, {
      ventaEmisorId: (venta as any).emisor_id, fiscal: true,
    })
    const { data: pvRows } = await supabase.from('puntos_venta_afip')
      .select('numero, emisor_id').eq('tenant_id', tenant!.id).eq('activo', true)
    const pvNumero = puntoVentaDelEmisor(pvRows, emisor?.id ?? null, emisor?.es_default ?? true) ?? 1

    const data: FacturaPDFData = {
      tipo_comprobante:  (venta.tipo_comprobante ?? 'B').replace(/^Factura\s+/i, ''),
      numero_comprobante: venta.numero_comprobante ?? venta.numero,
      punto_venta:       pvNumero,
      fecha:             venta.created_at,
      cae:               venta.cae,
      vencimiento_cae:   venta.vencimiento_cae ?? '',
      ...campos,
      receptor_nombre:   venta.clientes?.nombre ?? 'Consumidor Final',
      receptor_cuit_dni: venta.clientes?.cuit_receptor ?? venta.clientes?.dni,
      receptor_condicion_iva: normalizarCondIVA(venta.clientes?.condicion_iva_receptor),
      receptor_domicilio: composeDomicilioCliente(venta.clientes?.cliente_domicilios),
      items: (venta.venta_items ?? []).map((i: any) => ({
        codigo:         i.productos?.sku ?? null,
        descripcion:    i.descripcion ?? i.productos?.nombre ?? 'Producto',
        cantidad:       Number(i.cantidad),
        precio_unitario: Number(i.precio_unitario),
        alicuota_iva:   Number(i.alicuota_iva ?? 21),
        subtotal:       Number(i.subtotal),
      })),
      total: Number(venta.total),
      forma_pago: formaPago,
      pago_mp_qr: pagoMpQr,
      pago_mp_monto: pagoMpQr ? saldo : null,
    }
    return { data, email: venta.clientes?.email ?? null }
  }

  // Crea el link de pago MercadoPago para un saldo y devuelve su QR (dataURL), o null.
  async function crearPagoMpQR(ventaId: string, monto: number): Promise<string | null> {
    if (!monto || monto <= 0) return null
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mp-crear-link-pago`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({ venta_id: ventaId, monto }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.init_point) return null
      return await QRCode.toDataURL(json.init_point, { width: 200, margin: 1 })
    } catch { return null }
  }

  // El domicilio del cliente vive en cliente_domicilios (no en clientes). Toma el principal.
  function composeDomicilioCliente(doms: any[] | null | undefined): string | undefined {
    const d = (doms ?? []).find((x: any) => x.es_principal) ?? (doms ?? [])[0]
    if (!d) return undefined
    const l1 = [d.calle, d.numero, d.piso_depto].filter(Boolean).join(' ')
    const l2 = [d.ciudad, d.provincia].filter(Boolean).join(', ')
    return [l1, l2].filter(Boolean).join(', ') || undefined
  }

  // medio_pago es un JSON string [{"tipo":"Efectivo","monto":1500}] → etiqueta para el PDF
  function parseFormaPago(mp: any): string | null {
    try {
      const arr = typeof mp === 'string' ? JSON.parse(mp) : mp
      if (!Array.isArray(arr) || arr.length === 0) return null
      const tipos = Array.from(new Set(arr.map((m: any) => m?.tipo).filter(Boolean)))
      return tipos.length ? tipos.join(' + ') : null
    } catch { return null }
  }

  async function accionFacturaPDF(facturaId: string, accion: 'descargar' | 'imprimir') {
    setDescargandoPdf(facturaId)
    try {
      const res = await buildFacturaPDFDataById(facturaId)
      if (res) await generarFacturaPDF(res.data, accion)
    } catch (e: any) {
      toast.error(`Error al generar PDF: ${e.message}`)
    } finally {
      setDescargandoPdf(null)
    }
  }
  const descargarFacturaPDF = (facturaId: string) => accionFacturaPDF(facturaId, 'descargar')

  // Abre el modal de envío por email precargando el correo del cliente de la factura (editable).
  async function abrirEnviarFacturaEmail(facturaId: string) {
    setFacturaEmailModal({ facturaId })
    setFacturaEmailValue('')
    try {
      const { data } = await supabase.from('ventas')
        .select('clientes(email)').eq('id', facturaId).single()
      const em = (data as any)?.clientes?.email
      if (em) setFacturaEmailValue(em)
    } catch { /* si falla el prefill, el usuario igual puede tipear el correo */ }
  }

  async function enviarFacturaEmail(facturaId: string, email: string) {
    email = email.trim()
    if (!email) { toast.error('Ingresá un email'); return }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast.error('Email inválido'); return }
    try {
      const res = await buildFacturaPDFDataById(facturaId)
      if (!res) return
      setEnviandoEmail(facturaId)
      const { data } = res
      const { base64, filename } = await generarFacturaPDFBase64(data)
      const { error } = await supabase.functions.invoke('send-email', {
        body: {
          type: 'factura_emitida',
          to: email,
          data: {
            cliente_nombre: data.receptor_nombre,
            negocio: tenant!.nombre,
            tipo_comprobante: `Factura ${data.tipo_comprobante}`,
            numero_comprobante: data.numero_comprobante,
            cae: data.cae,
            vencimiento_cae: data.vencimiento_cae,
            items: data.items.map(it => ({ nombre: it.descripcion, cantidad: it.cantidad, precio_unitario: it.precio_unitario, subtotal: it.subtotal })),
            total: data.total,
          },
          attachments: [{ filename, content: base64 }],
        },
      })
      if (error) {
        let detalle = ''
        try { const body = await (error as any).context?.json?.(); if (body?.error) detalle = String(body.error) } catch { /* */ }
        throw new Error(detalle || error.message || 'No se pudo enviar el email')
      }
      toast.success(`Factura enviada a ${email}`)
      setFacturaEmailModal(null)
    } catch (e: any) {
      const msg = String(e?.message ?? '')
      toast.error(/api key/i.test(msg)
        ? 'Resend rechazó la API key (revisá el secret RESEND_API_KEY en Supabase).'
        : (msg || 'No se pudo enviar el email'), { duration: 8000 })
    } finally {
      setEnviandoEmail(null)
    }
  }

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: config } = useQuery({
    queryKey: ['facturacion-config', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('tenants')
        .select('facturacion_habilitada, condicion_iva_emisor, razon_social_fiscal, cuit, umbral_factura_b, logo_url, domicilio_fiscal, ingresos_brutos, inicio_actividades, sitio_web, banco, cbu, alias_cbu, leyenda_comprobante')
        .eq('id', tenant!.id).single()
      return data
    },
    enabled: !!tenant,
  })

  const { data: puntosVenta = [] } = useQuery({
    queryKey: ['puntos-venta-afip', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('puntos_venta_afip')
        .select('*').eq('tenant_id', tenant!.id).eq('activo', true).order('numero')
      return data ?? []
    },
    enabled: !!tenant,
  })

  // Ventas sin CAE (borradores para Tab 2)
  const { data: borradoresFact = [], isLoading: loadingBorr } = useQuery({
    queryKey: ['ventas-sin-cae', tenant?.id, sucursalId],
    queryFn: async () => {
      let q = supabase.from('ventas')
        .select('id, numero, total, estado, created_at, tipo_comprobante, cae, sucursal_id, clientes(nombre,cuit_receptor,condicion_iva_receptor), venta_items(cantidad, precio_unitario, subtotal, alicuota_iva, productos(nombre))')
        .eq('tenant_id', tenant!.id)
        .eq('estado', 'despachada')
        .is('cae', null)
        .order('created_at', { ascending: false })
        .limit(50)
      if (sucursalId) q = q.eq('sucursal_id', sucursalId)
      const { data } = await q
      return data ?? []
    },
    enabled: !!tenant && tab === 'emitir',
  })

  // Facturas ya emitidas (con multi-emisor: las del emisor filtrado)
  const { data: emitidas = [] } = useQuery({
    queryKey: ['facturas-emitidas', tenant?.id, periodoDesde, periodoHasta, sucursalId, emisorFiltro?.id],
    queryFn: async () => {
      let q = supabase.from('ventas')
        .select('id, numero, total, cae, vencimiento_cae, tipo_comprobante, numero_comprobante, created_at, clientes(nombre)')
        .eq('tenant_id', tenant!.id)
        .not('cae', 'is', null)
        .gte('created_at', periodoDesde)
        .lte('created_at', periodoHasta + 'T23:59:59')
        .order('created_at', { ascending: false })
      if (sucursalId) q = q.eq('sucursal_id', sucursalId)
      if (emisorOr) q = q.or(emisorOr)
      const { data } = await q
      return data ?? []
    },
    enabled: !!tenant && tab === 'emitir',
  })

  // Datos para Libro IVA Ventas (por CUIT: con multi-emisor filtra por el emisor elegido)
  const { data: ivaVentas = [] } = useQuery({
    queryKey: ['iva-ventas', tenant?.id, periodoDesde, periodoHasta, filtroAlicuota, emisorFiltro?.id],
    queryFn: async () => {
      let q = supabase.from('venta_items')
        .select('cantidad, precio_unitario, subtotal, alicuota_iva, iva_monto, ventas!inner(numero, created_at, cae, tipo_comprobante, emisor_id, clientes(nombre))')
        .eq('ventas.tenant_id', tenant!.id)
        .gte('ventas.created_at', periodoDesde)
        .lte('ventas.created_at', periodoHasta + 'T23:59:59')
        .not('ventas.cae', 'is', null)
      if (filtroAlicuota) q = q.eq('alicuota_iva', filtroAlicuota)
      if (emisorOr) q = q.or(emisorOr, { referencedTable: 'ventas' })
      const { data } = await q
      return data ?? []
    },
    enabled: !!tenant && tab === 'libros' && libroSub === 'ventas',
  })

  // NC electrónicas emitidas en el período — RESTAN débito fiscal (REGLA #0). Se imputan
  // por nc_fecha (fecha de emisión, mig 266). Alimenta el Libro IVA Ventas y los KPIs.
  // El emisor de la NC es SIEMPRE el de la factura original → filtro vía ventas.emisor_id.
  const { data: ncPeriodo = [] } = useQuery({
    queryKey: ['iva-ventas-nc', tenant?.id, periodoDesde, periodoHasta, emisorFiltro?.id],
    queryFn: async () => {
      let q = supabase.from('devoluciones')
        .select('id, nc_tipo, nc_numero_comprobante, nc_cae, nc_fecha, created_at, devolucion_items(cantidad, precio_unitario, productos(alicuota_iva)), ventas!inner(emisor_id, clientes(nombre))')
        .eq('tenant_id', tenant!.id)
        .not('nc_cae', 'is', null)
        .gte('nc_fecha', periodoDesde)
        .lte('nc_fecha', periodoHasta + 'T23:59:59')
        .order('nc_fecha', { ascending: false })
      if (emisorOr) q = q.or(emisorOr, { referencedTable: 'ventas' })
      const { data } = await q
      return (data ?? []).map(mapDevolucionNc)
    },
    enabled: !!tenant && (tab === 'panel' || (tab === 'libros' && libroSub === 'ventas')),
  })

  // Datos para Libro IVA Compras. ⚠ Los libros IVA son del CUIT completo: acá NO se filtra
  // por sucursal (el Libro Ventas tampoco lo hace) — si no, la posición mezclaría un débito
  // de todo el CUIT con un crédito de una sola sucursal. Con multi-emisor, el crédito se
  // imputa por gastos.emisor_id (los legacy sin emisor cuentan como del principal).
  const { data: ivaCompras = [] } = useQuery({
    queryKey: ['iva-compras', tenant?.id, periodoDesde, periodoHasta, emisorFiltro?.id],
    queryFn: async () => {
      let q = supabase.from('gastos')
        .select('id, descripcion, monto, iva_monto, tipo_iva, iva_deducible, conciliado_iva, fecha, categoria')
        .eq('tenant_id', tenant!.id)
        .eq('iva_deducible', true)
        .gt('iva_monto', 0)
        .gte('fecha', periodoDesde)
        .lte('fecha', periodoHasta)
        .order('fecha', { ascending: false })
      if (emisorOr) q = q.or(emisorOr)
      const { data } = await q
      return data ?? []
    },
    enabled: !!tenant && tab === 'libros' && libroSub === 'compras',
  })

  // Historial 12 meses para liquidación (por CUIT con multi-emisor)
  const { data: historial12 = [] } = useQuery({
    queryKey: ['iva-historial-12', tenant?.id, emisorFiltro?.id],
    queryFn: async () => {
      const rows = []
      const hoy = new Date()

      // NC emitidas de los 12 meses (una sola query): restan débito en su mes de emisión.
      const inicio12 = new Date(hoy.getFullYear(), hoy.getMonth() - 11, 1).toISOString().split('T')[0]
      let qNcs = supabase.from('devoluciones')
        .select('id, nc_tipo, nc_numero_comprobante, nc_fecha, created_at, devolucion_items(cantidad, precio_unitario, productos(alicuota_iva)), ventas!inner(emisor_id)')
        .eq('tenant_id', tenant!.id)
        .not('nc_cae', 'is', null)
        .gte('nc_fecha', inicio12)
      if (emisorOr) qNcs = qNcs.or(emisorOr, { referencedTable: 'ventas' })
      const { data: ncsRaw } = await qNcs
      const ncPorMes: Record<string, number> = {}
      for (const raw of ncsRaw ?? []) {
        const nc = mapDevolucionNc(raw as any)
        const mes = nc.fecha.slice(0, 7)
        ncPorMes[mes] = (ncPorMes[mes] ?? 0) + ivaNcTotal([nc])
      }

      for (let i = 11; i >= 0; i--) {
        const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1)
        const desde = d.toISOString().split('T')[0]
        const hasta = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0]
        const periodo = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`

        let qV = supabase.from('venta_items').select('iva_monto, ventas!inner(cae, emisor_id)')
          .eq('ventas.tenant_id', tenant!.id)
          .gte('ventas.created_at', desde).lte('ventas.created_at', hasta + 'T23:59:59')
          .not('ventas.cae', 'is', null)
        if (emisorOr) qV = qV.or(emisorOr, { referencedTable: 'ventas' })
        let qG = supabase.from('gastos').select('iva_monto')
          .eq('tenant_id', tenant!.id).eq('iva_deducible', true).gt('iva_monto', 0)
          .gte('fecha', desde).lte('fecha', hasta)
        if (emisorOr) qG = qG.or(emisorOr)
        const [{ data: dVentas }, { data: dGastos }] = await Promise.all([qV, qG])
        const debito  = (dVentas ?? []).reduce((s: number, r: any) => s + Number(r.iva_monto ?? 0), 0)
          - (ncPorMes[periodo] ?? 0)
        const credito = (dGastos ?? []).reduce((s: number, r: any) => s + Number(r.iva_monto ?? 0), 0)
        rows.push({ periodo, debito, credito, posicion: debito - credito })
      }
      return rows
    },
    enabled: !!tenant && tab === 'liquidacion',
  })

  const { data: retenciones = [] } = useQuery({
    queryKey: ['retenciones', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('retenciones_sufridas')
        .select('*').eq('tenant_id', tenant!.id).order('fecha', { ascending: false })
      return data ?? []
    },
    enabled: !!tenant && tab === 'liquidacion',
  })

  // ── KPIs del Panel (por CUIT con multi-emisor) ───────────────────────────────
  const { data: kpis } = useQuery({
    queryKey: ['facturacion-kpis', tenant?.id, periodoDesde, periodoHasta, emisorFiltro?.id],
    queryFn: async () => {
      let qV = supabase.from('venta_items').select('iva_monto, ventas!inner(cae, emisor_id)')
        .eq('ventas.tenant_id', tenant!.id)
        .gte('ventas.created_at', periodoDesde).lte('ventas.created_at', periodoHasta + 'T23:59:59')
        .not('ventas.cae', 'is', null)
      if (emisorOr) qV = qV.or(emisorOr, { referencedTable: 'ventas' })
      let qG = supabase.from('gastos').select('iva_monto')
        .eq('tenant_id', tenant!.id).eq('iva_deducible', true).gt('iva_monto', 0)
        .gte('fecha', periodoDesde).lte('fecha', periodoHasta)
      if (emisorOr) qG = qG.or(emisorOr)
      const [{ data: dVentas }, { data: dGastos }] = await Promise.all([qV, qG])
      const debito  = (dVentas ?? []).reduce((s: number, r: any) => s + Number(r.iva_monto ?? 0), 0)
      const credito = (dGastos ?? []).reduce((s: number, r: any) => s + Number(r.iva_monto ?? 0), 0)
      return { debito, credito, posicion: debito - credito }
    },
    enabled: !!tenant && tab === 'panel',
  })

  // ── Emitir factura ────────────────────────────────────────────────────────────
  const emitirFactura = async () => {
    if (!ventaAFacturar) return
    // Multi-CUIT: cambiar el emisor de la sucursal exige confirmación explícita.
    if (emisorEsOverride && !confirmoEmisorOverride) {
      toast.error('Marcá la confirmación para emitir con un CUIT distinto al de la sucursal.')
      return
    }
    setEmitiendo(true)
    try {
      const { data, error } = await supabase.functions.invoke('emitir-factura', {
        body: {
          venta_id:         ventaAFacturar.id,
          tenant_id:        tenant!.id,
          tipo_comprobante: tipoComprobante,
          punto_venta:      puntoVenta,
          ...(emisorModalId ? { emisor_id: emisorModalId } : {}),
        },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)

      toast.success(`✅ Factura ${tipoComprobante} emitida — CAE: ${data.cae}`)
      qc.invalidateQueries({ queryKey: ['ventas-sin-cae'] })
      qc.invalidateQueries({ queryKey: ['facturas-emitidas'] })
      qc.invalidateQueries({ queryKey: ['facturacion-kpis'] })
      setShowEmitirModal(false); setVentaAFacturar(null)
    } catch (e: any) {
      let msg = String(e?.message ?? '')
      try { const body = await (e as any).context?.json?.(); if (body?.error) msg = String(body.error) } catch { /* */ }
      toast.error('Error al emitir: ' + (msg || 'intente nuevamente'), { duration: 8000 })
    } finally {
      setEmitiendo(false) }
  }

  // ── Conciliar compra ──────────────────────────────────────────────────────────
  const conciliar = useMutation({
    mutationFn: async ({ id, val }: { id: string; val: boolean }) => {
      const { error } = await supabase.from('gastos').update({ conciliado_iva: val }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['iva-compras'] }),
    onError: (e: any) => toast.error(e.message),
  })

  // ── Exportar Excel ────────────────────────────────────────────────────────────
  const exportarLibroIVA = (tipo: 'ventas' | 'compras') => {
    const wb = XLSX.utils.book_new()
    if (tipo === 'ventas') {
      const rows = (ivaVentas as any[]).map(r => ({
        'Fecha':       (r.ventas as any)?.created_at?.split('T')[0] ?? '',
        'Comprobante': (r.ventas as any)?.tipo_comprobante ?? '',
        'Número':      (r.ventas as any)?.numero ?? '',
        'CAE':         (r.ventas as any)?.cae ?? '',
        'Cliente':     (r.ventas as any)?.clientes?.nombre ?? '',
        'Neto':        Number(r.subtotal ?? 0) - Number(r.iva_monto ?? 0),
        'Alícuota IVA': r.alicuota_iva ?? '',
        'IVA':         Number(r.iva_monto ?? 0),
      }))
      // NC emitidas del período (montos en negativo — restan del libro)
      const caePorNc = new Map((ncPeriodo as NcEmitida[]).map(nc => [`${nc.nc_tipo} #${nc.nc_numero_comprobante ?? '—'}`, nc.nc_cae ?? '']))
      for (const f of filasNc) {
        rows.push({
          'Fecha': f.fecha, 'Comprobante': f.comprobante, 'Número': '',
          'CAE': caePorNc.get(f.comprobante) ?? '', 'Cliente': f.cliente ?? '',
          'Neto': f.neto, 'Alícuota IVA': f.alicuota, 'IVA': f.iva,
        } as any)
      }
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'IVA Ventas')
    } else {
      const rows = (ivaCompras as any[]).map(r => ({
        'Fecha':       r.fecha,
        'Descripción': r.descripcion,
        'Categoría':   r.categoria ?? '',
        'Monto Total': Number(r.monto),
        'Tipo IVA':    r.tipo_iva ?? '',
        'IVA':         Number(r.iva_monto ?? 0),
        'Neto':        Number(r.monto) - Number(r.iva_monto ?? 0),
        'Conciliado':  r.conciliado_iva ? 'Sí' : 'No',
      }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'IVA Compras')
    }
    XLSX.writeFile(wb, `libro_iva_${tipo}_${periodoDesde}_${periodoHasta}.xlsx`)
  }

  // ── Cálculos ──────────────────────────────────────────────────────────────────
  // Filas NC del libro (montos NEGATIVOS). El filtro de alícuota también las alcanza
  // (una NC-C no discrimina → alícuota '—' y queda fuera de los filtros específicos).
  const filasNc = (ncPeriodo as NcEmitida[]).flatMap(filasLibroNc)
    .filter(f => !filtroAlicuota || f.alicuota === filtroAlicuota)
  // IVA que las NC del período restan del débito (para KPIs; sin filtro de alícuota).
  const ivaNcPeriodo = ivaNcTotal(ncPeriodo as NcEmitida[])
  const totalIvaVentas  = (ivaVentas as any[]).reduce((s, r) => s + Number(r.iva_monto ?? 0), 0)
    + filasNc.reduce((s, f) => s + f.iva, 0)
  const totalIvaCompras = (ivaCompras as any[]).reduce((s, r) => s + Number(r.iva_monto ?? 0), 0)
  const comprasConciliadas = (ivaCompras as any[]).filter(r => r.conciliado_iva).length
  // KPIs del panel netos de NC (débito y posición; el crédito no cambia).
  const kpiDebito   = (kpis?.debito ?? 0) - ivaNcPeriodo
  const kpiPosicion = (kpis?.posicion ?? 0) - ivaNcPeriodo

  const inputClass = 'border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:border-accent'

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
            <Receipt size={22} className="text-accent" /> Facturación
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">
            Facturación electrónica AFIP · {config?.razon_social_fiscal ?? tenant?.nombre}
          </p>
        </div>
        {/* Emisor (multi-CUIT F5: los reportes fiscales son POR CUIT, nunca mezclados) + Período */}
        <div className="flex items-center gap-2 text-sm flex-wrap">
          {multiEmisor && (
            <div className="relative">
              <select value={emisorFiltro?.id ?? ''} onChange={e => setEmisorFiltroId(e.target.value || null)}
                title="Los libros, KPIs y la liquidación son por CUIT — elegí el emisor a reportar"
                className={`${inputClass} appearance-none pr-8`}>
                {emisoresFiscales.map(em => (
                  <option key={em.id} value={em.id}>{em.nombre} — {em.cuit}</option>
                ))}
              </select>
              <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
          )}
          <Calendar size={14} className="text-gray-400" />
          <input type="date" value={periodoDesde} onChange={e => setPeriodoDesde(e.target.value)}
            className={inputClass} />
          <span className="text-gray-400">—</span>
          <input type="date" value={periodoHasta} onChange={e => setPeriodoHasta(e.target.value)}
            className={inputClass} />
        </div>
      </div>

      {/* Aviso si facturación no está habilitada */}
      {config && !config.facturacion_habilitada && (
        <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-4">
          <AlertTriangle size={18} className="text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">Facturación no habilitada</p>
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
              Activá la facturación electrónica en <strong>Configuración → Negocio</strong> y completá los datos fiscales (CUIT, condición IVA, punto de venta).
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <PageTabs
        tabs={[
          { id: 'panel', label: 'Panel de control', icon: BarChart2 },
          { id: 'emitir', label: 'Facturación', icon: Send },
          { id: 'libros', label: 'Libros IVA', icon: BookOpen },
          { id: 'liquidacion', label: 'Liquidación', icon: Scale },
        ]}
        active={tab}
        onChange={(id) => setTab(id as Tab)}
      />

      {/* ══ TAB 1: PANEL DE CONTROL ══ */}
      {tab === 'panel' && (
        <div className="space-y-5">
          <div className="grid sm:grid-cols-3 gap-4">
            {[
              { label: 'IVA Débito (Ventas)', value: kpiDebito, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/20', desc: 'IVA de facturas emitidas menos NC' },
              { label: 'IVA Crédito (Compras)', value: kpis?.credito ?? 0, color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/20', desc: 'IVA de gastos deducibles' },
              { label: 'Posición mensual', value: Math.abs(kpiPosicion), color: kpiPosicion >= 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400', bg: kpiPosicion >= 0 ? 'bg-red-50 dark:bg-red-900/20' : 'bg-green-50 dark:bg-green-900/20', desc: kpiPosicion >= 0 ? 'A pagar (proyectado)' : 'Saldo a favor' },
            ].map(k => (
              <div key={k.label} className={`${k.bg} rounded-xl p-5 border border-gray-100 dark:border-gray-700`}>
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">{k.label}</p>
                <p className={`text-3xl font-bold ${k.color}`}>{formatMoneda(k.value)}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{k.desc}</p>
              </div>
            ))}
          </div>

          {/* Info fiscal del negocio */}
          {config?.cuit && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5">
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                <Building size={15} className="text-accent" /> Datos fiscales del negocio
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div><p className="text-xs text-gray-400">CUIT</p><p className="font-medium text-gray-800 dark:text-gray-100">{config.cuit}</p></div>
                <div><p className="text-xs text-gray-400">Condición IVA</p><p className="font-medium text-gray-800 dark:text-gray-100">{config.condicion_iva_emisor ?? '—'}</p></div>
                <div><p className="text-xs text-gray-400">Umbral Fact. B</p><p className="font-medium text-gray-800 dark:text-gray-100">{formatMoneda(Number(config.umbral_factura_b ?? 0))}</p></div>
                <div><p className="text-xs text-gray-400">Facturas emitidas</p><p className="font-medium text-gray-800 dark:text-gray-100">{(emitidas as any[]).length}</p></div>
              </div>
            </div>
          )}

          {/* Disclaimer */}
          <div className="flex items-start gap-2.5 bg-gray-50 dark:bg-gray-700/30 border border-gray-200 dark:border-gray-600 rounded-xl p-4 text-xs text-gray-500 dark:text-gray-400">
            <Info size={13} className="flex-shrink-0 mt-0.5" />
            <p>{DISCLAIMER}</p>
          </div>
        </div>
      )}

      {/* ══ TAB 2: FACTURACIÓN ELECTRÓNICA ══ */}
      {tab === 'emitir' && (
        <div className="space-y-5">
          {/* Borradores — ventas sin CAE */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                <AlertTriangle size={16} className="text-amber-500" />
                Ventas pendientes de facturar
                <span className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs px-2 py-0.5 rounded-full">
                  {(borradoresFact as any[]).length}
                </span>
              </h2>
            </div>

            {loadingBorr ? (
              <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent" /></div>
            ) : (borradoresFact as any[]).length === 0 ? (
              <div className="text-center py-10 text-gray-400 dark:text-gray-500">
                <CheckCircle size={32} className="mx-auto mb-2 text-green-500 opacity-60" />
                <p className="text-sm">Todas las ventas están facturadas</p>
              </div>
            ) : (
              <div className="space-y-2">
                {(borradoresFact as any[]).map((v: any) => (
                  <div key={v.id} className="bg-white dark:bg-gray-800 rounded-xl border border-amber-200 dark:border-amber-800 p-4 flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-800 dark:text-gray-100">Venta #{v.numero ?? v.id.slice(-6)}</span>
                        <span className="text-xs text-gray-400">{v.created_at?.split('T')[0]}</span>
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-300 mt-0.5">
                        {v.clientes?.nombre ?? 'Sin cliente'} · {formatMoneda(Number(v.total ?? 0))}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        // Multi-CUIT: emisor default = el de la sucursal de la venta (?? principal)
                        const def = emisorDeSucursal((v as any).sucursal_id)
                        setEmisorModalId(def?.id ?? null)
                        setEmisorModalDefaultId(def?.id ?? null)
                        setConfirmoEmisorOverride(false)
                        setVentaAFacturar(v)
                        setTipoComprobante(detectarTipoComprobante(def?.condicion_iva_emisor ?? (config as any)?.condicion_iva_emisor, (v as any).clientes?.condicion_iva_receptor))
                        const pvs = (puntosVenta as any[]).filter((pv: any) =>
                          pv.emisor_id === def?.id || (!pv.emisor_id && (def?.es_default ?? true)))
                        setPuntoVenta(pvs[0]?.numero ?? 1)
                        setShowEmitirModal(true)
                      }}
                      disabled={!config?.facturacion_habilitada}
                      className="flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent/90 text-white text-sm font-medium rounded-xl disabled:opacity-40 transition-all">
                      <Send size={14} /> Emitir factura
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Facturas emitidas */}
          <div>
            <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-3 flex items-center gap-2">
              <CheckCircle size={16} className="text-green-500" /> Comprobantes emitidos
            </h2>
            {(emitidas as any[]).length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">Sin comprobantes en el período</p>
            ) : (
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-100 dark:border-gray-600">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Fecha</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Tipo</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">N°</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Cliente</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Total</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">CAE</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                    {(emitidas as any[]).map((f: any) => (
                      <tr key={f.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{f.created_at?.split('T')[0]}</td>
                        <td className="px-4 py-3"><span className="text-xs bg-accent/10 text-accent px-2 py-0.5 rounded">{f.tipo_comprobante ?? '—'}</span></td>
                        <td className="px-4 py-3 font-mono text-gray-700 dark:text-gray-300">{f.numero_comprobante ?? f.numero}</td>
                        <td className="px-4 py-3 text-gray-800 dark:text-gray-100">{f.clientes?.nombre ?? '—'}</td>
                        <td className="px-4 py-3 text-right font-semibold text-gray-800 dark:text-gray-100">{formatMoneda(Number(f.total ?? 0))}</td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-500 dark:text-gray-400">{f.cae?.slice(0, 12)}…</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <button
                              onClick={() => descargarFacturaPDF(f.id)}
                              disabled={descargandoPdf === f.id}
                              title="Descargar PDF"
                              className="text-accent hover:text-accent/80 disabled:opacity-40"
                            >
                              {descargandoPdf === f.id
                                ? <RefreshCw size={14} className="animate-spin" />
                                : <Download size={14} />}
                            </button>
                            <button
                              onClick={() => accionFacturaPDF(f.id, 'imprimir')}
                              disabled={descargandoPdf === f.id}
                              title="Imprimir"
                              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 disabled:opacity-40"
                            >
                              <Printer size={14} />
                            </button>
                            <button
                              onClick={() => abrirEnviarFacturaEmail(f.id)}
                              disabled={enviandoEmail === f.id}
                              title="Enviar por email"
                              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 disabled:opacity-40"
                            >
                              {enviandoEmail === f.id
                                ? <RefreshCw size={14} className="animate-spin" />
                                : <Send size={14} />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ TAB 3: LIBROS IVA ══ */}
      {tab === 'libros' && (
        <div className="space-y-4">
          {/* Sub-tabs */}
          <div className="flex items-center gap-2 flex-wrap">
            {[
              { id: 'ventas'  as LibroSubTab, label: `IVA Ventas (Débito)` },
              { id: 'compras' as LibroSubTab, label: `IVA Compras (Crédito)` },
            ].map(s => (
              <button key={s.id} onClick={() => setLibroSub(s.id)}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all
                  ${libroSub === s.id ? 'bg-accent text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
                {s.label}
              </button>
            ))}
            <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">Los libros IVA son del CUIT completo (no se filtran por sucursal)</span>
          </div>

          {/* Filtros */}
          <div className="flex items-center gap-2 flex-wrap">
            {libroSub === 'ventas' && (
              <div className="relative">
                <select value={filtroAlicuota} onChange={e => setFiltroAlicuota(e.target.value)}
                  className={`${inputClass} appearance-none pr-8`}>
                  <option value="">Todas las alícuotas</option>
                  <option value="21">21%</option>
                  <option value="10.5">10.5%</option>
                  <option value="27">27%</option>
                  <option value="0">0% / Exento</option>
                </select>
                <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            )}
            <button onClick={() => exportarLibroIVA(libroSub)}
              className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
              <Download size={14} /> Exportar Excel
            </button>
            {libroSub === 'ventas' && (
              <span className="text-sm text-gray-500 dark:text-gray-400 ml-auto">
                Total IVA período: <strong className="text-red-600 dark:text-red-400">{formatMoneda(totalIvaVentas)}</strong>
              </span>
            )}
            {libroSub === 'compras' && (
              <span className="text-sm text-gray-500 dark:text-gray-400 ml-auto">
                Deducible: <strong className="text-green-600 dark:text-green-400">{formatMoneda(totalIvaCompras)}</strong>
                {' · '}{comprasConciliadas}/{(ivaCompras as any[]).length} conciliados
              </span>
            )}
          </div>

          {/* Tabla Ventas */}
          {libroSub === 'ventas' && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-100 dark:border-gray-600">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Fecha</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Comprobante</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Cliente</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Neto</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">IVA %</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">IVA $</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                    {(ivaVentas as any[]).length === 0 && filasNc.length === 0 ? (
                      <tr><td colSpan={6} className="text-center py-8 text-gray-400">Sin datos en el período</td></tr>
                    ) : (<>
                    {(ivaVentas as any[]).map((r: any, i: number) => {
                      const neto = Number(r.subtotal ?? 0) - Number(r.iva_monto ?? 0)
                      return (
                        <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                          <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">{(r.ventas as any)?.created_at?.split('T')[0]}</td>
                          <td className="px-4 py-2.5 text-gray-700 dark:text-gray-300 text-xs">{(r.ventas as any)?.tipo_comprobante ?? ''} #{(r.ventas as any)?.numero}</td>
                          <td className="px-4 py-2.5 text-gray-800 dark:text-gray-100">{(r.ventas as any)?.clientes?.nombre ?? '—'}</td>
                          <td className="px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">{formatMoneda(neto)}</td>
                          <td className="px-4 py-2.5 text-center"><span className="text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 px-1.5 rounded">{r.alicuota_iva ?? '—'}%</span></td>
                          <td className="px-4 py-2.5 text-right font-medium text-red-600 dark:text-red-400">{formatMoneda(Number(r.iva_monto ?? 0))}</td>
                        </tr>
                      )
                    })}
                    {/* NC emitidas: restan del libro (montos en negativo) */}
                    {filasNc.map((f, i) => (
                      <tr key={`nc-${i}`} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 bg-purple-50/40 dark:bg-purple-900/10">
                        <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">{f.fecha}</td>
                        <td className="px-4 py-2.5 text-xs"><span className="bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 px-1.5 py-0.5 rounded">{f.comprobante}</span></td>
                        <td className="px-4 py-2.5 text-gray-800 dark:text-gray-100">{f.cliente ?? '—'}</td>
                        <td className="px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">{formatMoneda(f.neto)}</td>
                        <td className="px-4 py-2.5 text-center"><span className="text-xs bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 px-1.5 rounded">{f.alicuota === '—' ? '—' : `${f.alicuota}%`}</span></td>
                        <td className="px-4 py-2.5 text-right font-medium text-green-600 dark:text-green-400">{formatMoneda(f.iva)}</td>
                      </tr>
                    ))}
                    </>)}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tabla Compras */}
          {libroSub === 'compras' && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-100 dark:border-gray-600">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Fecha</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Descripción</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Categoría</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Neto</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">IVA $</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Conciliado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                    {(ivaCompras as any[]).length === 0 ? (
                      <tr><td colSpan={6} className="text-center py-8 text-gray-400">Sin compras deducibles en el período</td></tr>
                    ) : (ivaCompras as any[]).map((r: any) => {
                      const neto = Number(r.monto) - Number(r.iva_monto ?? 0)
                      return (
                        <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                          <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">{r.fecha}</td>
                          <td className="px-4 py-2.5 text-gray-800 dark:text-gray-100">{r.descripcion}</td>
                          <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 text-xs">{r.categoria ?? '—'}</td>
                          <td className="px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">{formatMoneda(neto)}</td>
                          <td className="px-4 py-2.5 text-right font-medium text-green-600 dark:text-green-400">{formatMoneda(Number(r.iva_monto ?? 0))}</td>
                          <td className="px-4 py-2.5 text-center">
                            <button onClick={() => conciliar.mutate({ id: r.id, val: !r.conciliado_iva })}
                              className={`w-5 h-5 rounded border-2 flex items-center justify-center mx-auto transition-colors
                                ${r.conciliado_iva ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 dark:border-gray-600 hover:border-accent'}`}>
                              {r.conciliado_iva && <CheckCircle size={12} />}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══ TAB 4: LIQUIDACIÓN ══ */}
      {tab === 'liquidacion' && (
        <div className="space-y-5">
          {/* Historial 12 meses */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5">
            <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-4">IVA — Últimos 12 meses</h2>
            {(historial12 as any[]).length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">Cargando...</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-100 dark:border-gray-700">
                    <tr>
                      <th className="text-left py-2 text-xs font-semibold text-gray-500 dark:text-gray-400">Período</th>
                      <th className="text-right py-2 text-xs font-semibold text-gray-500 dark:text-gray-400">IVA Débito</th>
                      <th className="text-right py-2 text-xs font-semibold text-gray-500 dark:text-gray-400">IVA Crédito</th>
                      <th className="text-right py-2 text-xs font-semibold text-gray-500 dark:text-gray-400">Posición</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                    {(historial12 as any[]).map((r: any) => (
                      <tr key={r.periodo} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="py-2.5 font-medium text-gray-800 dark:text-gray-100 capitalize">{mesLabel(r.periodo)}</td>
                        <td className="py-2.5 text-right text-red-600 dark:text-red-400">{formatMoneda(r.debito)}</td>
                        <td className="py-2.5 text-right text-green-600 dark:text-green-400">{formatMoneda(r.credito)}</td>
                        <td className={`py-2.5 text-right font-semibold ${r.posicion >= 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                          {r.posicion >= 0 ? `A pagar ${formatMoneda(r.posicion)}` : `A favor ${formatMoneda(Math.abs(r.posicion))}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Retenciones */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">Retenciones y percepciones sufridas</h2>
            </div>
            {(retenciones as any[]).length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">Sin retenciones cargadas</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b border-gray-100 dark:border-gray-700">
                  <tr>
                    <th className="text-left py-2 text-xs font-semibold text-gray-500">Fecha</th>
                    <th className="text-left py-2 text-xs font-semibold text-gray-500">Tipo</th>
                    <th className="text-left py-2 text-xs font-semibold text-gray-500">Agente</th>
                    <th className="text-right py-2 text-xs font-semibold text-gray-500">Monto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                  {(retenciones as any[]).map((r: any) => (
                    <tr key={r.id}>
                      <td className="py-2 text-gray-500">{r.fecha}</td>
                      <td className="py-2 text-gray-800 dark:text-gray-100">{r.tipo}</td>
                      <td className="py-2 text-gray-600 dark:text-gray-300">{r.agente}</td>
                      <td className="py-2 text-right font-medium text-gray-800 dark:text-gray-100">{formatMoneda(Number(r.monto ?? 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Disclaimer */}
          <div className="flex items-start gap-2.5 bg-gray-50 dark:bg-gray-700/30 border border-gray-200 dark:border-gray-600 rounded-xl p-4 text-xs text-gray-500 dark:text-gray-400">
            <Info size={13} className="flex-shrink-0 mt-0.5" />
            <p>{DISCLAIMER}</p>
          </div>
        </div>
      )}

      {/* ══ MODAL: EMITIR FACTURA ══ */}
      {showEmitirModal && ventaAFacturar && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">Emitir comprobante</h2>
              <button onClick={() => { setShowEmitirModal(false); setVentaAFacturar(null) }}
                className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400"><X size={18} /></button>
            </div>

            <div className="p-5 space-y-4">
              {/* Info venta */}
              <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-3 text-sm">
                <p className="font-medium text-gray-800 dark:text-gray-100">
                  Venta #{ventaAFacturar.numero ?? ventaAFacturar.id.slice(-6)}
                </p>
                <p className="text-gray-500 dark:text-gray-400">
                  {ventaAFacturar.clientes?.nombre ?? 'Sin cliente'} · {formatMoneda(Number(ventaAFacturar.total ?? 0))}
                </p>
              </div>

              {/* Emisor fiscal (multi-CUIT F4) */}
              {multiEmisor && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Emisor (CUIT)</label>
                  <div className="relative">
                    <select value={emisorModalId ?? ''} onChange={e => {
                      const id = e.target.value || null
                      setEmisorModalId(id)
                      setConfirmoEmisorOverride(false)
                      const em = emisoresFiscales.find(x => x.id === id)
                      const permitidos = tiposComprobantePermitidos(em?.condicion_iva_emisor ?? (config as any)?.condicion_iva_emisor)
                      setTipoComprobante(t => permitidos.includes(t as any) ? t : permitidos[0])
                      const pvs = (puntosVenta as any[]).filter((pv: any) =>
                        pv.emisor_id === id || (!pv.emisor_id && !!em?.es_default))
                      if (pvs.length > 0) setPuntoVenta(pvs[0].numero)
                    }} className={`w-full appearance-none ${inputClass} pr-8`}>
                      {emisoresFiscales.map(em => (
                        <option key={em.id} value={em.id}>
                          {em.nombre} — {em.cuit}{em.id === emisorModalDefaultId ? ' (de la sucursal)' : ''}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  </div>
                  {emisorEsOverride && (
                    <label className="flex items-start gap-2 mt-2 cursor-pointer bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl px-3 py-2">
                      <input type="checkbox" checked={confirmoEmisorOverride} onChange={e => setConfirmoEmisorOverride(e.target.checked)} className="mt-0.5" />
                      <span className="text-[11px] text-amber-700 dark:text-amber-400">
                        Voy a emitir con un CUIT <strong>distinto al asignado a la sucursal</strong>. El comprobante sale a nombre de {emisorModal?.nombre} ({emisorModal?.cuit}) y no se puede deshacer (solo NC + re-factura).
                      </span>
                    </label>
                  )}
                </div>
              )}

              {/* Tipo de comprobante — letras según la condición del EMISOR seleccionado */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tipo de comprobante</label>
                <div className="relative">
                  <select value={tipoComprobante} onChange={e => setTipoComprobante(e.target.value)}
                    className={`w-full appearance-none ${inputClass} pr-8`}>
                    {TIPO_COMPROBANTE_OPTS
                      .filter(o => tiposComprobantePermitidos(emisorModal?.condicion_iva_emisor ?? (config as any)?.condicion_iva_emisor).includes(o.value as any))
                      .map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>

              {/* Punto de venta (del emisor seleccionado — los PV de AFIP son por CUIT) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Punto de venta</label>
                {(puntosVenta as any[]).filter((pv: any) => pv.emisor_id === emisorModal?.id || (!pv.emisor_id && (emisorModal?.es_default ?? true))).length > 0 ? (
                  <div className="relative">
                    <select value={puntoVenta} onChange={e => setPuntoVenta(parseInt(e.target.value))}
                      className={`w-full appearance-none ${inputClass} pr-8`}>
                      {(puntosVenta as any[])
                        .filter((pv: any) => pv.emisor_id === emisorModal?.id || (!pv.emisor_id && (emisorModal?.es_default ?? true)))
                        .map((pv: any) => (
                          <option key={pv.id} value={pv.numero}>{pv.numero.toString().padStart(4,'0')} — {pv.nombre ?? 'Punto de venta'}</option>
                        ))}
                    </select>
                    <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  </div>
                ) : (
                  <input type="number" value={puntoVenta} onChange={e => setPuntoVenta(parseInt(e.target.value))}
                    min="1" className={`w-full ${inputClass}`} />
                )}
              </div>

              {/* Advertencia si tipo A y sin CUIT */}
              {tipoComprobante === 'A' && !ventaAFacturar.clientes?.cuit_receptor && (
                <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl px-3 py-2">
                  <AlertTriangle size={13} />
                  El cliente no tiene CUIT cargado. Actualizá su ficha antes de emitir Factura A.
                </div>
              )}
            </div>

            <div className="px-5 pb-5 flex gap-3">
              <button onClick={() => { setShowEmitirModal(false); setVentaAFacturar(null) }}
                className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 font-medium py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 text-sm">
                Cancelar
              </button>
              <button onClick={emitirFactura}
                disabled={emitiendo || (tipoComprobante === 'A' && !ventaAFacturar.clientes?.cuit_receptor) || (emisorEsOverride && !confirmoEmisorOverride)}
                className="flex-1 bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl transition-all disabled:opacity-50 text-sm flex items-center justify-center gap-2">
                {emitiendo ? <><RefreshCw size={14} className="animate-spin" /> Emitiendo…</> : <><Send size={14} /> Emitir y obtener CAE</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: ENVIAR FACTURA POR EMAIL (correo del cliente precargado) ── */}
      {facturaEmailModal && (
        <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Send size={18} className="text-accent" />
                <h2 className="font-semibold text-gray-800 dark:text-gray-100">Enviar factura por email</h2>
              </div>
              <button onClick={() => setFacturaEmailModal(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-3">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">Destinatario</label>
              <input
                type="email" value={facturaEmailValue} autoFocus
                onChange={e => setFacturaEmailValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && enviandoEmail !== facturaEmailModal.facturaId) enviarFacturaEmail(facturaEmailModal.facturaId, facturaEmailValue) }}
                placeholder="email@cliente.com"
                className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
              <p className="text-[11px] text-gray-400">Se adjunta el PDF de la factura.</p>
            </div>
            <div className="px-5 pb-5 flex gap-2">
              <button onClick={() => setFacturaEmailModal(null)}
                className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 font-medium py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 text-sm transition-all">
                Cancelar
              </button>
              <button onClick={() => enviarFacturaEmail(facturaEmailModal.facturaId, facturaEmailValue)} disabled={enviandoEmail === facturaEmailModal.facturaId}
                className="flex-[2] bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl transition-all disabled:opacity-50 text-sm flex items-center justify-center gap-2">
                {enviandoEmail === facturaEmailModal.facturaId ? <><RefreshCw size={15} className="animate-spin" /> Enviando…</> : <><Send size={15} /> Enviar</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
