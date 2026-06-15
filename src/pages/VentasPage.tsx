import { useState, useRef, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { Plus, Search, ShoppingCart, Package, Truck, X, Hash, Percent, CreditCard, User, FileText, Zap, DollarSign, Printer, Layers, Camera, Scissors, Gift, LayoutGrid, List, RotateCcw, ChevronDown, ChevronUp, AlertTriangle, QrCode, Copy, ExternalLink, Check, RefreshCw, Wallet, FileDown, Receipt, CheckCircle2, Lock, Tag, Send } from 'lucide-react'
import QRCode from 'qrcode'
import { supabase } from '@/lib/supabase'
import { reproducirSonidoCobro } from '@/lib/sonidoCobro'
import { resolverScanCompuesto } from '@/lib/scanCompuesto'
import { cobrarDeudaCCFIFO } from '@/lib/cobranzaCC'
import { evaluarLimiteCC, evaluarMorosidad } from '@/lib/ccLogic'
import { notificarRegistroDeudaCC, notificarPagoCC } from '@/lib/notificacionesCC'
import { useAuthStore } from '@/store/authStore'
import { logActividad, nuevaTransaccion } from '@/lib/actividadLog'
import { getRebajeSort } from '@/lib/rebajeSort'
import { generarFacturaPDF, generarFacturaPDFBase64, normalizarCondIVA, type FacturaPDFData } from '@/lib/facturasPDF'
import { generarPresupuestoPDF, type PresupuestoPDFData } from '@/lib/presupuestoPDF'
import { generarRemitoPDF, type RemitoPDFData } from '@/lib/remitoPDF'
import { detectarTipoComprobante } from '@/lib/facturacionLogic'
import { useCotizacion } from '@/hooks/useCotizacion'
import { useModalKeyboard } from '@/hooks/useModalKeyboard'
import { useGruposEstados } from '@/hooks/useGruposEstados'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'
import { useConteoBloqueante } from '@/hooks/useConteoBloqueante'
import { useModoOperacion } from '@/hooks/useModoOperacion'
import { moduloSoloLectura } from '@/lib/permisosModulo'
import { useCierreContable } from '@/hooks/useCierreContable'
import { useCanalesVenta } from '@/hooks/useCanalesVenta'
import { BarcodeScanner } from '@/components/BarcodeScanner'
import { AddressAutocompleteInput } from '@/components/AddressAutocompleteInput'
import { COURIERS, serviciosDe, esCourierApi } from '@/lib/couriers/catalogo'
import { cotizarEnvio, type CotizacionOpcion } from '@/lib/couriers/api'
import { calcularDistanciaKm } from '@/hooks/useGoogleMaps'
import { validarMediosPago, calcularSaldoPendiente, validarDespacho, validarSaldoMediosPago, acumularMediosPago, calcularVuelto, calcularEfectivoCaja, calcularComboRows, calcularDescuentoComboMulti, restaurarMediosPago, calcularLpnFuentes, esDecimal, parseCantidad, type EstadoVenta, type MedioPagoItem, type LineaDisponible, type LpnFuente } from '@/lib/ventasValidation'
import toast from 'react-hot-toast'

type Tab = 'nueva' | 'historial' | 'canales'
type DescTipo = 'pct' | 'monto'

const ESTADOS: Record<EstadoVenta, { label: string; color: string; bg: string }> = {
  pendiente:  { label: 'Pendiente',  color: 'text-yellow-700 dark:text-yellow-400', bg: 'bg-yellow-100 dark:bg-yellow-900/30' },
  reservada:  { label: 'Reservada',  color: 'text-blue-700 dark:text-blue-400',   bg: 'bg-blue-100 dark:bg-blue-900/30'   },
  despachada: { label: 'Finalizada', color: 'text-green-700 dark:text-green-400',  bg: 'bg-green-100 dark:bg-green-900/30'  },
  cancelada:  { label: 'Cancelada',  color: 'text-red-700 dark:text-red-400',    bg: 'bg-red-100 dark:bg-red-900/30'    },
  facturada:  { label: 'Facturada',  color: 'text-purple-700', bg: 'bg-purple-100 dark:bg-purple-900/30' },
  devuelta:   { label: 'Devuelta',   color: 'text-orange-700 dark:text-orange-400', bg: 'bg-orange-100 dark:bg-orange-900/30' },
}

// Fallback si el tenant aún no tiene métodos configurados — se prefiere la lista dinámica de Config
const MEDIOS_PAGO_FALLBACK = ['Efectivo', 'Tarjeta de débito', 'Tarjeta de crédito', 'Transferencia', 'Mercado Pago']
// E3 — catálogo cerrado de motivos de cancelación de reserva (+ observación libre opcional)
const MOTIVOS_CANCELACION_RESERVA = ['Cliente arrepentido', 'Producto roto', 'Stock perdido', 'Otro']

function isPresupuestoVencido(venta: any, validezDias: number | null | undefined): boolean {
  if (!validezDias || venta?.estado !== 'pendiente') return false
  const ref = new Date(venta.updated_at ?? venta.created_at)
  const dias = (Date.now() - ref.getTime()) / (1000 * 60 * 60 * 24)
  return dias > validezDias
}

function calcularEfectivo(mediosPago: MedioPagoItem[], total: number): number {
  const efectivos = mediosPago.filter(m => m.tipo === 'Efectivo')
  if (efectivos.length === 0) return 0
  const hayOtros = mediosPago.some(m => m.tipo && m.tipo !== 'Efectivo')
  if (efectivos.length === 1 && !efectivos[0].monto && !hayOtros) return total
  return efectivos.reduce((acc, m) => acc + (parseFloat(m.monto) || 0), 0)
}

const stepCantidad = (u?: string | null) => esDecimal(u) ? 0.001 : 1

// ISS-075: stock VENDIBLE del producto en una sucursal (estados es_disponible_venta + ubicación pickeable).
// Se usa para el stock_antes/despues de los movimientos de venta — más significativo que el total
// global del producto (que mezcla todas las sucursales y estados no vendibles como "Análisis").
async function stockVendibleSucursal(productoId: string, sucursalId: string | null, vendibleEstadoIds: string[]): Promise<number> {
  let q = supabase.from('inventario_lineas')
    .select('cantidad, ubicaciones(disponible_surtido)')
    .eq('producto_id', productoId).eq('activo', true).gt('cantidad', 0)
  if (vendibleEstadoIds.length > 0) q = q.in('estado_id', vendibleEstadoIds)
  if (sucursalId) q = q.eq('sucursal_id', sucursalId)
  const { data } = await q
  return (data ?? [])
    .filter((l: any) => l.ubicaciones?.disponible_surtido !== false)
    .reduce((s: number, l: any) => s + (Number(l.cantidad) || 0), 0)
}

interface CartItem {
  producto_id: string
  nombre: string
  sku: string
  unidad_medida: string
  precio_unitario: number          // precio minorista base (1 u.) — ya convertido a moneda local
  precio_usd_origen?: number        // G5 — si el producto se vende en USD, su precio original en dólares
  tiers?: { cantidad_minima: number; precio: number }[]  // G1/G2 — precios mayoristas por cantidad (asc)
  precio_costo: number
  cantidad: number
  descuento: number
  descuento_tipo: DescTipo
  tiene_series: boolean
  tiene_vencimiento: boolean
  regla_inventario?: string | null
  linea_id?: string
  lpn?: string
  lineas_disponibles?: LineaDisponible[]   // todas las líneas ordenadas por sort activo
  lpn_fuentes?: LpnFuente[]               // computed: qué líneas cubren la cantidad actual
  lpn_manual_ids?: string[]               // ISS-075: linea_ids que el operador eligió explícitamente (origen='manual'); el resto del plan es 'auto'
  imagen_url?: string
  es_kit?: boolean
  alicuota_iva?: number
  series_seleccionadas: string[]
  series_disponibles: any[]
}

// Haversine × 1.35 — módulo-level para usar en useEffect sin dependency issues
function haversineKmCoordsStatic(c1: string, c2: string): number | null {
  const m1 = c1.match(/^(-?\d+\.?\d*),(-?\d+\.?\d*)$/)
  const m2 = c2.match(/^(-?\d+\.?\d*),(-?\d+\.?\d*)$/)
  if (!m1 || !m2) return null
  const [lat1, lon1] = [parseFloat(m1[1]), parseFloat(m1[2])]
  const [lat2, lon2] = [parseFloat(m2[1]), parseFloat(m2[2])]
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return Math.round(R * 2 * Math.asin(Math.sqrt(a)) * 1.35)
}

export default function VentasPage() {
  const { tenant, user, initialized: authInitialized } = useAuthStore()
  const { avanzado: modoAvanzado } = useModoOperacion()
  // Modo básico no usa ubicaciones: el stock se surte/despacha aunque `ubicacion_id` sea NULL
  // (el ingreso de stock en básico no asigna ubicación). En avanzado (WMS) solo se surte stock
  // ubicado. Aplicar a TODAS las queries de inventario_lineas que buscan stock para vender/
  // reservar/despachar — si no, en básico la venta falla con "stock insuficiente" pese a haber stock.
  const soloUbicado = (q: any): any => (modoAvanzado ? q.not('ubicacion_id', 'is', null) : q)
  const esContador = user?.rol === 'CONTADOR'  // J3: acceso read-only a Ventas
  const { sucursalId, applyFilter, sucursales, puedeVerTodas } = useSucursalFilter()
  // A2 — conteo wall-to-wall en curso en la sucursal → bloquea reservas/despachos (mueven stock)
  const { data: conteoBloqueante } = useConteoBloqueante(tenant?.id, sucursalId)
  const { isPeriodoCerrado, ultimoCierre } = useCierreContable()
  const { canalesActivos, reglaDe } = useCanalesVenta()  // VF2 (I1/I2)
  const clienteObligatorio  = (tenant as any)?.cliente_obligatorio    ?? 'reservas'
  const clienteCreacionInline = (tenant as any)?.cliente_creacion_inline ?? true
  const permiteCF           = (tenant as any)?.cliente_consumidor_final ?? true  // H5: ¿se puede vender como Consumidor Final?
  const clienteDatosMinimos = (tenant as any)?.cliente_datos_minimos   ?? 'nombre'

  // ISS-085: formatea el número de ticket por sucursal
  // Solo usa formato CODIGO-NNNN si la sucursal tiene un código explícitamente configurado
  const formatTicket = (v: any) => {
    // F5: presupuestos tienen correlativo propio con prefijo PRES, por sucursal
    if (v?.estado === 'pendiente') {
      const suc = v?.sucursal_id ? sucursales.find((s: any) => s.id === v.sucursal_id) : null
      const codigo = (suc as any)?.codigo
      if (codigo && v?.presupuesto_numero_sucursal)
        return `PRES-${codigo}-${String(v.presupuesto_numero_sucursal).padStart(4, '0')}`
      if (v?.presupuesto_numero)
        return `PRES-${String(v.presupuesto_numero).padStart(4, '0')}`
      return `PRES-#${v?.numero ?? '?'}`
    }
    if (v?.numero_sucursal && v?.sucursal_id) {
      const suc = sucursales.find((s: any) => s.id === v.sucursal_id)
      const codigo = (suc as any)?.codigo   // null/undefined si no configurado
      if (codigo) return `${codigo}-${String(v.numero_sucursal).padStart(4, '0')}`
    }
    return `#${v?.numero ?? '?'}`
  }
  // H2 — enviar el ticket/comprobante por email (reusa el template venta_confirmada)
  const enviarTicketPorEmail = async (destino: string) => {
    const email = destino.trim()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast.error('Email inválido'); return }
    if (!ticketVenta) return
    setEmailTicketSending(true)
    try {
      const items = (ticketVenta.items ?? []).map((i: any) => ({
        nombre: i.nombre ?? i.producto_nombre ?? 'Ítem',
        cantidad: i.tiene_series ? (i.series_seleccionadas?.length ?? i.cantidad ?? 1) : (i.cantidad ?? 1),
        subtotal: i.subtotal ?? ((i.precio_unitario ?? 0) * (i.cantidad ?? 1)),
      }))
      const { error } = await supabase.functions.invoke('send-email', {
        body: {
          type: 'venta_confirmada',
          to: email,
          data: {
            numero: ticketVenta.numero,
            negocio: tenant!.nombre,
            total: ticketVenta.total,
            items,
            medio_pago: typeof ticketVenta.medio_pago === 'string' ? formatMedioPago(ticketVenta.medio_pago) : '',
          },
        },
      })
      if (error) {
        // Surface the real Resend/Edge-Function reason (ej. "API key is invalid")
        let detalle = ''
        try {
          const body = await (error as any).context?.json?.()
          if (body?.error) detalle = String(body.error)
        } catch { /* context no disponible */ }
        throw new Error(detalle || error.message || 'No se pudo enviar el email')
      }
      toast.success(`Ticket enviado a ${email}`)
      setEmailTicketOpen(false); setEmailTicketValue('')
    } catch (e: any) {
      const msg = String(e?.message ?? '')
      toast.error(/api key/i.test(msg)
        ? 'Resend rechazó la API key (revisá el secret RESEND_API_KEY en Supabase).'
        : (msg || 'No se pudo enviar el email'), { duration: 8000 })
    } finally { setEmailTicketSending(false) }
  }
  // VF3/J2 — pide la clave maestra (si está configurada) antes de ejecutar una acción sensible
  const pedirClaveMaestra = (titulo: string, onOk: () => void) => {
    if (!claveMaestraConfigurada) { onOk(); return }
    setClaveInput(''); setClaveReq({ titulo, onOk })
  }
  const confirmarClaveMaestra = async () => {
    if (!claveReq) return
    setClaveVerificando(true)
    try {
      const { data: ok } = await supabase.rpc('verificar_clave_maestra', { p_tenant_id: tenant!.id, p_clave: claveInput.trim() })
      if (!ok) { toast.error('Clave maestra incorrecta'); return }
      const cb = claveReq.onOk
      setClaveReq(null); setClaveInput('')
      cb()
    } finally { setClaveVerificando(false) }
  }
  // VF3/J1 — registra una acción sensible en el audit log de la venta (fire-and-forget)
  const logVentaAuditoria = (ventaId: string, accion: string, detalle: any) => {
    supabase.from('venta_auditoria').insert({
      id: crypto.randomUUID(), tenant_id: tenant!.id, venta_id: ventaId, accion, detalle,
      usuario_id: user?.id ?? null, usuario_nombre: (user as any)?.nombre_display ?? user?.rol ?? null,
    }).then(() => {}, () => {})
  }
  // VF4/K2 — notificar a DUEÑO/SUPERVISOR/ADMIN (alertas de ventas)
  const notificarRolesVentas = async (tipo: string, titulo: string, mensaje: string) => {
    try {
      const { data: us } = await supabase.from('users').select('id')
        .eq('tenant_id', tenant!.id).in('rol', ['DUEÑO', 'SUPERVISOR', 'ADMIN', 'SUPER_USUARIO'])
      if (!us || us.length === 0) return
      await supabase.from('notificaciones').insert(us.map((u: any) => ({
        tenant_id: tenant!.id, user_id: u.id, tipo, titulo, mensaje, action_url: '/ventas',
      })))
    } catch { /* las alertas no bloquean el flujo */ }
  }
  // VF3/J2 — cambiar el cliente de una venta (con clave maestra + auditoría)
  const confirmarCambioCliente = (c: any) => {
    const venta = cambiarClienteVenta
    if (!venta) return
    pedirClaveMaestra('Cambiar el cliente de la venta', async () => {
      const { error } = await supabase.from('ventas')
        .update({ cliente_id: c.id, cliente_nombre: c.nombre, cliente_telefono: c.telefono ?? null, consumidor_final: false })
        .eq('id', venta.id)
      if (error) { toast.error(error.message); return }
      logVentaAuditoria(venta.id, 'cambio_cliente', { cliente_anterior: venta.cliente_nombre ?? null, cliente_nuevo: c.nombre })
      toast.success('Cliente actualizado')
      setVentaDetalle((d: any) => d && d.id === venta.id ? { ...d, cliente_id: c.id, cliente_nombre: c.nombre } : d)
      qc.invalidateQueries({ queryKey: ['venta-auditoria', venta.id] })
      qc.invalidateQueries({ queryKey: ['ventas'] })
      setCambiarClienteVenta(null); setClienteSearch('')
    })
  }
  const qc = useQueryClient()
  const { grupos, grupoDefault, estadosDefault } = useGruposEstados()
  const { cotizacion: cotizacionUSD } = useCotizacion()
  const [searchParams, setSearchParams] = useSearchParams()
  const [tab, setTab] = useState<Tab>(() => searchParams.get('id') ? 'historial' : 'nueva')
  // J3: CONTADOR es read-only → siempre en el historial, sin acceso al POS
  useEffect(() => { if (esContador && tab !== 'historial') setTab('historial') }, [esContador, tab])
  const [ventaGrupoId, setVentaGrupoId] = useState<string | null>(null)

  // Nueva venta
  const [cart, setCart] = useState<CartItem[]>([])
  const [productoSearch, setProductoSearch] = useState('')
  const [clienteId, setClienteId] = useState<string | null>(null)
  const [esConsumidorFinal, setEsConsumidorFinal] = useState(true)  // H5: flag por venta (CF vs cliente registrado)
  const [clienteNombre, setClienteNombre] = useState('')
  const [clienteTelefono, setClienteTelefono] = useState('')
  const [clienteCCEnabled, setClienteCCEnabled] = useState(false)
  const [clienteCredito, setClienteCredito] = useState(0)  // E2 — saldo a favor del cliente (cliente_creditos)
  // B5 — cobranza de deuda CC desde el POS
  const [clienteCCDeuda, setClienteCCDeuda] = useState(0)
  const [cobrarCCOpen, setCobrarCCOpen] = useState(false)
  const [cobrarCCMonto, setCobrarCCMonto] = useState('')
  const [cobrarCCMetodo, setCobrarCCMetodo] = useState('Efectivo')
  const [cobrarCCSaving, setCobrarCCSaving] = useState(false)
  const [clienteSearch, setClienteSearch] = useState('')
  const [clienteDropOpen, setClienteDropOpen] = useState(false)
  const [nuevoClienteOpen, setNuevoClienteOpen] = useState(false)
  const [nuevoClienteForm, setNuevoClienteForm] = useState({ nombre: '', dni: '', telefono: '' })
  const [savingCliente, setSavingCliente] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [lpnPickerIdx, setLpnPickerIdx] = useState<number | null>(null)
  const [mediosPago, setMediosPago] = useState<MedioPagoItem[]>([{ tipo: '', monto: '' }])
  const [descuentoTotal, setDescuentoTotal] = useState('')
  const [descuentoTotalTipo, setDescuentoTotalTipo] = useState<DescTipo>('pct')
  const [notas, setNotas] = useState('')
  // ISS-082: monto comprometido en medios de pago (actualiza sólo en blur/enter)
  const [committedAsignado, setCommittedAsignado] = useState(0)
  // ISS-103: canal de venta en POS
  const [canalPOS, setCanalPOS] = useState('POS')
  // VF2/I1: si la default no matchea ningún canal configurado, usar el primero activo
  useEffect(() => {
    if (canalesActivos.length > 0 && !canalesActivos.some(c => c.nombre === canalPOS)) {
      setCanalPOS(canalesActivos[0].nombre)
    }
  }, [canalesActivos])
  // ISS-086: cuotas por banco en tarjeta de crédito
  const [cuotasSeleccion, setCuotasSeleccion] = useState<Record<number, { banco: string; cuotas: number; interes: number; sinInteres: boolean }>>({})
  const cuotasBancos: { id: string; nombre: string; cuotas: { cant: number; sin_interes: boolean; interes: number }[] }[] =
    ((tenant as any)?.cuotas_bancos ?? [])
  const [requiereEnvio, setRequiereEnvio] = useState(false)
  const [envioTransporte, setEnvioTransporte] = useState<'propio' | 'tercero'>('propio')
  const [envioCourier, setEnvioCourier] = useState('')
  const [envioServicio, setEnvioServicio] = useState('')
  const [costoEnvioVenta, setCostoEnvioVenta] = useState('')
  // ISS-174 F2 — cotización por API en el POS
  const [cotizandoVenta, setCotizandoVenta] = useState(false)
  const [cotizacionesVenta, setCotizacionesVenta] = useState<CotizacionOpcion[]>([])
  const [cpDestinoVenta, setCpDestinoVenta] = useState('')
  const [pesoVenta, setPesoVenta] = useState('')
  const [envioTipoVenta, setEnvioTipoVenta]   = useState<'monto' | 'km'>('monto')
  const [envioKmVenta, setEnvioKmVenta]       = useState('')
  const [precioPorKmVenta, setPrecioPorKmVenta] = useState('')
  const [envioDestinoVenta, setEnvioDestinoVenta] = useState('')
  const [envioOrigenVenta, setEnvioOrigenVenta] = useState('')
  const [envioDestinoCoords, setEnvioDestinoCoords] = useState('')
  const [envioOrigenCoords,  setEnvioOrigenCoords]  = useState('')
  const [envioOrigenGeoError, setEnvioOrigenGeoError] = useState(false)    // origen no geocodificable
  const [envioDestinoGeoError, setEnvioDestinoGeoError] = useState(false)  // destino no geocodificable
  const [envioFechaVenta, setEnvioFechaVenta] = useState('')
  // ISS-178 — Rango horario de entrega (índice del rango seleccionado en tenant.envio_rangos_horarios)
  const [envioRangoHorarioIdx, setEnvioRangoHorarioIdx] = useState<string>('')
  const [calculandoDistancia, setCalculandoDistancia] = useState(false)
  const [saving, setSaving] = useState(false)
  const [ticketVenta, setTicketVenta] = useState<any | null>(null)
  // H2 — enviar ticket por email
  const [emailTicketOpen, setEmailTicketOpen] = useState(false)
  const [emailTicketValue, setEmailTicketValue] = useState('')
  const [emailTicketSending, setEmailTicketSending] = useState(false)
  // VF3/J2 — clave maestra para acciones sensibles
  const claveMaestraConfigurada = !!(tenant as any)?.clave_maestra
  const [claveReq, setClaveReq] = useState<{ titulo: string; onOk: () => void } | null>(null)
  const [claveInput, setClaveInput] = useState('')
  const [claveVerificando, setClaveVerificando] = useState(false)
  const [overrideDescuento, setOverrideDescuento] = useState(false)  // J2c — override de descuento autorizado
  // VF3/J2 — cambiar cliente post-venta
  const [cambiarClienteVenta, setCambiarClienteVenta] = useState<any | null>(null)
  const [saldoModal, setSaldoModal] = useState<{ ventaId: string; total: number; montoPagado: number; mediosPago: MedioPagoItem[]; targetEstado?: 'despachada' | 'reservada' } | null>(null)
  // E2/E3 — cancelación de reserva: motivo + (si hay seña) penalidad + destino devolución/crédito
  const [cancelReservaModal, setCancelReservaModal] = useState<{ venta: any; destino: 'devolucion' | 'credito'; motivo: string; observacion: string } | null>(null)
  const [facturaModal, setFacturaModal] = useState<{ ventaId: string; ventaNumero: number; ventaTotal: number } | null>(null)
  // CUIT del cliente de la venta a facturar (para gatear Factura A, que exige CUIT del receptor)
  const [facturaClienteCuit, setFacturaClienteCuit] = useState<string | null>(null)
  // Tras emitir desde el POS: pasa a la vista de acciones (descargar/imprimir/email) sin ir al historial
  const [facturaEmitida, setFacturaEmitida] = useState<{ ventaId: string; tipo: string; cae: string } | null>(null)
  const [facturaTipo, setFacturaTipo] = useState<'A' | 'B' | 'C'>('B')
  const [facturaPV, setFacturaPV]     = useState<number>(1)
  const [ncModal, setNcModal]         = useState<{ devolucionId: string; ventaId: string; ventaNumero: number; monto: number } | null>(null)
  const [ncTipo, setNcTipo]           = useState<'NC-A' | 'NC-B' | 'NC-C'>('NC-B')
  const [ncPV, setNcPV]               = useState<number>(1)
  const [emitendoNC, setEmitiendoNC]  = useState(false)
  const [emitiendoFactura, setEmitiendoFactura] = useState(false)
  const [descargandoPdfVenta, setDescargandoPdfVenta] = useState(false)
  const [descargandoPresupuesto, setDescargandoPresupuesto] = useState(false)
  const [descargandoRemito, setDescargandoRemito] = useState(false)
  const [enviandoFacturaEmail, setEnviandoFacturaEmail] = useState(false)
  // Modal "Enviar factura por email": precarga el correo del cliente de la venta (editable)
  const [facturaEmailModal, setFacturaEmailModal] = useState<{ ventaId: string } | null>(null)
  const [facturaEmailValue, setFacturaEmailValue] = useState('')
  const [modoVenta, setModoVenta] = useState<'reservada' | 'despachada' | 'pendiente'>('despachada')
  const [editandoPago, setEditandoPago] = useState(false)
  const [editMontoPagado, setEditMontoPagado] = useState('')
  const [savingMontoPagado, setSavingMontoPagado] = useState(false)
  const [actualizandoPrecios, setActualizandoPrecios] = useState(false)

  // Devoluciones
  interface DevItem {
    venta_item_id: string
    producto_id: string
    nombre: string
    cantidad_original: number
    precio_unitario: number
    tiene_series: boolean
    venta_series: { serie_id: string; nro_serie: string }[]
    cantidad_devolver: number
    series_seleccionadas: string[]
  }
  const [devolucionVenta, setDevolucionVenta] = useState<any | null>(null)
  const [devItems, setDevItems] = useState<DevItem[]>([])
  const [devMotivo, setDevMotivo] = useState('')
  const [devMediosPago, setDevMediosPago] = useState<MedioPagoItem[]>([{ tipo: '', monto: '' }])
  // A7 (relevamiento Ventas A-D): destino del stock devuelto — DEV (revisión) o vendible directo. Default DEV.
  const [devDestinoStock, setDevDestinoStock] = useState<'dev' | 'vendible'>('dev')
  // L1 — caja específica para egreso efectivo en devolución
  const [devCajaSesionId, setDevCajaSesionId] = useState<string>('')
  const [devSaving, setDevSaving] = useState(false)
  const [devComprobante, setDevComprobante] = useState<any | null>(null)
  const [devolucionesOpen, setDevolucionesOpen] = useState(false)

  // MP link de pago
  const [mpLinkModal, setMpLinkModal] = useState<{ ventaId: string; monto: number; initPoint: string; qrDataUrl: string } | null>(null)
  const [generandoMpLink, setGenerandoMpLink] = useState(false)
  // ISS-072: MODO link + QR
  const [modoModal, setModoModal] = useState<{ qrDataUrl: string; deepLink: string; paymentId: string } | null>(null)
  const [generandoModo, setGenerandoModo] = useState(false)
  const [modoConectado, setModoConectado] = useState<boolean | null>(null)
  const [preVentaId, setPreVentaId] = useState<string | null>(null)
  const [mpPagoRecibido, setMpPagoRecibido] = useState(false)
  const [canalFiltro, setCanalFiltro] = useState<string | null>(null)
  const [canalEstado, setCanalEstado] = useState<string>('')
  const [canalSearch, setCanalSearch] = useState<string>('')
  const [canalDesde, setCanalDesde] = useState<string>('')
  const [canalHasta, setCanalHasta] = useState<string>('')

  const generarLinkMP = async (ventaId: string, monto: number) => {
    if (!monto || monto <= 0) { toast.error('Ingresá un monto para generar el link'); return }
    setGenerandoMpLink(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mp-crear-link-pago`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({ venta_id: ventaId, monto }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error al generar link')
      const qrDataUrl = await QRCode.toDataURL(json.init_point, { width: 220, margin: 2 })
      setMpLinkModal({ ventaId, monto, initPoint: json.init_point, qrDataUrl })
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setGenerandoMpLink(false)
    }
  }

  // Para venta nueva: genera UUID pre-venta y crea la preference antes de guardar
  const generarLinkMPCheckout = async (monto: number) => {
    const id = preVentaId ?? crypto.randomUUID()
    if (!preVentaId) setPreVentaId(id)
    setMpPagoRecibido(false)
    await generarLinkMP(id, monto)
  }

  // ISS-072: MODO — genera QR + link de pago
  const generarPagoMODO = async (monto: number) => {
    if (!monto || monto <= 0) { toast.error('Ingresá un monto para generar el QR MODO'); return }
    setGenerandoModo(true)
    try {
      const id = preVentaId ?? crypto.randomUUID()
      if (!preVentaId) setPreVentaId(id)
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/modo-crear-pago`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({ venta_id: id, monto }),
      })
      const json = await res.json()
      if (!res.ok) { toast.error(json.error ?? 'Error al generar pago MODO'); return }
      // Generar imagen QR a partir del string MODO
      const qrDataUrl = await QRCode.toDataURL(json.qr, { width: 260, margin: 2 })
      setModoModal({ qrDataUrl, deepLink: json.deep_link, paymentId: json.payment_id })
    } catch (e: any) { toast.error(e.message ?? 'Error al conectar con MODO') }
    finally { setGenerandoModo(false) }
  }

  // Verificar si MODO está conectado (lazy, solo cuando se necesita)
  const checkModoConectado = async () => {
    if (modoConectado !== null) return modoConectado
    const { data } = await supabase.from('modo_credentials')
      .select('conectado').eq('tenant_id', tenant!.id).maybeSingle()
    const conectado = data?.conectado ?? false
    setModoConectado(conectado)
    return conectado
  }

  // ISS-072: Polling MODO — detecta pago mientras el QR está visible
  const [modoPagoRecibido, setModoPagoRecibido] = useState(false)
  useEffect(() => {
    if (!modoModal) { setModoPagoRecibido(false); return }
    const ventaId = preVentaId
    if (!ventaId) return
    const interval = setInterval(async () => {
      // Caso 1: venta existe → id_pago_externo seteado
      const { data: ventaData } = await supabase
        .from('ventas')
        .select('id_pago_externo, monto_pagado')
        .eq('id', ventaId)
        .maybeSingle()
      if (ventaData?.id_pago_externo) {
        setModoPagoRecibido(true)
        clearInterval(interval)
        return
      }
      // Caso 2: pre-venta → buscar en log
      const { data: logData } = await supabase
        .from('ventas_externas_logs')
        .select('id')
        .eq('tenant_id', tenant!.id)
        .eq('integracion', 'MODO')
        .eq('webhook_external_id', modoModal.paymentId)
        .maybeSingle()
      if (logData) {
        setModoPagoRecibido(true)
        clearInterval(interval)
      }
    }, 4000)
    return () => clearInterval(interval)
  }, [modoModal, preVentaId])

  // Polling: mientras el modal QR está abierto, consulta cada 4s si llegó el pago.
  // Chequea tanto la venta (reservas) como ventas_externas_logs (ventas directas con pre-UUID).
  useEffect(() => {
    if (!mpLinkModal) { setMpPagoRecibido(false); return }
    const ventaId = mpLinkModal.ventaId
    const interval = setInterval(async () => {
      // Caso 1: venta ya existe → id_pago_externo seteado (reservas y ventas ya creadas)
      const { data: ventaData } = await supabase
        .from('ventas')
        .select('id_pago_externo, monto_pagado')
        .eq('id', ventaId)
        .maybeSingle()
      if (ventaData?.id_pago_externo) {
        setMpPagoRecibido(true)
        clearInterval(interval)
        if (ventaDetalle?.id === ventaId) {
          setVentaDetalle((prev: any) => prev ? { ...prev, monto_pagado: ventaData.monto_pagado } : prev)
        }
        return
      }
      // Caso 2: venta directa aún no creada → buscar log pre-venta
      const { data: logData } = await supabase
        .from('ventas_externas_logs')
        .select('id')
        .eq('tenant_id', tenant!.id)
        .eq('integracion', 'MercadoPago')
        .eq('webhook_external_id', `mp-preventa-${ventaId}`)
        .maybeSingle()
      if (logData) {
        setMpPagoRecibido(true)
        clearInterval(interval)
      }
    }, 4000)
    return () => clearInterval(interval)
  }, [mpLinkModal])

  // Caja abierta
  const { data: sesionesAbiertas = [] } = useQuery({
    queryKey: ['caja-sesiones-abiertas', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('caja_sesiones')
        .select('id, caja_id, cajas(nombre, moneda)')
        .eq('tenant_id', tenant!.id)
        .eq('estado', 'abierta')
      return data ?? []
    },
    enabled: !!tenant,
    refetchInterval: 15_000,
    refetchOnMount: true,      // Refresca al entrar a la página (ej: después de abrir caja en otra tab)
    refetchOnWindowFocus: true,
  })

  // Métodos de pago con su cuenta de origen default (para acreditar movimientos informativos)
  const { data: metodosPagoCfg = [] } = useQuery<any[]>({
    queryKey: ['metodos_pago_cfg', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('metodos_pago')
        .select('id, nombre, cuenta_origen_id, habilitado_ventas')
        .eq('tenant_id', tenant!.id).eq('activo', true)
      return data ?? []
    },
    enabled: !!tenant,
  })
  const normalizarNombreMetodo = (s: string): string =>
    s.toLowerCase()
      .normalize('NFD').replace(/\p{Diacritic}/gu, '') // sin tildes
      .replace(/\sde\s/g, ' ')                          // sin preposición "de"
      .replace(/\s+/g, ' ').trim()
  const cuentaOrigenDeMetodo = (nombreMetodo: string): string | null => {
    if (!nombreMetodo) return null
    const norm = normalizarNombreMetodo(nombreMetodo)
    const m = (metodosPagoCfg as any[]).find(x => normalizarNombreMetodo(x.nombre || '') === norm)
    return m?.cuenta_origen_id ?? null
  }
  // Lista de medios de pago: viene de Config → Ventas → Métodos de pago (dinámica)
  // Si el tenant aún no tiene config, fallback al hardcoded
  const MEDIOS_PAGO: string[] = (metodosPagoCfg as any[]).length > 0
    ? (metodosPagoCfg as any[]).filter(m => m.habilitado_ventas !== false).map(m => m.nombre).filter(Boolean)
    : MEDIOS_PAGO_FALLBACK
  const [cajaSeleccionadaId, setCajaSeleccionadaId] = useState<string | null>(null)

  // Sesión de la caja predeterminada del usuario (derivada de localStorage + sesiones abiertas)
  const cajaPrefKey = tenant?.id && user?.id ? `caja_preferida_${tenant.id}_${user.id}` : null
  const cajaPreferidaSesionId = useMemo<string | null>(() => {
    if (sesionesAbiertas.length === 0 || !cajaPrefKey) return null
    const cajaPrefId = localStorage.getItem(cajaPrefKey)
    if (!cajaPrefId) return null
    const sesion = (sesionesAbiertas as any[]).find(s => s.caja_id === cajaPrefId)
    return sesion?.id ?? null
  }, [sesionesAbiertas, cajaPrefKey])

  // sesión efectiva: selección explícita del user > caja preferida > única abierta
  const sesionCajaId = cajaSeleccionadaId
    ?? cajaPreferidaSesionId
    ?? (sesionesAbiertas.length === 1 ? (sesionesAbiertas[0] as any).id : null)

  // Si la selección explícita ya no es válida (caja cerrada, etc.), resetearla
  useEffect(() => {
    if (!cajaSeleccionadaId) return
    const stillValid = (sesionesAbiertas as any[]).some(s => s.id === cajaSeleccionadaId)
    if (!stillValid) setCajaSeleccionadaId(null)
  }, [sesionesAbiertas, cajaSeleccionadaId])

  // Historial
  const [searchHistorial, setSearchHistorial] = useState('')
  const [filterEstado, setFilterEstado] = useState<EstadoVenta | ''>('')
  const [filterCategoria, setFilterCategoria] = useState<string>('')
  const [ventaDetalle, setVentaDetalle] = useState<any | null>(null)
  const [ventasLimit, setVentasLimit] = useState(50)
  // Resetear paginación cuando cambian los filtros
  useEffect(() => { setVentasLimit(50) }, [filterEstado, sucursalId])

  // E1 — liberación de reservas vencidas (sweep lazy al entrar a Ventas).
  // Solo corre si el tenant configuró un vencimiento. Libera stock + cancela las vencidas.
  const sweepRanRef = useRef(false)
  useEffect(() => {
    if (sweepRanRef.current) return
    if (!tenant?.id || !((tenant as any)?.reserva_vencimiento_dias > 0)) return
    sweepRanRef.current = true
    supabase.rpc('liberar_reservas_vencidas', { p_tenant_id: tenant.id }).then(({ data, error }) => {
      if (!error && (data ?? 0) > 0) {
        toast(`${data} reserva(s) vencida(s): stock liberado automáticamente.`, { icon: '⏳' })
        qc.invalidateQueries({ queryKey: ['ventas'] })
        qc.invalidateQueries({ queryKey: ['productos'] })
      }
    })
  }, [tenant?.id])

  // E2 — saldo a favor del cliente seleccionado (cliente_creditos)
  useEffect(() => {
    if (!clienteId || !tenant?.id) { setClienteCredito(0); return }
    let cancelado = false
    supabase.from('cliente_creditos').select('monto').eq('tenant_id', tenant.id).eq('cliente_id', clienteId)
      .then(({ data }) => {
        if (cancelado) return
        const saldo = (data ?? []).reduce((acc: number, r: any) => acc + (Number(r.monto) || 0), 0)
        setClienteCredito(Math.max(0, Math.round(saldo * 100) / 100))
      })
    return () => { cancelado = true }
  }, [clienteId, tenant?.id])

  // B5 — deuda CC del cliente seleccionado (para mostrar "Cobrar deuda" en el POS)
  const fetchClienteCCDeuda = async () => {
    if (!clienteId) { setClienteCCDeuda(0); return }
    const { data } = await supabase.rpc('cliente_cc_estado', { p_cliente: clienteId })
    setClienteCCDeuda(Number(data?.[0]?.deuda_total ?? 0))
  }
  useEffect(() => { fetchClienteCCDeuda() }, [clienteId])

  const registrarCobranzaCC = async () => {
    const monto = parseFloat(cobrarCCMonto)
    if (!monto || monto <= 0) { toast.error('Ingresá un monto válido'); return }
    if (!clienteId) return
    setCobrarCCSaving(true)
    try {
      const { aplicado, cajaRegistrada } = await cobrarDeudaCCFIFO(supabase, {
        tenantId: tenant!.id, clienteId, monto, metodo: cobrarCCMetodo,
        usuarioId: user?.id, clienteNombre: clienteNombre || null,
        sesionCajaId, cuentaOrigenId: cuentaOrigenDeMetodo(cobrarCCMetodo),
      })
      if (aplicado <= 0) { toast.error('Sin ventas CC pendientes'); return }
      toast.success(`Cobranza de $${Math.round(aplicado).toLocaleString('es-AR')} registrada`)
      // Impacto en arqueo: si era efectivo y no había caja a la que imputar, avisar (descuadre seguro)
      if (cobrarCCMetodo === 'Efectivo' && !cajaRegistrada) {
        toast('El efectivo cobrado no quedó en ningún arqueo: no hay caja abierta a la que imputarlo.', { icon: '⚠️', duration: 7000 })
      } else if (cajaRegistrada) {
        qc.invalidateQueries({ queryKey: ['caja-sesiones-abiertas', tenant?.id] })
      }
      void notificarPagoCC(tenant, clienteId, clienteNombre || 'cliente', aplicado)  // CL4/C4
      setCobrarCCOpen(false); setCobrarCCMonto(''); setCobrarCCMetodo('Efectivo')
      await fetchClienteCCDeuda()
    } catch (e: any) { toast.error(e.message ?? 'Error al registrar la cobranza') }
    finally { setCobrarCCSaving(false) }
  }

  // Auto-calcular costo de envío cuando cambian km o precio/km
  useEffect(() => {
    if (envioTipoVenta === 'km' && envioKmVenta && precioPorKmVenta) {
      const calc = parseFloat(envioKmVenta) * parseFloat(precioPorKmVenta)
      if (!isNaN(calc) && calc > 0) setCostoEnvioVenta(calc.toFixed(2))
    }
  }, [envioKmVenta, precioPorKmVenta, envioTipoVenta])

  // ISS-162/163: pre-llenar origen (sucursal) y $/km (Config) al activar envío
  useEffect(() => {
    if (!requiereEnvio) return
    const suc = (sucursales as any[]).find(s => s.id === sucursalId)
    if (suc?.direccion) {
      setEnvioOrigenVenta(suc.direccion)
      // Geocodificar el origen UNA SOLA VEZ para tener coords disponibles
      setEnvioOrigenGeoError(false)
      fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(suc.direccion)}&format=jsonv2&limit=1&countrycodes=ar`,
        { headers: { 'User-Agent': 'Genesis360App/1.0' } })
        .then(r => r.json())
        .then((d: any[]) => {
          if (d?.[0]) { setEnvioOrigenCoords(`${d[0].lat},${d[0].lon}`); setEnvioOrigenGeoError(false) }
          else setEnvioOrigenGeoError(true)
        })
        .catch(() => setEnvioOrigenGeoError(true))
    }
    const kmRate = suc?.costo_km_envio || (tenant as any)?.costo_envio_por_km
    if (kmRate) { setPrecioPorKmVenta(String(kmRate)); setEnvioTipoVenta('km') }
    // Pre-llenar destino con domicilio principal del cliente + geocodificar en paralelo
    const destPrefill = !envioDestinoVenta && domiciliosFormateadosVenta.length > 0
      ? domiciliosFormateadosVenta[0] : envioDestinoVenta
    if (!envioDestinoVenta && destPrefill) setEnvioDestinoVenta(destPrefill)
    if (destPrefill && !envioDestinoCoords) {
      setEnvioDestinoGeoError(false)
      setTimeout(() => {
        fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(destPrefill)}&format=jsonv2&limit=1&countrycodes=ar`,
          { headers: { 'User-Agent': 'Genesis360App/1.0' } })
          .then(r => r.json())
          .then((d: any[]) => {
            if (d?.[0]) { setEnvioDestinoCoords(`${d[0].lat},${d[0].lon}`); setEnvioDestinoGeoError(false) }
            else setEnvioDestinoGeoError(true)
          })
          .catch(() => setEnvioDestinoGeoError(true))
      }, 600)
    }
  }, [requiereEnvio])

  // Calcular cuando ambos coords están disponibles (se dispara ante cualquier cambio de coords o modo)
  useEffect(() => {
    if (!envioOrigenCoords || !envioDestinoCoords || envioTipoVenta !== 'km') return
    const km = haversineKmCoordsStatic(envioOrigenCoords, envioDestinoCoords)
    if (km !== null) setEnvioKmVenta(String(km))
  }, [envioOrigenCoords, envioDestinoCoords, envioTipoVenta])

  // Auto-geocodificar destino y calcular distancia cuando el texto cambia (tipeo manual o selección)
  // Cubre el caso donde el usuario no selecciona del dropdown sino que tipea la dirección
  const geocodTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!requiereEnvio || envioTipoVenta !== 'km' || !envioOrigenCoords) return
    if (envioDestinoCoords) {
      // Ya tenemos coords del destino → Haversine directo
      const km = haversineKmCoordsStatic(envioOrigenCoords, envioDestinoCoords)
      if (km !== null) setEnvioKmVenta(String(km))
      return
    }
    if (!envioDestinoVenta || envioDestinoVenta.length < 5) return
    if (geocodTimerRef.current) clearTimeout(geocodTimerRef.current)
    setEnvioDestinoGeoError(false)
    geocodTimerRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: envioDestinoVenta, format: 'jsonv2', limit: '1', countrycodes: 'ar' })
        const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { 'User-Agent': 'Genesis360App/1.0' } })
        const data = await res.json()
        if (data?.[0]) {
          const dc = `${data[0].lat},${data[0].lon}`
          setEnvioDestinoCoords(dc); setEnvioDestinoGeoError(false)
          const km = haversineKmCoordsStatic(envioOrigenCoords, dc)
          if (km !== null) setEnvioKmVenta(String(km))
        } else { setEnvioDestinoGeoError(true) }
      } catch { setEnvioDestinoGeoError(true) }
    }, 1200)
  }, [envioDestinoVenta, envioOrigenCoords, envioDestinoCoords, envioTipoVenta, requiereEnvio])

  const haversineKmCoords = haversineKmCoordsStatic

  // ISS-162: calcular distancia cuando se selecciona una dirección
  // Prioridad: Haversine (coords disponibles, instantáneo) → Maps API (fallback)
  const autoCalcularDistancia = async (origen: string, destino: string) => {
    if (!origen || !destino || envioTipoVenta !== 'km') return
    // Si tenemos coords de origen Y destino → Haversine instantáneo
    const destCoordsStr = envioDestinoCoords
    const origenCoordsStr = envioOrigenCoords
    if (origenCoordsStr && destCoordsStr) {
      const km = haversineKmCoords(origenCoordsStr, destCoordsStr)
      if (km !== null) { setEnvioKmVenta(String(km)); return }
    }
    // Fallback: Maps API (puede tardar o fallar)
    setCalculandoDistancia(true)
    const km = await calcularDistanciaKm(origen, destino)
    if (km !== null) setEnvioKmVenta(String(km))
    setCalculandoDistancia(false)
  }

  // Limpiar carrito cuando el DUEÑO cambia de sucursal (evita vender inventario de otra sucursal)
  const prevSucursalRef = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (prevSucursalRef.current === undefined) {
      prevSucursalRef.current = sucursalId   // primera carga — solo registrar, no limpiar
      return
    }
    if (prevSucursalRef.current === sucursalId) return
    prevSucursalRef.current = sucursalId
    if (cart.length > 0) {
      setCart([])
      setClienteId(null); setClienteNombre(''); setClienteTelefono(''); setClienteCCEnabled(false)
      setMediosPago([{ tipo: '', monto: '' }]); setNotas(''); setDescuentoTotal(''); setRequiereEnvio(false)
      if (cartDraftKey) localStorage.removeItem(cartDraftKey)
      toast('Sucursal cambiada — el carrito fue borrado para evitar vender stock de otra sucursal.', {
        icon: '🏪', duration: 5000,
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sucursalId])

  // Modal series
  const [seriesModal, setSeriesModal] = useState<{ itemIdx: number; lineas: any[] } | null>(null)
  const [seriesBusqueda, setSeriesBusqueda] = useState('')

  const registrarClienteInline = async () => {
    const { nombre, dni, telefono } = nuevoClienteForm
    if (!nombre.trim()) { toast.error('El nombre es obligatorio'); return }
    if (clienteDatosMinimos !== 'nombre' && !dni.trim()) { toast.error('El DNI es obligatorio'); return }
    setSavingCliente(true)
    try {
      const { data, error } = await supabase.from('clientes')
        .insert({ tenant_id: tenant!.id, nombre: nombre.trim(), dni: dni.trim(), telefono: telefono.trim() })
        .select('id, nombre').single()
      if (error) throw error
      setClienteId(data.id)
      setClienteNombre(data.nombre)
      setClienteTelefono(telefono.trim())
      setNuevoClienteOpen(false)
      setNuevoClienteForm({ nombre: '', dni: '', telefono: '' })
      toast.success('Cliente registrado')
    } catch (err: any) {
      toast.error(err.message?.includes('clientes_dni_tenant') ? 'Ya existe un cliente con ese DNI' : (err.message ?? 'Error al registrar'))
    } finally {
      setSavingCliente(false)
    }
  }

  useModalKeyboard({ isOpen: seriesModal !== null, onClose: () => { setSeriesModal(null); setSeriesBusqueda('') }, onConfirm: () => { setSeriesModal(null); setSeriesBusqueda('') } })
  useModalKeyboard({ isOpen: ticketVenta !== null, onClose: () => setTicketVenta(null) })
  useModalKeyboard({ isOpen: ventaDetalle !== null && saldoModal === null && ticketVenta === null, onClose: () => { setVentaDetalle(null); setEditandoPago(false) } })
  useModalKeyboard({ isOpen: facturaModal !== null, onClose: () => { setFacturaModal(null); setFacturaEmitida(null) } })
  useModalKeyboard({ isOpen: nuevoClienteOpen, onClose: () => { setNuevoClienteOpen(false); setNuevoClienteForm({ nombre: '', dni: '', telefono: '' }) }, onConfirm: registrarClienteInline })
  useModalKeyboard({ isOpen: saldoModal !== null, onClose: () => setSaldoModal(null) })

  // Cola de scans para procesar secuencialmente (evita duplicados por concurrencia)
  const scanQueueRef = useRef<string[]>([])
  const scanProcessingRef = useRef(false)

  // Pre-guardado del carrito en localStorage
  const cartDraftKey = tenant?.id ? `carrito_draft_${tenant.id}` : null
  // Restaurar carrito + re-fetch inmediato de lineas_disponibles
  const restoredRef = useRef(false)
  useEffect(() => {
    if (!cartDraftKey || restoredRef.current) return
    restoredRef.current = true
    const raw = localStorage.getItem(cartDraftKey)
    if (!raw) return
    try {
      const draft = JSON.parse(raw)
      if (draft.cart?.length > 0) {
        const itemsRestaurados = draft.cart.map((item: any) => ({ ...item, lineas_disponibles: [], series_disponibles: [] }))
        setCart(itemsRestaurados)

        // Re-fetch inmediato de lineas_disponibles — dentro del mismo effect para
        // evitar la race condition con el effect separado que llega antes que el cart
        const hoy = new Date().toISOString().split('T')[0]
        const itemsSinSeries = itemsRestaurados.filter((i: any) => !i.tiene_series)
        if (itemsSinSeries.length > 0) {
          Promise.all(itemsSinSeries.map(async (item: any) => {
            let q = supabase.from('inventario_lineas')
              .select('id, lpn, cantidad, cantidad_reservada, fecha_vencimiento, ubicaciones(nombre, prioridad, disponible_surtido)')
              .eq('producto_id', item.producto_id).eq('activo', true).gt('cantidad', 0)
            if (sucursalId) q = q.eq('sucursal_id', sucursalId)
            const { data } = await q
            const lineasDisp = (data ?? [])
              .filter((l: any) => (l.ubicaciones as any)?.disponible_surtido !== false)
              .filter((l: any) => !l.fecha_vencimiento || l.fecha_vencimiento >= hoy)
              .map((l: any) => ({
                id: l.id, lpn: l.lpn ?? null,
                cantidad: l.cantidad, cantidad_reservada: l.cantidad_reservada ?? 0,
                ubicacion: (l.ubicaciones as any)?.nombre ?? null,
              }))
            return { producto_id: item.producto_id, lineasDisp }
          })).then(updates => {
            setCart(prev => prev.map(item => {
              const u = updates.find((x: any) => x.producto_id === item.producto_id)
              return u ? { ...item, lineas_disponibles: u.lineasDisp } : item
            }))
          }).catch(() => {})
        }

        if (draft.clienteId) {
          setClienteId(draft.clienteId)
          setClienteNombre(draft.clienteNombre ?? '')
          setClienteTelefono(draft.clienteTelefono ?? '')
          supabase.from('clientes').select('cuenta_corriente_habilitada').eq('id', draft.clienteId).maybeSingle()
            .then(({ data }) => { if (data?.cuenta_corriente_habilitada) setClienteCCEnabled(true) })
        }
        if (draft.mediosPago) setMediosPago(draft.mediosPago)
        if (draft.notas) setNotas(draft.notas)
        if (draft.modoVenta) setModoVenta(draft.modoVenta)
        if (draft.descuentoTotal) setDescuentoTotal(draft.descuentoTotal)
        if (draft.descuentoTotalTipo) setDescuentoTotalTipo(draft.descuentoTotalTipo)
        toast('🛒 Se recuperó tu carrito anterior', { duration: 4000 })
      }
    } catch { localStorage.removeItem(cartDraftKey) }
  }, [cartDraftKey])  // eslint-disable-line react-hooks/exhaustive-deps
  // Guardar solo cuando hay contenido (nunca borrar aquí — el delete va en sale completion)
  useEffect(() => {
    if (!cartDraftKey || !restoredRef.current) return
    if (cart.length === 0 && !clienteId) {
      if (cartDraftKey) localStorage.removeItem(cartDraftKey)
      return
    }
    const draft = {
      cart: cart.map(({ lineas_disponibles: _ld, series_disponibles: _sd, ...rest }) => rest),
      clienteId, clienteNombre, clienteTelefono,
      mediosPago, notas, modoVenta, descuentoTotal, descuentoTotalTipo,
    }
    localStorage.setItem(cartDraftKey, JSON.stringify(draft))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, clienteId, clienteNombre, clienteTelefono, mediosPago, notas, modoVenta, descuentoTotal, descuentoTotalTipo])

  // Foco en buscador de productos
  const [searchFocused, setSearchFocused] = useState(false)
  const [viewMode, setViewMode] = useState<'lista' | 'galeria'>('lista')

  const { data: productosBusqueda = [] } = useQuery({
    queryKey: ['productos-venta', tenant?.id, productoSearch, ventaGrupoId, viewMode, sucursalId],
    queryFn: async () => {
      // Determinar estados del grupo activo
      const grupoActivo = ventaGrupoId === 'todos'
        ? null
        : ventaGrupoId
          ? grupos.find(g => g.id === ventaGrupoId)
          : grupoDefault
      const estadosFiltro = grupoActivo?.estado_ids ?? []

      // Buscar productos
      let prodQuery = supabase.from('productos')
        .select('id, nombre, sku, precio_venta, precio_costo, tiene_series, tiene_vencimiento, regla_inventario, stock_actual, unidad_medida, imagen_url, es_kit, alicuota_iva, precio_usd, moneda_venta')
        .eq('tenant_id', tenant!.id).eq('activo', true)
        .order('nombre')
        .limit(viewMode === 'galeria' ? 60 : 20)
      if (productoSearch.length > 0)
        prodQuery = prodQuery.or(`nombre.ilike.%${productoSearch}%,sku.ilike.%${productoSearch}%`)
      const { data: prods } = await prodQuery

      if (!prods || prods.length === 0) return []

      // Calcular stock disponible por producto según el grupo activo
      const productoIds = prods.map((p: any) => p.id)

      // Estados habilitados para venta (es_disponible_venta = true)
      const { data: estadosVentaData } = await supabase
        .from('estados_inventario')
        .select('id')
        .eq('tenant_id', tenant!.id)
        .eq('es_disponible_venta', true)
      const estadosVentaIds = (estadosVentaData ?? []).map((e: any) => e.id)

      // Intersección: grupo activo ∩ estados habilitados para venta
      const estadosFinal = estadosFiltro.length > 0
        ? estadosFiltro.filter(id => estadosVentaIds.includes(id))
        : estadosVentaIds

      // Traer líneas activas de estos productos con ubicación disponible para surtido
      // (en básico no se filtra por ubicación — el stock no está ubicado)
      let lineasQuery = applyFilter(
        soloUbicado(
          supabase.from('inventario_lineas')
            .select('producto_id, cantidad, cantidad_reservada, estado_id, ubicaciones(disponible_surtido), inventario_series(id, activo, reservado)')
            .eq('tenant_id', tenant!.id)
            .eq('activo', true)
            .in('producto_id', productoIds)
        )
      )

      // Filtrar por estados válidos (grupo ∩ disponible_venta, o solo disponible_venta si sin grupo)
      // En básico no se filtra por estado (el stock no tiene estado asignado — todo es vendible)
      if (modoAvanzado && estadosFinal.length > 0) {
        lineasQuery = lineasQuery.in('estado_id', estadosFinal)
      }

      const { data: lineas } = await lineasQuery

      // Calcular stock disponible por producto (solo líneas con ubicación disponible para surtido)
      const stockMap: Record<string, number> = {}
      for (const linea of lineas ?? []) {
        if ((linea.ubicaciones as any)?.disponible_surtido === false) continue
        const pid = linea.producto_id
        if (!stockMap[pid]) stockMap[pid] = 0

        const tieneSeries = (linea.inventario_series ?? []).length > 0
        if (tieneSeries) {
          // Contar series activas y no reservadas
          const disponibles = (linea.inventario_series ?? [])
            .filter((s: any) => s.activo && !s.reservado).length
          stockMap[pid] += disponibles
        } else {
          // Cantidad - reservada
          const disponible = (linea.cantidad ?? 0) - (linea.cantidad_reservada ?? 0)
          stockMap[pid] += Math.max(0, disponible)
        }
      }

      // Filtrar productos con stock > 0 en el grupo y agregar stock calculado
      return prods
        .map((p: any) => ({
          ...p,
          stock_disponible: stockMap[p.id] ?? 0,
          stock_filtrado: estadosFiltro.length > 0, // indica que el stock está filtrado por grupo
        }))
        .filter((p: any) => estadosFiltro.length === 0 || (stockMap[p.id] ?? 0) > 0)
    },
    enabled: !!tenant && authInitialized,
  })

  const { data: clientesBusqueda = [] } = useQuery({
    queryKey: ['clientes-search', tenant?.id, clienteSearch],
    queryFn: async () => {
      let q = supabase.from('clientes').select('id, nombre, dni, telefono, cuenta_corriente_habilitada')
        .eq('tenant_id', tenant!.id).order('nombre').limit(10)
      if (clienteSearch) q = q.or(`nombre.ilike.%${clienteSearch}%,dni.ilike.%${clienteSearch}%`)
      const { data } = await q
      return data ?? []
    },
    enabled: !!tenant && (clienteDropOpen || !!cambiarClienteVenta),
  })

  // VF3/J1 — audit log de la venta abierta en el detalle
  const ventaDetalleId = ventaDetalle?.id ?? null
  const { data: ventaAuditoria = [] } = useQuery({
    queryKey: ['venta-auditoria', ventaDetalleId],
    enabled: !!ventaDetalleId,
    queryFn: async () => {
      const { data } = await supabase.from('venta_auditoria')
        .select('id, accion, detalle, usuario_nombre, created_at')
        .eq('venta_id', ventaDetalleId).order('created_at', { ascending: false })
      return data ?? []
    },
  })

  // Domicilios del cliente seleccionado — para autocompletar dirección de envío
  const { data: domiciliosClienteVenta = [] } = useQuery({
    queryKey: ['domicilios-cliente-venta', clienteId],
    queryFn: async () => {
      const { data } = await supabase.from('cliente_domicilios')
        .select('calle, numero, piso_depto, ciudad, provincia, codigo_postal')
        .eq('cliente_id', clienteId!)
        .order('es_principal', { ascending: false }).order('created_at')
      return data ?? []
    },
    enabled: !!clienteId,
  })
  const domiciliosFormateadosVenta = (domiciliosClienteVenta as any[]).map(d =>
    [d.calle, d.numero, d.piso_depto, d.ciudad, d.provincia, d.codigo_postal].filter(Boolean).join(', ')
  )

  // ISS-174 — cotizar el envío por API del courier en el POS
  const cpOrigenVenta = (sucursales as any[]).find(s => s.id === sucursalId)?.codigo_postal || ''
  const cpDestinoEfectivo = cpDestinoVenta.trim() || (domiciliosClienteVenta as any[])[0]?.codigo_postal || ''
  const handleCotizarVenta = async () => {
    if (!esCourierApi(envioCourier)) { toast.error(`${envioCourier || 'El courier'} no tiene cotización por API`); return }
    if (!cpOrigenVenta) { toast.error('La sucursal no tiene código postal (cargalo en Sucursales)'); return }
    if (!cpDestinoEfectivo) { toast.error('Ingresá el código postal de destino'); return }
    setCotizandoVenta(true); setCotizacionesVenta([])
    try {
      const ops = await cotizarEnvio({
        courier: envioCourier, origen_cp: cpOrigenVenta, destino_cp: cpDestinoEfectivo,
        peso_kg: parseFloat(pesoVenta) || 1,
      })
      setCotizacionesVenta(ops)
      if (ops.length === 0) toast('Sin opciones para ese destino', { icon: 'ℹ️' })
    } catch (e: any) {
      toast.error(e?.message ?? 'Error al cotizar')
    } finally { setCotizandoVenta(false) }
  }

  const { data: categoriasHistorial = [] } = useQuery({
    queryKey: ['categorias-historial', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('categorias').select('id, nombre').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant && tab === 'historial',
  })

  const { data: devolucionesPasadas = [] } = useQuery({
    queryKey: ['devoluciones-venta', ventaDetalle?.id],
    queryFn: async () => {
      const { data } = await supabase.from('devoluciones')
        .select('*, devolucion_items(*, productos(nombre,sku)), nc_cae, nc_tipo, nc_numero_comprobante, origen')
        .eq('venta_id', ventaDetalle!.id)
        .order('created_at', { ascending: false })
      return data ?? []
    },
    enabled: !!ventaDetalle?.id,
  })

  // ISS-075: desglose de despacho por LPN/ubicación de cada ítem de la venta abierta
  const { data: despachosVenta = [] } = useQuery({
    queryKey: ['venta-despachos', ventaDetalle?.id],
    queryFn: async () => {
      const { data } = await supabase.from('venta_item_despachos')
        .select('venta_item_id, lpn, ubicacion_nombre, cantidad, nro_serie, origen')
        .eq('venta_id', ventaDetalle!.id)
        .order('created_at', { ascending: true })
      return data ?? []
    },
    enabled: !!ventaDetalle?.id,
  })
  const despachosPorItem = (despachosVenta as any[]).reduce((acc: Record<string, any[]>, d: any) => {
    (acc[d.venta_item_id] ??= []).push(d); return acc
  }, {})

  const { data: ventas = [], isLoading: loadingVentas } = useQuery({
    queryKey: ['ventas', tenant?.id, filterEstado, sucursalId, ventasLimit],
    queryFn: async () => {
      let q = supabase.from('ventas').select('*, venta_items(id, producto_id, cantidad, precio_unitario, descuento, subtotal, alicuota_iva, iva_monto, linea_id, productos(nombre,sku,precio_costo,tiene_series,tiene_vencimiento,regla_inventario,categoria_id), inventario_lineas(lpn), venta_series(serie_id, inventario_series(nro_serie)))')
        .eq('tenant_id', tenant!.id).order('created_at', { ascending: false }).limit(ventasLimit)
      if (filterEstado) q = q.eq('estado', filterEstado)
      q = applyFilter(q)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!tenant && tab === 'historial',
  })

  // Abrir modal de venta directamente si viene con ?id= en la URL.
  // Con ?devolver=1 (CTA desde Envíos cuando un envío vuelve en estado "devolución")
  // se abre directo el flujo de devolución de esa venta (respeta plazo de canal + clave maestra).
  useEffect(() => {
    const id = searchParams.get('id')
    if (!id || loadingVentas) return
    const venta = ventas.find((v: any) => v.id === id)
    if (venta) {
      const devolver = searchParams.get('devolver') === '1'
      setSearchParams({}, { replace: true })
      if (devolver) abrirModalDevolucion(venta)
      else setVentaDetalle(venta)
    }
  }, [ventas, loadingVentas, searchParams, setSearchParams])

  const agregarProducto = async (p: any) => {
    setProductoSearch('')

    // Usar stock_disponible calculado por el query (ya descuenta reservas y aplica filtro de grupo)
    const stockDisponible = p.stock_disponible ?? p.stock_actual ?? 0

    if (stockDisponible <= 0) {
      toast.error(p.stock_filtrado
        ? 'Sin stock disponible en el grupo seleccionado'
        : 'Este producto no tiene stock disponible')
      return
    }

    if (!p.precio_venta || p.precio_venta <= 0) {
      toast.error(`"${p.nombre}" no tiene precio de venta. Editá el producto antes de venderlo.`)
      return
    }

    // Si ya está en el carrito, incrementar
    const totalEnCarrito = cart.filter(c => c.producto_id === p.id).reduce((a, c) => a + c.cantidad, 0)
    if (totalEnCarrito > 0) {
      if (totalEnCarrito >= stockDisponible) { toast.error(`Stock disponible: ${stockDisponible}`); return }
      const idx = cart.findIndex(c => c.producto_id === p.id)
      setCart(prev => prev.map((c, i) => i === idx ? { ...c, cantidad: c.cantidad + 1 } : c))
      return
    }

    // Si tiene series, cargar líneas disponibles (filtrando por grupo si aplica)
    let seriesDisp: any[] = []
    if (p.tiene_series) {
      const grupoActivo = ventaGrupoId === 'todos'
        ? null
        : ventaGrupoId ? grupos.find(g => g.id === ventaGrupoId) : grupoDefault
      const estadosFiltro = grupoActivo?.estado_ids ?? []

      // Estados habilitados para venta
      const { data: evData } = await supabase.from('estados_inventario').select('id').eq('tenant_id', tenant!.id).eq('es_disponible_venta', true)
      const evIds = (evData ?? []).map((e: any) => e.id)
      const estadosFinal = estadosFiltro.length > 0 ? estadosFiltro.filter(id => evIds.includes(id)) : evIds

      let lineasQuery = soloUbicado(
        supabase.from('inventario_lineas')
          .select('id, lpn, estado_id, ubicacion_id, ubicaciones(nombre, disponible_surtido), inventario_series(id, nro_serie, activo, reservado)')
          .eq('producto_id', p.id).eq('activo', true)
      )

      // En básico no se filtra por estado (el stock no tiene estado asignado — todo es vendible)
      if (modoAvanzado && estadosFinal.length > 0) {
        lineasQuery = lineasQuery.in('estado_id', estadosFinal)
      }

      const { data: lineas } = await lineasQuery
      seriesDisp = (lineas ?? [])
        .filter((l: any) => l.ubicaciones?.disponible_surtido !== false)
        .flatMap((l: any) =>
          (l.inventario_series ?? [])
            .filter((s: any) => s.activo && !s.reservado)
            .map((s: any) => ({ ...s, lpn: l.lpn, linea_id: l.id, ubicacion_id: l.ubicacion_id ?? null, ubicacion_nombre: (l.ubicaciones as any)?.nombre ?? null }))
        )
    }

    // Para productos sin series: pre-fetch todas las líneas disponibles, calcular fuentes
    let primaryLpn: string | undefined
    let primaryLineaId: string | undefined
    let lineasDisponibles: LineaDisponible[] = []
    let lpnFuentes: LpnFuente[] = []
    if (!p.tiene_series) {
      const sortLineas = getRebajeSort(p.regla_inventario, tenant!.regla_inventario, p.tiene_vencimiento ?? false)
      const grupoActivo2 = ventaGrupoId === 'todos' ? null : ventaGrupoId ? grupos.find(g => g.id === ventaGrupoId) : grupoDefault
      const estadosFiltro2 = grupoActivo2?.estado_ids ?? []
      // Estados habilitados para venta (reutiliza evIds del bloque anterior si ya fue calculado, o re-query)
      const { data: evData2 } = await supabase.from('estados_inventario').select('id').eq('tenant_id', tenant!.id).eq('es_disponible_venta', true)
      const evIds2 = (evData2 ?? []).map((e: any) => e.id)
      const estadosFinal2 = estadosFiltro2.length > 0 ? estadosFiltro2.filter(id => evIds2.includes(id)) : evIds2
      let lq = supabase.from('inventario_lineas')
        .select('id, lpn, cantidad, cantidad_reservada, created_at, fecha_vencimiento, ubicaciones(nombre, prioridad, disponible_surtido)')
        .eq('producto_id', p.id).eq('activo', true).gt('cantidad', 0)
      if (modoAvanzado && estadosFinal2.length > 0) lq = lq.in('estado_id', estadosFinal2)
      const { data: lineasRaw2 } = await lq
      const hoyStr = new Date().toISOString().split('T')[0]
      const sortedLineas = (lineasRaw2 ?? [])
        .filter((l: any) => l.ubicaciones?.disponible_surtido !== false)
        .filter((l: any) => !l.fecha_vencimiento || l.fecha_vencimiento >= hoyStr)
        .sort(sortLineas)
      lineasDisponibles = sortedLineas.map((l: any) => ({
        id: l.id,
        lpn: l.lpn ?? null,
        cantidad: l.cantidad,
        cantidad_reservada: l.cantidad_reservada ?? 0,
        ubicacion: (l.ubicaciones as any)?.nombre ?? null,
      }))
      lpnFuentes = calcularLpnFuentes(lineasDisponibles, 1)
      primaryLineaId = lpnFuentes[0]?.linea_id
      primaryLpn = lpnFuentes[0]?.lpn ?? undefined
    }

    // G5 — si el producto se vende en USD, convertir a moneda local a la cotización vigente
    const esUSD = (p as any).moneda_venta === 'usd' && ((p as any).precio_usd ?? 0) > 0 && (cotizacionUSD ?? 0) > 0
    const precioBase = esUSD
      ? Math.round(((p as any).precio_usd as number) * (cotizacionUSD as number) * 100) / 100
      : p.precio_venta
    const newItem: CartItem = {
      producto_id: p.id,
      nombre: p.nombre,
      sku: p.sku,
      unidad_medida: p.unidad_medida ?? 'unidad',
      precio_unitario: precioBase,
      precio_usd_origen: esUSD ? ((p as any).precio_usd as number) : undefined,
      tiers: (tiersMayoristaMap as any)[p.id],
      precio_costo: p.precio_costo ?? 0,
      cantidad: 1,
      descuento: 0,
      descuento_tipo: 'pct',
      tiene_series: p.tiene_series,
      tiene_vencimiento: p.tiene_vencimiento ?? false,
      regla_inventario: p.regla_inventario ?? null,
      linea_id: primaryLineaId,
      lpn: primaryLpn,
      lineas_disponibles: lineasDisponibles,
      lpn_fuentes: lpnFuentes,
      imagen_url: p.imagen_url,
      alicuota_iva: (p as any).alicuota_iva ?? 21,
      series_seleccionadas: [],
      series_disponibles: seriesDisp,
    }
    setCart(prev => [...prev, newItem])
  }

  const overrideLpnSource = (cartIdx: number, lineaId: string) => {
    setCart(prev => prev.map((item, i) => {
      if (i !== cartIdx || !item.lineas_disponibles) return item
      const selected = item.lineas_disponibles.find(l => l.id === lineaId)
      if (!selected) return item
      const reordered = [selected, ...item.lineas_disponibles.filter(l => l.id !== lineaId)]
      const fuentes = calcularLpnFuentes(reordered, item.cantidad)
      // ISS-075: registrar este LPN como elegido manualmente (para distinguir manual vs auto en el rebaje)
      const manualIds = Array.from(new Set([...(item.lpn_manual_ids ?? []), lineaId]))
      return { ...item, lineas_disponibles: reordered, lpn_fuentes: fuentes, lpn_manual_ids: manualIds, linea_id: fuentes[0]?.linea_id, lpn: fuentes[0]?.lpn ?? undefined }
    }))
    setLpnPickerIdx(null)
  }

  const procesarScan = async (code: string) => {
    const PROD_COLS = 'id, nombre, sku, precio_venta, precio_costo, tiene_series, tiene_vencimiento, regla_inventario, stock_actual, unidad_medida, codigo_barras, es_kit, alicuota_iva, precio_usd, moneda_venta'
    let prod: any = null
    let cantidadScan = 1   // ISS-127 F3: cantidad a sumar (1 por default; del código GS1 si trae AI 30)

    // ¿Código compuesto GS1? → identificar producto por GTIN (fallback codigo_barras).
    const comp = await resolverScanCompuesto(code, tenant!.id)
    if (comp) {
      if (!comp.producto) { toast.error('Código GS1 leído, pero el GTIN no coincide con ningún producto.'); return }
      cantidadScan = comp.fields.cantidad ?? 1
      const { data } = await supabase.from('productos').select(PROD_COLS)
        .eq('tenant_id', tenant!.id).eq('id', comp.producto.id).limit(1)
      prod = data?.[0]
      if (!prod) { toast.error('Producto no encontrado'); return }
    } else {
      const { data: prods } = await supabase.from('productos').select(PROD_COLS)
        .eq('tenant_id', tenant!.id).eq('activo', true)
        .or(`codigo_barras.eq.${code},sku.eq.${code}`)
        .limit(1)
      if (!prods || prods.length === 0) { toast.error(`No se encontró ningún producto con código "${code}"`); return }
      prod = prods[0]
    }
    const { data: lineasScan } = await applyFilter(
      supabase.from('inventario_lineas')
        .select('cantidad, cantidad_reservada, ubicaciones(disponible_surtido), inventario_series(id, activo, reservado)')
        .eq('tenant_id', tenant!.id).eq('producto_id', prod.id).eq('activo', true)
    )
    let stockDisponibleScan = 0
    for (const l of lineasScan ?? []) {
      if ((l.ubicaciones as any)?.disponible_surtido === false) continue
      const seriesArr = (l.inventario_series ?? []) as any[]
      if (seriesArr.length > 0) {
        stockDisponibleScan += seriesArr.filter((s: any) => s.activo && !s.reservado).length
      } else {
        stockDisponibleScan += Math.max(0, (l.cantidad ?? 0) - (l.cantidad_reservada ?? 0))
      }
    }
    // Si el producto ya está en el carrito y NO es serializado → sumar cantidad
    if (!prod.tiene_series) {
      const idx = cart.findIndex(c => c.producto_id === prod.id)
      if (idx >= 0) {
        const item = cart[idx]
        const maxDisp = item.lineas_disponibles?.reduce((s, l) => s + Math.max(0, l.cantidad - (l.cantidad_reservada ?? 0)), 0) ?? stockDisponibleScan
        const nuevaCant = item.cantidad + cantidadScan
        if (nuevaCant <= maxDisp) {
          updateItem(idx, 'cantidad', nuevaCant)
          return
        } else {
          toast.error(`Stock máximo disponible: ${maxDisp}`)
          return
        }
      }
    }
    await agregarProducto({ ...prod, stock_disponible: stockDisponibleScan })
  }

  const handleBarcodeScan = (code: string) => {
    // Encola el scan — procesa uno a la vez para evitar duplicados por concurrencia
    scanQueueRef.current.push(code)
    if (scanProcessingRef.current) return
    scanProcessingRef.current = true
    const processNext = async () => {
      while (scanQueueRef.current.length > 0) {
        const next = scanQueueRef.current.shift()!
        await procesarScan(next)
      }
      scanProcessingRef.current = false
    }
    processNext()
  }

  const updateItem = (idx: number, field: keyof CartItem, value: any) => {
    // Validar stock disponible antes de actualizar cantidad
    if (field === 'cantidad' && typeof value === 'number' && value > 0) {
      const item = cart[idx]
      if (item && !item.tiene_series && item.lineas_disponibles && item.lineas_disponibles.length > 0) {
        const maxDisp = item.lineas_disponibles.reduce(
          (sum, l) => sum + Math.max(0, l.cantidad - (l.cantidad_reservada ?? 0)), 0
        )
        if (value > maxDisp) {
          toast.error(`Stock máximo disponible: ${maxDisp}`)
          value = maxDisp
        }
      }
    }
    // Clamp descuento: pct máx 100%, monto máx subtotal del item
    if (field === 'descuento' && typeof value === 'number') {
      const item = cart[idx]
      if (item) {
        const cant = item.tiene_series ? item.series_seleccionadas.length : item.cantidad
        const base = item.precio_unitario * cant
        const tipo = item.descuento_tipo
        if (tipo === 'pct') value = Math.min(100, Math.max(0, value))
        else value = Math.min(base, Math.max(0, value))
      }
    }
    // Al cambiar el tipo de descuento, clampear el valor actual al nuevo límite
    if (field === 'descuento_tipo') {
      const item = cart[idx]
      if (item) {
        const cant = item.tiene_series ? item.series_seleccionadas.length : item.cantidad
        const base = item.precio_unitario * cant
        const nuevoTipo = value as DescTipo
        const descActual = item.descuento
        if (nuevoTipo === 'pct') {
          // Si venía de monto, el número puede ser mayor a 100; clampearlo
          const clampedPct = Math.min(100, Math.max(0, descActual))
          setCart(prev => prev.map((it, i) => i !== idx ? it : { ...it, descuento_tipo: nuevoTipo, descuento: clampedPct }))
          return
        } else {
          // Si venía de pct, convertir el porcentaje a monto para no perder contexto
          const montoEquivalente = Math.min(base, Math.max(0, descActual <= 100 ? base * descActual / 100 : descActual))
          setCart(prev => prev.map((it, i) => i !== idx ? it : { ...it, descuento_tipo: nuevoTipo, descuento: parseFloat(montoEquivalente.toFixed(2)) }))
          return
        }
      }
    }
    setCart(prev => prev.map((item, i) => {
      if (i !== idx) return item
      const updated = { ...item, [field]: value }
      // Recomputa las fuentes de LPN cuando cambia la cantidad (solo non-series)
      if (field === 'cantidad' && !item.tiene_series && item.lineas_disponibles) {
        const nuevasCantidad = value as number
        const fuentes = calcularLpnFuentes(item.lineas_disponibles, nuevasCantidad)
        updated.lpn_fuentes = fuentes
        updated.linea_id = fuentes[0]?.linea_id
        updated.lpn = fuentes[0]?.lpn ?? undefined
      }
      return updated
    }))
  }

  const removeItem = (idx: number) => setCart(prev => prev.filter((_, i) => i !== idx))

  // ── Facturación ───────────────────────────────────────────────────────────
  const factHabilitada = !!(tenant as any)?.facturacion_habilitada && !!(tenant as any)?.cuit

  const detectarTipoComp = (clienteCondIva?: string): 'A' | 'B' | 'C' =>
    detectarTipoComprobante((tenant as any)?.condicion_iva_emisor, clienteCondIva)

  const triggerFacturaModal = (ventaId: string, ventaNumero: number, ventaTotal: number, clienteCondIva?: string) => {
    const tipo = detectarTipoComp(clienteCondIva)
    const pvDefault = (puntosVentaAfip as any[])[0]?.numero ?? 1
    setFacturaTipo(tipo)
    setFacturaPV(pvDefault)
    setFacturaClienteCuit(null)
    setFacturaModal({ ventaId, ventaNumero, ventaTotal })
  }

  // Al abrir el modal, traer el CUIT del cliente de la venta (Factura A lo exige).
  useEffect(() => {
    if (!facturaModal) return
    let cancel = false
    supabase.from('ventas').select('clientes(cuit_receptor)').eq('id', facturaModal.ventaId).single()
      .then(({ data }) => {
        if (cancel) return
        const cuit = ((data as any)?.clientes?.cuit_receptor ?? '').toString().replace(/[-\s]/g, '')
        setFacturaClienteCuit(cuit || null)
        // Si quedó seleccionada Factura A sin CUIT, degradar a B para no bloquear la emisión.
        if (!cuit) setFacturaTipo(t => (t === 'A' ? 'B' : t))
      })
    return () => { cancel = true }
  }, [facturaModal])

  const emitirFactura = async () => {
    if (!facturaModal) return
    setEmitiendoFactura(true)
    try {
      const { data, error } = await supabase.functions.invoke('emitir-factura', {
        body: { venta_id: facturaModal.ventaId, tenant_id: tenant!.id, tipo_comprobante: facturaTipo, punto_venta: facturaPV },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      toast.success(`✅ Factura ${facturaTipo} emitida — CAE: ${data.cae}`, { duration: 8000 })
      // No cerramos: pasamos a la vista de acciones (descargar/imprimir/email)
      setFacturaEmitida({ ventaId: facturaModal.ventaId, tipo: facturaTipo, cae: data.cae })
      // Sincronizar el detalle abierto (si es la misma venta) para reflejar CAE + estado
      setVentaDetalle((d: any) => d && d.id === facturaModal.ventaId
        ? { ...d, cae: data.cae, vencimiento_cae: data.vencimiento, numero_comprobante: data.numero,
            tipo_comprobante: `Factura ${facturaTipo}`, estado: d.estado === 'despachada' ? 'facturada' : d.estado }
        : d)
    } catch (e: any) {
      let msg = String(e?.message ?? '')
      try { const body = await (e as any).context?.json?.(); if (body?.error) msg = String(body.error) } catch { /* */ }
      toast.error('Error al emitir: ' + (msg || 'intente nuevamente'), { duration: 8000 })
    } finally {
      setEmitiendoFactura(false)
    }
  }

  const emitirNC = async () => {
    if (!ncModal) return
    setEmitiendoNC(true)
    try {
      const { data, error } = await supabase.functions.invoke('emitir-factura', {
        body: {
          venta_id: ncModal.ventaId,
          tenant_id: tenant!.id,
          tipo_comprobante: ncTipo,
          punto_venta: ncPV,
          devolucion_id: ncModal.devolucionId,
        },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      toast.success(`✅ ${ncTipo} emitida — CAE: ${data.cae}`, { duration: 8000 })
      setNcModal(null)
      qc.invalidateQueries({ queryKey: ['devoluciones-venta', ncModal.ventaId] })
    } catch (e: any) {
      let msg = String(e?.message ?? '')
      try { const body = await (e as any).context?.json?.(); if (body?.error) msg = String(body.error) } catch { /* */ }
      toast.error('Error al emitir NC: ' + (msg || 'intente nuevamente'), { duration: 8000 })
    } finally {
      setEmitiendoNC(false)
    }
  }

  // Crea el link de pago MercadoPago para un saldo y devuelve su QR (dataURL).
  // Si el tenant no tiene MP conectado o falla, devuelve null (la factura sale sin QR de pago).
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

  // Arma el FacturaPDFData + email del cliente para una venta facturada (por id).
  // Sirve al detalle de venta Y al modal post-emisión del POS (sin ir al historial).
  async function buildFacturaPDFDataPorId(ventaId: string): Promise<{ data: FacturaPDFData; email: string | null } | null> {
    const { data: venta, error: vErr } = await supabase.from('ventas')
      .select('numero, numero_comprobante, tipo_comprobante, cae, vencimiento_cae, total, monto_pagado, created_at, medio_pago, clientes(nombre, email, dni, cuit_receptor, condicion_iva_receptor, cliente_domicilios(calle, numero, piso_depto, ciudad, provincia, es_principal)), venta_items(cantidad, precio_unitario, subtotal, alicuota_iva, productos(nombre, sku))')
      .eq('id', ventaId).single()
    if (vErr) throw new Error(vErr.message)
    if (!venta?.cae) return null
    const { data: pv } = await supabase.from('puntos_venta_afip')
      .select('numero').eq('tenant_id', tenant!.id).eq('activo', true)
      .order('numero').limit(1).maybeSingle()
    const { data: cfgTenant } = await supabase.from('tenants')
      .select('razon_social_fiscal, cuit, domicilio_fiscal, condicion_iva_emisor, logo_url, ingresos_brutos, inicio_actividades, telefono, email, sitio_web, banco, cbu, alias_cbu, leyenda_comprobante')
      .eq('id', tenant!.id).single()
    const cli = (venta as any).clientes
    const formaPago = parseFormaPago((venta as any).medio_pago)
    // Saldo pendiente → QR de pago MercadoPago en el PDF (si el tenant tiene MP conectado)
    const saldo = Number(venta.total) - Number((venta as any).monto_pagado ?? 0)
    const pagoMpQr = saldo > 0.5 ? await crearPagoMpQR(ventaId, saldo) : null
    const data: FacturaPDFData = {
      tipo_comprobante:    (venta.tipo_comprobante ?? 'B').replace(/^Factura\s+/i, ''),
      numero_comprobante:  venta.numero_comprobante ?? venta.numero,
      punto_venta:         pv?.numero ?? 1,
      fecha:               venta.created_at,
      cae:                 venta.cae,
      vencimiento_cae:     venta.vencimiento_cae ?? '',
      emisor_razon_social: cfgTenant?.razon_social_fiscal ?? tenant?.nombre ?? '',
      emisor_cuit:         cfgTenant?.cuit ?? '',
      emisor_domicilio:    cfgTenant?.domicilio_fiscal,
      emisor_condicion_iva: cfgTenant?.condicion_iva_emisor ?? 'responsable_inscripto',
      emisor_logo_url:     (cfgTenant as any)?.logo_url ?? (tenant as any)?.logo_url ?? null,
      emisor_ingresos_brutos:    (cfgTenant as any)?.ingresos_brutos ?? null,
      emisor_inicio_actividades: (cfgTenant as any)?.inicio_actividades ?? null,
      emisor_telefono:     (cfgTenant as any)?.telefono ?? null,
      emisor_email:        (cfgTenant as any)?.email ?? null,
      emisor_sitio_web:    (cfgTenant as any)?.sitio_web ?? null,
      emisor_banco:        (cfgTenant as any)?.banco ?? null,
      emisor_cbu:          (cfgTenant as any)?.cbu ?? null,
      emisor_alias:        (cfgTenant as any)?.alias_cbu ?? null,
      emisor_leyenda:      (cfgTenant as any)?.leyenda_comprobante ?? null,
      receptor_nombre:     cli?.nombre ?? 'Consumidor Final',
      receptor_cuit_dni:   cli?.cuit_receptor ?? cli?.dni,
      receptor_condicion_iva: normalizarCondIVA(cli?.condicion_iva_receptor),
      receptor_domicilio:  composeDomicilioCliente(cli?.cliente_domicilios),
      items: ((venta as any).venta_items ?? []).map((i: any) => ({
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
    return { data, email: cli?.email ?? null }
  }

  async function accionFacturaPDF(ventaId: string, accion: 'descargar' | 'imprimir') {
    setDescargandoPdfVenta(true)
    try {
      const res = await buildFacturaPDFDataPorId(ventaId)
      if (res) await generarFacturaPDF(res.data, accion)
    } catch (e: any) {
      toast.error(`Error al generar PDF: ${e.message}`)
    } finally {
      setDescargandoPdfVenta(false)
    }
  }
  const descargarFacturaPDFVenta = () => ventaDetalle?.id && accionFacturaPDF(ventaDetalle.id, 'descargar')

  // Arma el PresupuestoPDFData (A4) para una venta en estado presupuesto ('pendiente').
  async function buildPresupuestoPDFDataPorId(ventaId: string): Promise<PresupuestoPDFData | null> {
    const { data: venta, error } = await supabase.from('ventas')
      .select('numero, presupuesto_numero, presupuesto_numero_sucursal, estado, sucursal_id, total, created_at, notas, clientes(nombre, cuit_receptor, dni, condicion_iva_receptor, cliente_domicilios(calle, numero, piso_depto, ciudad, provincia, es_principal)), venta_items(cantidad, precio_unitario, subtotal, productos(nombre, sku))')
      .eq('id', ventaId).single()
    if (error) throw new Error(error.message)
    if (!venta) return null
    const { data: cfgTenant } = await supabase.from('tenants')
      .select('razon_social_fiscal, cuit, domicilio_fiscal, condicion_iva_emisor, logo_url, ingresos_brutos, inicio_actividades, telefono, email, sitio_web, banco, cbu, alias_cbu, leyenda_comprobante')
      .eq('id', tenant!.id).single()
    const cli = (venta as any).clientes
    const validezDias = (tenant as any)?.presupuesto_validez_dias
    let validez: string | null = null
    if (validezDias && venta.created_at) {
      const d = new Date(venta.created_at); d.setDate(d.getDate() + Number(validezDias)); validez = d.toISOString()
    }
    return {
      numero:              formatTicket(venta),
      fecha:               venta.created_at,
      validez_hasta:       validez,
      emisor_razon_social: cfgTenant?.razon_social_fiscal ?? tenant?.nombre ?? '',
      emisor_cuit:         cfgTenant?.cuit ?? '',
      emisor_domicilio:    cfgTenant?.domicilio_fiscal,
      emisor_condicion_iva: cfgTenant?.condicion_iva_emisor ?? 'responsable_inscripto',
      emisor_logo_url:     (cfgTenant as any)?.logo_url ?? (tenant as any)?.logo_url ?? null,
      emisor_ingresos_brutos:    (cfgTenant as any)?.ingresos_brutos ?? null,
      emisor_inicio_actividades: (cfgTenant as any)?.inicio_actividades ?? null,
      emisor_telefono:     (cfgTenant as any)?.telefono ?? null,
      emisor_email:        (cfgTenant as any)?.email ?? null,
      emisor_sitio_web:    (cfgTenant as any)?.sitio_web ?? null,
      emisor_banco:        (cfgTenant as any)?.banco ?? null,
      emisor_cbu:          (cfgTenant as any)?.cbu ?? null,
      emisor_alias:        (cfgTenant as any)?.alias_cbu ?? null,
      emisor_leyenda:      (cfgTenant as any)?.leyenda_comprobante ?? null,
      receptor_nombre:     cli?.nombre ?? 'Consumidor Final',
      receptor_cuit_dni:   cli?.cuit_receptor ?? cli?.dni,
      receptor_condicion_iva: cli?.condicion_iva_receptor ? normalizarCondIVA(cli.condicion_iva_receptor) : null,
      receptor_domicilio:  composeDomicilioCliente(cli?.cliente_domicilios) ?? null,
      items: ((venta as any).venta_items ?? []).map((i: any) => ({
        codigo:          i.productos?.sku ?? null,
        descripcion:     i.productos?.nombre ?? 'Producto',
        cantidad:        Number(i.cantidad),
        precio_unitario: Number(i.precio_unitario),
        subtotal:        Number(i.subtotal),
      })),
      total: Number(venta.total),
      observaciones: venta.notas ?? null,
    }
  }

  async function accionPresupuestoPDF(ventaId: string, accion: 'descargar' | 'imprimir') {
    setDescargandoPresupuesto(true)
    try {
      const data = await buildPresupuestoPDFDataPorId(ventaId)
      if (data) await generarPresupuestoPDF(data, accion)
    } catch (e: any) {
      toast.error(`Error al generar el presupuesto: ${e.message}`)
    } finally {
      setDescargandoPresupuesto(false)
    }
  }

  // Arma el RemitoPDFData (nota de entrega, no fiscal) de una venta.
  async function buildRemitoPDFDataPorId(ventaId: string): Promise<RemitoPDFData | null> {
    const { data: venta, error } = await supabase.from('ventas')
      .select('numero, numero_sucursal, sucursal_id, estado, created_at, notas, clientes(nombre, cuit_receptor, dni, condicion_iva_receptor, cliente_domicilios(calle, numero, piso_depto, ciudad, provincia, es_principal)), venta_items(cantidad, productos(nombre, sku))')
      .eq('id', ventaId).single()
    if (error) throw new Error(error.message)
    if (!venta) return null
    const { data: cfgTenant } = await supabase.from('tenants')
      .select('razon_social_fiscal, cuit, domicilio_fiscal, condicion_iva_emisor, logo_url, ingresos_brutos, inicio_actividades, telefono, email, sitio_web, leyenda_comprobante')
      .eq('id', tenant!.id).single()
    const cli = (venta as any).clientes
    return {
      numero:              `R-${formatTicket(venta)}`,
      fecha:               venta.created_at,
      emisor_razon_social: cfgTenant?.razon_social_fiscal ?? tenant?.nombre ?? '',
      emisor_cuit:         cfgTenant?.cuit ?? '',
      emisor_domicilio:    cfgTenant?.domicilio_fiscal,
      emisor_condicion_iva: cfgTenant?.condicion_iva_emisor ?? 'responsable_inscripto',
      emisor_logo_url:     (cfgTenant as any)?.logo_url ?? (tenant as any)?.logo_url ?? null,
      emisor_ingresos_brutos:    (cfgTenant as any)?.ingresos_brutos ?? null,
      emisor_inicio_actividades: (cfgTenant as any)?.inicio_actividades ?? null,
      emisor_telefono:     (cfgTenant as any)?.telefono ?? null,
      emisor_email:        (cfgTenant as any)?.email ?? null,
      emisor_sitio_web:    (cfgTenant as any)?.sitio_web ?? null,
      emisor_leyenda:      (cfgTenant as any)?.leyenda_comprobante ?? null,
      receptor_nombre:     cli?.nombre ?? 'Consumidor Final',
      receptor_cuit_dni:   cli?.cuit_receptor ?? cli?.dni,
      receptor_condicion_iva: cli?.condicion_iva_receptor ? normalizarCondIVA(cli.condicion_iva_receptor) : null,
      receptor_domicilio:  composeDomicilioCliente(cli?.cliente_domicilios) ?? null,
      items: ((venta as any).venta_items ?? []).map((i: any) => ({
        codigo:      i.productos?.sku ?? null,
        descripcion: i.productos?.nombre ?? 'Producto',
        cantidad:    Number(i.cantidad),
      })),
      observaciones: venta.notas ?? null,
    }
  }

  async function accionRemitoPDF(ventaId: string, accion: 'descargar' | 'imprimir') {
    setDescargandoRemito(true)
    try {
      const data = await buildRemitoPDFDataPorId(ventaId)
      if (data) await generarRemitoPDF(data, accion)
    } catch (e: any) {
      toast.error(`Error al generar el remito: ${e.message}`)
    } finally {
      setDescargandoRemito(false)
    }
  }

  // Abre el modal de envío por email precargando el correo del cliente de la venta (editable).
  async function abrirEnviarFacturaEmail(ventaId: string) {
    setFacturaEmailModal({ ventaId })
    setFacturaEmailValue('')
    try {
      const { data } = await supabase.from('ventas')
        .select('clientes(email)').eq('id', ventaId).single()
      const em = (data as any)?.clientes?.email
      if (em) setFacturaEmailValue(em)
    } catch { /* si falla el prefill, el usuario igual puede tipear el correo */ }
  }

  // Envía la factura por email con el PDF adjunto (reusa el template factura_emitida)
  async function enviarFacturaEmail(ventaId: string, email: string) {
    email = email.trim()
    if (!email) { toast.error('Ingresá un email'); return }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast.error('Email inválido'); return }
    try {
      const res = await buildFacturaPDFDataPorId(ventaId)
      if (!res) return
      setEnviandoFacturaEmail(true)
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
            items: data.items.map(it => ({
              nombre: it.descripcion,
              cantidad: it.cantidad,
              precio_unitario: it.precio_unitario,
              subtotal: it.subtotal,
            })),
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
      setEnviandoFacturaEmail(false)
    }
  }

  const [combosActivosMulti, setCombosActivosMulti] = useState<{id: string; nombre: string; monto: number}[]>([])
  const autoMultiSig = useRef('')

  // Puntos de venta AFIP — carga lazy cuando se abre el modal de facturación
  const { data: puntosVentaAfip = [] } = useQuery({
    queryKey: ['puntos-venta-afip', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('puntos_venta_afip')
        .select('id, numero, nombre').eq('tenant_id', tenant!.id).eq('activo', true).order('numero')
      return data ?? []
    },
    enabled: !!tenant && (!!facturaModal || !!ncModal),
  })

  const { data: combosDisp = [] } = useQuery({
    queryKey: ['combos', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('combos')
        .select('id, nombre, descuento_pct, descuento_tipo, descuento_monto, combo_items(producto_id, cantidad)')
        .eq('tenant_id', tenant!.id).eq('activo', true)
      return data ?? []
    },
    enabled: !!tenant,
  })

  // G1/G2 — precios mayoristas por cantidad (producto_precios_mayorista). Mapa por producto.
  const { data: tiersMayoristaMap = {} } = useQuery({
    queryKey: ['precios-mayorista', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('producto_precios_mayorista')
        .select('producto_id, cantidad_minima, precio').eq('tenant_id', tenant!.id)
      const map: Record<string, { cantidad_minima: number; precio: number }[]> = {}
      for (const r of (data ?? []) as any[]) {
        (map[r.producto_id] ??= []).push({ cantidad_minima: r.cantidad_minima, precio: Number(r.precio) })
      }
      for (const k in map) map[k].sort((a, b) => a.cantidad_minima - b.cantidad_minima)
      return map
    },
    enabled: !!tenant,
  })

  // Precio efectivo de un ítem según su cantidad: tier mayorista con mayor cantidad_minima
  // que la cantidad satisfaga; si ninguno aplica, precio minorista (precio_unitario base).
  const precioTierEfectivo = (item: CartItem): number => {
    const cant = item.tiene_series ? item.series_seleccionadas.length : item.cantidad
    const tiers = item.tiers
    if (!tiers || tiers.length === 0) return item.precio_unitario
    // VF2/I2: la lista de precios por canal puede forzar minorista o mayorista
    const lista = reglaDe(canalPOS).lista_precio
    if (lista === 'minorista') return item.precio_unitario
    if (lista === 'mayorista') return tiers[tiers.length - 1]?.precio ?? item.precio_unitario  // mejor tier (asc)
    let precio = item.precio_unitario
    for (const t of tiers) if (cant >= t.cantidad_minima) precio = t.precio  // tiers ya viene asc
    return precio
  }

  const findCombo = (productoId: string, cantidad: number, item: CartItem) => {
    return (combosDisp as any[])
      .filter(c => {
        const items: {producto_id: string; cantidad: number}[] = c.combo_items ?? []
        if (items.length !== 1) return false
        const ci = items[0]
        if (ci.producto_id !== productoId || cantidad < ci.cantidad) return false
        const tipo = c.descuento_tipo ?? 'pct'
        if (tipo === 'pct' && item.descuento_tipo === 'pct' && item.descuento === c.descuento_pct) return false
        if (tipo === 'monto_ars' && item.descuento_tipo === 'monto' && item.descuento === c.descuento_monto) return false
        if (tipo === 'monto_usd' && item.descuento_tipo === 'monto' && item.descuento === Math.round(c.descuento_monto * (cotizacionUSD || 1))) return false
        return true
      })
      .sort((a: any, b: any) => (b.combo_items?.[0]?.cantidad ?? 0) - (a.combo_items?.[0]?.cantidad ?? 0))[0] ?? null
  }

  const comboDescLabel = (combo: any) => {
    const tipo = combo.descuento_tipo ?? 'pct'
    if (tipo === 'pct') return `${combo.descuento_pct}% off`
    if (tipo === 'monto_usd') return `USD ${combo.descuento_monto} off`
    return `$${combo.descuento_monto.toLocaleString('es-AR', { maximumFractionDigits: 0 })} off`
  }

  const aplicarCombo = (idx: number, combo: any) => {
    const item = cart[idx]
    const rows = calcularComboRows(item.cantidad, combo, cotizacionUSD || 1)
    const newItems: CartItem[] = rows.map(r => ({ ...item, cantidad: r.cantidad, descuento: r.descuento, descuento_tipo: r.descuento_tipo as DescTipo }))
    setCart(prev => [...prev.slice(0, idx), ...newItems, ...prev.slice(idx + 1)])
    const comboUnits = rows[0]?.cantidad ?? 0
    const rem = rows[1]?.cantidad ?? 0
    toast.success(`Combo aplicado: ${comboUnits} uds. con ${comboDescLabel(combo)}${rem > 0 ? ` + ${rem} sin descuento` : ''}`)
  }

  // Auto-aplicar combos cuando cambia el carrito
  const autoComboSig = useRef('')
  useEffect(() => {
    if (!combosDisp.length) return
    const sig = cart.map(i => `${i.producto_id}:${i.cantidad}:${i.descuento}:${i.descuento_tipo}`).join('|')
    if (sig === autoComboSig.current) return
    autoComboSig.current = sig

    // ── Single-SKU combos (combo_items.length === 1) ───────────────────────────
    const changes = new Map<string, CartItem[]>()
    const processed = new Set<string>()

    for (const item of cart) {
      if (item.tiene_series || processed.has(item.producto_id)) continue
      processed.add(item.producto_id)

      const productRows = cart.filter(r => r.producto_id === item.producto_id)
      const totalQty = productRows.reduce((s, r) => s + r.cantidad, 0)

      const singleCombos = (combosDisp as any[]).filter(c => (c.combo_items?.length ?? 0) === 1)
      const combo = singleCombos
        .filter(c => c.combo_items[0].producto_id === item.producto_id && totalQty >= c.combo_items[0].cantidad)
        .sort((a: any, b: any) => b.combo_items[0].cantidad - a.combo_items[0].cantidad)[0]

      if (!combo) {
        const tieneDescCombo = productRows.some(r => r.descuento > 0)
        if (tieneDescCombo) {
          changes.set(item.producto_id, productRows.map(r => ({ ...r, descuento: 0, descuento_tipo: 'pct' as DescTipo })))
          toast('Descuento de combo removido', { icon: 'ℹ️' })
        }
        const comboMasCercano = singleCombos
          .filter(c => c.combo_items[0].producto_id === item.producto_id && c.combo_items[0].cantidad > totalQty)
          .sort((a: any, b: any) => a.combo_items[0].cantidad - b.combo_items[0].cantidad)[0]
        if (comboMasCercano && comboMasCercano.combo_items[0].cantidad - totalQty === 1) {
          toast(`💡 Agregá 1 más: combo ${comboMasCercano.combo_items[0].cantidad}× con ${comboDescLabel(comboMasCercano)}`, { duration: 4000 })
        }
        continue
      }

      const comboData = { ...combo, cantidad: combo.combo_items[0].cantidad }
      const rows = calcularComboRows(totalQty, comboData, cotizacionUSD || 1)
      const target: CartItem[] = rows.map(r => ({ ...item, cantidad: r.cantidad, descuento: r.descuento, descuento_tipo: r.descuento_tipo as DescTipo }))

      const curSig = productRows.map(r => `${r.cantidad}:${r.descuento}:${r.descuento_tipo}`).sort().join(',')
      const tgtSig = target.map(r => `${r.cantidad}:${r.descuento}:${r.descuento_tipo}`).sort().join(',')
      if (curSig !== tgtSig) {
        changes.set(item.producto_id, target)
        toast.success(`Combo aplicado: ${combo.combo_items[0].cantidad}× con ${comboDescLabel(combo)}`)
      }
    }

    if (changes.size) {
      const done = new Set<string>()
      const newCart: CartItem[] = []
      for (const item of cart) {
        if (changes.has(item.producto_id) && !done.has(item.producto_id)) {
          done.add(item.producto_id)
          newCart.push(...changes.get(item.producto_id)!)
        } else if (!changes.has(item.producto_id)) {
          newCart.push(item)
        }
      }
      const newSig = newCart.map(i => `${i.producto_id}:${i.cantidad}:${i.descuento}:${i.descuento_tipo}`).join('|')
      autoComboSig.current = newSig
      setCart(newCart)
    }

    // ── Multi-SKU combos (combo_items.length > 1) ──────────────────────────────
    const multiCombos = (combosDisp as any[]).filter(c => (c.combo_items?.length ?? 0) > 1)
    const newMulti: {id: string; nombre: string; monto: number}[] = []
    for (const combo of multiCombos) {
      const allPresent = (combo.combo_items ?? []).every((ci: any) => {
        const qty = cart.filter(i => i.producto_id === ci.producto_id).reduce((s, i) => s + i.cantidad, 0)
        return qty >= ci.cantidad
      })
      if (allPresent) {
        const subtotalCombo = (combo.combo_items ?? []).reduce((s: number, ci: any) => {
          const cartItem = cart.find(i => i.producto_id === ci.producto_id)
          return s + (cartItem?.precio_unitario ?? 0) * ci.cantidad
        }, 0)
        const monto = calcularDescuentoComboMulti(combo, subtotalCombo, cotizacionUSD || 1)
        newMulti.push({ id: combo.id, nombre: combo.nombre, monto })
      } else {
        const totalFaltantes = (combo.combo_items ?? []).reduce((s: number, ci: any) => {
          const qty = cart.filter(i => i.producto_id === ci.producto_id).reduce((s2, i) => s2 + i.cantidad, 0)
          return s + Math.max(0, ci.cantidad - qty)
        }, 0)
        if (totalFaltantes === 1) {
          toast(`💡 Falta 1 producto para el combo "${combo.nombre}"`, { duration: 4000 })
        }
      }
    }
    const multiSig = newMulti.map(c => `${c.id}:${c.monto.toFixed(2)}`).join('|')
    if (multiSig !== autoMultiSig.current) {
      autoMultiSig.current = multiSig
      setCombosActivosMulti(newMulti)
    }
  }, [cart, combosDisp, cotizacionUSD])

  const splitItem = (idx: number) => {
    setCart(prev => {
      const item = prev[idx]
      if (item.cantidad <= 1) return prev
      const reduced = { ...item, cantidad: item.cantidad - 1 }
      const newRow: CartItem = { ...item, cantidad: 1, descuento: 0, descuento_tipo: 'pct' }
      return [...prev.slice(0, idx), reduced, newRow, ...prev.slice(idx + 1)]
    })
  }

  const getItemSubtotal = (item: CartItem) => {
    const cant = item.tiene_series ? item.series_seleccionadas.length : item.cantidad
    const base = precioTierEfectivo(item) * cant
    if (item.descuento_tipo === 'pct') return base * (1 - item.descuento / 100)
    return Math.max(0, base - item.descuento)
  }

  const subtotal = cart.reduce((acc, item) => acc + getItemSubtotal(item), 0)
  // C3/G3 (relevamiento Ventas): SOLO DUEÑO/SUPERVISOR/ADMIN pueden aplicar descuentos
  // (por ítem o global). Cualquier otro rol los tiene bloqueados. El SUPERVISOR además
  // está sujeto al límite de % configurado por el tenant.
  const ROLES_DESCUENTO = ['DUEÑO', 'SUPERVISOR', 'ADMIN', 'SUPER_USUARIO']
  const descuentoBloqueadoCajero = !ROLES_DESCUENTO.includes(user?.rol ?? '')
  const descTotalVal = parseFloat(descuentoTotal) || 0
  const descTotalMonto = descuentoTotalTipo === 'pct' ? subtotal * descTotalVal / 100 : descTotalVal
  const descCombosMulti = combosActivosMulti.reduce((s, c) => s + c.monto, 0)
  // Redondear a 2 decimales para evitar discrepancias de display vs validación
  const total = Math.round(Math.max(0, subtotal - descTotalMonto - descCombosMulti) * 100) / 100

  // Auto-calcular costo de envío por KM
  const costoEnvioNum = requiereEnvio ? (parseFloat(costoEnvioVenta) || 0) : 0
  const totalConEnvio = total + costoEnvioNum

  // Medios de pago helpers
  const updateMedioPago = (idx: number, field: keyof MedioPagoItem, value: string) =>
    setMediosPago(prev => prev.map((m, i) => i === idx ? { ...m, [field]: value } : m))
  const addMedioPago = () => setMediosPago(prev => [...prev, { tipo: '', monto: '' }])
  const removeMedioPago = (idx: number) => setMediosPago(prev => prev.filter((_, i) => i !== idx))

  const serializeMediosPago = (items: MedioPagoItem[], totalVenta: number): string | null => {
    const filled = items.filter(m => m.tipo)
    if (filled.length === 0) return null
    if (filled.length === 1 && !filled[0].monto)
      return JSON.stringify([{ tipo: filled[0].tipo, monto: totalVenta }])
    return JSON.stringify(filled.map(m => ({ tipo: m.tipo, monto: parseFloat(m.monto) || 0 })))
  }

  const formatMedioPago = (raw: string | null | undefined): string => {
    if (!raw) return ''
    try {
      const arr = JSON.parse(raw) as { tipo: string; monto: number }[]
      if (Array.isArray(arr))
        return arr.map(p => p.monto ? `${p.tipo} $${p.monto.toLocaleString('es-AR', { maximumFractionDigits: 0 })}` : p.tipo).join(' + ')
    } catch {}
    return raw
  }

  const totalAsignado = mediosPago.reduce((acc, m) => acc + (parseFloat(m.monto) || 0), 0)
  const totalFaltante = total - totalAsignado

  // ISS-090: CC como método de pago parcial (derivado de mediosPago)
  const montoCC = mediosPago.filter(m => m.tipo === 'Cuenta Corriente').reduce((acc, m) => acc + (parseFloat(m.monto) || 0), 0)
  const modoCC = montoCC > 0
  // E2: crédito a favor aplicado como pago (cuenta como pagado, NO entra a caja)
  const montoCredito = mediosPago.filter(m => m.tipo === 'Crédito a favor').reduce((acc, m) => acc + (parseFloat(m.monto) || 0), 0)

  const registrarVenta = async (estado: 'pendiente' | 'reservada' | 'despachada') => {
    if (esContador) { toast.error('El CONTADOR tiene acceso de solo lectura en Ventas.'); return }
    if (moduloSoloLectura(user, 'ventas')) { toast.error('Tu rol tiene acceso de solo lectura en Ventas.'); return }
    // A2 — durante un conteo wall-to-wall bloqueante no se puede mover stock (reserva/despacho).
    // El presupuesto ('pendiente') sí se permite porque no afecta stock.
    if (estado !== 'pendiente' && conteoBloqueante) {
      toast.error('Hay un conteo wall-to-wall en curso en esta sucursal. No se pueden reservar ni despachar ventas hasta que se cierre.')
      return
    }
    if (cart.length === 0) { toast.error('Agregá al menos un producto'); return }
    for (const item of cart) {
      if (item.tiene_series && item.series_seleccionadas.length === 0) {
        toast.error(`Seleccioná las series para ${item.nombre}`); return
      }
      if (item.tiene_series && item.series_seleccionadas.length !== item.cantidad) {
        toast.error(`Seleccioná ${item.cantidad} serie(s) para ${item.nombre}`); return
      }
      // Validar cantidad válida (NaN o ≤ 0 no deben llegar al DB)
      if (!item.cantidad || item.cantidad <= 0 || isNaN(item.cantidad)) {
        toast.error(`Cantidad inválida para "${item.nombre}". Corregila antes de guardar.`); return
      }
    }
    // G3 + J2c — validación de descuentos por rol/canal, con override por clave maestra
    const rol = user?.rol
    const reglaCanal = reglaDe(canalPOS)  // VF2/I2: reglas según clasificación del canal de venta
    const hayDescuentoItem = cart.some(i => i.descuento > 0)
    const hayDescuentoGlobal = descTotalVal > 0
    const maxSupervisor = (tenant as any)?.descuento_max_supervisor_pct
    const maxCanal = reglaCanal.descuento_max_pct
    // Detectar la primera violación de descuento (si la hay)
    let violacionDesc: string | null = null
    if (descuentoBloqueadoCajero && (hayDescuentoItem || hayDescuentoGlobal)) {
      violacionDesc = 'tu rol no puede aplicar descuentos'
    } else if (rol === 'SUPERVISOR' && maxSupervisor != null) {
      const itemExc = cart.find(i => i.descuento_tipo === 'pct' && i.descuento > maxSupervisor)
      if (itemExc) violacionDesc = `${itemExc.descuento}% supera el límite del SUPERVISOR (${maxSupervisor}%)`
      else if (descuentoTotalTipo === 'pct' && descTotalVal > maxSupervisor) violacionDesc = `el descuento global supera el límite del SUPERVISOR (${maxSupervisor}%)`
    }
    if (!violacionDesc && maxCanal != null && (hayDescuentoItem || hayDescuentoGlobal)) {
      const itemExc = cart.find(i => i.descuento_tipo === 'pct' && i.descuento > maxCanal)
      if (itemExc) violacionDesc = `${itemExc.descuento}% supera el máximo de este canal (${maxCanal}%)`
      else if (descuentoTotalTipo === 'pct' && descTotalVal > maxCanal) violacionDesc = `el descuento global supera el máximo de este canal (${maxCanal}%)`
    }
    // Si hay violación: con clave maestra configurada se puede autorizar (override); sin clave, bloquea.
    if (violacionDesc && !overrideDescuento) {
      if (claveMaestraConfigurada) {
        pedirClaveMaestra(`Autorizar descuento (${violacionDesc})`, () => {
          setOverrideDescuento(true)
          setTimeout(() => registrarVentaRef.current?.(estado), 0)
        })
      } else {
        toast.error(`Descuento no autorizado: ${violacionDesc}. Pedí autorización a un DUEÑO/SUPERVISOR.`)
      }
      return
    }

    // Cliente obligatorio según config del tenant
    // H5 (VF1): si el negocio factura y la venta NO es a Consumidor Final, el cliente
    // es obligatorio (para poder facturar a un cliente identificado). Si CF no está
    // permitido en Config, también es obligatorio.
    const ventaCF = permiteCF && esConsumidorFinal
    const clienteRequerido = clienteObligatorio === 'siempre'
      || (clienteObligatorio === 'reservas' && (estado === 'pendiente' || estado === 'reservada'))
      || (factHabilitada && !ventaCF)
      || !permiteCF
      || !!reglaCanal.requiere_cliente
    if (clienteRequerido && !clienteId) {
      toast.error(factHabilitada && !ventaCF
        ? 'Para facturar a un cliente registrado, seleccioná o creá el cliente (o marcá la venta como Consumidor Final).'
        : 'Registrá o seleccioná un cliente para continuar.')
      return
    }
    // ISS-090: CC como método de pago parcial
    if (modoCC) {
      if (!clienteId) { toast.error('Seleccioná un cliente para usar cuenta corriente.'); return }
      if (!clienteCCEnabled) { toast.error('Este cliente no tiene cuenta corriente habilitada.'); return }
    }
    // CL2 — morosidad (B4) + enforcement de límite de CC (B1).
    // bloqueo_total aplica a cualquier venta; bloqueo_cc/enforcement solo a la parte CC.
    const morosidadPol = (tenant as any)?.cc_morosidad_politica ?? 'bloqueo_cc'
    if (estado !== 'pendiente' && clienteId && (modoCC || morosidadPol === 'bloqueo_total')) {
      const { data: ccData } = await supabase.rpc('cliente_cc_estado', { p_cliente: clienteId })
      const est = (ccData?.[0] ?? { deuda_total: 0, deuda_vencida: 0 }) as { deuda_total: number; deuda_vencida: number }
      const fmtCC = (n: number) => '$' + Math.round(n).toLocaleString('es-AR')
      // B4 — morosidad (lógica pura testeable en ccLogic.ts)
      const moros = evaluarMorosidad({ deudaVencida: est.deuda_vencida, politica: morosidadPol, modoCC })
      if (moros === 'bloquear_total') {
        toast.error(`Cliente con deuda vencida (${fmtCC(est.deuda_vencida)}). No puede comprar hasta saldar.`); return
      }
      if (moros === 'bloquear_cc') {
        toast.error(`Cliente con deuda vencida (${fmtCC(est.deuda_vencida)}). No puede sumar a cuenta corriente; cobrá por otro medio.`); return
      }
      // B1 — enforcement de límite (solo sobre la parte que va a CC)
      if (modoCC && montoCC > 0.5) {
        const { data: cli } = await supabase.from('clientes').select('limite_credito').eq('id', clienteId).maybeSingle()
        const limite = cli?.limite_credito ?? (tenant as any)?.limite_cc_default ?? null
        const enf = evaluarLimiteCC({ deudaTotal: est.deuda_total, montoCC, limite, politica: (tenant as any)?.cc_enforcement_politica ?? 'avisar' })
        if (enf.supera) {
          const msg = `Esta venta deja la cuenta corriente en ${fmtCC(est.deuda_total + montoCC)}, supera el límite de ${fmtCC(limite as number)}.`
          if (enf.accion === 'bloquear') { toast.error(msg + ' Operación bloqueada.'); return }
          if (enf.accion === 'avisar' && !confirm(msg + ' ¿Continuar igual?')) return
        }
      }
    }
    // E2: crédito a favor — requiere cliente y no puede superar el saldo disponible
    if (montoCredito > 0.001) {
      if (!clienteId) { toast.error('Seleccioná un cliente para usar su crédito a favor.'); return }
      if (montoCredito > clienteCredito + 0.5) {
        toast.error(`El crédito a favor disponible es $${clienteCredito.toLocaleString('es-AR', { maximumFractionDigits: 0 })}. No podés aplicar más que eso.`)
        return
      }
    }
    // E6 — seña obligatoria + mínima % al reservar (la seña es dinero real, excluye CC)
    if (estado === 'reservada' && ((tenant as any)?.reserva_sena_obligatoria ?? true)) {
      const senaReal = mediosPago.filter(m => m.tipo !== 'Cuenta Corriente').reduce((acc, m) => acc + (parseFloat(m.monto) || 0), 0)
      const minPct = parseFloat((tenant as any)?.reserva_sena_minima_pct ?? 0) || 0
      const senaMinima = minPct > 0 ? total * minPct / 100 : 0
      if (senaReal < 0.5) {
        toast.error('No se puede reservar sin seña. Cobrá una seña para confirmar la reserva.')
        return
      }
      if (senaMinima > 0 && senaReal + 0.5 < senaMinima) {
        toast.error(`La seña mínima es ${minPct}% del total ($${senaMinima.toLocaleString('es-AR', { maximumFractionDigits: 0 })}). Cobraste $${senaReal.toLocaleString('es-AR', { maximumFractionDigits: 0 })}.`)
        return
      }
    }
    // Validar medios de pago (CC se excluye; los demás deben cubrir totalSinCC)
    // ISS-105: validar contra totalConEnvio (incluye costo de envío)
    const mediosSinCC = mediosPago.filter(m => m.tipo !== 'Cuenta Corriente')
    const totalSinCC = Math.max(0, totalConEnvio - montoCC)
    // Full CC (montoCC cubre todo): no hay otros medios que validar
    const errorPago = modoCC && totalSinCC < 0.5
      ? null
      : validarMediosPago(estado, modoCC ? mediosSinCC : mediosPago, modoCC ? totalSinCC : totalConEnvio)
    if (errorPago) { toast.error(errorPago); return }
    // Validar que hay sucursal seleccionada cuando hay varias sucursales
    if (sucursales.length > 1 && !sucursalId) {
      toast.error('Seleccioná una sucursal antes de registrar la venta. El stock se descuenta por sucursal.')
      return
    }
    // H4 (VF1): reserva y venta directa SIEMPRE exigen caja abierta — incluso 100% CC.
    // Solo el presupuesto (estado 'pendiente') puede crearse sin caja. Se quitó la
    // excepción que permitía despachar/reservar 100% CC sin caja (control de ingresos).
    if (estado === 'despachada' || estado === 'reservada') {
      if (sesionesAbiertas.length === 0) {
        toast.error('No hay caja abierta. Abrí una caja antes de registrar ventas o reservas (incluso en cuenta corriente).')
        return
      }
      if (sesionesAbiertas.length > 1 && !sesionCajaId) {
        toast.error('Hay varias cajas abiertas. Seleccioná en cuál registrar la venta.')
        return
      }
    }
    const vuelto = calcularVuelto(mediosPago.filter(m => m.tipo !== 'Cuenta Corriente'), totalConEnvio - montoCC)
    // ISS-105: efectivo en caja se calcula contra totalConEnvio (costo de envío incluido)
    const montoEfectivoCaja = calcularEfectivoCaja(mediosPago.filter(m => m.tipo !== 'Cuenta Corriente'), totalConEnvio - montoCC)
    setSaving(true)
    const stockAlertas: Array<{ nombre: string; sku: string; stock_actual: number; stock_minimo: number }> = []
    let ventaIdCreada: string | null = null
    try {
      // Crear venta — si hay preVentaId (QR MP ya generado) se usa ese UUID
      const { data: venta, error: ventaError } = await supabase.from('ventas').insert({
        ...(preVentaId ? { id: preVentaId } : {}),
        tenant_id: tenant!.id,
        cliente_id: clienteId || null,
        cliente_nombre: clienteNombre || null,
        cliente_telefono: clienteTelefono || null,
        consumidor_final: permiteCF && esConsumidorFinal && !clienteId,  // H5
        estado,
        subtotal,
        descuento_total: descuentoTotalTipo === 'pct' ? descTotalVal : 0,
        total,
        // ISS-090: CC como medio de pago parcial; ISS-105: monto_pagado incluye costo envío
        medio_pago: serializeMediosPago(mediosPago, totalConEnvio),
        monto_pagado: estado === 'pendiente' ? 0 : (() => {
          const filled = mediosPago.filter(m => m.tipo)
          // Auto-complete: único medio sin monto → se cobra el total
          if (filled.length === 1 && !filled[0].monto) {
            return filled[0].tipo !== 'Cuenta Corriente' ? totalConEnvio : 0
          }
          return Math.min(
            filled.filter(m => m.tipo !== 'Cuenta Corriente').reduce((s, m) => s + (parseFloat(m.monto) || 0), 0),
            totalConEnvio
          )
        })(),
        es_cuenta_corriente: modoCC,
        // B3 — vencimiento de la venta CC = hoy + cc_dias_vencimiento (si está configurado)
        ...(modoCC && montoCC > 0.5 && ((tenant as any)?.cc_dias_vencimiento ?? null) != null
          ? { fecha_vencimiento_cc: new Date(Date.now() + ((tenant as any).cc_dias_vencimiento) * 86400000).toISOString().slice(0, 10) }
          : {}),
        notas: notas || null,
        usuario_id: user?.id,
        sucursal_id: sucursalId || null,
        origen: canalPOS,
        // ISS-086: info de cuotas (primer tarjeta crédito encontrada)
        ...(Object.values(cuotasSeleccion).find(c => c.cuotas > 0)
          ? { cuotas_info: Object.values(cuotasSeleccion).find(c => c.cuotas > 0) }
          : {}),
        ...(costoEnvioNum > 0 ? { costo_envio: costoEnvioNum } : {}),
        ...(estado === 'despachada' ? { despachado_at: new Date().toISOString() } : {}),
        ...(estado === 'reservada' ? { reservado_at: new Date().toISOString() } : {}),
      }).select().single()
      if (ventaError) throw ventaError
      ventaIdCreada = venta.id

      // CL4/C1 — notificar al cliente el alta de deuda en cuenta corriente (event-driven, fire-and-forget)
      if (modoCC && montoCC > 0.5 && clienteId) {
        void notificarRegistroDeudaCC(tenant, clienteId, clienteNombre || 'cliente', montoCC)
      }

      // J2c/J1 — si la venta usó override de descuento autorizado por clave maestra, dejar traza
      if (overrideDescuento) {
        logVentaAuditoria(venta.id, 'override_descuento', {
          descuento_global_pct: descuentoTotalTipo === 'pct' ? descTotalVal : null,
          items_con_descuento: cart.filter(i => i.descuento > 0).map(i => ({ nombre: i.nombre, descuento: i.descuento })),
        })
        setOverrideDescuento(false)
      }
      // K2 — alerta de margen negativo (venta despachada con costo > total)
      if (estado === 'despachada' && ((tenant as any)?.alerta_margen_negativo ?? true)) {
        const costoTotal = cart.reduce((acc, i) => acc + ((i.precio_costo || 0) * (i.tiene_series ? i.series_seleccionadas.length : i.cantidad)), 0)
        if (costoTotal > total + 0.5) {
          notificarRolesVentas('warning', `Venta #${venta.numero} con margen negativo`,
            `Se cerró la venta #${venta.numero} por $${total.toLocaleString('es-AR', { maximumFractionDigits: 0 })} con un costo de $${costoTotal.toLocaleString('es-AR', { maximumFractionDigits: 0 })}.`)
        }
      }

      // Si el QR de MP fue pagado antes de crear la venta, aplicar monto_pagado del log
      if (preVentaId) {
        const { data: preLog } = await supabase
          .from('ventas_externas_logs')
          .select('payload')
          .eq('tenant_id', tenant!.id)
          .eq('integracion', 'MercadoPago')
          .eq('webhook_external_id', `mp-preventa-${preVentaId}`)
          .maybeSingle()
        if (preLog?.payload) {
          const p = preLog.payload as any
          await supabase.from('ventas').update({
            monto_pagado: Math.min(Number(p.monto ?? 0), total),
            id_pago_externo: String(p.payment_id),
            money_release_date: p.money_release_date ?? null,
          }).eq('id', venta.id)
        }
      }

      // ─── Fase 1: batch insert venta_items ────────────────────────────────────
      const itemPayloads = cart.map(item => {
        const cant = item.tiene_series ? item.series_seleccionadas.length : item.cantidad
        const itemSubtotal = getItemSubtotal(item)
        const ivaRate = item.alicuota_iva ?? 21
        const ivaMonto = ivaRate > 0 ? itemSubtotal - itemSubtotal / (1 + ivaRate / 100) : 0
        let lineaId: string | null = item.linea_id ?? null
        if (item.tiene_series && item.series_seleccionadas.length > 0) {
          const first = item.series_disponibles.find((s: any) => s.id === item.series_seleccionadas[0])
          lineaId = first?.linea_id ?? null
          if (!item.series_seleccionadas.every(sid => item.series_disponibles.find((d: any) => d.id === sid)?.linea_id === lineaId))
            lineaId = null
        }
        // Mig 156: persistir el plan de LPN del carrito (no-series) para honrarlo al
        // despachar una reserva. `manual` = LPN elegido explícitamente por el operador.
        const manualIds = new Set(item.lpn_manual_ids ?? [])
        const lpnPlan = (!item.tiene_series && (item.lpn_fuentes ?? []).length > 0)
          ? item.lpn_fuentes!.map(f => ({ linea_id: f.linea_id, lpn: f.lpn ?? null, cantidad: f.cantidad, manual: f.linea_id ? manualIds.has(f.linea_id) : false }))
          : null
        return {
          tenant_id: tenant!.id, venta_id: venta.id, producto_id: item.producto_id, linea_id: lineaId,
          cantidad: cant, precio_unitario: precioTierEfectivo(item), precio_costo_historico: item.precio_costo || null,
          descuento: item.descuento_tipo === 'pct' ? item.descuento : 0, subtotal: itemSubtotal,
          alicuota_iva: ivaRate, iva_monto: parseFloat(ivaMonto.toFixed(2)),
          lpn_plan: lpnPlan,
        }
      })
      const { data: insertedItems, error: itemsError } = await supabase.from('venta_items').insert(itemPayloads).select()
      if (itemsError) {
        // Rollback: eliminar el header de venta para no dejar una venta sin líneas
        await supabase.from('ventas').delete().eq('id', venta.id)
        throw itemsError
      }

      // ─── Fase 2: series + lineas en paralelo por item (distintos productos) ──
      // ISS-075: acumular el desglose de despacho por LPN/ubicación (solo despachada)
      const despachoRows: any[] = []
      const _hoy = new Date().toISOString().split('T')[0]
      // Procesamiento SECUENCIAL (no Promise.all): si el mismo producto está en varias
      // líneas del carrito, el rebaje en paralelo leería el mismo stock y se pisaría (race).
      for (let i = 0; i < cart.length; i++) {
        const item = cart[i]
        const cant = item.tiene_series ? item.series_seleccionadas.length : item.cantidad
        const ventaItemId = insertedItems![i].id

        if (item.tiene_series && item.series_seleccionadas.length > 0) {
          const { error: seriesError } = await supabase.from('venta_series').insert(
            item.series_seleccionadas.map(sid => ({
              tenant_id: tenant!.id, venta_id: venta.id, venta_item_id: ventaItemId, serie_id: sid,
            }))
          )
          if (seriesError) throw seriesError
          if (estado === 'reservada')
            await supabase.from('inventario_series').update({ reservado: true }).in('id', item.series_seleccionadas)
          else if (estado === 'despachada') {
            await supabase.from('inventario_series').update({ activo: false, reservado: false }).in('id', item.series_seleccionadas)
            // ISS-075: una fila de despacho por serie (snapshot LPN/ubicación/serie)
            for (const sid of item.series_seleccionadas) {
              const s = item.series_disponibles.find((d: any) => d.id === sid)
              despachoRows.push({
                tenant_id: tenant!.id, venta_id: venta.id, venta_item_id: ventaItemId, producto_id: item.producto_id,
                linea_id: s?.linea_id ?? null, lpn: s?.lpn ?? null,
                ubicacion_id: s?.ubicacion_id ?? null, ubicacion_nombre: s?.ubicacion_nombre ?? null,
                cantidad: 1, nro_serie: s?.nro_serie ?? null, origen: 'manual',
              })
            }
          }
        }

        if (!item.tiene_series && (estado === 'reservada' || estado === 'despachada')) {
          const sortLineas = getRebajeSort(item.regla_inventario, tenant!.regla_inventario, item.tiene_vencimiento)
          let lineasQ = soloUbicado(
            supabase.from('inventario_lineas')
              .select('id, lpn, cantidad, cantidad_reservada, created_at, fecha_vencimiento, ubicacion_id, ubicaciones(nombre, prioridad, disponible_surtido)')
              .eq('producto_id', item.producto_id).eq('activo', true).gt('cantidad', 0)
          )
          // Filtrar ESTRICTAMENTE por sucursal activa para no tocar stock de otra sucursal
          if (sucursalId) lineasQ = lineasQ.eq('sucursal_id', sucursalId)
          const { data: lineasRaw } = await lineasQ
          const lineas = (lineasRaw ?? [])
            .filter((l: any) => l.ubicaciones?.disponible_surtido !== false)
            .filter((l: any) => !l.fecha_vencimiento || l.fecha_vencimiento >= _hoy)
            .sort(sortLineas)
          const stockDisp = lineas.reduce((sum: number, l: any) => sum + Math.max(0, l.cantidad - (l.cantidad_reservada ?? 0)), 0)
          if (stockDisp < cant) throw new Error(`Stock insuficiente para "${item.nombre}" en esta sucursal. Disponible: ${stockDisp}, pedido: ${cant}`)

          // Consume hasta `qty` unidades de una línea concreta. Muta el objeto in-memory
          // para que la fase de fallback no vuelva a contar lo ya consumido.
          const consumirLinea = async (linea: any, qty: number, origen: 'manual' | 'auto'): Promise<number> => {
            if (qty <= 0) return 0
            if (estado === 'reservada') {
              const areservar = Math.min((linea.cantidad ?? 0) - (linea.cantidad_reservada ?? 0), qty)
              if (areservar <= 0) return 0
              await supabase.from('inventario_lineas').update({ cantidad_reservada: (linea.cantidad_reservada ?? 0) + areservar }).eq('id', linea.id)
              linea.cantidad_reservada = (linea.cantidad_reservada ?? 0) + areservar
              return areservar
            }
            const disponible = (linea.cantidad ?? 0) - (linea.cantidad_reservada ?? 0)
            const rebajar = Math.min(disponible, qty)
            if (rebajar <= 0) return 0
            const nuevaCant = linea.cantidad - rebajar
            await supabase.from('inventario_lineas').update({ cantidad: nuevaCant, activo: nuevaCant > 0 }).eq('id', linea.id)
            linea.cantidad = nuevaCant
            // ISS-075: una fila de despacho por LPN consumido (snapshot + origen manual/auto)
            despachoRows.push({
              tenant_id: tenant!.id, venta_id: venta.id, venta_item_id: ventaItemId, producto_id: item.producto_id,
              linea_id: linea.id, lpn: linea.lpn ?? null,
              ubicacion_id: linea.ubicacion_id ?? null, ubicacion_nombre: linea.ubicaciones?.nombre ?? null,
              cantidad: rebajar, nro_serie: null, origen,
            })
            return rebajar
          }

          let restante = cant
          // Fase A — ISS-075: seguir el plan de LPN del carrito (item.lpn_fuentes) con cantidades exactas.
          // origen='manual' SOLO para los LPN que el operador eligió explícitamente; los que el plan
          // autocompletó por la regla de rebaje van como 'auto'.
          const manualIds = new Set(item.lpn_manual_ids ?? [])
          const lineaById: Record<string, any> = Object.fromEntries(lineas.map((l: any) => [l.id, l]))
          for (const f of (item.lpn_fuentes ?? [])) {
            if (restante <= 0) break
            const linea = lineaById[f.linea_id]
            if (!linea) continue   // la línea elegida ya no tiene stock → se cubre en la Fase B
            restante -= await consumirLinea(linea, Math.min(f.cantidad, restante), manualIds.has(f.linea_id) ? 'manual' : 'auto')
          }
          // Fase B — fallback por orden de sort (regla de rebaje del sistema). origen='auto'.
          for (const linea of lineas) {
            if (restante <= 0) break
            restante -= await consumirLinea(linea, restante, 'auto')
          }
          if (restante > 0.0001) throw new Error(`Stock insuficiente para "${item.nombre}" en esta sucursal.`)
        }
      }

      // ISS-075: persistir el desglose de despacho (fire-and-forget, no bloquea la venta)
      // Gate por toggle del tenant (Config → Inventario → Trazabilidad de asignación de stock)
      const trazaAsignacionOn = (tenant as any)?.trazabilidad_asignacion !== false
      if (trazaAsignacionOn && estado === 'despachada' && despachoRows.length > 0) {
        void supabase.from('venta_item_despachos').insert(despachoRows).then(({ error }) => {
          if (error) console.warn('No se pudo registrar el desglose de despacho:', error.message)
        })
      }

      // ─── Fase 3: movimientos de stock (solo despachada) ──────────────────────
      // IMPORTANTE: el trigger `lineas_recalcular_stock` ya recalculó productos.stock_actual
      // tras la Fase 2. NO lo actualizamos manualmente acá (hacerlo pisaba el valor correcto
      // con un cálculo paralelo → race). Solo registramos los movimientos para el historial,
      // agregando cantidades por producto (si el mismo producto está en varias líneas del carrito).
      if (estado === 'despachada') {
        const cantPorProducto: Record<string, number> = {}
        for (const item of cart.filter(i => !i.tiene_series)) {
          cantPorProducto[item.producto_id] = (cantPorProducto[item.producto_id] ?? 0) + item.cantidad
        }
        const productIds = Object.keys(cantPorProducto)
        if (productIds.length > 0) {
          // Estados vendibles del tenant — para calcular el stock por sucursal del movimiento.
          // En básico el stock no tiene estado → vendibleIds vacío = sin filtro (cuenta todo el activo).
          const { data: evData } = await supabase.from('estados_inventario').select('id').eq('tenant_id', tenant!.id).eq('es_disponible_venta', true)
          const vendibleIds = modoAvanzado ? (evData ?? []).map((e: any) => e.id) : []
          const { data: prodsData } = await supabase.from('productos')
            .select('id, stock_minimo, nombre, sku').in('id', productIds)
          const prodMap = Object.fromEntries((prodsData ?? []).map(p => [p.id, p]))
          const movimientosRows: any[] = []
          for (const productoId of productIds) {
            const prodData = prodMap[productoId]
            if (!prodData) continue
            const cant = cantPorProducto[productoId]
            // ISS-075: stock_antes/despues = stock VENDIBLE en la sucursal de la venta (no el total global)
            const stockDespues = await stockVendibleSucursal(productoId, sucursalId, vendibleIds)
            const stockAntes = stockDespues + cant
            movimientosRows.push({
              tenant_id: tenant!.id, producto_id: productoId, tipo: 'rebaje', cantidad: cant,
              stock_antes: stockAntes, stock_despues: stockDespues,
              motivo: `Venta #${venta.numero}`, usuario_id: user?.id, venta_id: venta.id,
              sucursal_id: sucursalId || null,
            })
            if (stockDespues <= (prodData.stock_minimo ?? 0))
              stockAlertas.push({ nombre: prodData.nombre, sku: prodData.sku ?? '', stock_actual: stockDespues, stock_minimo: prodData.stock_minimo ?? 0 })
          }
          if (movimientosRows.length > 0)
            await supabase.from('movimientos_stock').insert(movimientosRows)
        }
      }

      // Emails transaccionales (fire-and-forget, no bloquean el flujo)
      const { data: { user: authUser } } = await supabase.auth.getUser()
      const ownerEmail = authUser?.email
      if (ownerEmail) {
        if (estado === 'despachada') {
          supabase.functions.invoke('send-email', {
            body: {
              type: 'venta_confirmada',
              to: ownerEmail,
              data: {
                numero: venta.numero,
                negocio: tenant!.nombre,
                total,
                items: cart.map(i => ({ nombre: i.nombre, cantidad: i.tiene_series ? i.series_seleccionadas.length : i.cantidad, subtotal: getItemSubtotal(i) })),
                medio_pago: serializeMediosPago(mediosPago, total) ?? '',
              },
            },
          }).catch(() => {/* silencioso */})
        }
        for (const alerta of stockAlertas) {
          supabase.functions.invoke('send-email', {
            body: { type: 'alerta_stock', to: ownerEmail, data: { ...alerta, negocio: tenant!.nombre } },
          }).catch(() => {/* silencioso */})
        }
      }

      logActividad({ entidad: 'venta', entidad_id: venta.id, entidad_nombre: `Venta #${venta.numero ?? ''}`, accion: 'crear', valor_nuevo: estado, pagina: '/ventas', tipo_transaccion: 'venta', sucursal_id: sucursalId || null })
      // E2: consumir crédito a favor aplicado (movimiento negativo en el ledger)
      if (estado !== 'pendiente' && montoCredito > 0.001 && clienteId) {
        await supabase.from('cliente_creditos').insert({
          tenant_id: tenant!.id,
          cliente_id: clienteId,
          monto: -(Math.round(montoCredito * 100) / 100),
          origen: 'consumo_venta',
          venta_id: venta.id,
          nota: `Aplicado en Venta #${venta.numero}`,
          usuario_id: user?.id,
        })
        setClienteCredito(c => Math.max(0, Math.round((c - montoCredito) * 100) / 100))
      }
      if (estado === 'despachada' && montoEfectivoCaja > 0 && sesionCajaId) {
        void supabase.from('caja_movimientos').insert({
          tenant_id: tenant!.id,
          sesion_id: sesionCajaId,
          tipo: 'ingreso',
          concepto: `Venta #${venta.numero}`,
          monto: montoEfectivoCaja,
          usuario_id: user?.id,
        }).then(() => qc.invalidateQueries({ queryKey: ['caja-sesiones-abiertas', tenant?.id] }))
      }
      // Registros informativos para medios no-efectivo — un insert por método (no afectan saldo)
      const sesionInformativo = sesionCajaId ?? ((sesionesAbiertas as any[])[0]?.id ?? null)
      if (estado === 'despachada' && sesionInformativo) {
        for (const mp of mediosPago) {
          if (!mp.tipo || mp.tipo === 'Efectivo' || mp.tipo === 'Cuenta Corriente' || mp.tipo === 'Crédito a favor' || !mp.tipo.trim()) continue
          const montoMp = parseFloat(mp.monto) || 0
          if (montoMp <= 0.01) continue
          const { error: errInfo } = await supabase.from('caja_movimientos').insert({
            tenant_id: tenant!.id,
            sesion_id: sesionInformativo,
            tipo: 'ingreso_informativo',
            concepto: `[${mp.tipo}] Venta #${venta.numero}`,
            monto: montoMp,
            cuenta_origen_id: cuentaOrigenDeMetodo(mp.tipo),
            usuario_id: user?.id,
          })
          if (errInfo) console.error('[caja] ingreso_informativo error:', errInfo)
        }
      }
      // Seña en caja: registrar efectivo cobrado al crear la reserva (fire-and-forget)
      if (estado === 'reservada' && montoEfectivoCaja > 0 && sesionCajaId) {
        void supabase.from('caja_movimientos').insert({
          tenant_id: tenant!.id,
          sesion_id: sesionCajaId,
          tipo: 'ingreso_reserva',
          concepto: `Seña Venta #${venta.numero}`,
          monto: montoEfectivoCaja,
          usuario_id: user?.id,
        }).then(() => qc.invalidateQueries({ queryKey: ['caja-sesiones-abiertas', tenant?.id] }))
      }
      // Seña no-efectivo: un ingreso_informativo por método (fire-and-forget)
      if (estado === 'reservada' && sesionCajaId) {
        for (const mp of mediosPago) {
          if (!mp.tipo || mp.tipo === 'Efectivo' || mp.tipo === 'Crédito a favor' || !mp.tipo.trim()) continue
          const montoMp = parseFloat(mp.monto) || 0
          if (montoMp <= 0.01) continue
          void supabase.from('caja_movimientos').insert({
            tenant_id: tenant!.id,
            sesion_id: sesionCajaId,
            tipo: 'ingreso_informativo',
            concepto: `[${mp.tipo}] Seña Venta #${venta.numero}`,
            monto: montoMp,
            cuenta_origen_id: cuentaOrigenDeMetodo(mp.tipo),
            usuario_id: user?.id,
          })
        }
      }
      const msg = estado === 'despachada' ? 'Venta finalizada' : estado === 'reservada' ? 'Venta reservada' : 'Presupuesto guardado'
      toast.success(msg)
      if (estado === 'despachada') reproducirSonidoCobro()  // M4 — sonido al cobrar
      if (estado !== 'pendiente') {
        setTicketVenta({ ...venta, items: cart.map(i => ({ ...i, subtotal: getItemSubtotal(i) })), vuelto: vuelto > 0.5 ? vuelto : 0 })
      }
      // Prompt facturación si la venta fue despachada y está habilitada
      if (estado === 'despachada' && factHabilitada) {
        triggerFacturaModal(venta.id, venta.numero ?? 0, Number(venta.total ?? 0))
      }
      // Auto-crear envío si el toggle está activo
      if (requiereEnvio && estado !== 'pendiente') {
        // ISS-156/175: el costo del envío que paga el CLIENTE ya entra con la venta.
        // - Envío propio: no hay courier a quien pagar → siempre saldado.
        // - Envío por tercero: si la venta se despachó (cobrada al 100%), el costo ya se cobró → saldado.
        //   Si es reserva (pago parcial), queda pendiente hasta el despacho.
        const envioYaSaldado = envioTransporte === 'propio' || (estado === 'despachada' && costoEnvioNum > 0)
        // ISS-178: snapshot del rango horario elegido (si hay)
        const rangosTenant: Array<{ desde: string; hasta: string }> = Array.isArray((tenant as any)?.envio_rangos_horarios)
          ? (tenant as any).envio_rangos_horarios
          : []
        const rangoElegido = envioRangoHorarioIdx !== '' ? rangosTenant[Number(envioRangoHorarioIdx)] : null
        await supabase.from('envios').insert({
          tenant_id: tenant!.id,
          venta_id: venta.id,
          estado: 'pendiente',
          canal: canalPOS || 'POS',
          created_by: user!.id,
          sucursal_id: sucursalId || null,
          destino_descripcion: envioDestinoVenta || null,
          costo_cotizado: costoEnvioNum > 0 ? costoEnvioNum : null,
          costo_pagado: envioYaSaldado,
          fecha_entrega_acordada: envioFechaVenta || null,
          rango_horario_desde: rangoElegido?.desde || null,
          rango_horario_hasta: rangoElegido?.hasta || null,
          courier: envioTransporte === 'tercero' ? (envioCourier || null) : 'Envío propio',
          servicio: envioTransporte === 'tercero' ? (envioServicio.trim() || null) : null,
        })
        qc.invalidateQueries({ queryKey: ['envios'] })
        toast('Envío creado en estado pendiente', { icon: '📦' })
      }

      setCart([]); setClienteId(null); setClienteSearch(''); setClienteNombre(''); setClienteTelefono('')
      setClienteCCEnabled(false); setEsConsumidorFinal(true); setOverrideDescuento(false)
      setMediosPago([{ tipo: '', monto: '' }]); setCommittedAsignado(0); setCuotasSeleccion({}); setDescuentoTotal(''); setNotas(''); setModoVenta('despachada'); setCanalPOS('POS')
      setRequiereEnvio(false)
      setEnvioTransporte('propio'); setEnvioCourier(''); setEnvioServicio('')
      setCostoEnvioVenta(''); setEnvioTipoVenta('monto'); setEnvioKmVenta('')
      setPrecioPorKmVenta(''); setEnvioDestinoVenta(''); setEnvioOrigenVenta(''); setEnvioRangoHorarioIdx('')
      setPreVentaId(null)
      if (cartDraftKey) localStorage.removeItem(cartDraftKey)
      setScannerOpen(false)
      qc.invalidateQueries({ queryKey: ['ventas'] })
      qc.invalidateQueries({ queryKey: ['productos'] })
      qc.invalidateQueries({ queryKey: ['inventario_lineas_all'] })
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] })
      setTab('nueva')
    } catch (err: any) {
      // Si la venta fue creada pero algo falló después (ej: stock insuficiente), eliminarla para evitar
      // que quede registrada en cuenta corriente sin haberse concretado realmente
      if (ventaIdCreada) {
        await supabase.from('ventas').delete().eq('id', ventaIdCreada).then(() => {}, () => {})
        ventaIdCreada = null
      }
      toast.error(err.message ?? 'Error al registrar la venta')
    } finally {
      setSaving(false)
    }
  }

  const guardarMontoPagado = async () => {
    const nuevo = parseFloat(editMontoPagado)
    if (isNaN(nuevo) || nuevo < 0) { toast.error('Monto inválido'); return }
    if (nuevo > ventaDetalle!.total) { toast.error(`No puede superar el total ($${ventaDetalle!.total?.toLocaleString('es-AR', { maximumFractionDigits: 0 })})`); return }
    setSavingMontoPagado(true)
    try {
      const { error } = await supabase.from('ventas').update({ monto_pagado: nuevo }).eq('id', ventaDetalle!.id)
      if (error) throw error
      setVentaDetalle((prev: any) => ({ ...prev, monto_pagado: nuevo }))
      qc.invalidateQueries({ queryKey: ['ventas'] })
      setEditandoPago(false)
      toast.success('Pago actualizado')
    } catch (err: any) {
      toast.error(err.message ?? 'Error al actualizar')
    } finally {
      setSavingMontoPagado(false)
    }
  }

  const modificarReserva = async () => {
    if (!ventaDetalle) return
    if (!confirm('¿Modificar esta reserva? Se cancelará la reserva actual y los productos volverán al carrito para que crees una nueva.')) return
    // Cancelar la reserva actual (libera stock reservado) y registrar motivo
    await cambiarEstado.mutateAsync({ ventaId: ventaDetalle.id, nuevoEstado: 'cancelada' }).catch(() => null)
    const notaAnterior = ventaDetalle.notas ? `${ventaDetalle.notas} | ` : ''
    void supabase.from('ventas').update({
      notas: `${notaAnterior}Cancelada por modificación de productos — ${new Date().toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })} por ${user?.nombre_display ?? 'usuario'}`
    }).eq('id', ventaDetalle.id)
    // Pre-poblar el carrito con los items de la venta
    const itemsBase: CartItem[] = (ventaDetalle.venta_items ?? [])
      .filter((item: any) => item.producto_id)
      .map((item: any) => ({
        producto_id: item.producto_id,
        nombre: item.productos?.nombre ?? '',
        sku: item.productos?.sku ?? '',
        precio_unitario: item.precio_unitario,
        precio_costo: item.productos?.precio_costo ?? 0,
        cantidad: item.cantidad,
        descuento: item.descuento ?? 0,
        descuento_tipo: 'pct' as DescTipo,
        tiene_series: item.productos?.tiene_series ?? false,
        tiene_vencimiento: item.productos?.tiene_vencimiento ?? false,
        regla_inventario: item.productos?.regla_inventario ?? null,
        series_seleccionadas: [],
        series_disponibles: [],
      }))
    // Para productos serializados, cargar series disponibles (activas y no reservadas)
    const cartConSeries = await Promise.all(itemsBase.map(async (cartItem) => {
      if (!cartItem.tiene_series) return cartItem
      const { data: lineasData } = await supabase.from('inventario_lineas')
        .select('id, lpn, inventario_series(id, nro_serie, activo, reservado)')
        .eq('producto_id', cartItem.producto_id)
        .eq('tenant_id', tenant!.id)
        .eq('activo', true)
      const seriesDisp = (lineasData ?? []).flatMap((l: any) =>
        (l.inventario_series ?? [])
          .filter((s: any) => s.activo && !s.reservado)
          .map((s: any) => ({ ...s, linea_id: l.id, lpn: l.lpn }))
      )
      return { ...cartItem, series_disponibles: seriesDisp }
    }))
    setCart(cartConSeries)
    if (ventaDetalle.cliente_id) { setClienteId(ventaDetalle.cliente_id); setClienteNombre(ventaDetalle.cliente_nombre ?? ''); setClienteTelefono(ventaDetalle.cliente_telefono ?? '') }
    // Restaurar medios de pago ya cobrados (monto_pagado de la reserva original)
    if (ventaDetalle.monto_pagado > 0) {
      const pagosRestaurados = restaurarMediosPago(ventaDetalle.medio_pago)
      if (pagosRestaurados.length > 0) setMediosPago(pagosRestaurados)
    }
    setModoVenta('reservada')
    setVentaDetalle(null)
    setTab('nueva')
    toast.success('Reserva cancelada — editá el carrito y volvé a reservar')
  }

  const actualizarPrecios = async () => {
    if (!ventaDetalle || !tenant) return
    setActualizandoPrecios(true)
    try {
      const productoIds = (ventaDetalle.venta_items ?? []).map((i: any) => i.producto_id).filter(Boolean)
      const { data: prods } = await supabase
        .from('productos').select('id, precio_venta, alicuota_iva').in('id', productoIds)
      if (!prods) throw new Error('No se pudieron cargar los precios')
      const precioMap: Record<string, { precio_venta: number; alicuota_iva: number }> = {}
      for (const p of prods) precioMap[p.id] = { precio_venta: p.precio_venta ?? 0, alicuota_iva: p.alicuota_iva ?? 21 }
      let nuevoTotal = 0
      for (const item of (ventaDetalle.venta_items ?? [])) {
        const prod = precioMap[item.producto_id]
        if (!prod) continue
        const nuevoPrecio = prod.precio_venta
        const descu = item.descuento ?? 0
        const nuevoSubtotal = nuevoPrecio * item.cantidad * (1 - descu / 100)
        const ivaRate = prod.alicuota_iva / 100
        const nuevoIva = nuevoSubtotal - nuevoSubtotal / (1 + ivaRate)
        nuevoTotal += nuevoSubtotal
        await supabase.from('venta_items').update({
          precio_unitario: nuevoPrecio,
          subtotal: nuevoSubtotal,
          alicuota_iva: prod.alicuota_iva,
          iva_monto: nuevoIva,
        }).eq('id', item.id)
      }
      const { error } = await supabase.from('ventas').update({
        total: nuevoTotal,
        updated_at: new Date().toISOString(),
      }).eq('id', ventaDetalle.id)
      if (error) throw error
      toast.success('Precios actualizados. Ya podés convertir el presupuesto.')
      setVentaDetalle(null)
      qc.invalidateQueries({ queryKey: ['ventas'] })
    } catch (e: any) {
      toast.error('Error: ' + (e.message ?? 'No se pudieron actualizar los precios'))
    } finally {
      setActualizandoPrecios(false)
    }
  }

  const abrirModalDevolucion = (venta: any) => {
    if (esContador) { toast.error('El CONTADOR tiene acceso de solo lectura en Ventas.'); return }
    // VF2/I2: plazo de devolución según la clasificación del canal de la venta
    const reglaDev = reglaDe(venta.origen)
    if (reglaDev.devolucion_dias != null) {
      const base = new Date(venta.updated_at ?? venta.created_at ?? Date.now())
      const dias = Math.floor((Date.now() - base.getTime()) / 86_400_000)
      if (dias > reglaDev.devolucion_dias) {
        toast.error(`El plazo de devolución de este canal es de ${reglaDev.devolucion_dias} días y ya pasaron ${dias}.`)
        return
      }
    }
    // VF5/H1 — edición/quita de ítems post-cobro: requiere autorización SUPERVISOR/DUEÑO.
    // Roles autorizados pasan directo; el resto (CAJERO, etc.) necesita la clave maestra
    // de un DUEÑO/SUPERVISOR para autorizar (si no hay clave configurada, se bloquea).
    const abrir = () => {
      const items = (venta.venta_items ?? []).map((item: any) => ({
        venta_item_id: item.id,
        producto_id: item.producto_id,
        nombre: item.productos?.nombre ?? '',
        cantidad_original: item.cantidad,
        precio_unitario: item.precio_unitario,
        tiene_series: (item.productos?.tiene_series ?? false),
        venta_series: (item.venta_series ?? []).map((vs: any) => ({
          serie_id: vs.serie_id,
          nro_serie: vs.inventario_series?.nro_serie ?? '',
        })),
        cantidad_devolver: item.tiene_series ? 0 : item.cantidad,
        series_seleccionadas: [],
      }))
      setDevItems(items)
      setDevMotivo('')
      setDevMediosPago([{ tipo: '', monto: '' }])
      setDevCajaSesionId(sesionesAbiertas.length === 1 ? (sesionesAbiertas[0] as any).id : '')
      setDevDestinoStock('dev')
      setDevolucionVenta(venta)
    }
    const rolesAutorizan = ['DUEÑO', 'SUPERVISOR', 'ADMIN', 'SUPER_USUARIO']
    if (rolesAutorizan.includes(user?.rol ?? '')) { abrir(); return }
    if (!claveMaestraConfigurada) {
      toast.error('Solo DUEÑO/SUPERVISOR/ADMIN pueden devolver o editar una venta cobrada. Configurá una clave maestra para autorizar a otros roles.')
      return
    }
    pedirClaveMaestra('Autorizar devolución/edición de una venta cobrada', abrir)
  }

  // ── Canales de ventas ──────────────────────────────────────────────────────
  const { data: canalStats = [] } = useQuery({
    queryKey: ['canal-stats', tenant?.id, sucursalId],
    queryFn: async () => {
      const desde = new Date()
      desde.setDate(desde.getDate() - 30)
      let q = supabase.from('ventas')
        .select('origen, total, estado')
        .eq('tenant_id', tenant!.id)
        .neq('estado', 'cancelada')
        .gte('created_at', desde.toISOString())
      q = applyFilter(q)
      const { data } = await q
      const map: Record<string, { count: number; total: number }> = {}
      for (const v of data ?? []) {
        const o = (v.origen as string) ?? 'POS'
        if (!map[o]) map[o] = { count: 0, total: 0 }
        map[o].count++
        map[o].total += Number(v.total ?? 0)
      }
      return Object.entries(map)
        .map(([origen, s]) => ({ origen, ...s }))
        .sort((a, b) => b.total - a.total)
    },
    enabled: !!tenant && tab === 'canales',
  })

  const { data: canalVentasRaw = [], isLoading: loadingCanal } = useQuery({
    queryKey: ['canal-ventas', tenant?.id, sucursalId, canalFiltro, canalEstado, canalDesde, canalHasta],
    queryFn: async () => {
      let q = supabase.from('ventas')
        .select('id, numero, estado, total, monto_pagado, origen, created_at, despachado_at, cliente_nombre, medio_pago, tracking_id, notas, venta_items(cantidad, precio_unitario, productos(nombre, sku))')
        .eq('tenant_id', tenant!.id)
        .order('created_at', { ascending: false })
        .limit(200)
      q = applyFilter(q)
      if (canalFiltro) q = q.eq('origen', canalFiltro)
      if (canalEstado) q = q.eq('estado', canalEstado)
      if (canalDesde) q = q.gte('created_at', canalDesde)
      if (canalHasta) q = q.lte('created_at', canalHasta + 'T23:59:59')
      const { data } = await q
      return data ?? []
    },
    enabled: !!tenant && tab === 'canales',
  })

  // Filtro client-side para búsqueda por texto
  const canalVentas = canalSearch.trim()
    ? (canalVentasRaw as any[]).filter((v: any) => {
        const s = canalSearch.toLowerCase()
        const matchVenta = String(v.numero).includes(s)
        const matchCliente = (v.cliente_nombre ?? '').toLowerCase().includes(s)
        const matchTracking = (v.tracking_id ?? '').toLowerCase().includes(s)
        const matchItem = (v.venta_items ?? []).some((i: any) =>
          (i.productos?.nombre ?? '').toLowerCase().includes(s) ||
          (i.productos?.sku ?? '').toLowerCase().includes(s)
        )
        return matchVenta || matchCliente || matchTracking || matchItem
      })
    : canalVentasRaw

  // Enter global → Venta directa (solo cuando no hay input/select/button focuseado)
  const registrarVentaRef = useRef<(estado: 'pendiente' | 'reservada' | 'despachada') => Promise<void>>()
  registrarVentaRef.current = registrarVenta
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return
      const tag = (document.activeElement as HTMLElement)?.tagName
      if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(tag ?? '')) return
      if (tab === 'nueva' && modoVenta === 'despachada' && cart.length > 0 && !saving) {
        registrarVentaRef.current?.('despachada')
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [tab, modoVenta, cart.length, saving])

  const procesarDevolucion = async () => {
    if (!devolucionVenta || !tenant) return
    const itemsADevolver = devItems.filter(i =>
      i.tiene_series ? i.series_seleccionadas.length > 0 : i.cantidad_devolver > 0
    )
    if (itemsADevolver.length === 0) {
      toast.error('Seleccioná al menos un ítem a devolver')
      return
    }

    // Validar que existe ubicación y estado de devolución configurados
    const { data: ubicDevData } = await supabase.from('ubicaciones')
      .select('id').eq('tenant_id', tenant.id).eq('es_devolucion', true).single()
    if (!ubicDevData) {
      toast.error('Configurá una ubicación de devolución en Configuración → Ubicaciones antes de continuar')
      return
    }
    const { data: estadoDevData } = await supabase.from('estados_inventario')
      .select('id').eq('tenant_id', tenant.id).eq('es_devolucion', true).single()
    if (!estadoDevData) {
      toast.error('Configurá un estado de devolución en Configuración → Estados antes de continuar')
      return
    }
    const ubicDevId = ubicDevData.id
    const estadoDevId = estadoDevData.id

    // A7: si el operador eligió "vendible", buscar primer estado disponible para la venta
    // (la línea queda sin ubicación — el dueño después la mueve si quiere). Solo aplica
    // a items no serializados; los serializados re-activan a su línea original siempre.
    let estadoVendibleId: string | null = null
    if (devDestinoStock === 'vendible') {
      const { data: estadoVendData } = await supabase.from('estados_inventario')
        .select('id').eq('tenant_id', tenant.id).eq('es_disponible_venta', true).limit(1).maybeSingle()
      if (!estadoVendData) {
        toast.error('No hay estado disponible para venta configurado. Cargá uno en Configuración → Estados o elegí "Dejar en DEV".')
        return
      }
      estadoVendibleId = estadoVendData.id
    }

    // Calcular monto total de la devolución
    const montoTotal = itemsADevolver.reduce((acc, i) => {
      const cant = i.tiene_series ? i.series_seleccionadas.length : i.cantidad_devolver
      return acc + i.precio_unitario * cant
    }, 0)

    // Validar medio de pago si hay monto
    const mediosValidos = devMediosPago.filter(m => m.tipo && parseFloat(m.monto) > 0)
    const totalMedios = mediosValidos.reduce((a, m) => a + parseFloat(m.monto), 0)
    const hayEfectivo = mediosValidos.some(m => m.tipo === 'Efectivo')

    if (montoTotal > 0 && Math.abs(totalMedios - montoTotal) > 0.5) {
      toast.error(`Los medios de devolución ($${totalMedios.toLocaleString('es-AR', { maximumFractionDigits: 0 })}) no cubren el total ($${montoTotal.toLocaleString('es-AR', { maximumFractionDigits: 0 })})`)
      return
    }
    if (hayEfectivo) {
      // L1 — si hay efectivo, debe haber caja elegida (selector explícito o fallback a la activa)
      const cajaParaEgreso = devCajaSesionId || sesionCajaId
      if (!cajaParaEgreso) {
        toast.error('No hay caja abierta. Abrí una caja antes de devolver en efectivo.')
        return
      }
      if (sesionesAbiertas.length > 1 && !devCajaSesionId) {
        toast.error('Hay varias cajas abiertas. Seleccioná en cuál registrar el egreso.')
        return
      }
    }

    setDevSaving(true)
    let devId: string | null = null
    try {
      // 1. Calcular número NC si es facturada
      let numero_nc: string | null = null
      if (devolucionVenta.estado === 'facturada') {
        const { count } = await supabase.from('devoluciones')
          .select('id', { count: 'exact', head: true })
          .eq('venta_id', devolucionVenta.id)
        numero_nc = `NC-${devolucionVenta.numero}-${(count ?? 0) + 1}`
      }

      // 2. Insertar devolución
      const { data: dev, error: devError } = await supabase.from('devoluciones').insert({
        tenant_id: tenant.id,
        venta_id: devolucionVenta.id,
        numero_nc,
        origen: devolucionVenta.estado as 'despachada' | 'facturada',
        motivo: devMotivo || null,
        monto_total: montoTotal,
        medio_pago: mediosValidos.length > 0 ? JSON.stringify(mediosValidos.map(m => ({ tipo: m.tipo, monto: parseFloat(m.monto) }))) : null,
        created_by: user?.id,
      }).select().single()
      if (devError) throw devError
      devId = dev.id

      // VF5/J1 — auditoría: si la venta era facturada, la devolución genera una NC interna (no fiscal)
      logVentaAuditoria(devolucionVenta.id, devolucionVenta.estado === 'facturada' ? 'nc_interna' : 'devolucion', {
        numero_nc, monto: montoTotal, motivo: devMotivo || null,
        items: itemsADevolver.map(i => ({ nombre: i.nombre, cantidad: i.tiene_series ? i.series_seleccionadas.length : i.cantidad_devolver })),
      })

      // Trazabilidad-extendida: una transacción de devolución agrupa todos los ítems reintegrados.
      const txDev = nuevaTransaccion()

      // 3. Procesar cada ítem
      for (const item of itemsADevolver) {
        const cantDev = item.tiene_series ? item.series_seleccionadas.length : item.cantidad_devolver

        if (item.tiene_series) {
          // Reactivar series originales
          await supabase.from('inventario_series')
            .update({ activo: true, reservado: false })
            .in('id', item.series_seleccionadas)
          // Buscar la linea de la primera serie para saber dónde está
          const { data: serieData } = await supabase.from('inventario_series')
            .select('linea_id').eq('id', item.series_seleccionadas[0]).single()
          if (serieData?.linea_id) {
            await supabase.from('inventario_lineas')
              .update({ activo: true })
              .eq('id', serieData.linea_id)
          }
          // Insertar devolucion_item sin linea_nueva (la serie ya existe)
          await supabase.from('devolucion_items').insert({
            devolucion_id: dev.id,
            producto_id: item.producto_id,
            cantidad: cantDev,
            precio_unitario: item.precio_unitario,
          })
          // Recalcular stock manualmente (trigger solo se ejecuta en UPDATE de inventario_series)
          const { data: prodData } = await supabase.from('productos').select('stock_actual').eq('id', item.producto_id).single()
          if (prodData) {
            await supabase.from('productos').update({ stock_actual: prodData.stock_actual + cantDev }).eq('id', item.producto_id)
          }
          logActividad({
            entidad: 'venta', entidad_id: devolucionVenta.id, entidad_nombre: `Venta #${devolucionVenta.numero ?? ''}`,
            accion: 'editar', campo: 'devolución', valor_anterior: item.nombre, valor_nuevo: `${cantDev} u${numero_nc ? ` · ${numero_nc}` : ''}`,
            pagina: '/ventas', transaccion_id: txDev, tipo_transaccion: 'devolucion',
            producto_id: item.producto_id, sucursal_id: (devolucionVenta as any).sucursal_id ?? null,
          })
        } else {
          // No serializado: crear nueva inventario_lineas.
          // A7: si devDestinoStock === 'vendible', la línea va al stock disponible (sin ubicación
          // específica, el operador la mueve después). Si no, va a la ubicación DEV para revisión.
          const lineaPayload: any = {
            tenant_id: tenant.id,
            producto_id: item.producto_id,
            cantidad: cantDev,
            notas: `Devolución de venta #${devolucionVenta.numero}${devDestinoStock === 'vendible' ? ' — reintegrado a stock vendible' : ''}`,
          }
          if (devDestinoStock === 'vendible' && estadoVendibleId) {
            lineaPayload.estado_id = estadoVendibleId
            // ubicacion_id queda null → aparece en alerta "Inventario sin ubicación"
          } else {
            lineaPayload.ubicacion_id = ubicDevId
            lineaPayload.estado_id = estadoDevId
          }
          const { data: linea, error: lineaErr } = await supabase.from('inventario_lineas').insert(lineaPayload).select().single()
          if (lineaErr) throw lineaErr
          // Movimiento de ingreso
          const { data: prodData } = await supabase.from('productos').select('stock_actual').eq('id', item.producto_id).single()
          if (prodData) {
            await supabase.from('movimientos_stock').insert({
              tenant_id: tenant.id,
              producto_id: item.producto_id,
              tipo: 'ingreso',
              cantidad: cantDev,
              stock_antes: prodData.stock_actual,
              stock_despues: prodData.stock_actual + cantDev,
              motivo: `Devolución venta #${devolucionVenta.numero}`,
              usuario_id: user?.id,
              linea_id: linea.id,
              venta_id: devolucionVenta.id,
            })
          }
          // Insertar devolucion_item con referencia a la nueva linea
          await supabase.from('devolucion_items').insert({
            devolucion_id: dev.id,
            producto_id: item.producto_id,
            cantidad: cantDev,
            precio_unitario: item.precio_unitario,
            inventario_linea_nueva_id: linea.id,
          })
          logActividad({
            entidad: 'venta', entidad_id: devolucionVenta.id, entidad_nombre: `Venta #${devolucionVenta.numero ?? ''}`,
            accion: 'editar', campo: 'devolución',
            valor_anterior: item.nombre,
            valor_nuevo: `${cantDev} u${numero_nc ? ` · ${numero_nc}` : ''}${devDestinoStock === 'vendible' ? ' · reintegrado vendible' : ' · a revisión'}`,
            pagina: '/ventas', transaccion_id: txDev, tipo_transaccion: 'devolucion',
            producto_id: item.producto_id, lpn: linea.lpn ?? null, sucursal_id: (devolucionVenta as any).sucursal_id ?? null,
          })
        }
      }

      // 4. Egreso en caja si hay efectivo (L1: usar caja seleccionada explícitamente para el egreso)
      const cajaParaEgreso = devCajaSesionId || sesionCajaId
      if (hayEfectivo && cajaParaEgreso) {
        const montoEfectivo = mediosValidos
          .filter(m => m.tipo === 'Efectivo')
          .reduce((a, m) => a + parseFloat(m.monto), 0)
        void supabase.from('caja_movimientos').insert({
          tenant_id: tenant.id,
          sesion_id: cajaParaEgreso,
          tipo: 'egreso',
          concepto: `Devolución venta #${devolucionVenta.numero}${numero_nc ? ` · ${numero_nc}` : ''}`,
          monto: montoEfectivo,
          cuenta_origen_id: cuentaOrigenDeMetodo('Efectivo'),
          usuario_id: user?.id,
        })
      }

      // Marcar venta como "devuelta" si el total devuelto cubre el 100% del total
      const { data: todasDev } = await supabase
        .from('devoluciones')
        .select('monto_total')
        .eq('venta_id', devolucionVenta.id)
      const totalDevuelto = (todasDev ?? []).reduce((acc, d) => acc + Number(d.monto_total), 0)
      if (totalDevuelto >= Number(devolucionVenta.total) - 0.5) {
        await supabase.from('ventas').update({ estado: 'devuelta' }).eq('id', devolucionVenta.id)
      }

      toast.success(`Devolución procesada${numero_nc ? ` · ${numero_nc}` : ''}`)
      qc.invalidateQueries({ queryKey: ['ventas'] })
      qc.invalidateQueries({ queryKey: ['productos'] })
      qc.invalidateQueries({ queryKey: ['inventario_lineas_all'] })

      // K2 — alertas: cliente/producto con > N devoluciones en M días (fire-and-forget)
      const N_dev = (tenant as any)?.alerta_devoluciones_n
      if (N_dev != null) {
        const M_dev = (tenant as any)?.alerta_devoluciones_dias ?? 30
        const desdeISO = new Date(Date.now() - M_dev * 86_400_000).toISOString()
        const ventaDev = devolucionVenta
        const items = itemsADevolver
        void (async () => {
          if (ventaDev.cliente_id) {
            const { count } = await supabase.from('devoluciones')
              .select('id, ventas!inner(cliente_id)', { count: 'exact', head: true })
              .eq('tenant_id', tenant!.id).eq('ventas.cliente_id', ventaDev.cliente_id).gte('created_at', desdeISO)
            if ((count ?? 0) >= N_dev) notificarRolesVentas('warning', 'Cliente con muchas devoluciones',
              `${ventaDev.cliente_nombre ?? 'Un cliente'} acumula ${count} devoluciones en los últimos ${M_dev} días.`)
          }
          for (const item of items) {
            const { count } = await supabase.from('devolucion_items')
              .select('id, devoluciones!inner(created_at, tenant_id)', { count: 'exact', head: true })
              .eq('producto_id', item.producto_id).eq('devoluciones.tenant_id', tenant!.id).gte('devoluciones.created_at', desdeISO)
            if ((count ?? 0) >= N_dev) notificarRolesVentas('warning', 'Producto con muchas devoluciones',
              `"${item.nombre}" acumula ${count} devoluciones en los últimos ${M_dev} días.`)
          }
        })()
      }

      // Mostrar comprobante
      setDevComprobante({
        numero_nc,
        venta_numero: devolucionVenta.numero,
        origen: devolucionVenta.estado,
        motivo: devMotivo,
        items: itemsADevolver.map(i => ({
          nombre: i.nombre,
          cantidad: i.tiene_series ? i.series_seleccionadas.length : i.cantidad_devolver,
          precio_unitario: i.precio_unitario,
        })),
        monto_total: montoTotal,
        medio_pago: mediosValidos,
        created_at: new Date().toISOString(),
      })
      setDevolucionVenta(null)
    } catch (err: any) {
      // Rollback manual: eliminar el header de devolución si ya se insertó
      if (devId) {
        await supabase.from('devoluciones').delete().eq('id', devId)
      }
      toast.error(err.message ?? 'Error al procesar devolución')
    } finally {
      setDevSaving(false)
    }
  }

  const cambiarEstado = useMutation({
    mutationFn: async ({ ventaId, nuevoEstado, saldoMediosPago, cancelOpts }: { ventaId: string; nuevoEstado: EstadoVenta; saldoMediosPago?: MedioPagoItem[]; cancelOpts?: { penalidadPct: number; destino: 'devolucion' | 'credito'; clienteId?: string | null; motivo?: string; observacion?: string } }) => {
      const venta = ventas.find((v: any) => v.id === ventaId)
      if (!venta) throw new Error('Venta no encontrada')

      if (nuevoEstado === 'despachada' || nuevoEstado === 'reservada') {
        if (sesionesAbiertas.length === 0) throw new Error('No hay caja abierta. Abrí una caja antes de continuar.')
        if (nuevoEstado === 'despachada' && sesionesAbiertas.length > 1 && !sesionCajaId)
          throw new Error('Hay varias cajas abiertas. Seleccioná en cuál registrar la venta desde el checkout.')
      }

      if (nuevoEstado === 'despachada') {
        const errorDespacho = validarDespacho(Number(venta.total ?? 0), Number(venta.monto_pagado ?? 0), saldoMediosPago)
        if (errorDespacho) throw new Error(errorDespacho)
      }

      const { data: items } = await supabase.from('venta_items')
        .select('*, venta_series(serie_id), productos(tiene_series, tiene_vencimiento, regla_inventario)')
        .eq('venta_id', ventaId)

      if (nuevoEstado === 'reservada') {
        // Reservar series y cantidad en líneas
        for (const item of items ?? []) {
          if ((item.productos as any)?.tiene_series) {
            const serieIds = (item.venta_series ?? []).map((s: any) => s.serie_id)
            await supabase.from('inventario_series').update({ reservado: true }).in('id', serieIds)
          } else {
            const prod = item.productos as any
            const sortLineas = getRebajeSort(prod?.regla_inventario, tenant!.regla_inventario, prod?.tiene_vencimiento ?? false)
            const { data: lineasRaw } = await soloUbicado(
              supabase.from('inventario_lineas')
                .select('id, cantidad, cantidad_reservada, created_at, fecha_vencimiento, ubicaciones(prioridad, disponible_surtido)')
                .eq('producto_id', item.producto_id).eq('activo', true).gt('cantidad', 0)
            )
            const _hoyStr = new Date().toISOString().split('T')[0]
            const lineas = (lineasRaw ?? [])
              .filter((l: any) => l.ubicaciones?.disponible_surtido !== false)
              .filter((l: any) => !l.fecha_vencimiento || l.fecha_vencimiento >= _hoyStr)
              .sort(sortLineas)
            const lineaById: Record<string, any> = Object.fromEntries(lineas.map((l: any) => [l.id, l]))
            // Reserva cantidad_reservada en una línea concreta. Muta in-memory para el fallback.
            const reservarEn = async (linea: any, qty: number): Promise<number> => {
              if (!linea || qty <= 0) return 0
              const areservar = Math.min(linea.cantidad - (linea.cantidad_reservada ?? 0), qty)
              if (areservar <= 0) return 0
              await supabase.from('inventario_lineas')
                .update({ cantidad_reservada: (linea.cantidad_reservada ?? 0) + areservar })
                .eq('id', linea.id)
              linea.cantidad_reservada = (linea.cantidad_reservada ?? 0) + areservar
              return areservar
            }
            let restante = item.cantidad
            // Mig 156 — Fase A: honrar el plan de LPN del carrito (si se eligió manualmente).
            for (const p of ((item.lpn_plan ?? []) as any[])) {
              if (restante <= 0) break
              restante -= await reservarEn(lineaById[p.linea_id], Math.min(p.cantidad, restante))
            }
            // Fase B: autocompletar por sort.
            for (const linea of lineas) {
              if (restante <= 0) break
              restante -= await reservarEn(linea, restante)
            }
          }
        }
        // Guardar seña si se cobró al reservar
        let montoPagadoReserva = venta.monto_pagado ?? 0
        let mediosPagoReserva = venta.medio_pago ?? null
        if (saldoMediosPago && saldoMediosPago.some(m => parseFloat(m.monto) > 0)) {
          const prevArr: { tipo: string; monto: number }[] = venta.medio_pago ? JSON.parse(venta.medio_pago) : []
          const acumulado = acumularMediosPago(prevArr, saldoMediosPago)
          mediosPagoReserva = JSON.stringify(acumulado)
          montoPagadoReserva = Math.min(
            venta.total ?? 0,
            montoPagadoReserva + saldoMediosPago.reduce((acc, m) => acc + (parseFloat(m.monto) || 0), 0)
          )
        }
        await supabase.from('ventas').update({
          estado: 'reservada',
          monto_pagado: montoPagadoReserva,
          medio_pago: mediosPagoReserva,
          reservado_at: new Date().toISOString(),
        }).eq('id', ventaId)

        // Registrar seña en caja
        if (saldoMediosPago && saldoMediosPago.some(m => parseFloat(m.monto) > 0)) {
          const _sesionId = sesionCajaId ?? (sesionesAbiertas.length > 0 ? (sesionesAbiertas[0] as any).id : null)
          if (_sesionId) {
            const efectivoSena = calcularEfectivoCaja(saldoMediosPago, montoPagadoReserva)
            if (efectivoSena > 0) {
              supabase.from('caja_movimientos').insert({
                tenant_id: tenant!.id, sesion_id: _sesionId,
                tipo: 'ingreso_reserva', monto: efectivoSena,
                concepto: `Seña Venta #${venta.numero}`, usuario_id: user?.id,
              }).then(() => null)
            }
            for (const mp of saldoMediosPago) {
              const monto = parseFloat(mp.monto) || 0
              if (monto > 0 && mp.tipo && mp.tipo !== 'Efectivo') {
                supabase.from('caja_movimientos').insert({
                  tenant_id: tenant!.id, sesion_id: _sesionId,
                  tipo: 'ingreso_informativo', monto,
                  concepto: `[${mp.tipo}] Seña Venta #${venta.numero}`,
                  cuenta_origen_id: cuentaOrigenDeMetodo(mp.tipo),
                  usuario_id: user?.id,
                }).then(() => null)
              }
            }
          }
        }

      } else if (nuevoEstado === 'despachada') {
        // ISS-075: desglose de despacho por LPN al pasar reserva → despachada
        const despachoRows: any[] = []
        // Estados vendibles del tenant — para el stock por sucursal del movimiento (B1)
        const { data: evDataCambio } = await supabase.from('estados_inventario').select('id').eq('tenant_id', tenant!.id).eq('es_disponible_venta', true)
        const vendibleIdsCambio = (evDataCambio ?? []).map((e: any) => e.id)
        for (const item of items ?? []) {
          if ((item.productos as any)?.tiene_series) {
            const serieIds = (item.venta_series ?? []).map((s: any) => s.serie_id)
            // ISS-075: snapshot LPN/ubicación/serie antes de desactivar
            const { data: seriesInfo } = await supabase.from('inventario_series')
              .select('nro_serie, linea_id, inventario_lineas(lpn, ubicacion_id, ubicaciones(nombre))')
              .in('id', serieIds)
            for (const s of (seriesInfo ?? []) as any[]) {
              despachoRows.push({
                tenant_id: tenant!.id, venta_id: ventaId, venta_item_id: item.id, producto_id: item.producto_id,
                linea_id: s.linea_id ?? null, lpn: s.inventario_lineas?.lpn ?? null,
                ubicacion_id: s.inventario_lineas?.ubicacion_id ?? null,
                ubicacion_nombre: s.inventario_lineas?.ubicaciones?.nombre ?? null,
                cantidad: 1, nro_serie: s.nro_serie ?? null, origen: 'manual',
              })
            }
            // Desactivar series y quitar reserva
            await supabase.from('inventario_series')
              .update({ activo: false, reservado: false }).in('id', serieIds)
          } else {
            const prod = item.productos as any
            const sortLineas = getRebajeSort(prod?.regla_inventario, tenant!.regla_inventario, prod?.tiene_vencimiento ?? false)
            let complQ = soloUbicado(
              supabase.from('inventario_lineas')
                .select('id, lpn, cantidad, cantidad_reservada, created_at, fecha_vencimiento, ubicacion_id, ubicaciones(nombre, prioridad, disponible_surtido)')
                .eq('producto_id', item.producto_id).eq('activo', true).gt('cantidad', 0)
            )
            // Usar la sucursal de la venta original para no tocar lineas de otra sucursal
            const ventaSucursal = (ventaDetalle as any)?.sucursal_id
            if (ventaSucursal) complQ = complQ.eq('sucursal_id', ventaSucursal)
            const { data: lineasRaw } = await complQ
            const _hoyStr2 = new Date().toISOString().split('T')[0]
            const lineas = (lineasRaw ?? [])
              .filter((l: any) => l.ubicaciones?.disponible_surtido !== false)
              .filter((l: any) => !l.fecha_vencimiento || l.fecha_vencimiento >= _hoyStr2)
              .sort(sortLineas)
            const lineaById: Record<string, any> = Object.fromEntries(lineas.map((l: any) => [l.id, l]))
            // Rebaja `qty` de una línea concreta. Muta in-memory para el fallback + registra el desglose.
            const consumir = async (linea: any, qty: number, origen: 'manual' | 'auto'): Promise<number> => {
              if (!linea || qty <= 0) return 0
              const rebajar = Math.min(linea.cantidad, qty)
              if (rebajar <= 0) return 0
              const nuevaCant = linea.cantidad - rebajar
              const nuevaReserva = Math.max(0, (linea.cantidad_reservada ?? 0) - rebajar)
              await supabase.from('inventario_lineas')
                .update({ cantidad: nuevaCant, cantidad_reservada: nuevaReserva, activo: nuevaCant > 0 })
                .eq('id', linea.id)
              linea.cantidad = nuevaCant
              linea.cantidad_reservada = nuevaReserva
              despachoRows.push({
                tenant_id: tenant!.id, venta_id: ventaId, venta_item_id: item.id, producto_id: item.producto_id,
                linea_id: linea.id, lpn: (linea as any).lpn ?? null,
                ubicacion_id: (linea as any).ubicacion_id ?? null, ubicacion_nombre: (linea as any).ubicaciones?.nombre ?? null,
                cantidad: rebajar, nro_serie: null, origen,
              })
              return rebajar
            }
            let restante = item.cantidad
            // Mig 156 — Fase A: honrar el plan de LPN persistido de la reserva (manual/auto).
            for (const p of ((item.lpn_plan ?? []) as any[])) {
              if (restante <= 0) break
              restante -= await consumir(lineaById[p.linea_id], Math.min(p.cantidad, restante), p.manual ? 'manual' : 'auto')
            }
            // Fase B: autocompletar por sort si el stock cambió desde la reserva.
            for (const linea of lineas) {
              if (restante <= 0) break
              restante -= await consumir(linea, restante, 'auto')
            }
          }
          // B1: Registrar movimiento. NO actualizamos stock_actual a mano: el trigger
          // (lineas/series_recalcular_stock) ya lo recalculó tras la rebaja de arriba.
          // stock_antes/despues = stock VENDIBLE en la sucursal de la venta (no el total global).
          const stockDespues = await stockVendibleSucursal(item.producto_id, (ventaDetalle as any)?.sucursal_id ?? null, vendibleIdsCambio)
          const stockAntes = stockDespues + item.cantidad
          await supabase.from('movimientos_stock').insert({
            tenant_id: tenant!.id,
            producto_id: item.producto_id,
            tipo: 'rebaje',
            cantidad: item.cantidad,
            stock_antes: stockAntes,
            stock_despues: stockDespues,
            motivo: `Venta #${venta.numero}`,
            usuario_id: user?.id,
            venta_id: ventaId,
          })
        }
        // ISS-075: persistir el desglose de despacho (fire-and-forget, gate por toggle del tenant)
        if ((tenant as any)?.trazabilidad_asignacion !== false && despachoRows.length > 0) {
          void supabase.from('venta_item_despachos').insert(despachoRows).then(({ error }) => {
            if (error) console.warn('No se pudo registrar el desglose de despacho:', error.message)
          })
        }
        // Acumular saldo en medio_pago si lo hay
        let montoPagadoFinal = venta.monto_pagado ?? 0
        let mediosPagoFinal = venta.medio_pago
        if (saldoMediosPago && saldoMediosPago.length > 0) {
          const prevArr: { tipo: string; monto: number }[] = venta.medio_pago ? JSON.parse(venta.medio_pago) : []
          const acumulado = acumularMediosPago(prevArr, saldoMediosPago)
          mediosPagoFinal = JSON.stringify(acumulado)
          montoPagadoFinal += saldoMediosPago.reduce((acc, m) => acc + (parseFloat(m.monto) || 0), 0)
        }
        await supabase.from('ventas')
          .update({ estado: 'despachada', despachado_at: new Date().toISOString(), medio_pago: mediosPagoFinal, monto_pagado: montoPagadoFinal })
          .eq('id', ventaId)
        // Registrar en caja el efectivo del saldo + la seña si no fue registrada al reservar
        const _sesionId = sesionCajaId ?? (sesionesAbiertas.length > 0 ? (sesionesAbiertas[0] as any).id : null)
        if (_sesionId) {
          try {
            // Efectivo del saldo cobrado ahora
            const pagosSaldo = saldoMediosPago?.filter(m => m.tipo === 'Efectivo' && parseFloat(m.monto) > 0) ?? []
            const efectivoSaldo = pagosSaldo.reduce((s, m) => s + parseFloat(m.monto), 0)
            // Verificar si la seña ya fue registrada en caja al crear la reserva
            const { data: senaEnCaja } = await supabase.from('caja_movimientos')
              .select('monto').eq('tenant_id', tenant!.id)
              .eq('tipo', 'ingreso_reserva')
              .eq('concepto', `Seña Venta #${venta.numero}`)
              .maybeSingle()
            // Si ya está en caja: no duplicar. Si no: incluir seña en el ingreso (reserva sin sesión activa)
            const efectivoOriginal = senaEnCaja
              ? 0
              : (() => {
                  if (venta.medio_pago) {
                    try {
                      const arr = JSON.parse(venta.medio_pago) as { tipo: string; monto: number }[]
                      return arr.filter(m => m.tipo === 'Efectivo').reduce((s, m) => s + (m.monto ?? 0), 0)
                    } catch { return 0 }
                  }
                  return 0
                })()
            const efectivoTotal = efectivoSaldo + efectivoOriginal
            if (efectivoTotal > 0) {
              await supabase.from('caja_movimientos').insert({
                tenant_id: tenant!.id,
                sesion_id: _sesionId,
                tipo: 'ingreso',
                concepto: `Venta #${venta.numero}`,
                monto: efectivoTotal,
                usuario_id: user?.id,
              })
            }
            // No-efectivo: un insert por método (saldo cobrado ahora + no-efectivo original de reserva)
            const prevArr: { tipo: string; monto: number }[] = venta.medio_pago ? (() => { try { return JSON.parse(venta.medio_pago) } catch { return [] } })() : []
            // Acumular por tipo: saldo nuevo + original (si seña fue registrada en caja)
            const noCashMap: Record<string, number> = {}
            for (const m of (saldoMediosPago ?? [])) {
              if (!m.tipo || m.tipo === 'Efectivo') continue
              const monto = parseFloat(m.monto) || 0
              if (monto > 0) noCashMap[m.tipo] = (noCashMap[m.tipo] ?? 0) + monto
            }
            if (senaEnCaja) {
              for (const m of prevArr.filter(m => m.tipo !== 'Efectivo')) {
                noCashMap[m.tipo] = (noCashMap[m.tipo] ?? 0) + (m.monto ?? 0)
              }
            }
            for (const [tipo, monto] of Object.entries(noCashMap)) {
              if (monto <= 0.01) continue
              void supabase.from('caja_movimientos').insert({
                tenant_id: tenant!.id,
                sesion_id: _sesionId,
                tipo: 'ingreso_informativo',
                concepto: `[${tipo}] Venta #${venta.numero}`,
                monto,
                cuenta_origen_id: cuentaOrigenDeMetodo(tipo),
                usuario_id: user?.id,
              })
            }
          } catch {}
        }

      } else if (nuevoEstado === 'cancelada') {
        // L5 — Cadena de anulación según estado de la venta original
        // (a) venta pendiente/reservada → cancelar libre (sin afectar caja)
        // (b) venta despachada con seña/pago efectivo → si NO hay caja abierta, bloquear y sugerir devolución/NC
        // (c) periodo contable cerrado → el trigger BD bloquea con SQLSTATE P0001
        if (venta.estado === 'despachada' && (venta.monto_pagado ?? 0) > 0) {
          const hayCajaAbierta = sesionesAbiertas.length > 0
          if (!hayCajaAbierta) {
            throw new Error('Esta venta fue despachada con cobro efectivo. Para anularla necesitás:\n• Abrir una caja para registrar el egreso de devolución, O\n• Usar el flujo "Devolver" en el historial para emitir una nota de crédito')
          }
        }
        // Liberar reservas
        for (const item of items ?? []) {
          if ((item.productos as any)?.tiene_series) {
            const serieIds = (item.venta_series ?? []).map((s: any) => s.serie_id)
            await supabase.from('inventario_series').update({ reservado: false }).in('id', serieIds)
          } else {
            const { data: lineas } = await supabase.from('inventario_lineas')
              .select('id, cantidad_reservada')
              .eq('producto_id', item.producto_id).eq('activo', true)
              .gt('cantidad_reservada', 0)
            let restante = item.cantidad
            for (const linea of lineas ?? []) {
              if (restante <= 0) break
              const liberar = Math.min(linea.cantidad_reservada ?? 0, restante)
              await supabase.from('inventario_lineas')
                .update({ cantidad_reservada: (linea.cantidad_reservada ?? 0) - liberar })
                .eq('id', linea.id)
              restante -= liberar
            }
          }
        }
        // E3 — registrar motivo de cancelación (catálogo + observación opcional) en notas
        const cancelNota = cancelOpts?.motivo
          ? `[Cancelación: ${cancelOpts.motivo}${cancelOpts.observacion?.trim() ? ` — ${cancelOpts.observacion.trim()}` : ''}]`
          : null
        await supabase.from('ventas')
          .update({
            estado: 'cancelada',
            cancelado_at: new Date().toISOString(),
            ...(cancelNota ? { notas: `${venta.notas ? venta.notas + ' · ' : ''}${cancelNota}` } : {}),
          })
          .eq('id', ventaId)
        // Auditoría 2026-06-11 — la venta anulada no debe dejar su envío vivo:
        // los envíos aún no despachados se cancelan; los que ya están en la calle
        // no se tocan (realidad física) pero se avisa para gestionarlos en Envíos.
        try {
          const { data: enviosVenta } = await supabase.from('envios')
            .select('id, estado')
            .eq('venta_id', ventaId)
            .in('estado', ['pendiente', 'despachado', 'en_camino', 'en_bodega'])
          const cancelables = (enviosVenta ?? []).filter((e: any) => e.estado === 'pendiente')
          const enCurso = (enviosVenta ?? []).filter((e: any) => e.estado !== 'pendiente')
          if (cancelables.length > 0) {
            await supabase.from('envios').update({ estado: 'cancelado' })
              .in('id', cancelables.map((e: any) => e.id))
            toast(`Se canceló ${cancelables.length === 1 ? 'el envío pendiente' : `${cancelables.length} envíos pendientes`} de esta venta`, { icon: '📦' })
          }
          if (enCurso.length > 0) {
            toast(`Esta venta tiene ${enCurso.length === 1 ? 'un envío' : `${enCurso.length} envíos`} en curso — gestionalo en Envíos`, { icon: '⚠️', duration: 8000 })
          }
        } catch (e) { console.error('[ventas] cancelación de envíos asociados falló:', e) }
        // E2 — devolución de seña con penalidad opcional y destino configurable.
        const senaCobrada = venta.monto_pagado ?? 0
        if (senaCobrada > 0) {
          // Penalidad: se retiene un % de la seña (no se devuelve). aDevolver = resto.
          const penalidadPct = cancelOpts ? (cancelOpts.penalidadPct || 0) : 0
          const aDevolver = Math.max(0, senaCobrada * (1 - penalidadPct / 100))
          const ratio = senaCobrada > 0 ? aDevolver / senaCobrada : 0

          // E2 destino "crédito": el monto a devolver queda como saldo a favor del cliente (reusa CC).
          if (cancelOpts?.destino === 'credito' && cancelOpts.clienteId && aDevolver > 0.01) {
            await supabase.from('cliente_creditos').insert({
              tenant_id: tenant!.id,
              cliente_id: cancelOpts.clienteId,
              monto: Math.round(aDevolver * 100) / 100,
              origen: 'cancelacion_reserva',
              venta_id: ventaId,
              nota: `Cancelación reserva #${venta.numero}${penalidadPct > 0 ? ` (penalidad ${penalidadPct}%)` : ''}`,
              usuario_id: user?.id,
            })
          } else if (aDevolver > 0.01) {
            // Destino "devolución": egreso en caja por el monto a devolver (escala efectivo/no-cash).
            const cancelSesionId = sesionCajaId ?? (sesionesAbiertas.length > 0 ? (sesionesAbiertas[0] as any).id : null)
            if (cancelSesionId) {
              try {
                const prevArr = venta.medio_pago ? JSON.parse(venta.medio_pago) as { tipo: string; monto: number }[] : []
                const efectivoCobrado = prevArr.filter(m => m.tipo === 'Efectivo').reduce((s, m) => s + (m.monto ?? 0), 0) * ratio
                if (efectivoCobrado > 0.01) {
                  void supabase.from('caja_movimientos').insert({
                    tenant_id: tenant!.id,
                    sesion_id: cancelSesionId,
                    tipo: 'egreso_devolucion_sena',
                    concepto: `Dev. seña Venta #${venta.numero}${penalidadPct > 0 ? ` (penalidad ${penalidadPct}%)` : ''}`,
                    monto: efectivoCobrado,
                    usuario_id: user?.id,
                  })
                }
                const noCashCancelado = aDevolver - efectivoCobrado
                if (noCashCancelado > 0.01) {
                  const noCashTipos = [...new Set(prevArr.filter(m => m.tipo !== 'Efectivo' && (m.monto ?? 0) > 0).map(m => m.tipo))]
                  const noCashTypes = noCashTipos.join(' + ') || 'No efectivo'
                  void supabase.from('caja_movimientos').insert({
                    tenant_id: tenant!.id,
                    sesion_id: cancelSesionId,
                    tipo: 'egreso_informativo',
                    concepto: `[${noCashTypes}] Dev. seña Venta #${venta.numero}`,
                    monto: noCashCancelado,
                    cuenta_origen_id: noCashTipos[0] ? cuentaOrigenDeMetodo(noCashTipos[0]) : null,
                    usuario_id: user?.id,
                  })
                }
              } catch {}
            }
          }
        }

      } else {
        await supabase.from('ventas').update({ estado: nuevoEstado }).eq('id', ventaId)
      }
      logActividad({
        entidad: 'venta', entidad_id: ventaId, entidad_nombre: `Venta #${venta.numero ?? ''}`,
        accion: 'cambio_estado', valor_anterior: venta.estado, valor_nuevo: nuevoEstado, pagina: '/ventas',
        tipo_transaccion: nuevoEstado === 'despachada' ? 'venta' : nuevoEstado === 'devuelta' ? 'devolucion' : undefined,
        sucursal_id: (venta as any).sucursal_id ?? null,
      })
    },
    onSuccess: (_data, variables) => {
      toast.success('Estado actualizado')
      qc.invalidateQueries({ queryKey: ['ventas'] })
      qc.invalidateQueries({ queryKey: ['productos'] })
      qc.invalidateQueries({ queryKey: ['inventario_lineas_all'] })
      qc.invalidateQueries({ queryKey: ['movimientos'] })
      qc.invalidateQueries({ queryKey: ['alertas'] })
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] })
      qc.invalidateQueries({ queryKey: ['caja-sesiones-abiertas', tenant?.id] })
      setVentaDetalle(null)
      // Prompt facturación si se despachó desde historial
      if (variables.nuevoEstado === 'despachada' && factHabilitada) {
        const v = (ventas as any[]).find(v => v.id === variables.ventaId)
        if (v) triggerFacturaModal(v.id, v.numero ?? 0, Number(v.total ?? 0))
      }
    },
    onError: (e: any) => {
      // L5 — Si el periodo contable está cerrado, mostrar mensaje específico
      const msg = e?.message ?? ''
      if (msg.includes('periodo contable cerrado') || msg.includes('periodo_cerrado') || e?.code === 'P0001') {
        toast.error('Este periodo contable ya está cerrado. Para anular esta venta, generá una nota de corrección desde Gastos → Cierres contables.', { duration: 7000 })
        return
      }
      toast.error(msg)
    },
  })

  const filteredVentas = ventas.filter((v: any) => {
    if (searchHistorial) {
      const s = searchHistorial.toLowerCase()
      if (!v.numero?.toString().includes(s) && !(v.cliente_nombre ?? '').toLowerCase().includes(s)) return false
    }
    if (filterCategoria) {
      const tieneCategoria = (v.venta_items ?? []).some((item: any) => item.productos?.categoria_id === filterCategoria)
      if (!tieneCategoria) return false
    }
    return true
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Ventas</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">Registrá y gestioná tus ventas</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 -mb-2">
        {(esContador ? [{ id: 'historial', label: 'Historial', icon: FileText }] : [{ id: 'nueva', label: 'Nueva venta', icon: Plus }, { id: 'historial', label: 'Historial', icon: FileText }, { id: 'canales', label: 'Canales', icon: Layers }]).map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id as Tab)}
            className={`flex items-center gap-2 py-2.5 px-4 text-sm font-medium transition-all border-b-2 -mb-px
              ${tab === id
                ? 'border-accent text-accent'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'}`}>
            <Icon size={15} />{label}
          </button>
        ))}
      </div>

      {/* ── NUEVA VENTA ── */}
      {tab === 'nueva' && sesionesAbiertas.length === 0 && (
        <div className="flex items-center gap-3 bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded-xl px-4 py-3">
          <AlertTriangle size={20} className="text-red-600 dark:text-red-400 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-semibold text-red-700 dark:text-red-400">Caja cerrada</p>
            <p className="text-sm text-red-600 dark:text-red-500">No podés finalizar ventas ni reservar hasta abrir una caja.</p>
          </div>
          <Link to="/caja" className="text-sm font-semibold text-red-700 dark:text-red-400 underline hover:no-underline flex-shrink-0">
            Ir a Caja →
          </Link>
        </div>
      )}
      {tab === 'nueva' && (
        <div className="grid lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-4">

            {/* Aviso: sin sucursal seleccionada el inventario no está filtrado */}
            {puedeVerTodas && sucursales.length > 0 && !sucursalId && (
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-sm text-amber-700 dark:text-amber-400">
                <AlertTriangle size={15} className="flex-shrink-0" />
                <span>Sin sucursal seleccionada — el inventario mostrado es de <strong>todas las sucursales</strong>. Seleccioná una desde el header para filtrar.</span>
              </div>
            )}

            {/* Buscador de productos */}
            <div className="bg-surface rounded-xl p-4 shadow-sm border border-border-ds">
              <h2 className="font-semibold text-primary mb-3 flex items-center gap-2"><ShoppingCart size={16} /> Agregar productos</h2>

              {/* Filtro por grupo */}
              {grupos.length > 0 && (
                <div className="mb-3 flex items-center gap-2 flex-wrap">
                  <Layers size={13} className="text-gray-400 dark:text-gray-500 flex-shrink-0" />
                  <span className="text-xs text-gray-500 dark:text-gray-400">Ver stock de:</span>
                  <button onClick={() => setVentaGrupoId('todos')}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-all
                      ${ventaGrupoId === 'todos' ? 'bg-primary text-white border-primary' : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:border-gray-600'}`}>
                    Todos
                  </button>
                  {grupos.map(g => (
                    <button key={g.id}
                      onClick={() => setVentaGrupoId(ventaGrupoId === g.id ? null : g.id)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-all flex items-center gap-1
                        ${ventaGrupoId === g.id || (ventaGrupoId === null && g.es_default)
                          ? 'bg-primary text-white border-primary'
                          : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:border-gray-600'}`}>
                      {g.nombre}
                      {g.es_default && ventaGrupoId === null && <span className="text-yellow-300">★</span>}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
                  <input type="text" value={productoSearch} onChange={e => setProductoSearch(e.target.value)}
                    placeholder="Buscar por nombre, SKU o código..."
                    onFocus={() => setSearchFocused(true)}
                    onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
                    className="w-full pl-8 pr-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
                  {viewMode === 'lista' && productosBusqueda.length > 0 && searchFocused && (
                    <div className="absolute top-full mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg z-10 max-h-48 overflow-y-auto">
                      {(productosBusqueda as any[]).map(p => (
                        <button key={p.id} onClick={() => agregarProducto(p)}
                          className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-sm border-b border-gray-50 last:border-0 flex items-center gap-3">
                          {/* Imagen pequeña */}
                          <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center flex-shrink-0 overflow-hidden">
                            {p.imagen_url
                              ? <img src={p.imagen_url} alt={p.nombre} className="w-full h-full object-cover" />
                              : <Package size={14} className="text-gray-300" />
                            }
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1 flex-wrap">
                              <span className="font-medium truncate">{p.nombre}</span>
                              <span className="text-gray-400 dark:text-gray-500 text-xs flex-shrink-0">{p.sku}</span>
                              {p.tiene_series && <span className="text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-600 px-1 rounded flex-shrink-0">series</span>}
                              {p.es_kit && <span className="text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 px-1 rounded flex-shrink-0" title="Producto KIT — asegurate de tener stock armado">KIT</span>}
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="font-semibold text-primary">${p.precio_venta?.toLocaleString('es-AR')}</p>
                            <p className="text-xs text-gray-400 dark:text-gray-500">
                              {p.stock_filtrado
                                ? <span className="text-blue-600 dark:text-blue-400 font-medium">{p.stock_disponible} disp.</span>
                                : `${p.stock_actual} stock`
                              }
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setScannerOpen(true)}
                  className="px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:text-accent transition-colors flex-shrink-0"
                  title="Escanear código de barras"
                >
                  <Camera size={17} />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode(v => v === 'lista' ? 'galeria' : 'lista')}
                  className={`px-3 py-2.5 border rounded-xl transition-colors flex-shrink-0
                    ${viewMode === 'galeria' ? 'border-accent text-accent bg-accent/5' : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50 hover:text-accent'}`}
                  title={viewMode === 'lista' ? 'Vista galería' : 'Vista lista'}
                >
                  {viewMode === 'lista' ? <LayoutGrid size={17} /> : <List size={17} />}
                </button>
              </div>

              {/* Galería de productos */}
              {viewMode === 'galeria' && productosBusqueda.length > 0 && (
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[28rem] overflow-y-auto pr-1">
                  {(productosBusqueda as any[]).map(p => (
                    <button key={p.id} onClick={() => agregarProducto(p)}
                      className="flex flex-col items-center text-center p-2.5 border border-gray-200 dark:border-gray-700 rounded-xl hover:border-accent hover:shadow-sm transition-all bg-surface h-full">
                      <div className="w-full aspect-square bg-gray-50 dark:bg-gray-700 rounded-lg flex items-center justify-center overflow-hidden mb-2">
                        {p.imagen_url
                          ? <img src={p.imagen_url} alt={p.nombre} className="w-full h-full object-cover rounded-lg" />
                          : <Package size={22} className="text-gray-300" />
                        }
                      </div>
                      <p className="text-xs font-medium text-primary line-clamp-2 leading-tight w-full">{p.nombre}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate w-full">{p.sku}</p>
                      <p className="text-sm font-bold text-primary mt-1">${p.precio_venta?.toLocaleString('es-AR')}</p>
                      <p className="text-xs mt-0.5">
                        {p.stock_filtrado
                          ? <span className="text-blue-600 dark:text-blue-400 font-medium">{p.stock_disponible} disp.</span>
                          : <span className={`${(p.stock_disponible ?? p.stock_actual) <= 0 ? 'text-red-400' : 'text-gray-400 dark:text-gray-500'}`}>
                              {p.stock_disponible ?? p.stock_actual} stock
                            </span>
                        }
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Carrito */}
            {cart.length > 0 && (
              <div className="bg-surface rounded-xl shadow-sm border border-border-ds overflow-hidden">
                <div className="px-4 py-3 border-b border-border-ds bg-page">
                  <h2 className="font-semibold text-primary flex items-center gap-2"><Package size={16} /> {cart.length} producto{cart.length !== 1 ? 's' : ''}</h2>
                </div>
                <div className="divide-y divide-gray-200 dark:divide-gray-600 max-h-[45vh] overflow-y-auto">
                  {cart.map((item, idx) => (
                    <div key={idx} className="px-4 py-3">
                      <div className="flex items-start gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-primary">{item.nombre}</p>
                            {!item.tiene_series && (() => {
                              const stockDisp = item.lineas_disponibles
                                ? item.lineas_disponibles.reduce((acc, l) => acc + Math.max(0, l.cantidad - (l.cantidad_reservada ?? 0)), 0)
                                : null
                              if (stockDisp === null || item.cantidad <= stockDisp) return null
                              return (
                                <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 flex-shrink-0">
                                  Stock insuf. ({stockDisp} disp.)
                                </span>
                              )
                            })()}
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs text-gray-400 dark:text-gray-500">{item.sku}</span>
                            {modoAvanzado && !item.tiene_series && item.lpn_fuentes && item.lpn_fuentes.length > 0 && (() => {
                              const canPick = (item.lineas_disponibles?.length ?? 0) > 1
                              const isOpen = lpnPickerIdx === idx
                              return (
                                <>
                                  {item.lpn_fuentes.slice(0, 3).map((f, fi) => (
                                    <span key={fi}
                                      onClick={canPick ? () => setLpnPickerIdx(isOpen ? null : idx) : undefined}
                                      title={canPick ? 'Click para cambiar posición de rebaje' : (f.ubicacion ? `Ubicación: ${f.ubicacion}` : undefined)}
                                      className={`text-xs px-1.5 py-0.5 rounded transition-colors
                                        ${canPick
                                          ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/40 ring-1 ring-blue-200 dark:ring-blue-800'
                                          : 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20'}`}>
                                      {f.lpn ?? 'Sin LPN'}{item.lpn_fuentes!.length > 1 ? ` (${f.cantidad}u)` : ''}
                                      {f.ubicacion && <span className="text-blue-400 dark:text-blue-500"> · {f.ubicacion}</span>}
                                      {canPick && fi === 0 && <span className="ml-0.5 text-blue-400">▾</span>}
                                    </span>
                                  ))}
                                  {item.lpn_fuentes.length > 3 && (
                                    <span className="text-xs text-gray-400 dark:text-gray-500">+{item.lpn_fuentes.length - 3} más</span>
                                  )}
                                  {/* Picker inline de posición */}
                                  {isOpen && item.lineas_disponibles && (
                                    <div className="w-full mt-1 bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-700 rounded-xl shadow-lg overflow-hidden">
                                      <p className="text-xs text-gray-500 dark:text-gray-400 px-3 py-1.5 border-b border-gray-100 dark:border-gray-700 font-medium">
                                        Elegir posición de rebaje
                                      </p>
                                      {item.lineas_disponibles.map((l) => {
                                        const disp = l.cantidad - (l.cantidad_reservada ?? 0)
                                        const isActive = item.lineas_disponibles![0].id === l.id
                                        return (
                                          <button key={l.id} onClick={() => overrideLpnSource(idx, l.id)}
                                            className={`w-full flex items-center justify-between px-3 py-2 text-xs text-left transition-colors
                                              ${isActive
                                                ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium'
                                                : 'hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-700 dark:text-gray-300'}`}>
                                            <span>
                                              {l.lpn ?? <span className="text-gray-400 italic">Sin LPN</span>}
                                              {l.ubicacion && <span className="text-gray-400 dark:text-gray-500 ml-1">· {l.ubicacion}</span>}
                                              {isActive && <span className="ml-1 text-blue-500">✓</span>}
                                            </span>
                                            <span className={`ml-2 shrink-0 ${disp <= 0 ? 'text-red-400' : 'text-gray-400 dark:text-gray-500'}`}>
                                              {disp}u disp.
                                            </span>
                                          </button>
                                        )
                                      })}
                                    </div>
                                  )}
                                </>
                              )
                            })()}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          {!item.tiene_series && item.cantidad > 1 && (
                            <button onClick={() => splitItem(idx)} title="Separar 1 unidad con descuento diferente"
                              className="text-gray-300 hover:text-blue-400 transition-colors">
                              <Scissors size={14} />
                            </button>
                          )}
                          <button onClick={() => removeItem(idx)} title="Quitar producto del carrito" className="text-gray-300 hover:text-red-400 transition-colors"><X size={16} /></button>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 mt-2">
                        {/* Cantidad */}
                        {!item.tiene_series && (
                          <div className="flex items-center gap-1">
                            <button onClick={() => updateItem(idx, 'cantidad', Math.max(stepCantidad(item.unidad_medida), parseFloat((item.cantidad - stepCantidad(item.unidad_medida)).toFixed(3))))} title="Reducir cantidad"
                              className="w-7 h-7 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50">−</button>
                            <input
                              key={`qty-${idx}-${item.cantidad}-${item.producto_id}`}
                              type="text"
                              inputMode={esDecimal(item.unidad_medida) ? 'decimal' : 'numeric'}
                              defaultValue={esDecimal(item.unidad_medida) ? item.cantidad.toString().replace('.', ',') : item.cantidad.toString()}
                              onBlur={e => updateItem(idx, 'cantidad', parseCantidad(e.target.value, item.unidad_medida))}
                              onKeyDown={e => {
                                if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); return }
                                // Para UOM enteras: bloquear punto y coma
                                if (!esDecimal(item.unidad_medida) && (e.key === '.' || e.key === ',')) e.preventDefault()
                              }}
                              className="w-16 text-center text-sm font-medium border border-gray-200 dark:border-gray-700 rounded-lg py-0.5 focus:outline-none focus:border-accent"
                            />
                            <button onClick={() => updateItem(idx, 'cantidad', parseFloat((item.cantidad + stepCantidad(item.unidad_medida)).toFixed(3)))} title="Aumentar cantidad"
                              className="w-7 h-7 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50">+</button>
                          </div>
                        )}

                        {/* Precio (sólo lectura — se edita desde Productos) */}
                        <div className="relative flex-1">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 text-xs">$</span>
                          <div className="w-full pl-5 pr-2 py-1.5 border border-border-ds rounded-lg text-sm bg-page text-muted select-none">
                            {item.precio_unitario.toLocaleString('es-AR', { maximumFractionDigits: 2 })}
                          </div>
                        </div>

                        {/* Descuento con toggle % / $ */}
                        {/* C3 (relevamiento Ventas A-D): CAJERO no puede colocar/editar descuentos
                            por ítem ni global. Si necesita aplicar uno, lo hace un SUPERVISOR/DUEÑO. */}
                        <div className="flex flex-col items-end gap-0.5">
                          <div className={`flex items-center border rounded-lg overflow-hidden w-28 ${
                            (() => {
                              if (descuentoBloqueadoCajero) return 'border-gray-200 dark:border-gray-700 opacity-60'
                              const rolItem = user?.rol
                              const limiteItem = rolItem === 'CAJERO' ? (tenant as any)?.descuento_max_cajero_pct : rolItem === 'SUPERVISOR' ? (tenant as any)?.descuento_max_supervisor_pct : null
                              return (limiteItem != null && item.descuento_tipo === 'pct' && item.descuento > limiteItem)
                                ? 'border-red-400 dark:border-red-500'
                                : 'border-gray-200 dark:border-gray-700'
                            })()
                          }`}>
                            <input type="number" onWheel={e => e.currentTarget.blur()} min="0" value={item.descuento}
                              onChange={e => updateItem(idx, 'descuento', parseFloat(e.target.value) || 0)}
                              disabled={descuentoBloqueadoCajero}
                              title={descuentoBloqueadoCajero ? 'Descuentos: solo DUEÑO/SUPERVISOR/ADMIN.' : undefined}
                              className="w-full pl-2 pr-1 py-1.5 text-sm focus:outline-none disabled:bg-gray-50 dark:disabled:bg-gray-800 disabled:cursor-not-allowed" placeholder="0" />
                            <button onClick={() => updateItem(idx, 'descuento_tipo', item.descuento_tipo === 'pct' ? 'monto' : 'pct')}
                              disabled={descuentoBloqueadoCajero}
                              title={descuentoBloqueadoCajero ? 'Descuentos: solo DUEÑO/SUPERVISOR/ADMIN' : 'Cambiar tipo de descuento (% o $)'}
                              className="px-2 py-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 text-gray-500 dark:text-gray-400 text-xs font-bold border-l border-gray-200 dark:border-gray-700 transition-colors disabled:cursor-not-allowed disabled:hover:bg-gray-100">
                              {item.descuento_tipo === 'pct' ? '%' : '$'}
                            </button>
                          </div>
                          {(() => {
                            if (descuentoBloqueadoCajero) {
                              return <span className="text-[10px] text-gray-400 dark:text-gray-500">Bloqueado</span>
                            }
                            const rolItem = user?.rol
                            const limiteItem = rolItem === 'CAJERO' ? (tenant as any)?.descuento_max_cajero_pct : rolItem === 'SUPERVISOR' ? (tenant as any)?.descuento_max_supervisor_pct : null
                            return (limiteItem != null && item.descuento_tipo === 'pct' && item.descuento > limiteItem)
                              ? <span className="text-[10px] text-red-500 dark:text-red-400">máx {limiteItem}%</span>
                              : null
                          })()}
                        </div>

                        {/* Subtotal */}
                        <p className="text-sm font-semibold text-primary w-20 text-right">
                          ${getItemSubtotal(item).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                        </p>
                      </div>

                      {/* G5 — producto vendido en USD (convertido a la cotización vigente) */}
                      {item.precio_usd_origen != null && item.precio_usd_origen > 0 && (
                        <p className="text-xs text-blue-600 dark:text-blue-400 mt-1 flex items-center gap-1">
                          <DollarSign size={11} /> Precio USD {item.precio_usd_origen.toLocaleString('es-AR', { maximumFractionDigits: 2 })} · convertido a ${item.precio_unitario.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                        </p>
                      )}

                      {/* G1/G2 — precio mayorista aplicado por cantidad */}
                      {(() => {
                        const efectivo = precioTierEfectivo(item)
                        if (efectivo >= item.precio_unitario) return null
                        return (
                          <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1 font-medium">
                            <Tag size={11} /> Precio mayorista: ${efectivo.toLocaleString('es-AR', { maximumFractionDigits: 0 })}/u
                            <span className="text-gray-400 dark:text-gray-500 line-through font-normal">${item.precio_unitario.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                          </p>
                        )
                      })()}

                      {/* Precio tachado cuando hay descuento */}
                      {item.descuento > 0 && (() => {
                        const cant = item.tiene_series ? item.series_seleccionadas.length : item.cantidad
                        const precioOriginal = precioTierEfectivo(item) * cant
                        const precioFinal = getItemSubtotal(item)
                        return (
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                            Precio lista:{' '}
                            <span className="line-through">${precioOriginal.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                            {' '}→{' '}
                            <span className="text-green-600 dark:text-green-400 font-medium">${precioFinal.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                          </p>
                        )
                      })()}

                      {/* Sugerencia de combo */}
                      {!item.tiene_series && (() => {
                        const combo = findCombo(item.producto_id, item.cantidad, item)
                        if (!combo) return null
                        return (
                          <div className="mt-1.5 flex items-center gap-2 text-xs bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 rounded-lg px-3 py-1.5 border border-amber-200">
                            <Gift size={12} />
                            <span className="flex-1">Combo: {combo.cantidad}× con {comboDescLabel(combo)} disponible</span>
                            <button onClick={() => aplicarCombo(idx, combo)}
                              className="font-semibold hover:underline text-amber-800 dark:text-amber-400">
                              Aplicar
                            </button>
                          </div>
                        )
                      })()}

                      {/* Series */}
                      {item.tiene_series && (
                        <div className="mt-2">
                          <button onClick={() => setSeriesModal({ itemIdx: idx, lineas: item.series_disponibles })}
                            className="flex items-center gap-1.5 text-xs text-accent hover:underline">
                            <Hash size={12} />
                            {item.series_seleccionadas.length > 0
                              ? `${item.series_seleccionadas.length} serie(s) seleccionada(s) — cambiar`
                              : 'Seleccionar series'}
                          </button>
                          {item.series_seleccionadas.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {item.series_seleccionadas.map(sid => {
                                const s = item.series_disponibles.find(d => d.id === sid)
                                return s ? (
                                  <span key={sid} className="text-xs bg-purple-50 dark:bg-purple-900/20 text-purple-700 px-1.5 py-0.5 rounded">{s.nro_serie}</span>
                                ) : null
                              })}
                            </div>
                          )}
                          {item.series_seleccionadas.length > 0 && (() => {
                            const lpns = [...new Set(item.series_seleccionadas.map(sid => {
                              const s = item.series_disponibles.find((d: any) => d.id === sid)
                              return s?.lpn as string | undefined
                            }).filter(Boolean))] as string[]
                            if (lpns.length === 0) return null
                            return (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {lpns.map(lpn => (
                                  <span key={lpn} className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-1.5 py-0.5 rounded">
                                    {lpn}
                                  </span>
                                ))}
                              </div>
                            )
                          })()}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Panel lateral */}
          <div className="space-y-4 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto lg:pr-1">
            {/* Cliente */}
            <div className="bg-surface rounded-xl p-4 shadow-sm border border-border-ds space-y-3">
              <h2 className="font-semibold text-primary flex items-center gap-2"><User size={16} /> Cliente</h2>
              {/* H5: tipo de comprobante — Consumidor Final vs Cliente registrado (solo si factura) */}
              {factHabilitada && permiteCF && (
                <div>
                  <div className="flex gap-2">
                    {([
                      { v: true,  t: 'Consumidor Final' },
                      { v: false, t: 'Cliente registrado' },
                    ] as const).map(opt => (
                      <button key={String(opt.v)} type="button"
                        onClick={() => {
                          setEsConsumidorFinal(opt.v)
                          if (opt.v) { setClienteId(null); setClienteNombre(''); setClienteTelefono(''); setClienteSearch(''); setClienteCCEnabled(false); setMediosPago(prev => prev.filter(m => m.tipo !== 'Cuenta Corriente')) }
                        }}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors
                          ${esConsumidorFinal === opt.v ? 'border-accent bg-accent/10 text-accent' : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400'}`}>
                        {opt.t}
                      </button>
                    ))}
                  </div>
                  {!esConsumidorFinal && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">Para facturar a un cliente registrado tenés que seleccionarlo o crearlo.</p>
                  )}
                </div>
              )}
              {/* Autocomplete cliente registrado */}
              <div className="relative">
                {clienteId ? (
                  <div className="flex items-center gap-2 px-3 py-2.5 border border-blue-300 bg-blue-50 dark:bg-blue-900/20 rounded-xl text-sm flex-wrap">
                    <span className="flex-1 font-medium text-blue-800 dark:text-blue-400">{clienteNombre}</span>
                    {clienteCCDeuda > 0.5 && (
                      <button onClick={() => { setCobrarCCOpen(true); setCobrarCCMonto(String(Math.round(clienteCCDeuda))); setCobrarCCMetodo('Efectivo') }}
                        className="flex items-center gap-1 text-xs bg-red-500 hover:bg-red-600 text-white px-2.5 py-1 rounded-lg transition-colors"
                        title="Cobrar deuda de cuenta corriente">
                        <DollarSign size={12} /> Deuda CC ${Math.round(clienteCCDeuda).toLocaleString('es-AR')}
                      </button>
                    )}
                    <button onClick={() => { setClienteId(null); setClienteNombre(''); setClienteTelefono(''); setClienteSearch(''); setClienteCCEnabled(false); setMediosPago(prev => prev.filter(m => m.tipo !== 'Cuenta Corriente')) }} title="Quitar cliente" className="text-blue-400 hover:text-blue-700 dark:text-blue-400"><X size={14} /></button>
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      value={clienteSearch}
                      onChange={e => { setClienteSearch(e.target.value); setClienteDropOpen(true) }}
                      onFocus={() => setClienteDropOpen(true)}
                      onBlur={() => setTimeout(() => setClienteDropOpen(false), 150)}
                      placeholder="Buscar por nombre o DNI..."
                      className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent"
                    />
                    {clienteDropOpen && clientesBusqueda.length > 0 && (
                      <div className="absolute z-20 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg max-h-40 overflow-y-auto">
                        {clientesBusqueda.map((c: any) => (
                          <button
                            key={c.id}
                            onMouseDown={() => {
                              setClienteId(c.id)
                              setClienteNombre(c.nombre)
                              setClienteTelefono(c.telefono ?? '')
                              setClienteCCEnabled(c.cuenta_corriente_habilitada ?? false)
                              setEsConsumidorFinal(false)   // H5: elegir cliente registrado → no es CF
                              setMediosPago(prev => prev.filter(m => m.tipo !== 'Cuenta Corriente'))
                              setClienteSearch('')
                              setClienteDropOpen(false)
                            }}
                            className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-sm"
                          >
                            <span className="font-medium">{c.nombre}</span>
                            {c.dni && <span className="text-gray-400 dark:text-gray-500 ml-2 text-xs">DNI {c.dni}</span>}
                            {c.telefono && <span className="text-gray-400 dark:text-gray-500 ml-2">{c.telefono}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
              {/* Registrar cliente nuevo inline */}
              {!clienteId && clienteCreacionInline && (
                nuevoClienteOpen ? (
                  <div className="border border-blue-200 dark:border-blue-700 rounded-xl p-3 space-y-2 bg-blue-50 dark:bg-blue-900/10">
                    <p className="text-xs font-medium text-blue-700 dark:text-blue-400">Nuevo cliente</p>
                    <input value={nuevoClienteForm.nombre} onChange={e => setNuevoClienteForm(f => ({ ...f, nombre: e.target.value }))}
                      placeholder="Nombre completo *" autoFocus
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
                    <div className="grid grid-cols-2 gap-2">
                      <input value={nuevoClienteForm.dni} onChange={e => setNuevoClienteForm(f => ({ ...f, dni: e.target.value }))}
                        placeholder="DNI *"
                        className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
                      <input value={nuevoClienteForm.telefono} onChange={e => setNuevoClienteForm(f => ({ ...f, telefono: e.target.value }))}
                        placeholder="Teléfono *"
                        className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => { setNuevoClienteOpen(false); setNuevoClienteForm({ nombre: '', dni: '', telefono: '' }) }}
                        className="flex-1 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 text-sm py-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700/50">
                        Cancelar
                      </button>
                      <button onClick={registrarClienteInline} disabled={savingCliente}
                        className="flex-1 bg-accent hover:bg-accent/90 text-white text-sm font-semibold py-2 rounded-xl disabled:opacity-50">
                        {savingCliente ? 'Guardando...' : 'Guardar'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setNuevoClienteOpen(true)}
                    className="w-full text-sm text-accent border border-dashed border-accent/40 rounded-xl py-2 hover:bg-accent/5 transition-colors">
                    + Registrar cliente nuevo
                  </button>
                )
              )}
            </div>

            {/* Descuento general + Notas — solo para reservada/despachada */}
            {modoVenta !== 'pendiente' && cart.length > 0 && (
              <div className="bg-surface rounded-xl p-4 shadow-sm border border-border-ds space-y-3">
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                    Descuento general
                    {descuentoBloqueadoCajero && (
                      <span className="ml-1.5 text-[10px] text-gray-400 dark:text-gray-500 italic">— solo DUEÑO/SUPERVISOR/ADMIN</span>
                    )}
                  </label>
                  {descTotalVal > 0 && cart.some(i => i.descuento > 0) && (
                    <div className="mb-1.5 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 rounded-lg px-2.5 py-1.5">
                      <span>⚠️</span>
                      <span>Hay descuentos por producto <strong>y</strong> descuento general activos</span>
                    </div>
                  )}
                  <div className={`flex items-center border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden ${descuentoBloqueadoCajero ? 'opacity-60' : ''}`}>
                    <input type="number" onWheel={e => e.currentTarget.blur()} min="0"
                      max={descuentoTotalTipo === 'pct' ? 100 : subtotal}
                      value={descuentoTotal}
                      onChange={e => {
                        const v = parseFloat(e.target.value) || 0
                        const max = descuentoTotalTipo === 'pct' ? 100 : subtotal
                        setDescuentoTotal(String(Math.min(v, max) || e.target.value))
                      }}
                      disabled={descuentoBloqueadoCajero}
                      title={descuentoBloqueadoCajero ? 'Descuentos: solo DUEÑO/SUPERVISOR/ADMIN.' : undefined}
                      placeholder="0"
                      className="flex-1 px-3 py-2.5 text-sm focus:outline-none disabled:bg-gray-50 dark:disabled:bg-gray-800 disabled:cursor-not-allowed" />
                    <button onClick={() => setDescuentoTotalTipo(t => t === 'pct' ? 'monto' : 'pct')}
                      disabled={descuentoBloqueadoCajero}
                      title={descuentoBloqueadoCajero ? 'Descuentos: solo DUEÑO/SUPERVISOR/ADMIN' : 'Cambiar tipo de descuento (% o $)'}
                      className="px-3 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 text-gray-600 dark:text-gray-400 text-sm font-bold border-l border-gray-200 dark:border-gray-700 transition-colors min-w-10 disabled:cursor-not-allowed disabled:hover:bg-gray-100">
                      {descuentoTotalTipo === 'pct' ? '%' : '$'}
                    </button>
                  </div>
                </div>
                <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2}
                  placeholder="Notas (opcional)"
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent resize-none" />
                {/* Toggle envío */}
                <div className={`rounded-xl border-2 overflow-hidden transition-all
                  ${requiereEnvio ? 'border-accent' : 'border-gray-200 dark:border-gray-600'}`}>
                  {/* Header toggle */}
                  <div
                    onClick={() => setRequiereEnvio(v => !v)}
                    className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer select-none transition-colors
                      ${requiereEnvio ? 'bg-accent/5 dark:bg-accent/10' : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'}`}>
                    <Truck size={16} className={requiereEnvio ? 'text-accent' : 'text-gray-400'} />
                    <span className={`text-sm font-medium flex-1 ${requiereEnvio ? 'text-accent' : 'text-gray-600 dark:text-gray-400'}`}>
                      Incluir envío
                    </span>
                    <div className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${requiereEnvio ? 'bg-accent' : 'bg-gray-300 dark:bg-gray-600'}`}>
                      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${requiereEnvio ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </div>
                  </div>

                  {/* Panel expandido */}
                  {requiereEnvio && (
                    <div className="px-3 pb-3 pt-2 space-y-3 border-t border-accent/20">

                      {/* Tipo de transporte: propio vs courier tercero */}
                      <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Tipo de transporte</p>
                        <div className="flex gap-2">
                          {(['propio', 'tercero'] as const).map(t => (
                            <button key={t} type="button" onClick={() => { setEnvioTransporte(t); if (t === 'propio') { setEnvioCourier(''); setEnvioServicio('') } }}
                              className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors
                                ${envioTransporte === t ? 'border-accent bg-accent/10 text-accent' : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400'}`}>
                              {t === 'propio' ? '🚗 Envío propio' : '📦 Courier / 3ro'}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Courier + Servicio (solo si tercero) */}
                      {envioTransporte === 'tercero' && (
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Courier</label>
                            <select value={envioCourier} onChange={e => { setEnvioCourier(e.target.value); setEnvioServicio('') }}
                              className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                              <option value="">Seleccionar…</option>
                              {COURIERS.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Servicio</label>
                            <select value={envioServicio} onChange={e => setEnvioServicio(e.target.value)}
                              disabled={!envioCourier || serviciosDe(envioCourier).length === 0}
                              className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:opacity-50">
                              <option value="">Seleccionar…</option>
                              {serviciosDe(envioCourier).map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </div>
                        </div>
                      )}

                      {/* ISS-174 — Cotizar por API del courier (Envíos/couriers = modo avanzado) */}
                      {modoAvanzado && envioTransporte === 'tercero' && esCourierApi(envioCourier) && (
                        <div className="rounded-lg border border-accent/30 bg-accent/5 p-2.5 space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <button type="button" onClick={handleCotizarVenta} disabled={cotizandoVenta}
                              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors disabled:opacity-60 font-medium">
                              {cotizandoVenta ? <RefreshCw size={12} className="animate-spin" /> : <DollarSign size={12} />}
                              {cotizandoVenta ? 'Cotizando…' : `Cotizar ${envioCourier}`}
                            </button>
                            <input type="text" value={cpDestinoVenta} onChange={e => setCpDestinoVenta(e.target.value)}
                              placeholder={cpDestinoEfectivo ? `CP destino (${cpDestinoEfectivo})` : 'CP destino'} inputMode="numeric"
                              className="w-24 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                            <input type="number" value={pesoVenta} onChange={e => setPesoVenta(e.target.value)}
                              placeholder="Peso kg" min="0" step="0.1" onWheel={e => e.currentTarget.blur()}
                              className="w-20 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                          </div>
                          {cotizacionesVenta.length > 0 && (
                            <div className="space-y-1">
                              {cotizacionesVenta.map((op, i) => (
                                <button key={i} type="button"
                                  onClick={() => { setEnvioServicio(op.servicio); setEnvioTipoVenta('monto'); setCostoEnvioVenta(String(op.precio)); toast.success(`${op.servicio} — $${op.precio.toLocaleString('es-AR')}`) }}
                                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border text-xs transition-colors
                                    ${envioServicio === op.servicio ? 'border-accent bg-accent/10' : 'border-gray-200 dark:border-gray-600 hover:border-accent/50 bg-white dark:bg-gray-700'}`}>
                                  <span className="font-medium text-gray-700 dark:text-gray-200">{op.servicio}</span>
                                  <span className="flex items-center gap-2">
                                    {op.plazo_dias != null && <span className="text-gray-400">{op.plazo_dias}d</span>}
                                    <span className="font-semibold text-accent">${op.precio.toLocaleString('es-AR')}</span>
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Tipo de costo */}
                      <div className="flex gap-2">
                        {(['monto', 'km'] as const).map(t => (
                          <button key={t} type="button" onClick={() => { setEnvioTipoVenta(t); setCostoEnvioVenta(''); setEnvioKmVenta(''); setPrecioPorKmVenta('') }}
                            className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors
                              ${envioTipoVenta === t ? 'border-accent bg-accent/10 text-accent' : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400'}`}>
                            {t === 'monto' ? '$ Monto fijo' : '📍 Por KM'}
                          </button>
                        ))}
                      </div>

                      {/* Campos según tipo */}
                      {envioTipoVenta === 'monto' ? (
                        <div>
                          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Costo de envío ($)</label>
                          <input type="number" min="0" step="0.01" onWheel={e => e.currentTarget.blur()}
                            value={costoEnvioVenta} onChange={e => setCostoEnvioVenta(e.target.value)}
                            placeholder="0.00"
                            className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Distancia (km)</label>
                              <input type="number" min="0" step="0.1" onWheel={e => e.currentTarget.blur()}
                                value={envioKmVenta} onChange={e => setEnvioKmVenta(e.target.value)}
                                placeholder="0"
                                className={`w-full border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 ${envioOrigenGeoError ? 'border-red-300 dark:border-red-600' : 'border-gray-200 dark:border-gray-600'}`} />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">$/km</label>
                              {/* Editable: si el tenant no tiene tarifa por km cargada (p.ej. modo básico
                                  sin Config→Envíos), se puede ingresar acá; si la tiene, viene pre-cargada
                                  y se puede sobrescribir por venta. El costo (km × $/km) se recalcula solo. */}
                              <input type="number" min="0" step="0.01" onWheel={e => e.currentTarget.blur()}
                                value={precioPorKmVenta} onChange={e => setPrecioPorKmVenta(e.target.value)}
                                placeholder="0.00"
                                className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                            </div>
                          </div>
                          {costoEnvioNum > 0 && (
                            <p className="text-xs text-accent font-medium">{envioKmVenta} km × ${precioPorKmVenta}/km = ${costoEnvioNum.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</p>
                          )}
                        </div>
                      )}

                      {/* ISS-163: Origen editable (pre-llenado con sucursal) */}
                      <div>
                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Dirección de origen (sucursal)</label>
                        <AddressAutocompleteInput
                          value={envioOrigenVenta}
                          onChange={setEnvioOrigenVenta}
                          onPlaceSelected={(addr, placeId) => {
                            setEnvioOrigenVenta(addr)
                            const isC = /^-?\d+\.?\d*,-?\d+\.?\d*$/.test(placeId)
                            if (isC) {
                              setEnvioOrigenCoords(placeId)
                            } else {
                              fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addr)}&format=jsonv2&limit=1&countrycodes=ar`,
                                { headers: { 'User-Agent': 'Genesis360App/1.0' } })
                                .then(r => r.json()).then((d: any[]) => {
                                  if (d?.[0]) setEnvioOrigenCoords(`${d[0].lat},${d[0].lon}`)
                                }).catch(() => {})
                            }
                            autoCalcularDistancia(addr, envioDestinoVenta)
                          }}
                          placeholder="Dirección de la sucursal..."
                        />
                        {envioOrigenGeoError && (
                          <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                            ⚠ No se encontró esta dirección — verificá que sea correcta en{' '}
                            <a href="/sucursales" className="underline font-medium">Sucursales</a>{' '}
                            o ingresá una nueva arriba.
                          </p>
                        )}
                      </div>

                      {/* ISS-164: Destino con autocompletado Google Places + domicilios del cliente */}
                      <div>
                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                          Dirección de entrega
                          {domiciliosFormateadosVenta.length > 0 && (
                            <span className="ml-1 text-accent">({domiciliosFormateadosVenta.length} guardada{domiciliosFormateadosVenta.length > 1 ? 's' : ''})</span>
                          )}
                        </label>
                        <AddressAutocompleteInput
                          value={envioDestinoVenta}
                          onChange={v => { setEnvioDestinoVenta(v); setEnvioDestinoCoords('') }}
                          onPlaceSelected={(addr, placeId) => {
                            setEnvioDestinoVenta(addr)
                            const isCoords = /^-?\d+\.?\d*,-?\d+\.?\d*$/.test(placeId)
                            const destCoords = isCoords ? placeId : ''
                            setEnvioDestinoCoords(destCoords)
                            // Haversine inmediato si tenemos coords de ambos puntos
                            if (destCoords && envioOrigenCoords && envioTipoVenta === 'km') {
                              const km = haversineKmCoords(envioOrigenCoords, destCoords)
                              if (km !== null) { setEnvioKmVenta(String(km)); return }
                            }
                            autoCalcularDistancia(envioOrigenVenta, isCoords ? placeId : addr)
                          }}
                          savedAddresses={domiciliosFormateadosVenta}
                          placeholder="Calle, número, ciudad..."
                        />
                        {calculandoDistancia && (
                          <p className="text-xs text-accent mt-1 animate-pulse">Calculando distancia...</p>
                        )}
                        {envioDestinoGeoError && !calculandoDistancia && (
                          <p className="text-xs text-red-500 mt-1">
                            ⚠ No se encontró esta dirección — intentá escribirla más completa (ej: "Av. Corrientes 1515, CABA").
                          </p>
                        )}
                        {/* Link Maps: usa coordenadas exactas cuando disponibles (Nominatim/geocoder) */}
                        {envioOrigenVenta && envioDestinoVenta && (
                          <a href={`https://www.google.com/maps/dir/${encodeURIComponent(envioOrigenVenta)}/${envioDestinoCoords || encodeURIComponent(envioDestinoVenta)}`}
                            target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 hover:text-accent mt-1 transition-colors">
                            🗺 Ver ruta en Google Maps
                          </a>
                        )}
                      </div>

                      {/* Fecha + rango horario de entrega acordados (ISS-178) */}
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Fecha de entrega acordada</label>
                          <input type="date" value={envioFechaVenta} onChange={e => setEnvioFechaVenta(e.target.value)}
                            className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Rango horario</label>
                          {(() => {
                            const rangos: Array<{ desde: string; hasta: string }> = Array.isArray((tenant as any)?.envio_rangos_horarios)
                              ? (tenant as any).envio_rangos_horarios
                              : []
                            return (
                              <select
                                value={envioRangoHorarioIdx}
                                onChange={e => setEnvioRangoHorarioIdx(e.target.value)}
                                disabled={rangos.length === 0}
                                className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:bg-gray-50 dark:disabled:bg-gray-800"
                              >
                                <option value="">{rangos.length === 0 ? 'Sin rangos configurados' : 'Sin definir'}</option>
                                {rangos.map((r, i) => (
                                  <option key={i} value={String(i)}>{r.desde} – {r.hasta}</option>
                                ))}
                              </select>
                            )
                          })()}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Totales */}
            {cart.length > 0 && (
              <div className="bg-surface rounded-xl p-4 shadow-sm border border-border-ds space-y-2">
                {(() => {
                  const subtotalSinDesc = cart.reduce((acc, item) => {
                    const cant = item.tiene_series ? item.series_seleccionadas.length : item.cantidad
                    return acc + item.precio_unitario * cant
                  }, 0)
                  const descItemsTotal = subtotalSinDesc - subtotal
                  return (
                    <>
                      <div className="flex justify-between text-sm text-muted">
                        <span>Precio lista</span>
                        <span>${subtotalSinDesc.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                      </div>
                      {descItemsTotal > 0 && (
                        <div className="flex justify-between text-sm text-info">
                          <span>Desc. por producto</span>
                          <span>−${descItemsTotal.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-sm text-muted">
                        <span>Subtotal</span>
                        <span>${subtotal.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                      </div>
                    </>
                  )
                })()}
                {descTotalMonto > 0 && (
                  <div className="flex justify-between text-sm text-success">
                    <span>Desc. general {descuentoTotalTipo === 'pct' ? `(${descTotalVal}%)` : `($${descTotalVal})`}</span>
                    <span>−${descTotalMonto.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                  </div>
                )}
                {combosActivosMulti.map(c => (
                  <div key={c.id} className="flex justify-between text-sm text-success">
                    <span>🎁 {c.nombre}</span>
                    <span>−${c.monto.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                  </div>
                ))}
                {costoEnvioNum > 0 && (
                  <div className="flex justify-between text-sm text-gray-600 dark:text-gray-300">
                    <span className="flex items-center gap-1"><Truck size={13} /> Envío</span>
                    <span>+${costoEnvioNum.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-primary text-lg border-t border-border-ds pt-2">
                  <span>Total</span>
                  <span>${totalConEnvio.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span>
                </div>
                {/* IVA desglosado por alícuota real */}
                {total > 0 && (() => {
                  const ivaByRate: Record<number, number> = {}
                  cart.forEach(item => {
                    const itemSubtotal = getItemSubtotal(item)
                    const rate = item.alicuota_iva ?? 21
                    if (rate > 0) {
                      const iva = itemSubtotal - itemSubtotal / (1 + rate / 100)
                      ivaByRate[rate] = (ivaByRate[rate] ?? 0) + iva
                    }
                  })
                  const entries = Object.entries(ivaByRate)
                  if (entries.length === 0) return null
                  return (
                    <div className="space-y-0.5">
                      {entries.map(([rate, amount]) => (
                        <div key={rate} className="flex justify-between text-xs text-gray-400 dark:text-gray-500">
                          <span>IVA {rate}% incluido</span>
                          <span>${(amount as number).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                        </div>
                      ))}
                    </div>
                  )
                })()}
              </div>
            )}

            {/* Método de pago — solo para reservada/despachada */}
            {modoVenta !== 'pendiente' && cart.length > 0 && (
              <div className="bg-surface rounded-xl p-4 shadow-sm border border-border-ds space-y-3">
                <h2 className="font-semibold text-primary flex items-center gap-2"><CreditCard size={16} /> Método de pago</h2>

                {mediosPago.map((mp, idx) => (
                  <div key={idx}>
                  <div className="flex gap-2 items-center">
                    <select value={mp.tipo} onChange={e => updateMedioPago(idx, 'tipo', e.target.value)}
                      className="flex-1 px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent">
                      <option value="">Medio de pago...</option>
                      {MEDIOS_PAGO.map(m => <option key={m} value={m}>{m}</option>)}
                      {/* ISS-090: CC como medio de pago parcial */}
                      {clienteCCEnabled && clienteId && (
                        <option value="Cuenta Corriente">💳 Cuenta Corriente</option>
                      )}
                      {/* E2: crédito a favor del cliente */}
                      {clienteId && clienteCredito > 0 && (
                        <option value="Crédito a favor">🎁 Crédito a favor (${clienteCredito.toLocaleString('es-AR', { maximumFractionDigits: 0 })})</option>
                      )}
                    </select>
                    <input type="number" onWheel={e => e.currentTarget.blur()} min="0" value={mp.monto}
                      onChange={e => updateMedioPago(idx, 'monto', e.target.value)}
                      onBlur={() => setCommittedAsignado(mediosPago.reduce((acc, m) => acc + (parseFloat(m.monto) || 0), 0))}
                      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                      placeholder="Monto"
                      className="w-24 px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
                    {mp.tipo === 'Mercado Pago' && parseFloat(mp.monto) > 0 && (
                      <button onClick={() => generarLinkMPCheckout(parseFloat(mp.monto))} disabled={generandoMpLink}
                        title="Generar QR / link de pago MP"
                        className="p-1.5 text-blue-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg flex-shrink-0 disabled:opacity-50 transition-colors">
                        <QrCode size={16} />
                      </button>
                    )}
                    {/* ISS-072: botón QR MODO */}
                    {mp.tipo === 'MODO' && parseFloat(mp.monto) > 0 && (
                      <button onClick={() => generarPagoMODO(parseFloat(mp.monto))} disabled={generandoModo}
                        title="Generar QR MODO (bancos interoperable)"
                        className="p-1.5 text-purple-500 hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded-lg flex-shrink-0 disabled:opacity-50 transition-colors">
                        <QrCode size={16} />
                      </button>
                    )}
                    {/* ISS-086: indicador cuotas si ya seleccionó */}
                    {mp.tipo === 'Tarjeta crédito' && cuotasSeleccion[idx] && (
                      <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 font-medium ${cuotasSeleccion[idx].sinInteres ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>
                        {cuotasSeleccion[idx].cuotas}x
                      </span>
                    )}
                    {mediosPago.length > 1 && (
                      <button onClick={() => { removeMedioPago(idx); setCuotasSeleccion(p => { const n = { ...p }; delete n[idx]; return n }) }} title="Quitar medio de pago" className="text-gray-400 dark:text-gray-500 hover:text-red-500 flex-shrink-0">
                        <X size={16} />
                      </button>
                    )}
                  </div>
                  {/* ISS-086: picker de cuotas cuando es Tarjeta crédito y hay bancos config */}
                  {mp.tipo === 'Tarjeta crédito' && cuotasBancos.length > 0 && parseFloat(mp.monto) > 0 && (() => {
                    const sel = cuotasSeleccion[idx]
                    const banco = cuotasBancos.find(b => b.nombre === sel?.banco) ?? cuotasBancos[0]
                    const montoCuota = sel && sel.cuotas > 0
                      ? (parseFloat(mp.monto) * (1 + sel.interes / 100)) / sel.cuotas
                      : null
                    return (
                      <div className="mt-1.5 bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3 space-y-2">
                        <div className="flex gap-2 flex-wrap">
                          <select value={sel?.banco ?? ''} onChange={e => setCuotasSeleccion(p => ({ ...p, [idx]: { ...p[idx], banco: e.target.value, cuotas: 0, interes: 0, sinInteres: false } }))}
                            className="flex-1 text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1 focus:outline-none focus:border-accent dark:bg-gray-700 dark:text-white">
                            <option value="">Banco...</option>
                            {cuotasBancos.map(b => <option key={b.id} value={b.nombre}>{b.nombre}</option>)}
                          </select>
                          <select value={sel?.cuotas ?? ''} onChange={e => {
                            const cuota = banco.cuotas.find(c => c.cant === parseInt(e.target.value))
                            if (!cuota) return
                            setCuotasSeleccion(p => ({ ...p, [idx]: { ...(p[idx] ?? { banco: banco.nombre }), cuotas: cuota.cant, interes: cuota.interes, sinInteres: cuota.sin_interes } }))
                          }} className="flex-1 text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1 focus:outline-none focus:border-accent dark:bg-gray-700 dark:text-white">
                            <option value="">Cuotas...</option>
                            {banco.cuotas.map(c => (
                              <option key={c.cant} value={c.cant}>
                                {c.cant}x {c.sin_interes ? '(sin interés)' : `(+${c.interes}%)`}
                              </option>
                            ))}
                          </select>
                        </div>
                        {sel?.cuotas > 0 && montoCuota !== null && (
                          <div className="flex items-center gap-2 text-xs">
                            {sel.sinInteres
                              ? <span className="bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 px-2 py-0.5 rounded font-medium">Sin interés</span>
                              : <span className="text-amber-600 dark:text-amber-400">+{sel.interes}% interés</span>
                            }
                            <span className="text-gray-500 dark:text-gray-400">
                              {sel.cuotas} cuotas de ${montoCuota.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                              {sel.interes > 0 && ` = $${(parseFloat(mp.monto) * (1 + sel.interes / 100)).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} total`}
                            </span>
                          </div>
                        )}
                      </div>
                    )
                  })()}
                  </div>
                ))}

                <button onClick={addMedioPago}
                  className="flex items-center gap-1 text-xs text-accent hover:underline">
                  <Plus size={12} /> Agregar otro medio
                </button>

                {cart.length > 0 && committedAsignado > 0 && (() => {
                  // ISS-105: faltante calculado contra totalConEnvio
                  const displayFaltante = Math.round((totalConEnvio - committedAsignado) * 100) / 100
                  const vueltoUI = calcularVuelto(mediosPago, totalConEnvio)
                  const esVuelto = vueltoUI >= 0.5
                  const fmt = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
                  return (
                    <p className={`text-xs text-right font-medium ${displayFaltante === 0 ? 'text-green-600 dark:text-green-400' : displayFaltante > 0 ? 'text-orange-500' : esVuelto ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                      {displayFaltante === 0
                        ? '✓ Total cubierto'
                        : displayFaltante > 0
                          ? `Falta asignar: $${fmt(displayFaltante)}`
                          : esVuelto
                            ? `Vuelto: $${fmt(Math.abs(displayFaltante))}`
                            : `Excede por: $${fmt(Math.abs(displayFaltante))}`}
                    </p>
                  )
                })()}
              </div>
            )}

            {/* Acciones — estado caja + modo + botón */}
            {cart.length > 0 && (
              <div className="bg-surface rounded-xl p-4 shadow-sm border border-border-ds space-y-2">
                {(() => {
                  const efectivo = calcularEfectivo(mediosPago, total)
                  if (sesionesAbiertas.length === 0) return (
                    <div className="flex items-center gap-2 text-xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 rounded-lg px-3 py-2.5">
                      <span>⚠️</span><span>Sin caja abierta — no se puede vender ni reservar</span>
                    </div>
                  )
                  if (sesionesAbiertas.length > 1) {
                    const valorSelect = cajaSeleccionadaId ?? cajaPreferidaSesionId ?? ''
                    const sesionActiva = (sesionesAbiertas as any[]).find(s => s.id === valorSelect)
                    return (
                      <div>
                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                          Registrar en caja:
                          {!cajaSeleccionadaId && cajaPreferidaSesionId && (
                            <span className="ml-1 text-[10px] text-yellow-600 dark:text-yellow-400 font-medium">★ predeterminada</span>
                          )}
                        </label>
                        <select value={valorSelect} onChange={e => setCajaSeleccionadaId(e.target.value || null)}
                          className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent">
                          {!valorSelect && <option value="">— Seleccioná una caja —</option>}
                          {(sesionesAbiertas as any[]).map(s => (
                            <option key={s.id} value={s.id}>
                              {s.cajas?.nombre ?? 'Caja'}
                              {s.id === cajaPreferidaSesionId ? ' ★' : ''}
                            </option>
                          ))}
                        </select>
                        {sesionActiva && (
                          <p className="text-[11px] text-green-600 dark:text-green-400 mt-1">
                            ✓ {efectivo > 0 ? 'Efectivo' : 'Venta'} → {sesionActiva.cajas?.nombre ?? 'Caja'}
                          </p>
                        )}
                      </div>
                    )
                  }
                  return (
                    <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 rounded-lg px-3 py-2.5">
                      <span>✓</span><span>{efectivo > 0 ? 'Efectivo' : 'Venta'} → {(sesionesAbiertas[0] as any).cajas?.nombre ?? 'Caja'}</span>
                    </div>
                  )
                })()}
                <div className="space-y-2 pt-1">
                  {/* ISS-103: canal de venta */}
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Canal de venta</label>
                    <select value={canalPOS} onChange={e => setCanalPOS(e.target.value)}
                      className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                      {canalesActivos.length === 0 && <option value="POS">🏪 Presencial</option>}
                      {canalesActivos.map(c => (
                        <option key={c.id} value={c.nombre}>{c.icono ? `${c.icono} ` : ''}{c.nombre}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden text-xs font-medium">
                    {([
                      ['reservada', 'Reservar', ShoppingCart],
                      ['despachada', 'Venta directa', Zap],
                      ['pendiente', 'Presupuesto', FileText],
                    ] as const).map(([modo, label, Icon]) => (
                      <button key={modo} onClick={() => setModoVenta(modo)}
                        className={`flex-1 flex items-center justify-center gap-1 py-2 transition-colors ${modoVenta === modo ? 'bg-accent text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
                        <Icon size={11} />{label}
                      </button>
                    ))}
                  </div>
                  {/* ISS-090: CC activa cuando se usa como medio de pago */}
                  {modoCC && (
                    <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-xl px-3 py-2">
                      <CreditCard size={12} /> <span>Parte de la venta a cuenta corriente del cliente</span>
                    </div>
                  )}
                  <button onClick={() => registrarVenta(modoCC ? 'despachada' : modoVenta)} disabled={saving}
                    className="w-full bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                    {modoCC ? <CreditCard size={16} /> : modoVenta === 'reservada' ? <ShoppingCart size={16} /> : modoVenta === 'despachada' ? <Zap size={16} /> : <FileText size={16} />}
                    {saving ? 'Guardando...' : modoCC ? 'Despachar (cuenta corriente)' : modoVenta === 'reservada' ? 'Reservar stock' : modoVenta === 'despachada' ? 'Venta directa' : 'Guardar presupuesto'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── HISTORIAL ── */}
      {tab === 'historial' && (
        <div className="space-y-4">
          <div className="flex gap-3 flex-wrap">
            <div className="relative flex-1 min-w-48">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
              <input type="text" value={searchHistorial} onChange={e => setSearchHistorial(e.target.value)}
                placeholder="Buscar por N° o cliente..."
                name="buscar-venta-historial" autoComplete="off"
                className="w-full pl-8 pr-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-800" />
            </div>
            <select value={filterEstado} onChange={e => setFilterEstado(e.target.value as EstadoVenta | '')}
              className="px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-800">
              <option value="">Todos los estados</option>
              {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            {categoriasHistorial.length > 0 && (
              <select value={filterCategoria} onChange={e => setFilterCategoria(e.target.value)}
                className="px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-800">
                <option value="">Todas las categorías</option>
                {categoriasHistorial.map((c: any) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            )}
          </div>

          <div className="bg-surface rounded-xl shadow-sm border border-border-ds overflow-hidden">
            {loadingVentas ? (
              <div className="flex items-center justify-center py-16">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : filteredVentas.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
                <ShoppingCart size={40} className="mb-3 opacity-50" />
                <p>No hay ventas registradas</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200 dark:divide-gray-600">
                {filteredVentas.map((v: any) => {
                  const est = ESTADOS[v.estado as EstadoVenta]
                  return (
                    <div key={v.id} className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors"
                      onClick={() => setVentaDetalle(v)}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-bold text-primary">{formatTicket(v)}</span>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${est.bg} ${est.color}`}>{est.label}</span>
                          {v.estado === 'reservada' && calcularSaldoPendiente(v.total ?? 0, v.monto_pagado ?? 0) > 0.5 && (
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400">
                              Saldo ${calcularSaldoPendiente(v.total, v.monto_pagado ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                            </span>
                          )}
                          {isPresupuestoVencido(v, (tenant as any)?.presupuesto_validez_dias) && (
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
                              Vencido
                            </span>
                          )}
                          {v.es_cuenta_corriente && (
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">
                              CC
                            </span>
                          )}
                          {/* ISS-106: badge para ventas CC sin items (ghost de error de stock previo) */}
                          {v.es_cuenta_corriente && v.estado === 'despachada' && (v.venta_items ?? []).length === 0 && (
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400" title="Venta creada pero fallida — cancelar para eliminar la deuda CC">
                              ⚠ Error — Cancelar
                            </span>
                          )}
                          {isPeriodoCerrado(v.created_at) && (
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 flex items-center gap-1" title={`Periodo cerrado hasta ${ultimoCierre} — venta no editable ni eliminable`}>
                              <Lock size={10} /> Cerrado
                            </span>
                          )}
                        </div>
                        <span className="font-bold text-primary">${((v.total ?? 0) + (v.costo_envio ?? 0)).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                      </div>
                      <div className="flex items-center justify-between mt-1 text-xs text-gray-400 dark:text-gray-500">
                        <span>{v.cliente_nombre ?? 'Sin cliente'} {v.medio_pago ? `· ${formatMedioPago(v.medio_pago)}` : ''}</span>
                        <span>{new Date(v.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                      </div>
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {(v.venta_items ?? []).map((item: any) => (
                          <span key={item.id} className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 px-1.5 py-0.5 rounded">
                            {item.cantidad}× {item.productos?.nombre}
                          </span>
                        ))}
                      </div>
                    </div>
                  )
                })}
                {ventas.length >= ventasLimit && (
                  <button onClick={() => setVentasLimit(v => v + 50)}
                    className="w-full py-3 text-sm text-accent hover:bg-accent/5 transition-colors border-t border-gray-100 dark:border-gray-700">
                    Cargar más ventas
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal detalle venta */}
      {ventaDetalle && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-primary">{ventaDetalle.estado === 'pendiente' ? 'Presupuesto' : 'Venta'} {formatTicket(ventaDetalle)}</h2>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ESTADOS[ventaDetalle.estado as EstadoVenta]?.bg} ${ESTADOS[ventaDetalle.estado as EstadoVenta]?.color}`}>
                    {ESTADOS[ventaDetalle.estado as EstadoVenta]?.label}
                  </span>
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    {new Date(ventaDetalle.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                </div>
              </div>
              <button onClick={() => { setVentaDetalle(null); setEditandoPago(false) }} title="Cerrar" className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-400"><X size={20} /></button>
            </div>

            {ventaDetalle.cliente_nombre && (
              <div className="mb-3 text-sm text-gray-600 dark:text-gray-400">
                <span className="font-medium">Cliente:</span> {ventaDetalle.cliente_nombre}
                {ventaDetalle.cliente_telefono && ` · ${ventaDetalle.cliente_telefono}`}
              </div>
            )}

            <div className="space-y-2 mb-4">
              {(ventaDetalle.venta_items ?? []).map((item: any) => {
                const nrosSerie = (item.venta_series ?? [])
                  .map((vs: any) => vs.inventario_series?.nro_serie)
                  .filter(Boolean)
                const lpn = item.inventario_lineas?.lpn
                const despachos = (despachosPorItem[item.id] ?? []) as any[]
                return (
                  <div key={item.id} className="flex justify-between text-sm bg-page rounded-xl px-3 py-2">
                    <div>
                      <p className="font-medium">{item.productos?.nombre}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">{item.cantidad} × ${item.precio_unitario?.toLocaleString('es-AR')}</p>
                      {item.descuento > 0 && (() => {
                        const descMonto = (item.precio_unitario * item.cantidad) - item.subtotal
                        return (
                          <p className="text-xs text-green-600 dark:text-green-400 font-medium">
                            Descuento {item.descuento}% · −${descMonto.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                          </p>
                        )
                      })()}
                      {nrosSerie.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {nrosSerie.map((s: string) => (
                            <span key={s} className="text-xs text-purple-600 bg-purple-50 dark:bg-purple-900/20 px-1.5 py-0.5 rounded">{s}</span>
                          ))}
                        </div>
                      )}
                      {/* ISS-075: desglose de despacho por LPN/ubicación */}
                      {despachos.length > 0 ? (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {despachos.map((d: any, di: number) => (
                            <span key={di} className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                              {d.nro_serie
                                ? <>#{d.nro_serie}{d.ubicacion_nombre ? ` · ${d.ubicacion_nombre}` : ''}</>
                                : <>{d.cantidad}u{d.lpn ? ` · LPN ${d.lpn}` : ''}{d.ubicacion_nombre ? ` · ${d.ubicacion_nombre}` : ''}</>}
                              {d.origen && <span className="text-gray-400 dark:text-gray-500">· {d.origen}</span>}
                            </span>
                          ))}
                        </div>
                      ) : nrosSerie.length === 0 && lpn && (
                        <span title="Venta anterior al registro de desglose por LPN — se muestra el LPN principal" className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700/50 px-1.5 py-0.5 rounded mt-1 inline-block">LPN principal: {lpn}</span>
                      )}
                    </div>
                    <p className="font-semibold">${item.subtotal?.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</p>
                  </div>
                )
              })}
            </div>

            <div className="border-t border-gray-100 pt-3 mb-4 space-y-1 text-sm">
              {ventaDetalle.descuento_total > 0 && (
                <div className="flex justify-between text-green-600 dark:text-green-400">
                  <span>Descuento {ventaDetalle.descuento_total}%</span>
                  <span>−${(ventaDetalle.subtotal * ventaDetalle.descuento_total / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                </div>
              )}
              {(ventaDetalle.costo_envio ?? 0) > 0 && (
                <div className="flex justify-between text-muted">
                  <span>Envío</span>
                  <span>${(ventaDetalle.costo_envio ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                </div>
              )}
              {(ventaDetalle.costo_envio_logistica ?? 0) > 0 && (
                <div className="flex justify-between text-muted">
                  <span>Envío logística</span>
                  <span>${(ventaDetalle.costo_envio_logistica ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-primary text-base">
                <span>Total</span>
                <span>${((ventaDetalle.total ?? 0) + (ventaDetalle.costo_envio ?? 0) + (ventaDetalle.costo_envio_logistica ?? 0)).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
              </div>
              {(() => {
                // Desglose IVA por tasa desde los items reales
                const ivaMap: Record<number, number> = {}
                for (const item of ventaDetalle.venta_items ?? []) {
                  const tasa = item.alicuota_iva ?? 21
                  const monto = Number(item.iva_monto ?? 0)
                  if (tasa > 0 && monto > 0) ivaMap[tasa] = (ivaMap[tasa] ?? 0) + monto
                }
                const tasas = Object.entries(ivaMap).sort(([a], [b]) => Number(b) - Number(a))
                if (tasas.length === 0 && (ventaDetalle.total ?? 0) > 0) {
                  return (
                    <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500">
                      <span>IVA incluido (21%)</span>
                      <span>${((ventaDetalle.total ?? 0) - (ventaDetalle.total ?? 0) / 1.21).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                    </div>
                  )
                }
                return tasas.map(([tasa, monto]) => (
                  <div key={tasa} className="flex justify-between text-xs text-gray-400 dark:text-gray-500">
                    <span>IVA incluido ({tasa}%)</span>
                    <span>${monto.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                  </div>
                ))
              })()}
              {ventaDetalle.medio_pago && <p className="text-gray-500 dark:text-gray-400">Medio de pago: {formatMedioPago(ventaDetalle.medio_pago)}</p>}
              {/* Pago parcial en reserva */}
              {ventaDetalle.estado === 'reservada' && (() => {
                const saldo = calcularSaldoPendiente(ventaDetalle.total ?? 0, ventaDetalle.monto_pagado ?? 0)
                return (
                  <div className="rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-3 py-2 space-y-1.5">
                    <div className="flex justify-between text-sm">
                      <span className="text-blue-700 dark:text-blue-300">{saldo > 0.5 ? 'Seña cobrada' : 'Ya cobrado'}</span>
                      <span className="font-semibold text-blue-700 dark:text-blue-300">${(ventaDetalle.monto_pagado ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                    </div>
                    {saldo > 0.5 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-orange-600 dark:text-orange-400 font-semibold">Saldo pendiente</span>
                        <span className="font-bold text-orange-600 dark:text-orange-400">${saldo.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                      </div>
                    )}
                    {saldo > 0.5 && (
                      <button onClick={() => generarLinkMP(ventaDetalle.id, saldo)} disabled={generandoMpLink}
                        className="flex items-center gap-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded-lg font-medium disabled:opacity-50 transition-colors">
                        <QrCode size={12} /> {generandoMpLink ? 'Generando...' : `Cobrar $${saldo.toLocaleString('es-AR', { maximumFractionDigits: 0 })} con MP`}
                      </button>
                    )}
                    {editandoPago ? (
                      <div className="flex gap-2 items-center pt-1">
                        <input type="number" onWheel={e => e.currentTarget.blur()} min="0" max={ventaDetalle.total} value={editMontoPagado}
                          onChange={e => setEditMontoPagado(e.target.value)}
                          className="flex-1 px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent"
                          placeholder="Nuevo monto cobrado" autoFocus />
                        <button onClick={guardarMontoPagado} disabled={savingMontoPagado}
                          className="px-3 py-1.5 bg-accent text-white text-xs font-semibold rounded-lg disabled:opacity-50">
                          {savingMontoPagado ? '...' : 'Guardar'}
                        </button>
                        <button onClick={() => setEditandoPago(false)} className="px-2 py-1.5 text-gray-400 hover:text-gray-600 text-xs">✕</button>
                      </div>
                    ) : (
                      <button onClick={() => { setEditandoPago(true); setEditMontoPagado(String(ventaDetalle.monto_pagado ?? 0)) }}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
                        Editar monto cobrado
                      </button>
                    )}
                  </div>
                )
              })()}
              {ventaDetalle.notas && (
                ventaDetalle.estado === 'cancelada'
                  ? (
                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2.5 text-sm">
                      <p className="text-xs font-semibold text-red-600 dark:text-red-400 mb-0.5 uppercase tracking-wide">Motivo de cancelación</p>
                      <p className="text-red-700 dark:text-red-300">{ventaDetalle.notas}</p>
                    </div>
                  ) : (
                    <p className="text-gray-500 dark:text-gray-400 text-sm">Notas: {ventaDetalle.notas}</p>
                  )
              )}
            </div>

            {/* Devoluciones previas colapsable */}
            {devolucionesPasadas.length > 0 && (
              <div className="mb-4 rounded-xl border border-orange-200 dark:border-orange-800 overflow-hidden">
                <button
                  onClick={() => setDevolucionesOpen(o => !o)}
                  className="w-full flex items-center justify-between px-4 py-2.5 bg-orange-50 dark:bg-orange-900/20 text-sm font-medium text-orange-700 dark:text-orange-400">
                  <span className="flex items-center gap-2"><RotateCcw size={14} /> Devoluciones ({devolucionesPasadas.length})</span>
                  {devolucionesOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                {devolucionesOpen && (
                  <div className="divide-y divide-orange-100 dark:divide-orange-800/40">
                    {(devolucionesPasadas as any[]).map((d: any) => (
                      <div key={d.id} className="px-4 py-2 text-xs text-gray-600 dark:text-gray-400 space-y-0.5">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="font-medium text-orange-600 dark:text-orange-400">{d.numero_nc ?? 'Sin NC interna'}</span>
                            <span className="ml-2 text-gray-400">{new Date(d.created_at).toLocaleDateString('es-AR')}</span>
                          </div>
                          {/* Badge NC electrónica emitida */}
                          {d.nc_cae ? (
                            <span className="flex-shrink-0 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full text-xs font-medium">
                              {d.nc_tipo} #{d.nc_numero_comprobante}
                            </span>
                          ) : d.origen === 'facturada' && ventaDetalle?.cae && (tenant as any)?.facturacion_habilitada ? (
                            <button
                              onClick={() => {
                                const pvDefault = (puntosVentaAfip as any[])[0]?.numero ?? 1
                                setNcPV(pvDefault)
                                setNcTipo('NC-B')
                                setNcModal({ devolucionId: d.id, ventaId: ventaDetalle.id, ventaNumero: ventaDetalle.numero, monto: d.monto_total })
                              }}
                              className="flex-shrink-0 flex items-center gap-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-800/40 px-2 py-0.5 rounded-full text-xs font-medium transition-colors">
                              <Receipt size={11} /> Emitir NC
                            </button>
                          ) : null}
                        </div>
                        {d.motivo && <p className="text-gray-400 dark:text-gray-500">{d.motivo}</p>}
                        {(d.devolucion_items ?? []).map((di: any) => (
                          <p key={di.id}>{di.cantidad}× {di.productos?.nombre} — ${(di.precio_unitario * di.cantidad).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</p>
                        ))}
                        <p className="font-semibold text-orange-600 dark:text-orange-400">Total: ${d.monto_total?.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Acciones según estado */}
            {/* Banner presupuesto vencido */}
            {isPresupuestoVencido(ventaDetalle, (tenant as any)?.presupuesto_validez_dias) && (
              <div className="rounded-xl bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 p-3 space-y-2">
                <p className="text-sm font-semibold text-orange-700 dark:text-orange-400 flex items-center gap-2">
                  <AlertTriangle size={15} /> Presupuesto vencido
                </p>
                <p className="text-xs text-orange-600 dark:text-orange-400">
                  Superó los {(tenant as any).presupuesto_validez_dias} días de validez. Actualizá los precios antes de convertirlo a venta.
                </p>
                <button onClick={actualizarPrecios} disabled={actualizandoPrecios}
                  className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-2 rounded-lg transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-60">
                  <RefreshCw size={14} className={actualizandoPrecios ? 'animate-spin' : ''} />
                  {actualizandoPrecios ? 'Actualizando...' : 'Actualizar precios ahora'}
                </button>
              </div>
            )}

            <div className="space-y-2">
              <button
                onClick={() => {
                  const items = (ventaDetalle.venta_items ?? []).map((item: any) => {
                    const nrosSerie = (item.venta_series ?? [])
                      .map((vs: any) => vs.inventario_series?.nro_serie)
                      .filter(Boolean)
                    const primaryLpn: string | null = item.inventario_lineas?.lpn ?? null
                    return {
                      nombre: item.productos?.nombre ?? '',
                      cantidad: item.cantidad,
                      precio_unitario: item.precio_unitario,
                      descuento: item.descuento ?? 0,
                      descuento_tipo: 'pct' as DescTipo,
                      subtotal: item.subtotal,
                      tiene_series: nrosSerie.length > 0,
                      series_seleccionadas: nrosSerie,
                      lpn: primaryLpn,
                      lpn_fuentes: primaryLpn
                        ? [{ linea_id: item.linea_id ?? null, lpn: primaryLpn, cantidad: item.cantidad }]
                        : undefined,
                    }
                  })
                  setTicketVenta({ ...ventaDetalle, items })
                }}
                className="w-full flex items-center justify-center gap-2 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-medium py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all text-sm">
                <Printer size={15} /> Ver / Imprimir ticket
              </button>
              {/* VF3/J1 — auditoría de la venta */}
              {ventaAuditoria.length > 0 && (
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1.5"><Lock size={12} /> Auditoría</p>
                  <div className="space-y-1.5">
                    {(ventaAuditoria as any[]).map(a => (
                      <div key={a.id} className="text-xs text-gray-600 dark:text-gray-300 flex items-start gap-2">
                        <span className="text-gray-400 whitespace-nowrap">{new Date(a.created_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                        <span className="flex-1">
                          <span className="font-medium">{({ anulacion: 'Anulación', cambio_cliente: 'Cambio de cliente', override_descuento: 'Override de descuento', edicion_items: 'Edición de ítems', nc_interna: 'NC interna (no fiscal)', devolucion: 'Devolución' } as any)[a.accion] ?? a.accion}</span>
                          {a.usuario_nombre ? ` · ${a.usuario_nombre}` : ''}
                          {a.accion === 'cambio_cliente' && a.detalle?.cliente_nuevo ? ` → ${a.detalle.cliente_nuevo}` : ''}
                          {(a.accion === 'nc_interna' || a.accion === 'devolucion') && a.detalle?.numero_nc ? ` · ${a.detalle.numero_nc}` : ''}
                          {(a.accion === 'nc_interna' || a.accion === 'devolucion') && a.detalle?.monto != null ? ` · $${Number(a.detalle.monto).toLocaleString('es-AR', { maximumFractionDigits: 0 })}` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* F1 — actualizar presupuesto on-demand (recrea con precios actuales + resetea contador de vencimiento) */}
              {ventaDetalle.estado === 'pendiente' && !isPresupuestoVencido(ventaDetalle, (tenant as any)?.presupuesto_validez_dias) && (
                <button onClick={actualizarPrecios} disabled={actualizandoPrecios}
                  title="Recrea el presupuesto con los precios actuales y reinicia el plazo de validez"
                  className="w-full flex items-center justify-center gap-2 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-medium py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all text-sm disabled:opacity-60">
                  <RefreshCw size={15} className={actualizandoPrecios ? 'animate-spin' : ''} />
                  {actualizandoPrecios ? 'Actualizando...' : 'Actualizar presupuesto (precios + validez)'}
                </button>
              )}
              {ventaDetalle.estado === 'pendiente' && (
                <div className="space-y-2">
                  <button
                    onClick={() => ventaDetalle?.id && accionPresupuestoPDF(ventaDetalle.id, 'descargar')}
                    disabled={descargandoPresupuesto}
                    className="w-full flex items-center justify-center gap-2 border border-accent/40 text-accent font-medium py-2.5 rounded-xl hover:bg-accent/5 transition-all text-sm disabled:opacity-50">
                    {descargandoPresupuesto
                      ? <><RefreshCw size={15} className="animate-spin" /> Generando PDF…</>
                      : <><FileDown size={15} /> Descargar Presupuesto PDF</>}
                  </button>
                  <button
                    onClick={() => ventaDetalle?.id && accionPresupuestoPDF(ventaDetalle.id, 'imprimir')}
                    disabled={descargandoPresupuesto}
                    className="w-full flex items-center justify-center gap-2 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-medium py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all text-sm disabled:opacity-50">
                    <Printer size={15} /> Imprimir presupuesto
                  </button>
                </div>
              )}
              {ventaDetalle.cae && (
                <div className="space-y-2">
                  <button
                    onClick={descargarFacturaPDFVenta}
                    disabled={descargandoPdfVenta}
                    className="w-full flex items-center justify-center gap-2 border border-accent/40 text-accent font-medium py-2.5 rounded-xl hover:bg-accent/5 transition-all text-sm disabled:opacity-50">
                    {descargandoPdfVenta
                      ? <><RefreshCw size={15} className="animate-spin" /> Generando PDF…</>
                      : <><FileDown size={15} /> Descargar Factura PDF</>}
                  </button>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => ventaDetalle?.id && accionFacturaPDF(ventaDetalle.id, 'imprimir')}
                      disabled={descargandoPdfVenta}
                      className="flex items-center justify-center gap-2 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-medium py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all text-sm disabled:opacity-50">
                      <Printer size={15} /> Imprimir
                    </button>
                    <button
                      onClick={() => ventaDetalle?.id && abrirEnviarFacturaEmail(ventaDetalle.id)}
                      disabled={enviandoFacturaEmail}
                      className="flex items-center justify-center gap-2 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-medium py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all text-sm disabled:opacity-50">
                      {enviandoFacturaEmail
                        ? <><RefreshCw size={15} className="animate-spin" /> Enviando…</>
                        : <><Send size={15} /> Enviar por email</>}
                    </button>
                  </div>
                </div>
              )}
              {ventaDetalle.estado !== 'pendiente' && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => ventaDetalle?.id && accionRemitoPDF(ventaDetalle.id, 'descargar')}
                    disabled={descargandoRemito}
                    className="flex items-center justify-center gap-2 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-medium py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all text-sm disabled:opacity-50">
                    {descargandoRemito
                      ? <><RefreshCw size={15} className="animate-spin" /> Generando…</>
                      : <><FileDown size={15} /> Remito PDF</>}
                  </button>
                  <button
                    onClick={() => ventaDetalle?.id && accionRemitoPDF(ventaDetalle.id, 'imprimir')}
                    disabled={descargandoRemito}
                    className="flex items-center justify-center gap-2 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-medium py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all text-sm disabled:opacity-50">
                    <Printer size={15} /> Imprimir remito
                  </button>
                </div>
              )}
              {ventaDetalle.estado === 'pendiente' && (() => {
                const vencido = isPresupuestoVencido(ventaDetalle, (tenant as any)?.presupuesto_validez_dias)
                return (
                  <button onClick={() => {
                    if (!(ventaDetalle.monto_pagado > 0)) {
                      setSaldoModal({
                        ventaId: ventaDetalle.id,
                        total: (ventaDetalle.total ?? 0) + (ventaDetalle.costo_envio ?? 0),
                        montoPagado: 0,
                        mediosPago: [{ tipo: '', monto: '' }],
                        targetEstado: 'reservada',
                      })
                      return
                    }
                    cambiarEstado.mutate({ ventaId: ventaDetalle.id, nuevoEstado: 'reservada' })
                  }}
                    disabled={cambiarEstado.isPending || vencido}
                    title={vencido ? 'Presupuesto vencido — actualizá los precios primero' : undefined}
                    className="w-full bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl transition-all disabled:opacity-40">
                    Reservar stock
                  </button>
                )
              })()}
              {(ventaDetalle.estado === 'pendiente' || ventaDetalle.estado === 'reservada') && (() => {
                const vencido = ventaDetalle.estado === 'pendiente' && isPresupuestoVencido(ventaDetalle, (tenant as any)?.presupuesto_validez_dias)
                return (
                  <button onClick={() => {
                    const totalConShipping = (ventaDetalle.total ?? 0) + (ventaDetalle.costo_envio ?? 0)
                    const saldo = calcularSaldoPendiente(totalConShipping, ventaDetalle.monto_pagado ?? 0)
                    if (saldo > 0.5) {
                      setSaldoModal({
                        ventaId: ventaDetalle.id,
                        total: totalConShipping,
                        montoPagado: ventaDetalle.monto_pagado ?? 0,
                        mediosPago: [{ tipo: '', monto: saldo.toFixed(2) }],
                      })
                    } else {
                      cambiarEstado.mutate({ ventaId: ventaDetalle.id, nuevoEstado: 'despachada' })
                    }
                  }}
                    disabled={cambiarEstado.isPending || vencido}
                    title={vencido ? 'Presupuesto vencido — actualizá los precios primero' : undefined}
                    className="w-full bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-40">
                    <Truck size={16} /> Finalizar (rebaja stock)
                  </button>
                )
              })()}
              {/* Emitir comprobante AFIP si la venta despachada aún no tiene CAE (ej. se saltó el prompt) */}
              {ventaDetalle.estado === 'despachada' && !ventaDetalle.cae && factHabilitada && (
                <button onClick={() => triggerFacturaModal(ventaDetalle.id, ventaDetalle.numero, Number(ventaDetalle.total), ventaDetalle.clientes?.condicion_iva_receptor)}
                  className="w-full bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl transition-all flex items-center justify-center gap-2">
                  <Receipt size={16} /> Emitir factura
                </button>
              )}
              {ventaDetalle.estado === 'despachada' && (
                factHabilitada && !ventaDetalle.cae ? (
                  <button onClick={() => cambiarEstado.mutate({ ventaId: ventaDetalle.id, nuevoEstado: 'facturada' })}
                    disabled={cambiarEstado.isPending}
                    className="w-full text-gray-500 dark:text-gray-400 font-medium py-1.5 text-xs hover:underline disabled:opacity-40">
                    O marcar como facturada sin emitir comprobante
                  </button>
                ) : (
                  <button onClick={() => cambiarEstado.mutate({ ventaId: ventaDetalle.id, nuevoEstado: 'facturada' })}
                    disabled={cambiarEstado.isPending}
                    className="w-full bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl transition-all">
                    Marcar como facturada
                  </button>
                )
              )}
              {['despachada', 'facturada'].includes(ventaDetalle.estado) && (
                <button onClick={() => abrirModalDevolucion(ventaDetalle)}
                  className="w-full flex items-center justify-center gap-2 border-2 border-orange-200 text-orange-600 dark:text-orange-400 font-semibold py-2.5 rounded-xl hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-all text-sm">
                  <RotateCcw size={15} /> Devolver
                </button>
              )}
              {/* J2 — acciones con clave maestra (anular despachada / cambiar cliente) */}
              {!esContador && ['despachada', 'facturada'].includes(ventaDetalle.estado) && !isPeriodoCerrado(ventaDetalle.created_at) && (
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => pedirClaveMaestra('Anular venta despachada', () => {
                    logVentaAuditoria(ventaDetalle.id, 'anulacion', { estado_previo: ventaDetalle.estado, total: ventaDetalle.total })
                    cambiarEstado.mutate({ ventaId: ventaDetalle.id, nuevoEstado: 'cancelada' })
                  })}
                    disabled={cambiarEstado.isPending}
                    className="flex items-center justify-center gap-1.5 border-2 border-red-200 text-red-600 dark:text-red-400 font-semibold py-2.5 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 transition-all text-sm">
                    <X size={15} /> Anular
                  </button>
                  <button onClick={() => { setCambiarClienteVenta(ventaDetalle); setClienteSearch('') }}
                    className="flex items-center justify-center gap-1.5 border-2 border-blue-200 text-blue-600 dark:text-blue-400 font-semibold py-2.5 rounded-xl hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all text-sm">
                    <User size={15} /> Cambiar cliente
                  </button>
                </div>
              )}
              {ventaDetalle.estado === 'reservada' && (
                <button onClick={modificarReserva} disabled={cambiarEstado.isPending}
                  className="w-full border-2 border-amber-200 text-amber-700 dark:text-amber-400 font-semibold py-2.5 rounded-xl hover:bg-amber-50 dark:bg-amber-900/20 transition-all text-sm flex items-center justify-center gap-2">
                  <ShoppingCart size={15} /> Modificar productos (cancela y recrea)
                </button>
              )}
              {['pendiente', 'reservada'].includes(ventaDetalle.estado) && (
                <button onClick={() => {
                  const montoCobrado = ventaDetalle.monto_pagado ?? 0
                  // E3 — toda cancelación de reserva pasa por el modal (motivo + obs).
                  // E2/E4 — con seña: requiere DUEÑO/SUPERVISOR/ADMIN + penalidad/destino.
                  if (ventaDetalle.estado === 'reservada') {
                    if (montoCobrado > 0) {
                      const rolesCancela = ['DUEÑO', 'SUPERVISOR', 'ADMIN', 'SUPER_USUARIO']
                      if (!rolesCancela.includes(user?.rol ?? '')) {
                        toast.error('Solo DUEÑO o SUPERVISOR pueden cancelar una reserva con seña pagada.')
                        return
                      }
                    }
                    setCancelReservaModal({ venta: ventaDetalle, destino: 'devolucion', motivo: '', observacion: '' })
                    return
                  }
                  // Presupuesto (pendiente): cancelación simple
                  if (!confirm('¿Cancelar este presupuesto?')) return
                  cambiarEstado.mutate({ ventaId: ventaDetalle.id, nuevoEstado: 'cancelada' })
                }}
                  disabled={cambiarEstado.isPending}
                  className="w-full border-2 border-red-200 text-red-600 dark:text-red-400 font-semibold py-2.5 rounded-xl hover:bg-red-50 dark:bg-red-900/20 transition-all">
                  Cancelar venta
                </button>
              )}
              {['cancelada', 'pendiente'].includes(ventaDetalle.estado) && (
                isPeriodoCerrado(ventaDetalle.created_at) ? (
                  <div className="w-full border-2 border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 font-medium py-2 rounded-xl text-sm flex items-center justify-center gap-2">
                    <Lock size={14} /> Periodo cerrado hasta {ultimoCierre} — no editable
                  </div>
                ) : (
                  <button onClick={async () => {
                    if (!confirm('¿Eliminar definitivamente esta venta? Esta acción no se puede deshacer.')) return
                    const { error } = await supabase.from('ventas').delete().eq('id', ventaDetalle.id)
                    if (error) {
                      const msg = (error.message ?? '').toLowerCase()
                      if (msg.includes('periodo contable cerrado') || msg.includes('período contable cerrado')) {
                        toast.error(error.message)
                      } else {
                        toast.error('Error al eliminar')
                      }
                      return
                    }
                    toast.success('Venta eliminada')
                    setVentaDetalle(null)
                    qc.invalidateQueries({ queryKey: ['ventas'] })
                  }}
                    className="w-full border-2 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 font-semibold py-2 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 hover:border-red-200 hover:text-red-500 transition-all text-sm">
                    Eliminar venta
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal DEVOLUCIÓN */}
      {devolucionVenta && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-700">
              <div>
                <h2 className="text-lg font-bold text-primary flex items-center gap-2"><RotateCcw size={18} className="text-orange-500" /> Procesar devolución</h2>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Venta #{devolucionVenta.numero} · {devolucionVenta.estado === 'facturada' ? 'Se generará nota de crédito' : 'Registra devolución sin NC'}</p>
              </div>
              <button onClick={() => setDevolucionVenta(null)} title="Cerrar" className="text-gray-400 hover:text-gray-600 dark:text-gray-500"><X size={20} /></button>
            </div>

            <div className="p-5 space-y-4">
              {/* Ítems a devolver */}
              <div>
                <p className="text-sm font-medium text-primary mb-2">Ítems a devolver</p>
                <div className="space-y-2">
                  {devItems.map((item, idx) => (
                    <div key={item.venta_item_id} className="bg-page rounded-xl p-3">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-medium">{item.nombre}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500">${item.precio_unitario.toLocaleString('es-AR', { maximumFractionDigits: 0 })} c/u</p>
                      </div>
                      {item.tiene_series ? (
                        <div className="space-y-1">
                          <p className="text-xs text-gray-500 dark:text-gray-400">Seleccioná series a devolver:</p>
                          <div className="flex flex-wrap gap-1">
                            {item.venta_series.map(vs => {
                              const sel = item.series_seleccionadas.includes(vs.serie_id)
                              return (
                                <button key={vs.serie_id}
                                  onClick={() => setDevItems(prev => prev.map((it, i) => i !== idx ? it : {
                                    ...it,
                                    series_seleccionadas: sel
                                      ? it.series_seleccionadas.filter(s => s !== vs.serie_id)
                                      : [...it.series_seleccionadas, vs.serie_id]
                                  }))}
                                  className={`text-xs px-2 py-0.5 rounded border transition-colors ${sel ? 'bg-orange-100 dark:bg-orange-900/30 border-orange-400 text-orange-700 dark:text-orange-300' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'}`}>
                                  {vs.nro_serie}
                                </button>
                              )
                            })}
                          </div>
                          {item.series_seleccionadas.length > 0 && (
                            <p className="text-xs text-orange-600 dark:text-orange-400">{item.series_seleccionadas.length} serie(s) · ${(item.precio_unitario * item.series_seleccionadas.length).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</p>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-3 mt-1">
                          <label className="text-xs text-gray-500 dark:text-gray-400">Cant. a devolver (máx {item.cantidad_original}):</label>
                          <input type="number" onWheel={e => e.currentTarget.blur()} min="0" max={item.cantidad_original}
                            value={item.cantidad_devolver}
                            onChange={e => setDevItems(prev => prev.map((it, i) => i !== idx ? it : { ...it, cantidad_devolver: Math.min(item.cantidad_original, Math.max(0, parseInt(e.target.value) || 0)) }))}
                            className="w-20 px-2 py-1 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-center focus:outline-none focus:border-accent" />
                          {item.cantidad_devolver > 0 && (
                            <span className="text-xs text-orange-600 dark:text-orange-400">${(item.precio_unitario * item.cantidad_devolver).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Total */}
              {(() => {
                const total = devItems.reduce((acc, i) => {
                  const cant = i.tiene_series ? i.series_seleccionadas.length : i.cantidad_devolver
                  return acc + i.precio_unitario * cant
                }, 0)
                return total > 0 ? (
                  <div className="flex justify-between items-center font-semibold text-sm bg-orange-50 dark:bg-orange-900/20 rounded-xl px-4 py-2.5 text-orange-700 dark:text-orange-300">
                    <span>Total a devolver</span>
                    <span>${total.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                  </div>
                ) : null
              })()}

              {/* Motivo */}
              <div>
                <label className="block text-sm font-medium text-primary mb-1">Motivo (opcional)</label>
                <input type="text" value={devMotivo} onChange={e => setDevMotivo(e.target.value)}
                  placeholder="Producto dañado, talla incorrecta..."
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent" />
              </div>

              {/* A7 — Destino del stock devuelto (no aplica a series — esas siempre vuelven a su línea original) */}
              <div>
                <label className="block text-sm font-medium text-primary mb-1.5">Destino del stock devuelto</label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <label className={`flex items-start gap-2 px-3 py-2 border rounded-lg cursor-pointer flex-1 transition-colors ${devDestinoStock === 'dev' ? 'border-accent bg-accent/5' : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30'}`}>
                    <input
                      type="radio"
                      name="dev-destino"
                      value="dev"
                      checked={devDestinoStock === 'dev'}
                      onChange={() => setDevDestinoStock('dev')}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-primary">Dejar en DEV para revisión</p>
                      <p className="text-[11px] text-muted">Va a la ubicación de devoluciones, excluida de venta. Default.</p>
                    </div>
                  </label>
                  <label className={`flex items-start gap-2 px-3 py-2 border rounded-lg cursor-pointer flex-1 transition-colors ${devDestinoStock === 'vendible' ? 'border-accent bg-accent/5' : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30'}`}>
                    <input
                      type="radio"
                      name="dev-destino"
                      value="vendible"
                      checked={devDestinoStock === 'vendible'}
                      onChange={() => setDevDestinoStock('vendible')}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-primary">Reintegrar a stock vendible</p>
                      <p className="text-[11px] text-muted">Entra como disponible para venta, sin ubicación (asignar después).</p>
                    </div>
                  </label>
                </div>
              </div>

              {/* L1 — Selector de caja para el egreso efectivo */}
              {devMediosPago.some(mp => mp.tipo === 'Efectivo' && parseFloat(mp.monto) > 0) && sesionesAbiertas.length > 0 && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-3">
                  <label className="block text-xs font-medium text-amber-800 dark:text-amber-300 mb-1">
                    💵 Caja para el egreso efectivo *
                  </label>
                  {sesionesAbiertas.length === 1 ? (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      → {(sesionesAbiertas[0] as any).cajas?.nombre ?? 'Caja única'}
                    </p>
                  ) : (
                    <select value={devCajaSesionId} onChange={e => setDevCajaSesionId(e.target.value)}
                      className="w-full px-3 py-2 border border-amber-300 dark:border-amber-600 rounded-lg text-sm focus:outline-none focus:border-amber-500 bg-white dark:bg-gray-800">
                      <option value="">— Seleccioná de qué caja sale el efectivo —</option>
                      {(sesionesAbiertas as any[]).map((s: any) => (
                        <option key={s.id} value={s.id}>{s.cajas?.nombre ?? 'Caja'}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* Medio de devolución */}
              <div>
                <label className="block text-sm font-medium text-primary mb-1">Medio de devolución</label>
                <div className="space-y-2">
                  {devMediosPago.map((mp, idx) => (
                    <div key={idx} className="flex gap-2">
                      <select value={mp.tipo} onChange={e => setDevMediosPago(prev => prev.map((m, i) => i !== idx ? m : { ...m, tipo: e.target.value }))}
                        className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent">
                        <option value="">Sin devolución monetaria</option>
                        {MEDIOS_PAGO.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                      {mp.tipo && (
                        <input type="number" onWheel={e => e.currentTarget.blur()} min="0" value={mp.monto}
                          onChange={e => setDevMediosPago(prev => prev.map((m, i) => i !== idx ? m : { ...m, monto: e.target.value }))}
                          placeholder="Monto"
                          className="w-28 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent" />
                      )}
                      {devMediosPago.length > 1 && (
                        <button onClick={() => setDevMediosPago(prev => prev.filter((_, i) => i !== idx))} className="text-gray-400 hover:text-red-500 p-1"><X size={16} /></button>
                      )}
                    </div>
                  ))}
                  <button onClick={() => setDevMediosPago(prev => [...prev, { tipo: '', monto: '' }])}
                    className="text-xs text-accent hover:underline">+ Agregar medio</button>
                </div>
              </div>
            </div>

            <div className="px-5 pb-5 flex gap-3">
              <button onClick={() => setDevolucionVenta(null)}
                className="flex-1 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-medium py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 text-sm">
                Cancelar
              </button>
              <button onClick={procesarDevolucion} disabled={devSaving}
                className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-semibold py-2.5 rounded-xl disabled:opacity-50 text-sm flex items-center justify-center gap-2">
                {devSaving ? 'Procesando...' : <><RotateCcw size={15} /> Confirmar devolución</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal COMPROBANTE DEVOLUCIÓN */}
      {devComprobante && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-sm p-6" id="devolucion-print">
            <div className="text-center mb-4 border-b border-dashed border-gray-300 dark:border-gray-600 pb-4">
              {/* VF5/H1 — para ventas facturadas el comprobante es una NC interna (no fiscal) */}
              {devComprobante.origen === 'facturada' && (
                <div className="bg-orange-100 dark:bg-orange-900/30 border border-orange-300 rounded-lg px-3 py-1.5 mb-3 inline-block">
                  <p className="text-xs font-bold text-orange-800 dark:text-orange-400 tracking-wide">NOTA DE CRÉDITO INTERNA · NO FISCAL</p>
                </div>
              )}
              <p className="text-lg font-bold text-primary">{tenant?.nombre ?? 'Genesis360'}</p>
              <p className="text-sm font-semibold text-orange-600 dark:text-orange-400 mt-1">
                {devComprobante.numero_nc ?? 'Comprobante de devolución'}
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                Venta #{devComprobante.venta_numero} · {new Date(devComprobante.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
              </p>
              {devComprobante.origen === 'facturada' && (
                <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">Documento interno de ajuste — no reemplaza la Nota de Crédito electrónica AFIP.</p>
              )}
            </div>
            {devComprobante.motivo && (
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">Motivo: {devComprobante.motivo}</p>
            )}
            <div className="space-y-1.5 mb-4">
              {devComprobante.items.map((item: any, i: number) => (
                <div key={i} className="flex justify-between text-sm">
                  <span>{item.cantidad}× {item.nombre}</span>
                  <span className="font-medium">${(item.precio_unitario * item.cantidad).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-dashed border-gray-300 dark:border-gray-600 pt-3">
              <div className="flex justify-between font-bold text-base text-orange-600 dark:text-orange-400">
                <span>Total devuelto</span>
                <span>${devComprobante.monto_total?.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
              </div>
              {devComprobante.medio_pago?.length > 0 && (
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  {devComprobante.medio_pago.map((m: any) => `${m.tipo} $${m.monto.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`).join(' + ')}
                </p>
              )}
            </div>
            <div className="mt-5 flex gap-3">
              <button onClick={() => { window.print(); }}
                className="flex-1 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-medium py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 text-sm flex items-center justify-center gap-2">
                <Printer size={15} /> Imprimir
              </button>
              <button onClick={() => setDevComprobante(null)}
                className="flex-1 bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl text-sm">
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VF3/J2 — Modal clave maestra */}
      {claveReq && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-xs p-5 space-y-3">
            <h3 className="font-semibold text-primary flex items-center gap-2"><Lock size={16} /> Clave maestra</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">{claveReq.titulo}. Ingresá la clave maestra del DUEÑO para autorizar.</p>
            {/* autoComplete="new-password" evita que Chrome autocomplete el email/usuario
                guardado en el buscador de texto que queda detrás del modal */}
            <input type="password" value={claveInput} onChange={e => setClaveInput(e.target.value)} autoFocus
              onKeyDown={e => { if (e.key === 'Enter') confirmarClaveMaestra() }}
              placeholder="Clave maestra"
              name="clave-maestra-venta" autoComplete="new-password"
              className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
            <div className="flex gap-2">
              <button onClick={() => { setClaveReq(null); setClaveInput('') }}
                className="flex-1 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 py-2 rounded-xl text-sm">Cancelar</button>
              <button onClick={confirmarClaveMaestra} disabled={claveVerificando}
                className="flex-1 bg-accent hover:bg-accent/90 text-white font-semibold py-2 rounded-xl text-sm disabled:opacity-60">
                {claveVerificando ? 'Verificando…' : 'Autorizar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VF3/J2 — Modal cambiar cliente */}
      {cambiarClienteVenta && (
        <div className="fixed inset-0 bg-black/50 z-[55] flex items-center justify-center p-4">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-3">
            <h3 className="font-semibold text-primary flex items-center gap-2"><User size={16} /> Cambiar cliente — Venta {formatTicket(cambiarClienteVenta)}</h3>
            <input type="text" value={clienteSearch} onChange={e => setClienteSearch(e.target.value)} autoFocus
              placeholder="Buscar por nombre o DNI…"
              name="buscar-cliente-cambio" autoComplete="off"
              className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
            <div className="max-h-52 overflow-y-auto space-y-1">
              {(clientesBusqueda as any[]).map(c => (
                <button key={c.id} onClick={() => confirmarCambioCliente(c)}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 text-sm text-gray-700 dark:text-gray-200">
                  {c.nombre}{c.dni ? ` · ${c.dni}` : ''}
                </button>
              ))}
              {clientesBusqueda.length === 0 && <p className="text-xs text-gray-400 px-1 py-2">Escribí para buscar un cliente.</p>}
            </div>
            <button onClick={() => { setCambiarClienteVenta(null); setClienteSearch('') }}
              className="w-full border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 py-2 rounded-xl text-sm">Cerrar</button>
          </div>
        </div>
      )}

      {/* Modal TICKET */}
      {ticketVenta && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-sm flex flex-col max-h-[90vh]" id="ticket-print">
            <div className="overflow-y-auto flex-1 p-6 pb-2">
            <div className="text-center mb-4 border-b border-dashed border-gray-300 dark:border-gray-600 pb-4">
              {ticketVenta.estado === 'pendiente' && (
                <div className="bg-amber-100 dark:bg-amber-900/30 border border-amber-300 rounded-lg px-3 py-1.5 mb-3 inline-block">
                  <p className="text-sm font-bold text-amber-800 dark:text-amber-400 tracking-wider">★ PRESUPUESTO ★</p>
                </div>
              )}
              <p className="text-lg font-bold text-primary">{tenant?.nombre ?? 'Genesis360'}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                {new Date(ticketVenta.created_at ?? Date.now()).toLocaleString('es-AR', {
                  dateStyle: 'full', timeStyle: 'short'
                })}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {ticketVenta.estado === 'pendiente' ? `Presupuesto ${formatTicket(ticketVenta)}` : `Venta ${formatTicket(ticketVenta)}`}
              </p>
              {ticketVenta.estado === 'pendiente' && (tenant as any)?.presupuesto_validez_dias && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 font-medium">
                  Válido por {(tenant as any).presupuesto_validez_dias} días
                </p>
              )}
            </div>

            {ticketVenta.cliente_nombre && (
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                <span className="font-medium">Cliente:</span> {ticketVenta.cliente_nombre}
              </p>
            )}

            <div className="space-y-1.5 mb-4">
              {(ticketVenta.items ?? []).map((item: any, i: number) => {
                const cant = item.tiene_series ? item.series_seleccionadas.length : item.cantidad
                const precioOriginalItem = item.precio_unitario * cant
                return (
                  <div key={i} className="flex justify-between text-sm">
                    <div className="flex-1 min-w-0 pr-2">
                      <span className="font-medium">{item.nombre}</span>
                      <span className="text-gray-400 dark:text-gray-500 ml-1 text-xs">× {cant}</span>
                      {item.descuento > 0 && (
                        <span className="text-green-600 dark:text-green-400 text-xs ml-1">
                          -{item.descuento_tipo === 'pct' ? `${item.descuento}%` : `$${item.descuento}`}
                        </span>
                      )}
                      {item.tiene_series && (item.series_seleccionadas ?? []).length > 0 && (
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">
                          S/N: {(item.series_seleccionadas as string[]).join(', ')}
                        </p>
                      )}
                    </div>
                    <div className="text-right whitespace-nowrap">
                      {item.descuento > 0 && (
                        <span className="line-through text-gray-300 text-xs mr-1">
                          ${precioOriginalItem.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                        </span>
                      )}
                      <span className="font-medium">${item.subtotal?.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                    </div>
                  </div>
                )
              })}
            </div>

            {(() => {
              const precioLista = (ticketVenta.items ?? []).reduce((acc: number, item: any) => {
                const cant = item.tiene_series ? item.series_seleccionadas.length : item.cantidad
                return acc + item.precio_unitario * cant
              }, 0)
              const tieneDescItems = precioLista > (ticketVenta.subtotal ?? 0)
              return (
                <div className="border-t border-dashed border-gray-300 dark:border-gray-600 pt-3 space-y-1">
                  {tieneDescItems && (
                    <div className="flex justify-between text-sm text-gray-400 dark:text-gray-500">
                      <span>Precio lista</span>
                      <span className="line-through">${precioLista.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
                    <span>Subtotal</span>
                    <span>${ticketVenta.subtotal?.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                  </div>
                  {ticketVenta.descuento_total > 0 && (
                    <div className="flex justify-between text-sm text-green-600 dark:text-green-400">
                      <span>Descuento {ticketVenta.descuento_total}%</span>
                      <span>−${(ticketVenta.subtotal * ticketVenta.descuento_total / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                    </div>
                  )}
                  {(() => {
                    // Desglose IVA por tasa
                    const items: any[] = ticketVenta.items ?? []
                    const ivaMap: Record<number, number> = {}
                    let totalIva = 0
                    for (const item of items) {
                      const tasa = item.alicuota_iva ?? 21
                      if (tasa <= 0) continue
                      const cant = item.tiene_series ? item.series_seleccionadas?.length ?? 0 : item.cantidad
                      const sub = item.subtotal ?? item.precio_unitario * cant
                      const iva = sub - sub / (1 + tasa / 100)
                      ivaMap[tasa] = (ivaMap[tasa] ?? 0) + iva
                      totalIva += iva
                    }
                    const tasas = Object.keys(ivaMap).map(Number).filter(t => ivaMap[t] > 0.01)
                    if (tasas.length === 0) return null
                    const neto = (ticketVenta.total ?? 0) - totalIva
                    return (
                      <div className="space-y-0.5 text-xs text-gray-400 dark:text-gray-500 border-t border-dashed border-gray-200 dark:border-gray-700 pt-2 mt-1">
                        <div className="flex justify-between">
                          <span>Neto (sin IVA)</span>
                          <span>${neto.toLocaleString('es-AR', { maximumFractionDigits: 2 })}</span>
                        </div>
                        {tasas.sort((a, b) => a - b).map(tasa => (
                          <div key={tasa} className="flex justify-between">
                            <span>IVA {tasa}%</span>
                            <span>${ivaMap[tasa].toLocaleString('es-AR', { maximumFractionDigits: 2 })}</span>
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                  {(ticketVenta.costo_envio ?? 0) > 0 && (
                    <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
                      <span>Envío</span>
                      <span>${(ticketVenta.costo_envio ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                    </div>
                  )}
                  {(ticketVenta.costo_envio_logistica ?? 0) > 0 && (
                    <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
                      <span>Envío logística</span>
                      <span>${(ticketVenta.costo_envio_logistica ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-primary text-base">
                    <span>TOTAL</span>
                    <span>${((ticketVenta.total ?? 0) + (ticketVenta.costo_envio ?? 0) + (ticketVenta.costo_envio_logistica ?? 0)).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                  </div>
                  {ticketVenta.medio_pago && (() => {
                    let pagos: { tipo: string; monto: number }[] = []
                    try { const p = JSON.parse(ticketVenta.medio_pago); if (Array.isArray(p)) pagos = p } catch {}
                    if (pagos.length === 0)
                      return <p className="text-xs text-gray-400 dark:text-gray-500 text-right">{ticketVenta.medio_pago}</p>
                    return (
                      <div className="space-y-0.5 pt-1 border-t border-dashed border-gray-200 dark:border-gray-700 mt-1">
                        {pagos.map((p, i) => (
                          <div key={i} className="flex justify-between text-xs text-gray-400 dark:text-gray-500">
                            <span>{p.tipo}</span>
                            {p.monto > 0 && <span>${p.monto.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>}
                          </div>
                        ))}
                        {ticketVenta.vuelto > 0 && (
                          <div className="flex justify-between text-sm font-semibold text-green-600 dark:text-green-400 border-t border-dashed border-gray-200 dark:border-gray-700 pt-1 mt-1">
                            <span>Vuelto</span>
                            <span>${ticketVenta.vuelto.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                          </div>
                        )}
                      </div>
                    )
                  })()}
                </div>
              )
            })()}

            <p className="text-center text-xs text-gray-300 mt-4 border-t border-dashed border-gray-200 dark:border-gray-700 pt-3">
              ¡Gracias por su compra!
            </p>
            </div>{/* end scroll area */}

            <div className="p-4 pt-2 border-t border-gray-100 dark:border-gray-700 shrink-0 space-y-2">
              {emailTicketOpen && (
                <div className="flex gap-2">
                  <input type="email" value={emailTicketValue} onChange={e => setEmailTicketValue(e.target.value)}
                    placeholder="email@cliente.com" autoFocus
                    onKeyDown={e => { if (e.key === 'Enter') enviarTicketPorEmail(emailTicketValue) }}
                    className="flex-1 border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                  <button onClick={() => enviarTicketPorEmail(emailTicketValue)} disabled={emailTicketSending}
                    className="px-3 py-1.5 bg-accent text-white rounded-lg text-sm font-medium disabled:opacity-60">
                    {emailTicketSending ? 'Enviando…' : 'Enviar'}
                  </button>
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={() => window.print()}
                  className="flex-1 flex items-center justify-center gap-2 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 py-2 rounded-xl text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <Printer size={15} /> Imprimir
                </button>
                <button onClick={() => { setEmailTicketOpen(o => !o); if (!emailTicketValue) setEmailTicketValue(ticketVenta.clientes?.email ?? ticketVenta.cliente_email ?? '') }}
                  className="flex-1 flex items-center justify-center gap-2 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 py-2 rounded-xl text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <Send size={15} /> Email
                </button>
                <button onClick={() => { setTicketVenta(null); setEmailTicketOpen(false) }}
                  className="flex-1 bg-accent hover:bg-accent/90 text-white font-semibold py-2 rounded-xl text-sm transition-all">
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal selección de series */}
      {seriesModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-primary">Seleccionar series</h2>
              <button onClick={() => { setSeriesModal(null); setSeriesBusqueda('') }} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-400"><X size={20} /></button>
            </div>
            {/* Buscador */}
            <div className="relative mb-3">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
              <input
                type="text"
                placeholder="Buscar N/S o LPN..."
                value={seriesBusqueda}
                onChange={e => setSeriesBusqueda(e.target.value)}
                className="w-full pl-8 pr-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent"
                autoFocus
              />
            </div>
            <div className="space-y-1 max-h-60 overflow-y-auto mb-4">
              {seriesModal.lineas.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">No hay series disponibles</p>
              ) : seriesModal.lineas
                  .filter((s: any) => !seriesBusqueda || s.nro_serie?.toLowerCase().includes(seriesBusqueda.toLowerCase()) || s.lpn?.toLowerCase().includes(seriesBusqueda.toLowerCase()))
                  .map((s: any) => {
                const selected = cart[seriesModal.itemIdx]?.series_seleccionadas.includes(s.id)
                return (
                  <label key={s.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded-lg cursor-pointer">
                    <input type="checkbox" checked={selected}
                      onChange={e => {
                        const current = cart[seriesModal.itemIdx].series_seleccionadas
                        const updated = e.target.checked
                          ? [...current, s.id]
                          : current.filter(id => id !== s.id)
                        updateItem(seriesModal.itemIdx, 'series_seleccionadas', updated)
                        updateItem(seriesModal.itemIdx, 'cantidad', updated.length)
                      }} />
                    <span className="text-sm">{s.nro_serie}</span>
                    <span className="text-xs text-gray-400 dark:text-gray-500">{s.lpn}</span>
                  </label>
                )
              })}
            </div>
            <button onClick={() => { setSeriesModal(null); setSeriesBusqueda('') }}
              className="w-full bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl transition-all">
              Confirmar ({cart[seriesModal.itemIdx]?.series_seleccionadas.length} seleccionadas)
            </button>
          </div>
        </div>
      )}

      {/* Escáner de código de barras — modo POS persistente */}
      {scannerOpen && (
        <BarcodeScanner
          title="Escáner de venta"
          persistent
          onDetected={handleBarcodeScan}
          onClose={() => setScannerOpen(false)}
        />
      )}

      {/* E2/E3 — Cancelar reserva: motivo (catálogo) + obs · si hay seña: penalidad + destino */}
      {cancelReservaModal && (() => {
        const v = cancelReservaModal.venta
        const sena = v.monto_pagado ?? 0
        const penalidadPct = parseFloat((tenant as any)?.reserva_penalidad_pct ?? 0) || 0
        const penalidad = sena * penalidadPct / 100
        const aDevolver = Math.max(0, sena - penalidad)
        const tieneCliente = !!v.cliente_id
        const destino = cancelReservaModal.destino
        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-md">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
                <h2 className="font-semibold text-primary flex items-center gap-2">
                  <RotateCcw size={16} /> Cancelar reserva {formatTicket(v)}
                </h2>
                <button onClick={() => setCancelReservaModal(null)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400"><X size={18} /></button>
              </div>
              <div className="p-5 space-y-4">
                <p className="text-sm text-gray-600 dark:text-gray-400">Se liberará el stock reservado.{sena > 0 ? ' Definí qué pasa con la seña cobrada.' : ''}</p>

                {/* E3 — motivo (catálogo) + observación opcional */}
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Motivo de la cancelación</label>
                  <select value={cancelReservaModal.motivo}
                    onChange={e => setCancelReservaModal({ ...cancelReservaModal, motivo: e.target.value })}
                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent dark:bg-gray-700">
                    <option value="">Seleccioná un motivo…</option>
                    {MOTIVOS_CANCELACION_RESERVA.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <textarea value={cancelReservaModal.observacion} rows={2}
                    onChange={e => setCancelReservaModal({ ...cancelReservaModal, observacion: e.target.value })}
                    placeholder="Observación (opcional)"
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent dark:bg-gray-700" />
                </div>

                {sena > 0 && (
                  <>
                    <div className="bg-gray-50 dark:bg-gray-700/40 rounded-xl p-3 text-sm space-y-1">
                      <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Seña cobrada</span><span className="font-medium">${sena.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span></div>
                      {penalidadPct > 0 && (
                        <div className="flex justify-between text-red-600 dark:text-red-400"><span>Penalidad ({penalidadPct}%) — se retiene</span><span>−${penalidad.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span></div>
                      )}
                      <div className="flex justify-between border-t border-gray-200 dark:border-gray-600 pt-1 mt-1 font-bold"><span>A devolver / acreditar</span><span className="text-primary">${aDevolver.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span></div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Destino del monto</p>
                      <label className="flex items-center gap-3 p-2.5 border border-gray-200 dark:border-gray-700 rounded-xl cursor-pointer">
                        <input type="radio" name="destinoCancel" checked={destino === 'devolucion'} onChange={() => setCancelReservaModal({ ...cancelReservaModal, destino: 'devolucion' })} className="accent-accent" />
                        <span className="text-sm text-gray-700 dark:text-gray-300">Devolver al cliente (efectivo / medio cobrado)</span>
                      </label>
                      <label className={`flex items-center gap-3 p-2.5 border rounded-xl ${tieneCliente ? 'cursor-pointer border-gray-200 dark:border-gray-700' : 'opacity-50 cursor-not-allowed border-gray-100 dark:border-gray-800'}`}>
                        <input type="radio" name="destinoCancel" disabled={!tieneCliente} checked={destino === 'credito'} onChange={() => setCancelReservaModal({ ...cancelReservaModal, destino: 'credito' })} className="accent-accent" />
                        <span className="text-sm text-gray-700 dark:text-gray-300">
                          Crédito a favor en la cuenta del cliente
                          {!tieneCliente && <span className="block text-xs text-gray-400">Requiere un cliente asignado a la venta</span>}
                        </span>
                      </label>
                    </div>
                  </>
                )}
              </div>
              <div className="flex gap-2 px-5 py-4 border-t border-gray-100 dark:border-gray-700">
                <button onClick={() => setCancelReservaModal(null)}
                  className="flex-1 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  Volver
                </button>
                <button onClick={() => {
                  if (!cancelReservaModal.motivo) { toast.error('Seleccioná un motivo de cancelación.'); return }
                  cambiarEstado.mutate({
                    ventaId: v.id, nuevoEstado: 'cancelada',
                    cancelOpts: { penalidadPct, destino, clienteId: v.cliente_id ?? null, motivo: cancelReservaModal.motivo, observacion: cancelReservaModal.observacion },
                  }, {
                    onSuccess: () => {
                      toast.success(sena <= 0
                        ? 'Reserva cancelada. Stock liberado.'
                        : destino === 'credito'
                          ? `Reserva cancelada. $${aDevolver.toLocaleString('es-AR', { maximumFractionDigits: 0 })} acreditados al cliente.`
                          : `Reserva cancelada. Devolvé $${aDevolver.toLocaleString('es-AR', { maximumFractionDigits: 0 })} al cliente.`)
                      setCancelReservaModal(null); setVentaDetalle(null)
                    },
                  })
                }}
                  disabled={cambiarEstado.isPending || !cancelReservaModal.motivo}
                  className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-semibold disabled:opacity-60">
                  {cambiarEstado.isPending ? 'Cancelando…' : 'Confirmar cancelación'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {saldoModal && (() => {
        const esReservar = saldoModal.targetEstado === 'reservada'
        const saldo = calcularSaldoPendiente(saldoModal.total, saldoModal.montoPagado)
        // Para reservar: solo exige monto > 0, no cubrir el total
        const asignado = saldoModal.mediosPago.reduce((acc, m) => acc + (parseFloat(m.monto) || 0), 0)
        // E6 — seña mínima configurable (% del total) al convertir a reserva
        const senaMinPct = parseFloat((tenant as any)?.reserva_sena_minima_pct ?? 0) || 0
        const senaMinima = ((tenant as any)?.reserva_sena_obligatoria ?? true) && senaMinPct > 0
          ? saldoModal.total * senaMinPct / 100 : 0
        const errorSaldo = esReservar
          ? (asignado <= 0 ? 'Ingresá al menos un monto para la seña'
            : asignado > saldoModal.total ? 'La seña no puede superar el total de la venta'
            : senaMinima > 0 && asignado + 0.5 < senaMinima ? `La seña mínima es ${senaMinPct}% ($${senaMinima.toLocaleString('es-AR', { maximumFractionDigits: 0 })})`
            : null)
          : validarSaldoMediosPago(saldoModal.mediosPago, saldo)
        const faltante = saldo - asignado
        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-sm">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
                <h2 className="font-semibold text-primary flex items-center gap-2">
                  <Truck size={16} /> {esReservar ? 'Registrar seña y reservar' : 'Cobrar saldo y finalizar'}
                </h2>
                <button onClick={() => setSaldoModal(null)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400"><X size={18} /></button>
              </div>
              <div className="px-5 py-4 space-y-3">
                <div className="bg-page rounded-xl p-3 text-sm space-y-1">
                  <div className="flex justify-between text-gray-600 dark:text-gray-400">
                    <span>Total venta</span>
                    <span>${saldoModal.total.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                  </div>
                  {!esReservar && saldoModal.montoPagado > 0 && (
                    <div className="flex justify-between text-green-600 dark:text-green-400">
                      <span>Ya cobrado</span>
                      <span>−${saldoModal.montoPagado.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-primary border-t border-gray-200 dark:border-gray-600 pt-1 mt-1">
                    <span>{esReservar ? 'Seña a cobrar (parcial ok)' : 'Saldo a cobrar'}</span>
                    <span>${saldo.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                  </div>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {esReservar ? 'Medio de pago para la seña:' : 'Medio de pago para el saldo:'}
                </p>
                {saldoModal.mediosPago.map((mp, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <select value={mp.tipo}
                      onChange={e => setSaldoModal(s => s ? { ...s, mediosPago: s.mediosPago.map((m, i) => i === idx ? { ...m, tipo: e.target.value } : m) } : s)}
                      className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent">
                      <option value="">Medio de pago...</option>
                      {MEDIOS_PAGO.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <input type="number" onWheel={e => e.currentTarget.blur()} min="0" value={mp.monto}
                      onChange={e => setSaldoModal(s => s ? { ...s, mediosPago: s.mediosPago.map((m, i) => i === idx ? { ...m, monto: e.target.value } : m) } : s)}
                      className="w-28 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
                    {mp.tipo === 'Mercado Pago' && parseFloat(mp.monto) > 0 && (
                      <button onClick={() => generarLinkMP(saldoModal.ventaId, parseFloat(mp.monto))} disabled={generandoMpLink}
                        title="Generar QR / link MP"
                        className="p-1.5 text-blue-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg flex-shrink-0 disabled:opacity-50 transition-colors">
                        <QrCode size={16} />
                      </button>
                    )}
                    {saldoModal.mediosPago.length > 1 && (
                      <button onClick={() => setSaldoModal(s => s ? { ...s, mediosPago: s.mediosPago.filter((_, i) => i !== idx) } : s)}
                        className="text-gray-400 hover:text-red-500"><X size={16} /></button>
                    )}
                  </div>
                ))}
                <button onClick={() => setSaldoModal(s => s ? { ...s, mediosPago: [...s.mediosPago, { tipo: '', monto: '' }] } : s)}
                  className="text-xs text-accent hover:underline">+ Agregar medio</button>
                {faltante > 0.5 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">Falta asignar ${faltante.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</p>
                )}
                {faltante < -0.5 && (
                  <p className="text-xs text-red-500">El monto excede el saldo por ${Math.abs(faltante).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</p>
                )}
              </div>
              <div className="px-5 pb-5 flex gap-3">
                <button onClick={() => setSaldoModal(null)}
                  className="flex-1 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-medium py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 text-sm">
                  Cancelar
                </button>
                <button
                  disabled={cambiarEstado.isPending || !!errorSaldo}
                  onClick={() => {
                    const target = saldoModal.targetEstado ?? 'despachada'
                    cambiarEstado.mutate({ ventaId: saldoModal.ventaId, nuevoEstado: target, saldoMediosPago: saldoModal.mediosPago })
                    setSaldoModal(null)
                  }}
                  className="flex-1 bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl disabled:opacity-50 text-sm flex items-center justify-center gap-2">
                  <Truck size={15} /> {esReservar ? 'Reservar stock' : 'Finalizar venta'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}
      {/* ── CANALES DE VENTAS ── */}
      {tab === 'canales' && (
        <div className="space-y-5">
          {/* KPIs por canal */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {/* Card "Todos" */}
            <button onClick={() => setCanalFiltro(null)}
              className={`rounded-xl p-4 text-left border-2 transition-all ${canalFiltro === null ? 'border-accent bg-accent/5' : 'border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-accent/40'}`}>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1 font-medium">Todos los canales</p>
              <p className="text-xl font-bold text-primary">
                ${canalStats.reduce((a, c) => a + c.total, 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500">{canalStats.reduce((a, c) => a + c.count, 0)} ventas · 30 días</p>
            </button>

            {canalStats.map(ch => {
              const cfg: Record<string, { label: string; color: string; bg: string }> = {
                POS:         { label: 'POS',         color: 'text-violet-700 dark:text-violet-400', bg: 'bg-violet-100 dark:bg-violet-900/30' },
                MELI:        { label: 'MercadoLibre', color: 'text-yellow-700 dark:text-yellow-400', bg: 'bg-yellow-100 dark:bg-yellow-900/30' },
                TiendaNube:  { label: 'TiendaNube',  color: 'text-green-700 dark:text-green-400',   bg: 'bg-green-100 dark:bg-green-900/30'   },
                MP:          { label: 'Mercado Pago', color: 'text-blue-700 dark:text-blue-400',    bg: 'bg-blue-100 dark:bg-blue-900/30'     },
              }
              const { label, color, bg } = cfg[ch.origen] ?? { label: ch.origen, color: 'text-gray-700', bg: 'bg-gray-100' }
              const selected = canalFiltro === ch.origen
              return (
                <button key={ch.origen} onClick={() => setCanalFiltro(selected ? null : ch.origen)}
                  className={`rounded-xl p-4 text-left border-2 transition-all ${selected ? 'border-accent bg-accent/5' : 'border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-accent/40'}`}>
                  <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full mb-2 ${color} ${bg}`}>{label}</span>
                  <p className="text-xl font-bold text-primary">${ch.total.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">{ch.count} venta{ch.count !== 1 ? 's' : ''} · 30 días</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">Prom. ${Math.round(ch.total / ch.count).toLocaleString('es-AR')}</p>
                </button>
              )
            })}

            {canalStats.length === 0 && !loadingCanal && (
              <div className="col-span-full text-center py-6 text-gray-400 dark:text-gray-500 text-sm">
                Sin ventas en los últimos 30 días
              </div>
            )}
          </div>

          {/* Filtros */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 p-3 space-y-2">
            <div className="flex gap-2 flex-wrap">
              {/* Búsqueda */}
              <div className="relative flex-1 min-w-[180px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" value={canalSearch} onChange={e => setCanalSearch(e.target.value)}
                  placeholder="Venta #, cliente, SKU, producto..."
                  className="w-full pl-8 pr-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent" />
              </div>
              {/* Estado */}
              <select value={canalEstado} onChange={e => setCanalEstado(e.target.value)}
                className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent">
                <option value="">Todos los estados</option>
                {Object.entries(ESTADOS).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2 flex-wrap items-center">
              <span className="text-xs text-gray-500 dark:text-gray-400">Fecha:</span>
              <input type="date" value={canalDesde} onChange={e => setCanalDesde(e.target.value)}
                className="px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent" />
              <span className="text-xs text-gray-400">→</span>
              <input type="date" value={canalHasta} onChange={e => setCanalHasta(e.target.value)}
                className="px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent" />
              {(canalSearch || canalEstado || canalDesde || canalHasta || canalFiltro) && (
                <button onClick={() => { setCanalSearch(''); setCanalEstado(''); setCanalDesde(''); setCanalHasta(''); setCanalFiltro(null) }}
                  className="text-xs text-red-500 hover:underline flex items-center gap-1">
                  <X size={11} /> Limpiar
                </button>
              )}
            </div>
          </div>

          {/* Listado de ventas por canal */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <p className="text-sm font-medium text-primary">
                {canalFiltro ? `Ventas de ${canalFiltro}` : 'Todas las ventas por canal'}
                <span className="ml-2 text-xs text-gray-400 font-normal">({(canalVentas as any[]).length})</span>
              </p>
              {canalFiltro && (
                <button onClick={() => setCanalFiltro(null)} className="text-xs text-accent hover:underline flex items-center gap-1">
                  <X size={12} /> Quitar filtro canal
                </button>
              )}
            </div>

            {loadingCanal ? (
              <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" /></div>
            ) : (canalVentas as any[]).length === 0 ? (
              <p className="text-center text-gray-400 dark:text-gray-500 text-sm py-10">Sin ventas para mostrar</p>
            ) : (
              <div className="divide-y divide-gray-50 dark:divide-gray-700">
                {(canalVentas as any[]).map((v: any) => {
                  const cfg: Record<string, { label: string; color: string; bg: string }> = {
                    POS:        { label: 'POS',         color: 'text-violet-700 dark:text-violet-400', bg: 'bg-violet-100 dark:bg-violet-900/30' },
                    MELI:       { label: 'ML',           color: 'text-yellow-700 dark:text-yellow-400', bg: 'bg-yellow-100 dark:bg-yellow-900/30' },
                    TiendaNube: { label: 'TN',           color: 'text-green-700 dark:text-green-400',   bg: 'bg-green-100 dark:bg-green-900/30'   },
                    MP:         { label: 'MP',           color: 'text-blue-700 dark:text-blue-400',     bg: 'bg-blue-100 dark:bg-blue-900/30'     },
                  }
                  const canal = cfg[v.origen ?? 'POS'] ?? { label: v.origen ?? 'POS', color: 'text-gray-700', bg: 'bg-gray-100' }
                  const estadoStyle = ESTADOS[v.estado as EstadoVenta] ?? ESTADOS.pendiente
                  return (
                    <div key={v.id}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/40 cursor-pointer transition-colors"
                      onClick={() => setVentaDetalle(v)}>
                      {/* Canal badge */}
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${canal.color} ${canal.bg}`}>
                        {canal.label}
                      </span>
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-primary">{formatTicket(v)}</span>
                          {v.tracking_id && <span className="text-xs text-gray-400 dark:text-gray-500">· ref {v.tracking_id}</span>}
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {v.cliente_nombre ?? 'Sin cliente'} · {new Date(v.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                        </p>
                      </div>
                      {/* Estado */}
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${estadoStyle.color} ${estadoStyle.bg}`}>
                        {estadoStyle.label}
                      </span>
                      {/* Total */}
                      <span className="text-sm font-semibold text-primary flex-shrink-0">
                        ${Number(v.total ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal QR / link MP */}
      {mpLinkModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-xs p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-primary text-base flex items-center gap-2">
                <QrCode size={16} className="text-blue-500" /> Cobrar con Mercado Pago
              </h3>
              <button onClick={() => setMpLinkModal(null)} className="text-gray-400 hover:text-gray-600 p-1"><X size={18} /></button>
            </div>

            {mpPagoRecibido ? (
              /* ── Pago confirmado ── */
              <div className="space-y-3 text-center">
                <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto">
                  <Check size={32} className="text-green-600 dark:text-green-400" />
                </div>
                <p className="font-semibold text-green-700 dark:text-green-400 text-lg">¡Pago recibido!</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  ${mpLinkModal.monto.toLocaleString('es-AR', { maximumFractionDigits: 0 })} confirmado por MercadoPago
                </p>
                {/* Reserva abierta en historial → finalizar con cambiarEstado */}
                {ventaDetalle?.id === mpLinkModal.ventaId ? (
                  <button
                    onClick={() => {
                      setMpLinkModal(null)
                      cambiarEstado.mutate({ ventaId: mpLinkModal.ventaId, nuevoEstado: 'despachada', saldoMediosPago: [] })
                    }}
                    disabled={cambiarEstado.isPending}
                    className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-xl text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                    <Truck size={15} /> Finalizar venta (rebaje stock)
                  </button>
                ) : preVentaId === mpLinkModal.ventaId ? (
                  /* Venta directa: preVentaId reservado, finalizar con registrarVenta */
                  <button
                    onClick={() => { setMpLinkModal(null); registrarVentaRef.current?.('despachada') }}
                    disabled={saving}
                    className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-xl text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                    <Truck size={15} /> {saving ? 'Procesando...' : 'Finalizar venta (rebaje stock)'}
                  </button>
                ) : (
                  <button onClick={() => setMpLinkModal(null)}
                    className="w-full border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-medium py-2.5 rounded-xl text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    Cerrar
                  </button>
                )}
              </div>
            ) : (
              /* ── Esperando pago ── */
              <>
                <div className="text-center">
                  <p className="text-2xl font-bold text-primary">
                    ${mpLinkModal.monto.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex items-center justify-center gap-1.5">
                    <span className="inline-block w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
                    Esperando pago del cliente...
                  </p>
                </div>

                <div className="flex justify-center">
                  <img src={mpLinkModal.qrDataUrl} alt="QR Mercado Pago" className="rounded-xl border border-gray-100 dark:border-gray-700" width={220} height={220} />
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => { navigator.clipboard.writeText(mpLinkModal.initPoint); toast.success('Link copiado') }}
                    className="flex-1 flex items-center justify-center gap-1.5 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                    <Copy size={14} /> Copiar link
                  </button>
                  <a href={mpLinkModal.initPoint} target="_blank" rel="noreferrer"
                    className="flex-1 flex items-center justify-center gap-1.5 bg-blue-500 hover:bg-blue-600 text-white py-2.5 rounded-xl text-sm font-medium transition-colors">
                    <ExternalLink size={14} /> Abrir en MP
                  </a>
                </div>
                <p className="text-xs text-center text-gray-400 dark:text-gray-500">
                  Esta pantalla se actualiza automáticamente al recibir el pago
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── ISS-072: Modal QR MODO ── */}
      {modoModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-xs p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-primary text-base flex items-center gap-2">
                <QrCode size={16} className="text-purple-500" /> Cobrar con MODO
              </h3>
              <button onClick={() => { setModoModal(null); setModoPagoRecibido(false) }} className="text-gray-400 hover:text-gray-600 p-1"><X size={18} /></button>
            </div>

            {modoPagoRecibido ? (
              <div className="flex flex-col items-center gap-3 py-4">
                <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                  <CheckCircle2 size={32} className="text-green-600 dark:text-green-400" />
                </div>
                <p className="font-semibold text-green-700 dark:text-green-400 text-center">¡Pago recibido!</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
                  El pago MODO fue confirmado. Podés continuar con la venta.
                </p>
                <button onClick={() => { setModoModal(null); setModoPagoRecibido(false) }}
                  className="w-full bg-accent hover:bg-accent/90 text-white font-medium py-2.5 rounded-xl text-sm transition-colors">
                  Continuar
                </button>
              </div>
            ) : (
              <>
                <div className="flex flex-col items-center gap-3">
                  <div className="relative">
                    <img src={modoModal.qrDataUrl} alt="QR MODO" className="w-48 h-48 rounded-xl" />
                    <div className="absolute inset-0 flex items-end justify-center pb-1">
                      <span className="text-[9px] bg-white/90 dark:bg-gray-800/90 text-purple-600 dark:text-purple-400 px-1.5 py-0.5 rounded font-medium">MODO · Interoperable</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
                    Escaneá con cualquier app bancaria argentina — MODO, Banco, Billetera digital
                  </p>
                  <div className="flex gap-2">
                    <a href={modoModal.deepLink} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs text-purple-600 hover:underline border border-purple-200 dark:border-purple-800 rounded-lg px-3 py-1.5 transition-colors hover:bg-purple-50 dark:hover:bg-purple-900/20">
                      <ExternalLink size={12} /> Abrir en app
                    </a>
                    <button onClick={() => { navigator.clipboard.writeText(modoModal.deepLink); toast.success('Link copiado') }}
                      className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700">
                      <Copy size={12} /> Copiar link
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 justify-center">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  Esperando confirmación del pago...
                </div>
                <button onClick={() => { setModoModal(null); setModoPagoRecibido(false) }}
                  className="w-full border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-medium py-2.5 rounded-xl text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  Cerrar
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── MODAL: ¿FACTURAR AHORA? ── */}
    {facturaModal && (
      <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm">
          {!facturaEmitida ? (
          <>
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
            <div className="flex items-center gap-2">
              <span className="text-xl">🧾</span>
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">¿Emitir comprobante?</h2>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Venta #{facturaModal.ventaNumero} · ${facturaModal.ventaTotal.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
            </p>
          </div>

          <div className="p-5 space-y-4">
            {/* Tipo de comprobante */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tipo de comprobante</label>
              <div className="grid grid-cols-3 gap-2">
                {(['A','B','C'] as const).map(t => {
                  const bloqueado = t === 'A' && !facturaClienteCuit
                  return (
                    <button key={t} onClick={() => { if (!bloqueado) setFacturaTipo(t) }} disabled={bloqueado}
                      title={bloqueado ? 'Factura A requiere un cliente con CUIT (Responsable Inscripto)' : undefined}
                      className={`py-2.5 rounded-xl text-sm font-semibold border-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed
                        ${facturaTipo === t ? 'border-accent bg-accent/10 text-accent' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-accent/40'}`}>
                      Factura {t}
                    </button>
                  )
                })}
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">
                {facturaTipo === 'A' && 'Para clientes Responsables Inscriptos — discrimina IVA'}
                {facturaTipo === 'B' && 'Para Consumidores Finales / Monotributistas'}
                {facturaTipo === 'C' && 'Para emisores Monotributistas — sin IVA'}
              </p>
              {!facturaClienteCuit && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                  Factura A deshabilitada: la venta no tiene un cliente con CUIT.
                </p>
              )}
            </div>

            {/* Punto de venta */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Punto de venta</label>
              {(puntosVentaAfip as any[]).length > 0 ? (
                <div className="relative">
                  <select value={facturaPV} onChange={e => setFacturaPV(parseInt(e.target.value))}
                    className="w-full appearance-none border border-gray-200 dark:border-gray-600 rounded-xl pl-3 pr-8 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                    {(puntosVentaAfip as any[]).map((pv: any) => (
                      <option key={pv.id} value={pv.numero}>
                        {String(pv.numero).padStart(4,'0')}{pv.nombre ? ` — ${pv.nombre}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <input type="number" value={facturaPV} onChange={e => setFacturaPV(parseInt(e.target.value))} min="1"
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
              )}
            </div>
          </div>

          <div className="px-5 pb-5 flex gap-2">
            <button onClick={() => { setFacturaModal(null); setFacturaEmitida(null) }}
              className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 font-medium py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 text-sm transition-all">
              Saltar
            </button>
            <button onClick={emitirFactura} disabled={emitiendoFactura}
              className="flex-[2] bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl transition-all disabled:opacity-50 text-sm flex items-center justify-center gap-2">
              {emitiendoFactura
                ? <><span className="animate-spin">⟳</span> Emitiendo…</>
                : <>🧾 Emitir Factura {facturaTipo}</>}
            </button>
          </div>
          </>
          ) : (
          <>
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
            <div className="flex items-center gap-2">
              <span className="text-xl">✅</span>
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">Factura {facturaEmitida.tipo} emitida</h2>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">CAE {facturaEmitida.cae}</p>
          </div>
          <div className="p-5 space-y-2">
            <button onClick={() => accionFacturaPDF(facturaEmitida.ventaId, 'descargar')} disabled={descargandoPdfVenta}
              className="w-full flex items-center justify-center gap-2 border border-accent/40 text-accent font-medium py-2.5 rounded-xl hover:bg-accent/5 transition-all text-sm disabled:opacity-50">
              {descargandoPdfVenta ? <><RefreshCw size={15} className="animate-spin" /> Generando PDF…</> : <><FileDown size={15} /> Descargar PDF</>}
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => accionFacturaPDF(facturaEmitida.ventaId, 'imprimir')} disabled={descargandoPdfVenta}
                className="flex items-center justify-center gap-2 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-medium py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all text-sm disabled:opacity-50">
                <Printer size={15} /> Imprimir
              </button>
              <button onClick={() => abrirEnviarFacturaEmail(facturaEmitida.ventaId)} disabled={enviandoFacturaEmail}
                className="flex items-center justify-center gap-2 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-medium py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all text-sm disabled:opacity-50">
                {enviandoFacturaEmail ? <><RefreshCw size={15} className="animate-spin" /> Enviando…</> : <><Send size={15} /> Enviar email</>}
              </button>
            </div>
          </div>
          <div className="px-5 pb-5">
            <button onClick={() => { setFacturaModal(null); setFacturaEmitida(null) }}
              className="w-full border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 font-medium py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 text-sm transition-all">
              Cerrar
            </button>
          </div>
          </>
          )}
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
                onKeyDown={e => { if (e.key === 'Enter' && !enviandoFacturaEmail) enviarFacturaEmail(facturaEmailModal.ventaId, facturaEmailValue) }}
                placeholder="email@cliente.com"
                className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
              <p className="text-[11px] text-gray-400">Se adjunta el PDF de la factura.</p>
            </div>
            <div className="px-5 pb-5 flex gap-2">
              <button onClick={() => setFacturaEmailModal(null)}
                className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 font-medium py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 text-sm transition-all">
                Cancelar
              </button>
              <button onClick={() => enviarFacturaEmail(facturaEmailModal.ventaId, facturaEmailValue)} disabled={enviandoFacturaEmail}
                className="flex-[2] bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl transition-all disabled:opacity-50 text-sm flex items-center justify-center gap-2">
                {enviandoFacturaEmail ? <><RefreshCw size={15} className="animate-spin" /> Enviando…</> : <><Send size={15} /> Enviar</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: EMITIR NOTA DE CRÉDITO ── */}
      {ncModal && (
        <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-2">
                <span className="text-xl">📋</span>
                <h2 className="font-semibold text-gray-800 dark:text-gray-100">Emitir Nota de Crédito</h2>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Venta #{ncModal.ventaNumero} · Devolución ${ncModal.monto?.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
              </p>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tipo de Nota de Crédito</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['NC-A','NC-B','NC-C'] as const).map(t => (
                    <button key={t} onClick={() => setNcTipo(t)}
                      className={`py-2.5 rounded-xl text-sm font-semibold border-2 transition-all
                        ${ncTipo === t ? 'border-accent bg-accent/10 text-accent' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-accent/40'}`}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Punto de venta</label>
                {(puntosVentaAfip as any[]).length > 0 ? (
                  <select value={ncPV} onChange={e => setNcPV(parseInt(e.target.value))}
                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm dark:bg-gray-700 dark:text-white focus:outline-none focus:border-accent">
                    {(puntosVentaAfip as any[]).map((pv: any) => (
                      <option key={pv.numero} value={pv.numero}>PV {pv.numero} — {pv.nombre}</option>
                    ))}
                  </select>
                ) : (
                  <input type="number" value={ncPV} onChange={e => setNcPV(parseInt(e.target.value))} min="1"
                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm dark:bg-gray-700 dark:text-white focus:outline-none focus:border-accent" />
                )}
              </div>

              <p className="text-xs text-gray-400 dark:text-gray-500">
                La NC quedará vinculada a la devolución y se enviará al WSFE de AFIP.
              </p>
            </div>

            <div className="px-5 pb-5 flex gap-3">
              <button onClick={() => setNcModal(null)}
                className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 font-medium py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 text-sm transition-all">
                Cancelar
              </button>
              <button onClick={emitirNC} disabled={emitendoNC}
                className="flex-[2] bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-xl transition-all disabled:opacity-50 text-sm flex items-center justify-center gap-2">
                {emitendoNC
                  ? <><span className="animate-spin">⟳</span> Emitiendo…</>
                  : <>📋 Emitir {ncTipo}</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* B5 — Cobrar deuda CC desde el POS */}
      {cobrarCCOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setCobrarCCOpen(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <h3 className="font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2"><DollarSign size={16} className="text-red-500" /> Cobrar deuda CC</h3>
              <button onClick={() => setCobrarCCOpen(false)} className="text-gray-400 hover:text-gray-600 p-1"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-sm text-gray-500 dark:text-gray-400">{clienteNombre} · deuda total <span className="font-semibold text-red-600 dark:text-red-400">${Math.round(clienteCCDeuda).toLocaleString('es-AR')}</span></p>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Monto a cobrar</label>
                <input type="number" min="0" onWheel={e => e.currentTarget.blur()} value={cobrarCCMonto}
                  onChange={e => setCobrarCCMonto(e.target.value)}
                  className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Medio de pago</label>
                <select value={cobrarCCMetodo} onChange={e => setCobrarCCMetodo(e.target.value)}
                  className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-800">
                  {['Efectivo', 'Transferencia', 'Débito', 'Crédito', 'MercadoPago', 'Otro'].map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <p className="text-[11px] text-gray-400 dark:text-gray-500">Se aplica FIFO sobre las ventas CC más antiguas del cliente.</p>
            </div>
            <div className="p-5 border-t border-gray-100 dark:border-gray-700 flex justify-end gap-3">
              <button onClick={() => setCobrarCCOpen(false)} className="border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-medium px-4 py-2 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 text-sm">Cancelar</button>
              <button onClick={registrarCobranzaCC} disabled={cobrarCCSaving}
                className="bg-red-500 hover:bg-red-600 text-white font-semibold px-5 py-2 rounded-xl text-sm disabled:opacity-50 transition-all">
                {cobrarCCSaving ? 'Registrando...' : 'Registrar cobranza'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
