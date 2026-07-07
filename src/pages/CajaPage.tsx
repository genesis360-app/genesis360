import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { BRAND } from '@/config/brand'
import { logActividad } from '@/lib/actividadLog'
import { useModalKeyboard } from '@/hooks/useModalKeyboard'
import {
  DollarSign, Plus, Minus, Lock, Unlock, History, Trash2,
  Printer, X, ChevronDown, ChevronUp, CheckCircle, AlertTriangle, Clock, Info, ArrowRightLeft, Receipt, RotateCcw, Tablet,
  Wallet, CreditCard, BarChart3, Settings
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { PageTabs } from '@/components/PageTabs'
import { createClient } from '@supabase/supabase-js'
import { useAuthStore } from '@/store/authStore'
import { moduloSoloLectura } from '@/lib/permisosModulo'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'
import { useCierreContable } from '@/hooks/useCierreContable'
import { useModoOperacion } from '@/hooks/useModoOperacion'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import toast from 'react-hot-toast'

type Tab = 'caja' | 'historial' | 'caja_fuerte' | 'reportes' | 'configuracion' | 'cobranzas'

// formatMoneda ahora viene del helper central — se redefine dentro del componente con tenant.moneda
import { formatMoneda as formatMonedaLib, MONEDAS_DISPONIBLES } from '@/lib/formato'
import { puede as cajaPuede, accedeABoveda, type ConfigCaja } from '@/lib/cajaPermisos'
import {
  extraerNumeroVenta, extraerMedioPago, signoMovimiento, saldoSesion,
  calcularDiferenciaCierre, calcularDiferenciaApertura, superaUmbralDiferencia,
  clasificarAjusteDiferencia, tipoAjusteTraspaso, acumularTotalesPorMetodo,
} from '@/lib/cajaArqueo'
import CajaReportes from '@/components/CajaReportes'
import CajaCobranzasCC from '@/components/CajaCobranzasCC'

const MONEDAS_LISTA = MONEDAS_DISPONIBLES.map(m => m.code)

const TIPO_LABEL: Record<string, string> = {
  ingreso:               'Venta',
  ingreso_informativo:   'No efectivo',
  ingreso_reserva:       'Seña',
  ingreso_apertura:      'Apertura',
  ingreso_traspaso:      'Traspaso ↓',
  egreso:                'Egreso',
  egreso_informativo:    'No efectivo',
  egreso_devolucion_sena:'Dev. seña',
  egreso_traspaso:       'Traspaso ↑',
}

function getTipoDisplay(tipo: string, concepto: string): string {
  if (tipo === 'ingreso') return extraerNumeroVenta(concepto) ? 'Venta' : 'Ingreso Manual'
  return TIPO_LABEL[tipo] ?? tipo
}

export default function CajaPage() {
  const navigate = useNavigate()
  const { tenant, user, sucursales, setUser } = useAuthStore()
  const { isPeriodoCerrado, ultimoCierre } = useCierreContable()
  const { avanzado: modoAvanzado } = useModoOperacion()
  const formatMoneda = (v: number) => formatMonedaLib(v, (tenant as any)?.moneda ?? 'ARS')
  const { sucursalId, applyFilter } = useSucursalFilter()
  const qc = useQueryClient()
  // Permisos centralizados (J3) — declarados arriba para que las queries los usen
  const configCaja: ConfigCaja = (tenant as any)?.config_caja ?? {}
  const rol = user?.rol as any
  const puedeExtraerBoveda    = cajaPuede(rol, 'extraer_boveda')
  const puedeAbrirAjena       = cajaPuede(rol, 'abrir_ajena')           // A2
  const puedeOperarCaja       = cajaPuede(rol, 'ingreso_manual')        // CONTADOR no puede
  const puedeReimprimirTicket = cajaPuede(rol, 'reimprimir_ticket_cierre')
  const puedeEditarMovimiento = cajaPuede(rol, 'editar_movimiento', configCaja)
  const esSoloLectura         = user?.rol === 'CONTADOR'                // J1 — read-only
  const puedeAdministrarCaja  = user?.rol === 'DUEÑO' || user?.rol === 'SUPERVISOR' || user?.rol === 'SUPER_USUARIO'
  const [tab, setTab] = useState<Tab>('caja')
  const [cajaSeleccionada, setCajaSeleccionada] = useState<string | null>(null)
  const [showApertura, setShowApertura] = useState(false)
  const [showCierre, setShowCierre] = useState(false)
  const [showMovimiento, setShowMovimiento] = useState(false)
  const [showNuevaCaja, setShowNuevaCaja] = useState(false)
  const [showTraspaso, setShowTraspaso] = useState(false)
  const [traspasoDestinoSesionId, setTraspasoDestinoSesionId] = useState<string>('')
  const [traspasoMonto, setTraspasoMonto] = useState('')
  const [traspasoConcepto, setTraspasoConcepto] = useState('')
  // Caja fuerte
  const [showDepositoFuerte, setShowDepositoFuerte] = useState(false)
  const [showRetiroFuerte, setShowRetiroFuerte] = useState(false)
  const [depositoFuenteSesionId, setDepositoFuenteSesionId] = useState('')
  const [depositoCuentaId, setDepositoCuentaId] = useState('') // cuenta de origen destino del ingreso a la bóveda
  const [showDifConfirm, setShowDifConfirm] = useState(false)
  const [fuerteMonto, setFuerteMonto] = useState('')
  const [fuerteConcepto, setFuerteConcepto] = useState('')
  const [retiroCajaDestinoSesionId, setRetiroCajaDestinoSesionId] = useState('')
  // Solicitud CAJERO → caja fuerte
  const [showSolicitudFuerte, setShowSolicitudFuerte] = useState(false)
  const [solicitudMonto, setSolicitudMonto] = useState('')
  const [solicitudConcepto, setSolicitudConcepto] = useState('')
  const [sesionExpandida, setSesionExpandida] = useState<string | null>(null)
  const [showArqueo, setShowArqueo] = useState(false)
  const [arqueoConteo, setArqueoConteo] = useState('')
  const [arqueoNotas, setArqueoNotas] = useState('')
  // Extraer dinero de bóveda (solo DUEÑO/ADMIN/SUPER_USUARIO)
  const [showExtraerBoveda, setShowExtraerBoveda] = useState(false)
  const [extraerCuentaId, setExtraerCuentaId] = useState<string>('')
  const [extraerMonto, setExtraerMonto] = useState('')
  const [extraerTipo, setExtraerTipo] = useState<'banco' | 'retiro_personal' | 'gasto' | 'inversion' | 'pago_proveedor' | 'otro'>('retiro_personal')
  const [extraerMotivo, setExtraerMotivo] = useState('')
  const [extraerNotas, setExtraerNotas] = useState('')
  // E3 — arqueo manual de bóveda (sin cerrarla)
  const [showArqueoBoveda, setShowArqueoBoveda] = useState(false)
  const [arqueoBovedaConteo, setArqueoBovedaConteo] = useState<Record<string, string>>({})
  const [arqueoBovedaNotas, setArqueoBovedaNotas] = useState('')
  // A2 — abrir caja a nombre de cajero (DUEÑO/SUPERVISOR)
  const [aperturaParaUsuarioId, setAperturaParaUsuarioId] = useState<string>('')
  // B5 — clave maestra al cerrar caja ajena
  const [claveMaestraCierre, setClaveMaestraCierre] = useState('')
  // G1 — corregir movimiento manual
  const [corregirMov, setCorregirMov] = useState<any | null>(null)
  const [corregirMonto, setCorregirMonto] = useState('')
  const [corregirConcepto, setCorregirConcepto] = useState('')
  // B7 — doble validación al cierre
  const [dobleValEmail, setDobleValEmail] = useState('')
  const [dobleValPassword, setDobleValPassword] = useState('')

  // Forms
  const [montoApertura, setMontoApertura] = useState('')
  const [montoSugerido, setMontoSugerido] = useState<number | null>(null)
  const [notasCierre, setNotasCierre] = useState('')
  const [montoRealCierre, setMontoRealCierre] = useState('')
  // Caja solo registra ingresos manuales — los egresos van por Gastos (relevamiento G2)
  const movTipo: 'ingreso' = 'ingreso'
  const [movConcepto, setMovConcepto] = useState('')
  const [movMonto, setMovMonto] = useState('')
  const [nuevaCajaNombre, setNuevaCajaNombre] = useState('')
  const [nuevaCajaMoneda, setNuevaCajaMoneda] = useState('')

  // Queries
  const { data: cajas = [] } = useQuery({
    queryKey: ['cajas', tenant?.id, sucursalId],
    queryFn: async () => {
      let q = supabase.from('cajas').select('*')
        .eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      // Caja Fuerte siempre visible (tenant-wide); operativas filtradas estrictamente por sucursal
      if (sucursalId) {
        q = q.or(`sucursal_id.eq.${sucursalId},es_caja_fuerte.eq.true`)
      }
      const { data } = await q
      return data ?? []
    },
    enabled: !!tenant,
  })

  const cajasOperativas = (cajas as any[]).filter(c => !c.es_caja_fuerte)
  const cajaFuerte = (cajas as any[]).find(c => c.es_caja_fuerte) ?? null

  const { data: fuerteSesion = null } = useQuery({
    queryKey: ['caja-fuerte-sesion', cajaFuerte?.id],
    queryFn: async () => {
      const { data } = await supabase.from('caja_sesiones')
        .select('id, caja_id').eq('caja_id', cajaFuerte!.id).eq('es_permanente', true)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      return data
    },
    enabled: !!cajaFuerte,
  })

  const { data: fuerteMovimientos = [] } = useQuery({
    queryKey: ['caja-fuerte-movimientos', fuerteSesion?.id],
    queryFn: async () => {
      const { data } = await supabase.from('caja_movimientos')
        .select('*, users(nombre_display)').eq('sesion_id', (fuerteSesion as any)!.id)
        .order('created_at', { ascending: false }).limit(20)
      return data ?? []
    },
    enabled: !!(fuerteSesion as any)?.id,
    refetchInterval: 15_000,
  })

  const fuerteSaldo = (fuerteMovimientos as any[]).reduce((acc: number, m: any) => {
    if (m.tipo === 'ingreso_traspaso') return acc + m.monto
    if (m.tipo === 'egreso_traspaso') return acc - m.monto
    return acc
  }, 0)

  // B4 — Reporte diferencias por cajero (últimos 30 días)
  const { data: difsPorCajero = [] } = useQuery({
    queryKey: ['vw-diferencias-cajero', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('vw_diferencias_por_cajero')
        .select('*').eq('tenant_id', tenant!.id)
        .order('diferencia_absoluta_acumulada', { ascending: false })
      return data ?? []
    },
    enabled: !!tenant && tab === 'historial' && (puedeAdministrarCaja || puedeReimprimirTicket),
  })

  // A2 — cajeros del tenant (para que DUEÑO/SUPERVISOR pueda abrir caja a su nombre)
  const { data: cajerosTenant = [] } = useQuery({
    queryKey: ['cajeros-tenant', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('users')
        .select('id, nombre_display, email, rol')
        .eq('tenant_id', tenant!.id)
        .in('rol', ['CAJERO','SUPERVISOR','DUEÑO'])
        .order('nombre_display')
      return data ?? []
    },
    enabled: !!tenant && puedeAbrirAjena,
  })

  // Saldos por Cuenta de Origen (banco / billetera) — bóveda discriminada
  const { data: bovedaCuentas = [] } = useQuery({
    queryKey: ['boveda-cuentas', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('vw_boveda_cuentas')
        .select('*').eq('tenant_id', tenant!.id).order('nombre')
      return data ?? []
    },
    enabled: !!tenant && tab === 'caja_fuerte',
    refetchInterval: 30_000,
  })

  // Capital del negocio por moneda = suma de las cuentas activas de la bóveda, AGRUPADA por moneda
  // (CAJ-29: no se convierte entre monedas; un tenant ARS+USD ve cada moneda por separado).
  // Es el dato principal de la pestaña Caja Fuerte (tarjeta destacada del header).
  const cuentasActivasBoveda = (bovedaCuentas as any[]).filter((c: any) => c.activo)
  const capitalPorMoneda = cuentasActivasBoveda.reduce((acc: Record<string, number>, c: any) => {
    const m = c.moneda || (tenant as any)?.moneda || 'ARS'
    acc[m] = (acc[m] || 0) + Number(c.saldo || 0)
    return acc
  }, {} as Record<string, number>)
  const monedasCapital = Object.entries(capitalPorMoneda) as [string, number][]

  // Historial de retiros de bóveda — RLS estricta: solo DUEÑO/ADMIN/SUPER_USUARIO
  const { data: bovedaRetiros = [] } = useQuery({
    queryKey: ['boveda-retiros', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('boveda_retiros')
        .select('*, users:usuario_id(nombre_display), cuentas_origen:cuenta_origen_id(nombre, tipo)')
        .eq('tenant_id', tenant!.id)
        .order('created_at', { ascending: false })
        .limit(50)
      return data ?? []
    },
    enabled: !!tenant && tab === 'caja_fuerte' && puedeExtraerBoveda,
  })

  // Roles personalizados del tenant — para habilitar acceso a bóveda a roles custom (E1)
  const { data: rolesCustom = [] } = useQuery({
    queryKey: ['roles-custom', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('roles_custom')
        .select('id, nombre').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant && puedeAdministrarCaja && tab === 'configuracion',
  })

  // E3 — Historial de arqueos de bóveda — RLS estricta: solo DUEÑO/ADMIN/SUPER_USUARIO
  const { data: bovedaArqueos = [] } = useQuery({
    queryKey: ['boveda-arqueos', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('boveda_arqueos')
        .select('*, users:usuario_id(nombre_display), cuentas_origen:cuenta_origen_id(nombre, tipo)')
        .eq('tenant_id', tenant!.id)
        .order('created_at', { ascending: false })
        .limit(50)
      return data ?? []
    },
    enabled: !!tenant && tab === 'caja_fuerte' && puedeExtraerBoveda,
  })

  // E3 — Mutation: arqueo manual de bóveda. Inserta una fila por cuenta contada (no cierra nada).
  const arquearBoveda = useMutation({
    mutationFn: async () => {
      if (!puedeExtraerBoveda) throw new Error('No tenés permiso para arquear la bóveda')
      const cuentasActivas = (bovedaCuentas as any[]).filter((c: any) => c.activo)
      const filas = cuentasActivas
        .filter((c: any) => (arqueoBovedaConteo[c.cuenta_origen_id] ?? '').trim() !== '')
        .map((c: any) => {
          const contado = parseFloat(arqueoBovedaConteo[c.cuenta_origen_id])
          const sistema = Number(c.saldo || 0)
          return {
            tenant_id: tenant!.id,
            cuenta_origen_id: c.cuenta_origen_id,
            saldo_sistema: sistema,
            saldo_contado: isNaN(contado) ? 0 : contado,
            diferencia: (isNaN(contado) ? 0 : contado) - sistema,
            notas: arqueoBovedaNotas.trim() || null,
            usuario_id: user!.id,
          }
        })
      if (filas.length === 0) throw new Error('Ingresá al menos un saldo contado')
      const { error } = await supabase.from('boveda_arqueos').insert(filas)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Arqueo de bóveda registrado')
      logActividad({ entidad: 'caja', entidad_nombre: 'Bóveda', accion: 'crear', valor_nuevo: 'Arqueo manual de bóveda', pagina: '/caja' })
      qc.invalidateQueries({ queryKey: ['boveda-arqueos'] })
      setShowArqueoBoveda(false); setArqueoBovedaConteo({}); setArqueoBovedaNotas('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // Mutation: extraer dinero de la bóveda (egreso real del sistema, no traspaso)
  const extraerDeBoveda = useMutation({
    mutationFn: async () => {
      if (!puedeExtraerBoveda) throw new Error('No tenés permiso para extraer dinero de la bóveda')
      if (!extraerCuentaId) throw new Error('Seleccioná una cuenta')
      const monto = parseFloat(extraerMonto)
      if (!monto || monto <= 0) throw new Error('Ingresá un monto válido')
      if (!extraerMotivo.trim()) throw new Error('Ingresá un motivo')

      const cuenta = (bovedaCuentas as any[]).find(c => c.cuenta_origen_id === extraerCuentaId)
      if (!cuenta) throw new Error('Cuenta inválida')
      const saldoCuenta = Number(cuenta.saldo || 0)
      if (monto > saldoCuenta) throw new Error(`Saldo insuficiente en ${cuenta.nombre}. Disponible: ${formatMoneda(saldoCuenta)}`)

      // Necesitamos una sesión donde anclar el movimiento (sesión de caja fuerte)
      if (!cajaFuerte) throw new Error('No hay caja fuerte configurada')
      let fuerteSessionId = (fuerteSesion as any)?.id
      if (!fuerteSessionId) {
        const { data: ns, error: eS } = await supabase.from('caja_sesiones').insert({
          tenant_id: tenant!.id, caja_id: cajaFuerte.id,
          estado: 'abierta', es_permanente: true,
          usuario_id: user!.id, monto_apertura: 0,
        }).select('id').single()
        if (eS) throw eS
        fuerteSessionId = ns.id
      }

      const tipoMov = cuenta.tipo === 'efectivo' ? 'egreso_traspaso' : 'egreso_informativo'
      const concepto = `[Extracción] ${extraerMotivo.trim()} (${extraerTipo.replace('_', ' ')})`

      const { data: mov, error: eMov } = await supabase.from('caja_movimientos').insert({
        tenant_id: tenant!.id,
        sesion_id: fuerteSessionId,
        tipo: tipoMov,
        monto,
        concepto,
        cuenta_origen_id: extraerCuentaId,
        usuario_id: user!.id,
      }).select('id').single()
      if (eMov) throw eMov

      const { error: eRet } = await supabase.from('boveda_retiros').insert({
        tenant_id: tenant!.id,
        cuenta_origen_id: extraerCuentaId,
        monto,
        tipo_retiro: extraerTipo,
        motivo: extraerMotivo.trim(),
        notas: extraerNotas.trim() || null,
        usuario_id: user!.id,
        movimiento_id: mov.id,
      })
      if (eRet) throw eRet
    },
    onSuccess: () => {
      toast.success('Extracción registrada')
      logActividad({ entidad: 'caja', entidad_nombre: 'Bóveda', accion: 'pagar', valor_nuevo: `Extracción ${formatMoneda(parseFloat(extraerMonto))} - ${extraerMotivo}`, pagina: '/caja' })
      qc.invalidateQueries({ queryKey: ['boveda-cuentas'] })
      qc.invalidateQueries({ queryKey: ['boveda-retiros'] })
      qc.invalidateQueries({ queryKey: ['caja-fuerte-movimientos'] })
      qc.invalidateQueries({ queryKey: ['caja-movimientos'] })
      setShowExtraerBoveda(false)
      setExtraerCuentaId(''); setExtraerMonto(''); setExtraerTipo('retiro_personal')
      setExtraerMotivo(''); setExtraerNotas('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // Sesiones abiertas en TODAS las cajas (para mostrar indicador en selector)
  const { data: cajasAbiertas = [] } = useQuery({
    queryKey: ['cajas-abiertas-ids', tenant?.id, sucursalId],
    queryFn: async () => {
      const { data } = await applyFilter(
        supabase.from('caja_sesiones')
          .select('caja_id').eq('tenant_id', tenant!.id).eq('estado', 'abierta')
      )
      return (data ?? []).map((r: any) => r.caja_id as string)
    },
    enabled: !!tenant,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  })

  // Sesiones abiertas propias del usuario actual (para bloquear segunda apertura en CAJERO + A4 detectar día anterior)
  const { data: misSesionesAbiertas = [] } = useQuery({
    queryKey: ['mis-sesiones-abiertas', tenant?.id, user?.id, sucursalId],
    queryFn: async () => {
      const { data } = await applyFilter(
        supabase.from('caja_sesiones')
          .select('id, caja_id, abierta_at, cajas(nombre)').eq('tenant_id', tenant!.id).eq('usuario_id', user!.id).eq('estado', 'abierta')
      )
      return data ?? []
    },
    enabled: !!tenant && !!user,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  })

  // A4 — detectar caja propia abierta más de 24h (probablemente olvidada del día anterior)
  const sesionDiaAnterior = (misSesionesAbiertas as any[]).find((s: any) => {
    if (!s.abierta_at) return false
    const horas = (Date.now() - new Date(s.abierta_at).getTime()) / (1000 * 60 * 60)
    return horas > 24
  })

  // Sesiones abiertas con datos completos (para modal traspaso)
  const { data: sesionesAbiertasAll = [] } = useQuery({
    queryKey: ['sesiones-abiertas-todas', tenant?.id, sucursalId],
    queryFn: async () => {
      const { data } = await applyFilter(
        supabase.from('caja_sesiones')
          .select('id, caja_id, monto_apertura, cajas(nombre)')
          .eq('tenant_id', tenant!.id).eq('estado', 'abierta')
      )
      return data ?? []
    },
    enabled: !!tenant && (showTraspaso || showDepositoFuerte || showRetiroFuerte),
  })

  // Auto-seleccionar caja (solo operativas, nunca caja fuerte).
  // Preferida persistida en DB (mig 239) → server-side, funciona en cualquier dispositivo/sesión.
  // localStorage queda como caché/fallback rápido (compat con preferidas viejas).
  const prefKey = tenant?.id && user?.id ? `caja_preferida_${tenant.id}_${user.id}` : null
  const cajaPreferidaId = (user as any)?.caja_preferida_id ?? (prefKey ? localStorage.getItem(prefKey) : null)
  useEffect(() => {
    if (cajaSeleccionada !== null || cajasOperativas.length === 0) return
    if (cajaPreferidaId && cajasOperativas.find((c: any) => c.id === cajaPreferidaId)) {
      setCajaSeleccionada(cajaPreferidaId)
    } else if (cajasAbiertas.length > 0) {
      setCajaSeleccionada(cajasAbiertas[0])
    }
  }, [cajasOperativas, cajasAbiertas, cajaSeleccionada, cajaPreferidaId])

  async function guardarCajaDefault(id: string) {
    if (!user?.id) return
    const esQuitar = cajaPreferidaId === id
    const nuevo = esQuitar ? null : id
    // Persistir server-side (mig 239) + caché local + reflejar en el store al instante
    const { error } = await supabase.from('users').update({ caja_preferida_id: nuevo }).eq('id', user.id)
    if (error) { toast.error('No se pudo guardar la caja predeterminada'); return }
    if (prefKey) { if (nuevo) localStorage.setItem(prefKey, nuevo); else localStorage.removeItem(prefKey) }
    setUser({ ...(user as any), caja_preferida_id: nuevo })
    toast.success(esQuitar ? 'Caja predeterminada quitada' : 'Caja guardada como predeterminada')
  }

  const cajaActual = cajasOperativas.find((c: any) => c.id === cajaSeleccionada) ?? cajasOperativas[0] ?? null
  const cajaId = cajaActual?.id ?? null

  const { data: sesionActiva } = useQuery({
    queryKey: ['sesion-activa', cajaId],
    queryFn: async () => {
      const { data } = await supabase.from('caja_sesiones')
        .select('*, abrio:usuario_id(nombre_display)')
        .eq('caja_id', cajaId!).eq('estado', 'abierta')
        .order('abierta_at', { ascending: false }).limit(1).single()
      return data ?? null
    },
    enabled: !!cajaId,
    // Sincronización multi-dispositivo: refresca cada 10s y al volver al foco
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  })

  const { data: movimientos = [] } = useQuery({
    queryKey: ['caja-movimientos', sesionActiva?.id],
    queryFn: async () => {
      const { data } = await supabase.from('caja_movimientos')
        .select('*, users(nombre_display)')
        .eq('sesion_id', sesionActiva!.id)
        .order('created_at', { ascending: false })
      return data ?? []
    },
    enabled: !!sesionActiva?.id,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  })

  const { data: historialSesiones = [] } = useQuery({
    queryKey: ['historial-sesiones', cajaId, sucursalId, cajaFuerte?.id],
    queryFn: async () => {
      let q = applyFilter(
        supabase.from('caja_sesiones')
          .select('*, cajas(nombre), abrio:usuario_id(nombre_display), cerrado_por:cerrado_por_id(nombre_display)')
          .eq('tenant_id', tenant!.id)
          .eq('estado', 'cerrada')
          .order('cerrada_at', { ascending: false })
          .limit(30)
      )
      // Excluir la caja fuerte del historial — tiene su propio historial en el tab Caja Fuerte
      if (cajaFuerte?.id) q = q.neq('caja_id', cajaFuerte.id)
      const { data } = await q
      return data ?? []
    },
    enabled: !!tenant && tab === 'historial',
  })

  const { data: movimientosDetalle = [] } = useQuery({
    queryKey: ['caja-movimientos-historial', sesionExpandida],
    queryFn: async () => {
      const { data } = await supabase.from('caja_movimientos')
        .select('*, users(nombre_display)')
        .eq('sesion_id', sesionExpandida!)
        .order('created_at', { ascending: true })
      return data ?? []
    },
    enabled: !!sesionExpandida,
  })

  const { data: motivosCaja = [] } = useQuery({
    queryKey: ['motivos-caja', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('motivos_movimiento')
        .select('id, nombre').eq('tenant_id', tenant!.id).eq('tipo', 'caja').eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant,
  })

  const { data: arqueosSesion = [] } = useQuery({
    queryKey: ['caja-arqueos', sesionActiva?.id],
    queryFn: async () => {
      const { data } = await supabase.from('caja_arqueos')
        .select('*, users(nombre_display)')
        .eq('sesion_id', sesionActiva!.id)
        .order('created_at', { ascending: false })
      return data ?? []
    },
    enabled: !!sesionActiva,
  })

  const { data: arqueosHistorial = [] } = useQuery({
    queryKey: ['caja-arqueos-historial', sesionExpandida],
    queryFn: async () => {
      const { data } = await supabase.from('caja_arqueos')
        .select('*, users(nombre_display)')
        .eq('sesion_id', sesionExpandida!)
        .order('created_at', { ascending: true })
      return data ?? []
    },
    enabled: !!sesionExpandida,
  })

  // Calcular totales de la sesión actual — solo efectivo
  const totalIngresos = movimientos.filter((m: any) =>
    m.tipo === 'ingreso' || m.tipo === 'ingreso_reserva' || m.tipo === 'ingreso_traspaso'
  ).reduce((a: number, m: any) => a + m.monto, 0)
  const totalEgresos = movimientos.filter((m: any) =>
    m.tipo === 'egreso' || m.tipo === 'egreso_devolucion_sena' || m.tipo === 'egreso_traspaso'
  ).reduce((a: number, m: any) => a + m.monto, 0)
  const saldoActual = sesionActiva ? saldoSesion({ apertura: sesionActiva.monto_apertura, ingresos: totalIngresos, egresos: totalEgresos }) : 0

  // Totales por medio de pago para el resumen de movimientos
  const totalesMedios = acumularTotalesPorMetodo(movimientos as any[])

  // Diferencia al cierre
  const montoRealNum = parseFloat(montoRealCierre) || 0
  const diferencia = calcularDiferenciaCierre(montoRealCierre, saldoActual)

  // Multi-usuario: quién abrió la sesión
  const abrioNombre = (sesionActiva as any)?.abrio?.nombre_display ?? null
  const esOtroUsuario = !!sesionActiva && sesionActiva.usuario_id !== user?.id
  // B2: CAJERO puede abrir 1 caja, pero no más de una simultáneamente
  const puedeAbrirCaja = puedeAdministrarCaja || misSesionesAbiertas.length === 0
  // CAJERO no puede ver el contenido de cajas abiertas por otro usuario
  const esCajero = user?.rol === 'CAJERO'
  const cajaAjenaBloqueada = esCajero && esOtroUsuario

  // Mutations
  const abrirCaja = useMutation({
    mutationFn: async () => {
      if (!cajaId) throw new Error('Seleccioná una caja')
      // A2: si DUEÑO/SUPERVISOR seleccionó otro usuario, esa es la sesión propietaria
      const usuarioPropietarioId = (puedeAbrirAjena && aperturaParaUsuarioId) ? aperturaParaUsuarioId : user!.id
      const abreEnNombreDeOtro = usuarioPropietarioId !== user!.id
      // B2: CAJERO no puede tener más de 1 sesión abierta simultáneamente
      if (!puedeAdministrarCaja) {
        const { data: check } = await supabase.from('caja_sesiones')
          .select('id').eq('tenant_id', tenant!.id).eq('usuario_id', user!.id).eq('estado', 'abierta')
        if (check && check.length > 0) {
          throw new Error('Ya tenés una caja abierta. Cerrala antes de abrir otra.')
        }
      }
      // Si abre a nombre de otro cajero: verificar que ESE cajero no tenga ya una sesión abierta
      if (abreEnNombreDeOtro) {
        const { data: yaAbierta } = await supabase.from('caja_sesiones')
          .select('id, cajas(nombre)').eq('tenant_id', tenant!.id)
          .eq('usuario_id', usuarioPropietarioId).eq('estado', 'abierta')
        if (yaAbierta && yaAbierta.length > 0) {
          throw new Error('Ese cajero ya tiene una caja abierta. Cerrá esa primero.')
        }
      }
      // Verificar que no haya otra sesión abierta por otro usuario en la misma caja
      const { data: existente } = await supabase.from('caja_sesiones')
        .select('id, usuario_id, abrio:usuario_id(nombre_display)')
        .eq('caja_id', cajaId).eq('estado', 'abierta')
        .maybeSingle()
      if (existente && existente.usuario_id !== usuarioPropietarioId) {
        const nombre = (existente as any).abrio?.nombre_display ?? 'otro usuario'
        throw new Error(`Esta caja ya está abierta por ${nombre}`)
      }
      const montoReal = parseFloat(montoApertura) || 0
      const difApertura = calcularDiferenciaApertura(montoReal, montoSugerido)
      const { error } = await supabase.from('caja_sesiones').insert({
        tenant_id: tenant!.id,
        caja_id: cajaId,
        usuario_id: usuarioPropietarioId,    // propietario (puede ser otro cajero)
        abierta_por: user!.id,               // quien efectivamente abrió (A2)
        monto_apertura: montoReal,
        monto_sugerido_apertura: montoSugerido,
        diferencia_apertura: difApertura,
        estado: 'abierta',
        sucursal_id: sucursalId || null,
      })
      if (error) throw error
      // Notificar si hay diferencia
      if (difApertura !== null && difApertura !== 0) {
        const { data: supervisores } = await supabase.from('users')
          .select('id, email, nombre_display')
          .eq('tenant_id', tenant!.id)
          .in('rol', ['DUEÑO', 'SUPERVISOR', 'SUPER_USUARIO'])
        if (supervisores?.length) {
          const difStr = difApertura > 0 ? `+$${Math.abs(difApertura).toLocaleString('es-AR')}` : `-$${Math.abs(difApertura).toLocaleString('es-AR')}`
          const titulo = `⚠ Diferencia al abrir ${cajaActual?.nombre ?? 'caja'}`
          const mensaje = `${user?.nombre_display ?? 'Un usuario'} abrió la caja con una diferencia de ${difStr} respecto al cierre anterior (sugerido $${montoSugerido!.toLocaleString('es-AR')}, ingresado $${montoReal.toLocaleString('es-AR')}).`
          await supabase.from('notificaciones').insert(
            supervisores.filter(s => s.id !== user?.id).map(s => ({
              tenant_id: tenant!.id,
              user_id: s.id,
              tipo: 'diferencia_apertura_caja',
              titulo,
              mensaje,
              action_url: '/caja',
            }))
          )
          // Email fire-and-forget
          supervisores.filter(s => s.email && s.id !== user?.id).forEach(s => {
            supabase.functions.invoke('send-email', {
              body: { type: 'notificacion', to: s.email, data: { titulo, mensaje, action_url: '/caja' } }
            }).catch(() => {})
          })
        }
      }
      return difApertura
    },
    onSuccess: () => {
      toast.success('Caja abierta')
      qc.invalidateQueries({ queryKey: ['sesion-activa'] })
      qc.invalidateQueries({ queryKey: ['cajas-abiertas-ids'] })
      setShowApertura(false); setShowDifConfirm(false); setMontoApertura(''); setAperturaParaUsuarioId('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const cerrarCaja = useMutation({
    mutationFn: async () => {
      if (!sesionActiva) throw new Error('No hay caja abierta')
      if (arqueosSesion.length === 0) throw new Error('Hacé al menos un arqueo parcial antes de cerrar la caja')
      if (montoRealCierre.trim() === '') throw new Error('Ingresá el monto contado para poder cerrar la caja')
      // B5 — verificar clave maestra si cierra caja ajena Y el tenant tiene clave configurada
      const claveConfigurada = !!(tenant as any)?.clave_maestra
      const esCierreAjeno = sesionActiva.usuario_id && sesionActiva.usuario_id !== user!.id
      if (esCierreAjeno && claveConfigurada) {
        if (!claveMaestraCierre.trim()) throw new Error('Esta caja la abrió otro usuario. Ingresá la clave maestra para cerrarla.')
        const { data: claveOK } = await supabase.rpc('verificar_clave_maestra', {
          p_tenant_id: tenant!.id,
          p_clave: claveMaestraCierre.trim(),
        })
        if (!claveOK) throw new Error('Clave maestra incorrecta')
      }
      // B7 — doble validación: si está activada en config, requerir 2do usuario válido
      if (configCaja.doble_validacion_cierre) {
        if (!dobleValEmail.trim() || !dobleValPassword.trim()) {
          throw new Error('Doble validación activada: ingresá email y contraseña del 2do usuario.')
        }
        // Cliente Supabase secundario para no romper la sesión actual
        const supaTemp = createClient(
          import.meta.env.VITE_SUPABASE_URL,
          import.meta.env.VITE_SUPABASE_ANON_KEY,
          { auth: { persistSession: false, autoRefreshToken: false } }
        )
        const { data: auth2, error: err2 } = await supaTemp.auth.signInWithPassword({
          email: dobleValEmail.trim(),
          password: dobleValPassword,
        })
        if (err2 || !auth2.user) {
          await supaTemp.auth.signOut().catch(() => {})
          throw new Error('Credenciales del 2do usuario inválidas')
        }
        if (auth2.user.id === user!.id) {
          await supaTemp.auth.signOut().catch(() => {})
          throw new Error('El 2do usuario debe ser distinto del que está cerrando la caja')
        }
        const { data: user2 } = await supaTemp.from('users')
          .select('rol, tenant_id').eq('id', auth2.user.id).single()
        await supaTemp.auth.signOut().catch(() => {})
        if (!user2 || user2.tenant_id !== tenant!.id) {
          throw new Error('El 2do usuario no pertenece a este negocio')
        }
        if (!['DUEÑO','SUPERVISOR','ADMIN','SUPER_USUARIO'].includes(user2.rol)) {
          throw new Error('El 2do usuario debe tener rol DUEÑO, SUPERVISOR o ADMIN')
        }
      }

      // K2 — Calcular snapshot_totales (por método de pago + ventas + movimientos manuales)
      const movs = movimientos as any[]
      const totalesPorMetodo: Record<string, number> = {}
      const ventasResumen: { numero?: number; concepto: string; medio: string; monto: number; created_at: string }[] = []
      const movManuales: { tipo: string; concepto: string; monto: number; created_at: string }[] = []
      for (const m of movs) {
        const medio = extraerMedioPago(m.tipo, m.concepto)
        const monto = signoMovimiento(m.tipo) * Number(m.monto || 0)
        totalesPorMetodo[medio] = (totalesPorMetodo[medio] ?? 0) + monto
        const numVenta = extraerNumeroVenta(m.concepto)
        if (numVenta) {
          ventasResumen.push({ numero: Number(numVenta), concepto: m.concepto, medio, monto: Number(m.monto), created_at: m.created_at })
        } else if (m.tipo === 'ingreso' || m.tipo === 'egreso') {
          movManuales.push({ tipo: m.tipo, concepto: m.concepto, monto: Number(m.monto), created_at: m.created_at })
        }
      }
      const snapshot = {
        version: 1,
        sucursal: { id: sesionActiva.sucursal_id ?? null, nombre: (sesionActiva as any).sucursales?.nombre ?? null },
        caja:     { id: sesionActiva.caja_id, nombre: cajaActual?.nombre ?? '—', moneda: (cajaActual as any)?.moneda ?? (tenant as any)?.moneda ?? 'ARS' },
        cajero:   { abrio: (sesionActiva as any)?.abrio?.nombre_display ?? null, cerro: user?.nombre_display ?? null },
        montos:   {
          apertura:    Number(sesionActiva.monto_apertura ?? 0),
          ingresos:    Number(totalIngresos ?? 0),
          egresos:     Number(totalEgresos ?? 0),
          saldo_sistema: Number(saldoActual ?? 0),
          conteo_real: Number(montoRealNum ?? 0),
          diferencia:  Number(diferencia ?? 0),
        },
        totales_por_metodo: Object.entries(totalesPorMetodo).map(([medio, monto]) => ({ medio, monto: Number(monto.toFixed(2)) })),
        ventas: ventasResumen.slice(0, 100),
        movimientos_manuales: movManuales.slice(0, 100),
        arqueos: (arqueosSesion as any[]).map((a: any) => ({ saldo_calculado: a.saldo_calculado, saldo_real: a.saldo_real, diferencia: a.diferencia, notas: a.notas, created_at: a.created_at })),
        numero_cierre: (sesionActiva as any).numero ?? null,
        generado_at: new Date().toISOString(),
      }

      const payload: any = {
        estado: 'cerrada',
        monto_cierre: saldoActual,
        total_ingresos: totalIngresos,
        total_egresos: totalEgresos,
        notas_cierre: notasCierre || null,
        cerrado_por_id: user?.id,
        cerrada_at: new Date().toISOString(),
        monto_real_cierre: montoRealNum,
        diferencia_cierre: diferencia ?? 0,
        snapshot_totales: snapshot,
      }
      const { error } = await supabase.from('caja_sesiones').update(payload).eq('id', sesionActiva.id)
      if (error) throw error

      // B4 — Si hay diferencia, registrar movimiento de ajuste asociado al cajero
      const dif = diferencia ?? 0
      const ajuste = clasificarAjusteDiferencia(dif)
      if (ajuste.tipo) {
        await supabase.from('caja_movimientos').insert({
          tenant_id: tenant!.id,
          sesion_id: sesionActiva.id,
          tipo: ajuste.tipo,
          concepto: ajuste.etiqueta === 'sobrante' ? `[Diferencia caja] Sobrante en cierre` : `[Diferencia caja] Faltante en cierre`,
          monto: Math.abs(dif),
          usuario_id: sesionActiva.usuario_id,  // asociado al cajero responsable
        })
      }
    },
    onSuccess: () => {
      logActividad({
        entidad: 'caja', entidad_id: sesionActiva?.id,
        entidad_nombre: cajaActual?.nombre ?? 'Caja',
        accion: 'cerrar',
        valor_nuevo: `Saldo: ${formatMoneda(saldoActual)}${diferencia !== null ? ` | Diferencia: ${formatMoneda(diferencia)}` : ''}`,
        pagina: '/caja',
      })
      const esCajeroPuro = user?.rol === 'CAJERO'
      // C2 — Mail al DUEÑO con detalle del cierre (siempre)
      // B1/B2/B3 — Alertas adicionales por diferencia según config del tenant
      void (async () => {
        const titulo = `Cierre de ${cajaActual?.nombre ?? 'Caja'} #${(sesionActiva as any).numero ?? ''} — ${formatMoneda(saldoActual)}`
        const lineas = [
          `Caja: ${cajaActual?.nombre ?? '—'}`,
          `Cerró: ${user?.nombre_display ?? (user as any)?.email ?? '—'}`,
          `Hora: ${new Date().toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}`,
          `Saldo sistema: ${formatMoneda(saldoActual)}`,
          `Conteo real: ${formatMoneda(montoRealNum)}`,
          `Diferencia: ${diferencia !== null ? formatMoneda(diferencia) : '—'}`,
          `Ingresos: ${formatMoneda(totalIngresos)}`,
          `Egresos: ${formatMoneda(totalEgresos)}`,
          notasCierre ? `Notas: ${notasCierre}` : '',
        ].filter(Boolean).join('\n')

        // Mail al DUEÑO (C2 — siempre)
        const { data: duenos } = await supabase.from('users')
          .select('email, nombre_display').eq('tenant_id', tenant!.id).eq('rol', 'DUEÑO')
        for (const d of (duenos ?? [])) {
          if (!d.email) continue
          void supabase.functions.invoke('send-email', {
            body: { type: 'notificacion', to: d.email, data: { titulo, mensaje: lineas, action_url: '/caja?tab=historial' } }
          }).catch(() => {})
        }

        // B1/B2/B3 — Si hay diferencia que supera umbral configurado, alertar a roles configurados
        const dif = diferencia ?? 0
        const umbral = Number((tenant as any)?.diferencia_caja_umbral ?? 0)  // 0/NULL = alerta con cualquier dif
        if (superaUmbralDiferencia(dif, umbral)) {
          const rolesAlerta: string[] = (tenant as any)?.diferencia_caja_alerta_roles ?? ['DUEÑO','SUPERVISOR']
          const canales: string[] = (tenant as any)?.diferencia_caja_alerta_canales ?? ['inapp','email']
          const tituloDif = `⚠ Diferencia en cierre ${cajaActual?.nombre ?? 'caja'}: ${dif > 0 ? '+' : ''}${formatMoneda(dif)}`
          const mensajeDif = `${user?.nombre_display ?? 'Un cajero'} cerró ${cajaActual?.nombre ?? 'la caja'} con ${dif > 0 ? 'sobrante' : 'faltante'} de ${formatMoneda(Math.abs(dif))}. Saldo sistema: ${formatMoneda(saldoActual)} · Conteo: ${formatMoneda(montoRealNum)}.`
          const { data: destinatarios } = await supabase.from('users')
            .select('id, email').eq('tenant_id', tenant!.id).in('rol', rolesAlerta)
          if (destinatarios?.length) {
            // Canal in-app
            if (canales.includes('inapp')) {
              await supabase.from('notificaciones').insert(
                destinatarios.filter(d => d.id !== user?.id).map(d => ({
                  tenant_id: tenant!.id, user_id: d.id,
                  tipo: 'diferencia_cierre_caja',
                  titulo: tituloDif, mensaje: mensajeDif,
                  action_url: '/caja?tab=historial',
                }))
              )
            }
            // Canal email
            if (canales.includes('email')) {
              for (const d of destinatarios) {
                if (!d.email || d.id === user?.id) continue
                void supabase.functions.invoke('send-email', {
                  body: { type: 'notificacion', to: d.email, data: { titulo: tituloDif, mensaje: mensajeDif, action_url: '/caja?tab=historial' } }
                }).catch(() => {})
              }
            }
            // Canal whatsapp — pendiente integración
          }
        }
      })()
      toast.success(esCajeroPuro ? 'Caja cerrada · El DUEÑO recibirá el detalle por email' : 'Caja cerrada')
      qc.invalidateQueries({ queryKey: ['sesion-activa'] })
      qc.invalidateQueries({ queryKey: ['historial-sesiones'] })
      setShowCierre(false); setNotasCierre(''); setMontoRealCierre(''); setClaveMaestraCierre('')
      setDobleValEmail(''); setDobleValPassword('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const agregarMovimiento = useMutation({
    mutationFn: async () => {
      if (moduloSoloLectura(user, 'caja')) throw new Error('Tu rol tiene acceso de solo lectura en Caja.')
      if (!sesionActiva) throw new Error('No hay caja abierta')
      if (!movConcepto.trim()) throw new Error('Ingresá un concepto')
      const monto = parseFloat(movMonto)
      if (!monto || monto <= 0) throw new Error('Ingresá un monto válido')
      const { error } = await supabase.from('caja_movimientos').insert({
        tenant_id: tenant!.id,
        sesion_id: sesionActiva.id,
        tipo: 'ingreso',
        concepto: movConcepto.trim(),
        monto,
        usuario_id: user?.id,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Ingreso registrado')
      qc.invalidateQueries({ queryKey: ['caja-movimientos'] })
      setShowMovimiento(false); setMovConcepto(''); setMovMonto('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // G1 — Corregir movimiento manual (DUEÑO/SUPERVISOR con config)
  const corregirMovimiento = useMutation({
    mutationFn: async () => {
      if (!corregirMov) throw new Error('No hay movimiento')
      if (!puedeEditarMovimiento) throw new Error('No tenés permiso para corregir movimientos')
      const nuevoMonto = parseFloat(corregirMonto)
      if (!nuevoMonto || nuevoMonto <= 0) throw new Error('Ingresá un monto válido')
      if (!corregirConcepto.trim()) throw new Error('Ingresá un concepto')
      const montoOriginal = Number(corregirMov.monto)

      // ISS-193 — Detectar si el movimiento es destino (u origen) de un traspaso entre cajas.
      // Si lo es, hay que reflejar la diferencia en la caja origen también para que ambas cuadren.
      let traspasoRel: any = null
      let propagarAOrigen = false
      let propagarADestino = false
      if (corregirMov.tipo === 'ingreso') {
        const { data: tDest } = await supabase.from('caja_traspasos')
          .select('id, sesion_origen_id, monto, concepto')
          .eq('movimiento_destino_id', corregirMov.id)
          .maybeSingle()
        if (tDest) { traspasoRel = tDest; propagarAOrigen = true }
      } else if (corregirMov.tipo === 'egreso') {
        const { data: tOrg } = await supabase.from('caja_traspasos')
          .select('id, sesion_destino_id, monto, concepto')
          .eq('movimiento_origen_id', corregirMov.id)
          .maybeSingle()
        if (tOrg) { traspasoRel = tOrg; propagarADestino = true }
      }

      // 1) Insertar reversión del original (mismo tipo opuesto)
      const tipoReverso = corregirMov.tipo === 'ingreso' ? 'egreso' : 'ingreso'
      const { error: e1 } = await supabase.from('caja_movimientos').insert({
        tenant_id: tenant!.id,
        sesion_id: corregirMov.sesion_id,
        tipo: tipoReverso,
        concepto: `[Reversión] ${corregirMov.concepto}`,
        monto: montoOriginal,
        usuario_id: user?.id,
      })
      if (e1) throw e1
      // 2) Insertar nuevo movimiento con valores corregidos
      const { data: movNuevo, error: e2 } = await supabase.from('caja_movimientos').insert({
        tenant_id: tenant!.id,
        sesion_id: corregirMov.sesion_id,
        tipo: corregirMov.tipo,
        concepto: `[Corregido] ${corregirConcepto.trim()}`,
        monto: nuevoMonto,
        usuario_id: user?.id,
      }).select('id').single()
      if (e2) throw e2

      // 3) ISS-193 — Propagar la diferencia a la caja contraparte del traspaso (si aplica)
      if (traspasoRel && (propagarAOrigen || propagarADestino)) {
        const contraSesionId = propagarAOrigen ? traspasoRel.sesion_origen_id : traspasoRel.sesion_destino_id
        const diferencia = nuevoMonto - montoOriginal // si destino recibió MENOS, diferencia<0 → la origen recupera plata
        const conceptoBase = corregirConcepto.trim()

        if (Math.abs(diferencia) > 0.01) {
          // La sesión contraparte debe estar abierta para registrarle el ajuste
          const { data: sesionContraparte } = await supabase.from('caja_sesiones')
            .select('id, estado, cajas(nombre)')
            .eq('id', contraSesionId)
            .maybeSingle()
          if (!sesionContraparte || (sesionContraparte as any).estado !== 'abierta') {
            const nombreCaja = (sesionContraparte as any)?.cajas?.nombre ?? 'la otra'
            throw new Error(`No se puede corregir: la caja contraparte del traspaso ("${nombreCaja}") está cerrada. Tiene que estar abierta para reflejar la diferencia de $${Math.abs(diferencia).toLocaleString('es-AR')}.`)
          }
          // Si destino recibió menos (diferencia<0): la origen recupera plata → ingreso en origen
          // Si destino recibió más  (diferencia>0): la origen pone plata extra → egreso  en origen
          // Análogo si propagás desde el origen al destino.
          const tipoAjuste = tipoAjusteTraspaso(propagarAOrigen ? 'a_origen' : 'a_destino', diferencia)
          const { error: e3 } = await supabase.from('caja_movimientos').insert({
            tenant_id: tenant!.id,
            sesion_id: contraSesionId,
            tipo: tipoAjuste,
            concepto: `[Ajuste traspaso] ${conceptoBase} · diferencia ${diferencia > 0 ? '+' : ''}${diferencia.toLocaleString('es-AR')}`,
            monto: Math.abs(diferencia),
            usuario_id: user?.id,
          })
          if (e3) throw e3
        }

        // 4) Actualizar el monto del traspaso para mantener consistencia + apuntar al nuevo movimiento
        const updatePayload: any = { monto: nuevoMonto }
        if (propagarAOrigen)  updatePayload.movimiento_destino_id = movNuevo?.id ?? null
        if (propagarADestino) updatePayload.movimiento_origen_id  = movNuevo?.id ?? null
        await supabase.from('caja_traspasos').update(updatePayload).eq('id', traspasoRel.id)
      }
    },
    onSuccess: () => {
      toast.success('Movimiento corregido')
      logActividad({
        entidad: 'caja', entidad_id: corregirMov?.id, entidad_nombre: corregirMov?.concepto,
        accion: 'editar',
        valor_anterior: `${corregirMov?.monto} · ${corregirMov?.concepto}`,
        valor_nuevo: `${parseFloat(corregirMonto)} · ${corregirConcepto.trim()}`,
        pagina: '/caja',
      })
      qc.invalidateQueries({ queryKey: ['caja-movimientos'] })
      setCorregirMov(null); setCorregirMonto(''); setCorregirConcepto('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const realizarTraspaso = useMutation({
    mutationFn: async () => {
      if (!sesionActiva) throw new Error('No hay sesión activa')
      if (!traspasoDestinoSesionId) throw new Error('Seleccioná la caja destino')
      const monto = parseFloat(traspasoMonto)
      if (!monto || monto <= 0) throw new Error('Ingresá un monto válido')
      if (monto > saldoActual) throw new Error(`Saldo insuficiente. Disponible: ${formatMoneda(saldoActual)}`)
      const concepto = traspasoConcepto.trim() || 'Traspaso entre cajas'
      const sesDestino = (sesionesAbiertasAll as any[]).find(s => s.id === traspasoDestinoSesionId)
      const nombreDestino = sesDestino?.cajas?.nombre ?? 'otra caja'
      const nombreOrigen = cajaActual?.nombre ?? 'esta caja'
      // Egreso en origen
      const { data: movOrigen, error: e1 } = await supabase.from('caja_movimientos').insert({
        tenant_id: tenant!.id, sesion_id: sesionActiva.id,
        tipo: 'egreso', concepto: `${concepto} → ${nombreDestino}`,
        monto, usuario_id: user!.id,
      }).select('id').single()
      if (e1) throw e1
      // Ingreso en destino
      const { data: movDestino, error: e2 } = await supabase.from('caja_movimientos').insert({
        tenant_id: tenant!.id, sesion_id: traspasoDestinoSesionId,
        tipo: 'ingreso', concepto: `${concepto} ← ${nombreOrigen}`,
        monto, usuario_id: user!.id,
      }).select('id').single()
      if (e2) throw e2
      // Registro en tabla de traspasos + FK a los movimientos para propagar correcciones (ISS-193)
      const { error: e3 } = await supabase.from('caja_traspasos').insert({
        tenant_id: tenant!.id,
        sesion_origen_id: sesionActiva.id,
        sesion_destino_id: traspasoDestinoSesionId,
        movimiento_origen_id:  movOrigen?.id  ?? null,
        movimiento_destino_id: movDestino?.id ?? null,
        monto, concepto: concepto || null, usuario_id: user!.id,
      })
      if (e3) throw e3
    },
    onSuccess: () => {
      toast.success('Traspaso realizado')
      qc.invalidateQueries({ queryKey: ['caja-movimientos'] })
      setShowTraspaso(false); setTraspasoMonto(''); setTraspasoConcepto(''); setTraspasoDestinoSesionId('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Caja fuerte mutations ──────────────────────────────────────────────────
  const operarCajaFuerte = useMutation({
    mutationFn: async ({
      tipo, monto, concepto, desdeSessionId, hastaSessionId, cuentaOrigenId,
    }: { tipo: 'deposito' | 'retiro'; monto: number; concepto: string; desdeSessionId?: string; hastaSessionId?: string; cuentaOrigenId?: string }) => {
      if (!cajaFuerte) throw new Error('No hay caja fuerte configurada')
      if (monto <= 0) throw new Error('Ingresá un monto válido')
      // Depósito desde caja: requiere saldo en esa caja
      if (tipo === 'deposito' && desdeSessionId) {
        // Obtener saldo de la sesión de origen seleccionada
        const { data: movOrigen } = await supabase.from('caja_movimientos')
          .select('tipo, monto').eq('sesion_id', desdeSessionId)
        const { data: sesOrigen } = await supabase.from('caja_sesiones')
          .select('monto_apertura').eq('id', desdeSessionId).single()
        const saldoOrigen = (sesOrigen?.monto_apertura ?? 0) + (movOrigen ?? []).reduce((acc: number, m: any) => {
          if (m.tipo === 'ingreso' || m.tipo === 'ingreso_reserva' || m.tipo === 'ingreso_traspaso') return acc + m.monto
          if (m.tipo === 'egreso' || m.tipo === 'egreso_devolucion_sena' || m.tipo === 'egreso_traspaso') return acc - m.monto
          return acc
        }, 0)
        if (monto > saldoOrigen) throw new Error(`Saldo insuficiente. Disponible: ${formatMoneda(saldoOrigen)}`)
      }
      if (tipo === 'retiro' && monto > fuerteSaldo) throw new Error(`Saldo insuficiente en caja fuerte. Disponible: ${formatMoneda(fuerteSaldo)}`)

      // Obtener o crear sesión permanente de la fuerte
      let fuerteSessionId = (fuerteSesion as any)?.id
      if (!fuerteSessionId) {
        const { data: ns, error: eS } = await supabase.from('caja_sesiones').insert({
          tenant_id: tenant!.id, caja_id: cajaFuerte.id,
          estado: 'abierta', es_permanente: true,
          usuario_id: user!.id, monto_apertura: 0,
        }).select('id').single()
        if (eS) throw eS
        fuerteSessionId = ns.id
      }

      // Cuenta efectivo del tenant — default para retiros/traspasos entre cajas (siempre efectivo).
      const cuentaEfectivo = (bovedaCuentas as any[]).find((c: any) => c.tipo === 'efectivo')
      const cuentaEfectivoId = cuentaEfectivo?.cuenta_origen_id ?? null
      // Cuenta destino del ingreso a la bóveda: la elegida en el modal (default Efectivo).
      const cuentaIngresoId = cuentaOrigenId || cuentaEfectivoId

      if (tipo === 'deposito') {
        // Si viene de una caja activa: egreso en esa caja
        if (desdeSessionId) {
          const { error: e1 } = await supabase.from('caja_movimientos').insert({
            tenant_id: tenant!.id, sesion_id: desdeSessionId,
            tipo: 'egreso_traspaso', monto,
            concepto: concepto || 'Depósito en caja fuerte',
            cuenta_origen_id: cuentaEfectivoId,
            usuario_id: user!.id,
          })
          if (e1) throw e1
        }
        // Ingreso en caja fuerte (siempre) — a la cuenta de origen elegida (default Efectivo)
        const { error: e2 } = await supabase.from('caja_movimientos').insert({
          tenant_id: tenant!.id, sesion_id: fuerteSessionId,
          tipo: 'ingreso_traspaso', monto,
          concepto: concepto || (desdeSessionId ? `Depósito desde caja` : 'Ingreso externo'),
          cuenta_origen_id: cuentaIngresoId,
          usuario_id: user!.id,
        })
        if (e2) throw e2
      } else {
        const destSesionId = hastaSessionId
        if (!destSesionId) throw new Error('Seleccioná la caja de destino')
        const { error: e1 } = await supabase.from('caja_movimientos').insert({
          tenant_id: tenant!.id, sesion_id: fuerteSessionId,
          tipo: 'egreso_traspaso', monto,
          concepto: concepto || 'Retiro de caja fuerte',
          cuenta_origen_id: cuentaEfectivoId,
          usuario_id: user!.id,
        })
        if (e1) throw e1
        const { error: e2 } = await supabase.from('caja_movimientos').insert({
          tenant_id: tenant!.id, sesion_id: destSesionId,
          tipo: 'ingreso_traspaso', monto,
          concepto: concepto || 'Ingreso desde caja fuerte',
          cuenta_origen_id: cuentaEfectivoId,
          usuario_id: user!.id,
        })
        if (e2) throw e2
      }
    },
    onSuccess: (_data, vars) => {
      toast.success(vars.tipo === 'deposito' ? 'Depositado en caja fuerte' : 'Retirado de caja fuerte')
      qc.invalidateQueries({ queryKey: ['caja-fuerte-sesion'] })
      qc.invalidateQueries({ queryKey: ['caja-fuerte-movimientos'] })
      qc.invalidateQueries({ queryKey: ['caja-movimientos'] })
      setShowDepositoFuerte(false); setShowRetiroFuerte(false)
      setFuerteMonto(''); setFuerteConcepto('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const enviarSolicitudFuerte = useMutation({
    mutationFn: async ({ monto, concepto }: { monto: number; concepto: string }) => {
      if (!sesionActiva) throw new Error('No hay sesión activa para transferir')
      if (monto <= 0) throw new Error('Ingresá un monto válido')
      if (monto > saldoActual) throw new Error(`Saldo insuficiente. Disponible: ${formatMoneda(saldoActual)}`)

      const { data: supervisores, error: eS } = await supabase.from('users')
        .select('id')
        .eq('tenant_id', tenant!.id)
        .in('rol', ['DUEÑO', 'SUPERVISOR', 'SUPER_USUARIO'])
      if (eS) throw eS
      if (!supervisores?.length) throw new Error('No hay supervisores para aprobar la solicitud')

      const metadata = {
        accion: 'solicitud_caja_fuerte',
        monto,
        concepto: concepto || '',
        sesion_id: sesionActiva.id,
        caja_id: cajaActual?.id ?? null,
        caja_nombre: cajaActual?.nombre ?? 'caja',
        cajero_nombre: user?.nombre_display ?? 'Un cajero',
      }
      const { error } = await supabase.from('notificaciones').insert(
        supervisores.map(s => ({
          tenant_id: tenant!.id,
          user_id: s.id,
          tipo: 'warning',
          titulo: `Solicitud de Caja Fuerte — ${user?.nombre_display ?? 'Cajero'}`,
          mensaje: `Solicitar transferir ${formatMoneda(monto)} de "${cajaActual?.nombre}" a Caja Fuerte.${concepto ? ` Concepto: ${concepto}` : ''}`,
          action_url: '/caja',
          metadata,
        }))
      )
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Solicitud enviada. El Owner o Supervisor deberá aprobarla.')
      setShowSolicitudFuerte(false)
      setSolicitudMonto('')
      setSolicitudConcepto('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const realizarArqueo = useMutation({
    mutationFn: async () => {
      if (!sesionActiva) throw new Error('No hay sesión activa')
      const conteo = parseFloat(arqueoConteo.replace(',', '.'))
      if (isNaN(conteo) || conteo < 0) throw new Error('Ingresá un monto válido')
      const { error } = await supabase.from('caja_arqueos').insert({
        tenant_id: tenant!.id,
        sesion_id: sesionActiva.id,
        saldo_calculado: saldoActual,
        saldo_real: conteo,
        notas: arqueoNotas.trim() || null,
        usuario_id: user?.id,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Arqueo registrado')
      qc.invalidateQueries({ queryKey: ['caja-arqueos', sesionActiva?.id] })
      setShowArqueo(false); setArqueoConteo(''); setArqueoNotas('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const crearCaja = useMutation({
    mutationFn: async () => {
      if (!nuevaCajaNombre.trim()) throw new Error('Ingresá un nombre')
      const { error } = await supabase.from('cajas').insert({
        tenant_id: tenant!.id,
        nombre: nuevaCajaNombre.trim(),
        sucursal_id: sucursalId || null,
        moneda: nuevaCajaMoneda || (tenant as any)?.moneda || 'ARS',
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Caja creada')
      qc.invalidateQueries({ queryKey: ['cajas'] })
      setShowNuevaCaja(false); setNuevaCajaNombre(''); setNuevaCajaMoneda('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // Keyboard shortcuts para modales
  useModalKeyboard({ isOpen: showMovimiento, onClose: () => { setShowMovimiento(false); setMovConcepto(''); setMovMonto('') }, onConfirm: () => { if (!agregarMovimiento.isPending) agregarMovimiento.mutate() } })
  useModalKeyboard({ isOpen: showCierre, onClose: () => { setShowCierre(false); setMontoRealCierre('') }, onConfirm: () => { if (!cerrarCaja.isPending) cerrarCaja.mutate() } })
  useModalKeyboard({ isOpen: showApertura, onClose: () => setShowApertura(false), onConfirm: () => { if (!abrirCaja.isPending) abrirCaja.mutate() } })
  useModalKeyboard({ isOpen: showNuevaCaja, onClose: () => setShowNuevaCaja(false), onConfirm: () => { if (!crearCaja.isPending) crearCaja.mutate() } })
  useModalKeyboard({ isOpen: showTraspaso && !showMovimiento, onClose: () => { setShowTraspaso(false); setTraspasoMonto(''); setTraspasoConcepto(''); setTraspasoDestinoSesionId('') }, onConfirm: () => { if (!realizarTraspaso.isPending) realizarTraspaso.mutate() } })
  useModalKeyboard({ isOpen: showArqueo, onClose: () => { setShowArqueo(false); setArqueoConteo(''); setArqueoNotas('') }, onConfirm: () => { if (!realizarArqueo.isPending) realizarArqueo.mutate() } })
  useModalKeyboard({ isOpen: showExtraerBoveda, onClose: () => setShowExtraerBoveda(false), onConfirm: () => { if (!extraerDeBoveda.isPending) extraerDeBoveda.mutate() } })

  // Defaults al abrir "Ingresar a Caja Fuerte": cuenta destino = Efectivo. En modo básico
  // la "caja de origen" queda fijada a la caja activa (el selector se bloquea — el usuario
  // siempre transfiere desde la caja en la que está parado).
  useEffect(() => {
    if (!showDepositoFuerte) return
    const efId = (bovedaCuentas as any[]).find((c: any) => c.tipo === 'efectivo')?.cuenta_origen_id ?? ''
    setDepositoCuentaId(efId)
    if (!modoAvanzado && sesionActiva) setDepositoFuenteSesionId(sesionActiva.id)
  }, [showDepositoFuerte]) // eslint-disable-line react-hooks/exhaustive-deps

  // Atajo de teclado: Shift+I = ingreso (solo con caja abierta)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!sesionActiva || tab !== 'caja') return
      if (e.shiftKey && e.key === 'I') { e.preventDefault(); setShowMovimiento(true) }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [sesionActiva, tab])

  const imprimirCierre = (sesion: any, formato: 'a4' | 'termico' = 'a4') => {
    // Si la sesión tiene snapshot_totales (K2), lo usamos. Si no, fallback a campos legacy.
    const snap = sesion.snapshot_totales || null
    const numCierre = sesion.numero ?? snap?.numero_cierre ?? null
    const numStr = numCierre ? `#${String(numCierre).padStart(4, '0')}` : ''
    const titulo = `Cierre de Caja ${numStr}`.trim()
    const tenantInfo = (tenant as any) || {}

    if (formato === 'termico') {
      // ─── Ticket angosto 80mm (C3) ──────────────────────────
      // Ancho 80mm, alto dinámico (calculado en función de líneas)
      const ancho = 80
      const lineasMov = (snap?.movimientos_manuales ?? []).length
      const lineasMet = (snap?.totales_por_metodo ?? []).length
      const alto = 130 + lineasMet * 5 + lineasMov * 4
      const tdoc = new jsPDF({ unit: 'mm', format: [ancho, alto] })
      tdoc.setFont('helvetica', 'bold'); tdoc.setFontSize(11)
      tdoc.text(BRAND.name, ancho/2, 7, { align: 'center' })
      tdoc.setFontSize(9); tdoc.setFont('helvetica', 'normal')
      tdoc.text(tenant?.nombre ?? '', ancho/2, 12, { align: 'center' })
      if (tenantInfo.cuit) tdoc.text(`CUIT: ${tenantInfo.cuit}`, ancho/2, 16, { align: 'center' })
      tdoc.setLineDashPattern([1,1], 0)
      tdoc.line(3, 19, ancho-3, 19)
      tdoc.setLineDashPattern([], 0)

      let y = 24
      tdoc.setFont('helvetica', 'bold'); tdoc.setFontSize(10)
      tdoc.text(titulo, ancho/2, y, { align: 'center' }); y += 5
      tdoc.setFont('helvetica', 'normal'); tdoc.setFontSize(8)
      tdoc.text(`Caja: ${sesion.cajas?.nombre ?? '—'}`, 3, y); y += 4
      const sucNombre = sesion.sucursales?.nombre ?? snap?.sucursal?.nombre
      if (sucNombre) { tdoc.text(`Sucursal: ${sucNombre}`, 3, y); y += 4 }
      tdoc.text(`Abrió: ${sesion.abrio?.nombre_display ?? '—'}`, 3, y); y += 4
      tdoc.text(`Cerró: ${sesion.cerrado_por?.nombre_display ?? '—'}`, 3, y); y += 4
      tdoc.text(`Apertura: ${new Date(sesion.abierta_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}`, 3, y); y += 4
      tdoc.text(`Cierre:   ${new Date(sesion.cerrada_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}`, 3, y); y += 5

      tdoc.setLineDashPattern([1,1], 0); tdoc.line(3, y, ancho-3, y); tdoc.setLineDashPattern([], 0); y += 4
      tdoc.setFont('helvetica', 'bold'); tdoc.text('Resumen', 3, y); y += 4
      tdoc.setFont('helvetica', 'normal')
      const filas: [string, string][] = [
        ['Apertura', formatMoneda(sesion.monto_apertura)],
        ['Ingresos', formatMoneda(sesion.total_ingresos)],
        ['Egresos',  formatMoneda(sesion.total_egresos)],
        ['Saldo sistema', formatMoneda(sesion.monto_cierre)],
      ]
      if (sesion.monto_real_cierre != null) filas.push(['Conteo real', formatMoneda(sesion.monto_real_cierre)])
      const dif = sesion.diferencia_cierre ?? 0
      if (sesion.monto_real_cierre != null) filas.push([dif >= 0 ? 'Sobrante' : 'Faltante', formatMoneda(Math.abs(dif))])
      for (const [c, v] of filas) {
        tdoc.text(c, 3, y); tdoc.text(v, ancho-3, y, { align: 'right' }); y += 4
      }

      // Totales por método (snapshot)
      if (snap?.totales_por_metodo?.length) {
        y += 1
        tdoc.setLineDashPattern([1,1], 0); tdoc.line(3, y, ancho-3, y); tdoc.setLineDashPattern([], 0); y += 4
        tdoc.setFont('helvetica', 'bold'); tdoc.text('Por método de pago', 3, y); y += 4
        tdoc.setFont('helvetica', 'normal')
        for (const t of snap.totales_por_metodo) {
          tdoc.text(t.medio || 'Otro', 3, y); tdoc.text(formatMoneda(t.monto), ancho-3, y, { align: 'right' }); y += 4
        }
      }

      // Notas
      if (sesion.notas_cierre) {
        y += 2; tdoc.setFont('helvetica', 'italic'); tdoc.setFontSize(7)
        const lines = tdoc.splitTextToSize(`Notas: ${sesion.notas_cierre}`, ancho - 6)
        tdoc.text(lines, 3, y); y += lines.length * 3
      }

      tdoc.save(`cierre_${numStr || new Date(sesion.cerrada_at).toISOString().split('T')[0]}_termico.pdf`)
      return
    }

    // ─── Formato A4 (default) ─────────────────────────────────
    const doc = new jsPDF()
    const w = doc.internal.pageSize.width

    // Header con logo + nombre
    doc.setFillColor(30, 58, 95)
    doc.rect(0, 0, w, 28, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(17); doc.setFont('helvetica', 'bold')
    doc.text(BRAND.name, 14, 13)
    doc.setFontSize(12); doc.setFont('helvetica', 'normal')
    doc.text(titulo, 14, 21)
    // Datos fiscales arriba derecha
    doc.setFontSize(9)
    if (tenant?.nombre) doc.text(tenant.nombre, w - 14, 10, { align: 'right' })
    if (tenantInfo.cuit) doc.text(`CUIT: ${tenantInfo.cuit}`, w - 14, 15, { align: 'right' })
    if (tenantInfo.domicilio_fiscal) doc.text(tenantInfo.domicilio_fiscal, w - 14, 20, { align: 'right' })

    // Bloque de datos del cierre
    doc.setTextColor(60, 60, 60)
    doc.setFontSize(10)
    const sucNombre = sesion.sucursales?.nombre ?? snap?.sucursal?.nombre
    let yh = 38
    doc.text(`Caja: ${sesion.cajas?.nombre ?? '—'}`, 14, yh); yh += 6
    if (sucNombre) { doc.text(`Sucursal: ${sucNombre}`, 14, yh); yh += 6 }
    doc.text(`Apertura: ${new Date(sesion.abierta_at).toLocaleString('es-AR')}`, 14, yh); yh += 6
    doc.text(`Cierre: ${new Date(sesion.cerrada_at).toLocaleString('es-AR')}`, 14, yh); yh += 6
    doc.text(`Abrió: ${sesion.abrio?.nombre_display ?? '—'}`, 14, yh); yh += 6
    doc.text(`Cerró: ${sesion.cerrado_por?.nombre_display ?? '—'}`, 14, yh); yh += 6

    // Tabla resumen
    const resumenRows: any[] = [
      ['Monto de apertura', formatMoneda(sesion.monto_apertura)],
      ['Total ingresos', formatMoneda(sesion.total_ingresos)],
      ['Total egresos', formatMoneda(sesion.total_egresos)],
      ['Saldo sistema (calculado)', formatMoneda(sesion.monto_cierre)],
    ]
    if (sesion.monto_real_cierre != null) {
      resumenRows.push(['Conteo real', formatMoneda(sesion.monto_real_cierre)])
      const dif = sesion.diferencia_cierre ?? 0
      resumenRows.push([dif >= 0 ? 'Sobrante' : 'Faltante', formatMoneda(Math.abs(dif))])
    }
    autoTable(doc, {
      startY: yh + 2,
      head: [['Concepto', 'Monto']],
      body: resumenRows,
      styles: { fontSize: 10 },
      headStyles: { fillColor: [30, 58, 95] },
      columnStyles: { 1: { halign: 'right' } },
    })
    let y2: number = (doc as any).lastAutoTable.finalY + 8

    // Totales por método de pago (del snapshot)
    if (snap?.totales_por_metodo?.length) {
      autoTable(doc, {
        startY: y2,
        head: [['Método de pago', 'Total']],
        body: snap.totales_por_metodo.map((t: any) => [t.medio || 'Otro', formatMoneda(t.monto)]),
        styles: { fontSize: 9 },
        headStyles: { fillColor: [80, 100, 130] },
        columnStyles: { 1: { halign: 'right' } },
      })
      y2 = (doc as any).lastAutoTable.finalY + 6
    }

    // Listado de ventas (truncado a 25 para no inflar el PDF)
    if (snap?.ventas?.length) {
      const ventas = snap.ventas.slice(0, 25)
      autoTable(doc, {
        startY: y2,
        head: [['#', 'Hora', 'Medio', 'Monto']],
        body: ventas.map((v: any) => [
          v.numero ?? '—',
          new Date(v.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
          v.medio || '—',
          formatMoneda(v.monto),
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [80, 100, 130] },
        columnStyles: { 3: { halign: 'right' } },
      })
      y2 = (doc as any).lastAutoTable.finalY + 6
      if (snap.ventas.length > 25) {
        doc.setFontSize(8); doc.setTextColor(120, 120, 120)
        doc.text(`+ ${snap.ventas.length - 25} ventas más en el detalle online`, 14, y2)
        y2 += 5
      }
    }

    // Movimientos manuales
    if (snap?.movimientos_manuales?.length) {
      autoTable(doc, {
        startY: y2,
        head: [['Tipo', 'Concepto', 'Monto']],
        body: snap.movimientos_manuales.slice(0, 15).map((m: any) => [
          m.tipo === 'ingreso' ? 'Ingreso' : 'Egreso',
          m.concepto?.length > 60 ? m.concepto.substring(0, 57) + '...' : m.concepto,
          formatMoneda(m.monto),
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [80, 100, 130] },
        columnStyles: { 2: { halign: 'right' } },
      })
      y2 = (doc as any).lastAutoTable.finalY + 6
    }

    // Notas
    if (sesion.notas_cierre) {
      doc.setFontSize(9); doc.setTextColor(80, 80, 80)
      const lines = doc.splitTextToSize(`Notas: ${sesion.notas_cierre}`, w - 28)
      doc.text(lines, 14, y2)
      y2 += lines.length * 5 + 4
    }

    // Espacio para firmas
    if (y2 < 250) {
      y2 = Math.max(y2 + 18, 260)
      doc.setDrawColor(180, 180, 180)
      doc.line(20, y2, 90, y2)
      doc.line(w - 90, y2, w - 20, y2)
      doc.setFontSize(8); doc.setTextColor(120, 120, 120)
      doc.text('Firma del cajero', 55, y2 + 4, { align: 'center' })
      doc.text('Firma del supervisor', w - 55, y2 + 4, { align: 'center' })
    }

    // Pie con número correlativo
    if (numCierre) {
      doc.setFontSize(8); doc.setTextColor(150, 150, 150)
      doc.text(`Cierre correlativo: ${numStr} · Generado: ${new Date().toLocaleString('es-AR')}`, w / 2, 290, { align: 'center' })
    }

    doc.save(`cierre_caja${numStr ? '_' + numStr.replace('#', '') : ''}_${new Date(sesion.cerrada_at).toISOString().split('T')[0]}.pdf`)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
            <DollarSign size={22} className="text-accent" /> Caja
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">Gestioná la caja de tu negocio</p>
        </div>
        {/* M3 — acceso al panel de cajero simplificado (tablets/touch) */}
        {!esSoloLectura && (
          <button onClick={() => navigate('/caja/panel')}
            title="Modo cajero — vista simplificada para tablet/touch"
            className="flex items-center gap-2 px-3 py-2 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-semibold rounded-xl transition-colors">
            <Tablet size={16} /> <span className="hidden sm:inline">Modo panel</span>
          </button>
        )}
      </div>

      {/* Tabs */}
      {(() => {
        const cajaFuerteRoles: string[] = (tenant as any)?.caja_fuerte_roles ?? ['DUEÑO']
        const puedeCajaFuerte = accedeABoveda(user?.rol as any, (user as any)?.rol_custom_id, cajaFuerteRoles)
        const tabs = [
          { id: 'caja', label: 'Caja actual', icon: Wallet, visible: true },
          { id: 'cobranzas', label: 'Cobranzas CC', icon: CreditCard, visible: true },
          { id: 'historial', label: 'Historial', icon: History, visible: true },
          { id: 'caja_fuerte', label: 'Caja Fuerte', icon: Lock, visible: puedeCajaFuerte && !!cajaFuerte },
          { id: 'reportes', label: 'Reportes', icon: BarChart3, visible: puedeAdministrarCaja || puedeReimprimirTicket },
          { id: 'configuracion', label: 'Configuración', icon: Settings, visible: puedeAdministrarCaja },
        ].filter(t => t.visible)
        return <PageTabs tabs={tabs} active={tab} onChange={(id) => setTab(id as Tab)} />
      })()}

      {/* ── CAJA ACTUAL ── */}
      {tab === 'caja' && (
        <div className="space-y-4">
          {/* A4 — Banner: caja propia abierta más de 24h */}
          {sesionDiaAnterior && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-300 dark:border-amber-700 rounded-xl p-4 flex items-start gap-3">
              <AlertTriangle size={18} className="text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-amber-800 dark:text-amber-300 text-sm">
                  Caja olvidada del día anterior
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                  Tu sesión en <strong>{(sesionDiaAnterior as any).cajas?.nombre ?? 'la caja'}</strong> está abierta hace más de 24h
                  ({new Date((sesionDiaAnterior as any).abierta_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}).
                  Cerrala primero para mantener el control contable.
                </p>
                {((sesionDiaAnterior as any).caja_id !== cajaId) && (
                  <button onClick={() => setCajaSeleccionada((sesionDiaAnterior as any).caja_id)}
                    className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-400 hover:text-amber-800 underline">
                    Ir a esa caja →
                  </button>
                )}
              </div>
            </div>
          )}
          {/* ISS-104: selector de caja — solo píldoras, sin select box */}
          {cajasOperativas.length > 1 && (
            <div className="flex gap-2 flex-wrap items-center">
              {cajasOperativas.map((c: any) => {
                const abierta = cajasAbiertas.includes(c.id)
                const activa = c.id === cajaId
                const esPref = cajaPreferidaId === c.id
                return (
                  <div key={c.id} className="flex items-center gap-0">
                    <button onClick={() => setCajaSeleccionada(c.id)}
                      title={abierta ? 'Abierta' : 'Cerrada'}
                      className={`flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-l-xl text-xs font-medium border-y border-l transition-all
                        ${activa
                          ? 'border-accent bg-accent/10 text-accent'
                          : abierta
                            ? 'border-green-300 bg-green-50 dark:bg-green-900/20 dark:border-green-700 text-green-700 dark:text-green-400 hover:border-green-400'
                            : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-400 dark:text-gray-500 hover:border-gray-300'}`}>
                      <DollarSign size={12} />
                      {esPref && <span className="text-yellow-500 text-[11px]">★</span>}
                      <span>{c.nombre}</span>
                      {c.moneda && c.moneda !== ((tenant as any)?.moneda ?? 'ARS') && (
                        <span className="text-[10px] font-mono px-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">{c.moneda}</span>
                      )}
                      <span className={`w-2 h-2 rounded-full ${abierta ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                    </button>
                    <button
                      onClick={() => guardarCajaDefault(c.id)}
                      title={esPref ? 'Predeterminada (click para quitar)' : 'Establecer como predeterminada'}
                      className={`px-2 py-1.5 rounded-r-xl text-xs border-y border-r transition-all
                        ${activa
                          ? 'border-accent bg-accent/10 text-accent hover:bg-accent/20'
                          : abierta
                            ? 'border-green-300 bg-green-50 dark:bg-green-900/20 dark:border-green-700 text-green-600 dark:text-green-400 hover:bg-green-100'
                            : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-300 dark:text-gray-600 hover:border-gray-300'}
                        ${esPref ? 'text-yellow-500' : ''}`}>
                      ★
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {cajasOperativas.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-10 text-center shadow-sm border border-gray-100">
              <DollarSign size={36} className="text-gray-300 mx-auto mb-3" />
              <p className="font-medium text-gray-600 dark:text-gray-400">No hay cajas operativas configuradas</p>
              <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Creá una caja en la pestaña Configuración</p>
              <button onClick={() => setTab('configuracion')}
                className="mt-4 text-sm text-accent hover:underline">
                Ir a configuración →
              </button>
            </div>
          ) : !sesionActiva ? (
            /* Caja cerrada */
            <div className="bg-white dark:bg-gray-800 rounded-xl p-8 text-center shadow-sm border border-gray-100">
              <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-4">
                <Lock size={28} className="text-gray-400 dark:text-gray-500" />
              </div>
              <h2 className="text-xl font-bold text-gray-700 dark:text-gray-300 mb-1">Caja cerrada</h2>
              <p className="text-gray-400 dark:text-gray-500 text-sm mb-6">
                {cajaActual?.nombre} — Abrí la caja para comenzar a registrar movimientos
              </p>
              {showApertura ? (
                <div className="max-w-xs mx-auto space-y-3">
                  {/* A2: DUEÑO/SUPERVISOR puede abrir caja a nombre de un cajero */}
                  {puedeAbrirAjena && (cajerosTenant as any[]).length > 1 && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 text-left">Abrir caja para</label>
                      <select value={aperturaParaUsuarioId}
                        onChange={e => setAperturaParaUsuarioId(e.target.value)}
                        className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-800">
                        <option value="">Yo ({user?.nombre_display ?? 'mi usuario'})</option>
                        {(cajerosTenant as any[]).filter((u: any) => u.id !== user?.id).map((u: any) => (
                          <option key={u.id} value={u.id}>{u.nombre_display ?? u.email} ({u.rol})</option>
                        ))}
                      </select>
                      {aperturaParaUsuarioId && (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1 text-left">
                          ⚠ La caja quedará a nombre del cajero seleccionado y solo él (o un DUEÑO/SUPERVISOR) podrá cerrarla
                        </p>
                      )}
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 text-left">Monto inicial en caja</label>
                    {montoSugerido !== null && (
                      <p className="text-xs text-blue-600 dark:text-blue-400 mb-1">
                        💡 Sugerido: ${montoSugerido.toLocaleString('es-AR')} (cierre anterior)
                      </p>
                    )}
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500">$</span>
                      <input type="number" onWheel={e => e.currentTarget.blur()} min="0" value={montoApertura}
                        onChange={e => { setMontoApertura(e.target.value); setShowDifConfirm(false) }}
                        placeholder="0" autoFocus
                        className="w-full pl-7 pr-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
                    </div>
                    {/* Diferencia en tiempo real */}
                    {montoSugerido !== null && montoApertura !== '' && (() => {
                      const dif = parseFloat(montoApertura) - montoSugerido
                      if (dif === 0) return null
                      return (
                        <div className={`mt-2 px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-2 ${dif > 0 ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400' : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'}`}>
                          <span>⚠</span>
                          <span>Diferencia de {dif > 0 ? '+' : ''}{dif.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })} respecto al cierre anterior. Se notificará al supervisor/dueño.</span>
                        </div>
                      )
                    })()}
                  </div>
                  {/* Confirm diferencia */}
                  {showDifConfirm && montoSugerido !== null && parseFloat(montoApertura) !== montoSugerido && (
                    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-xl p-3 text-sm text-amber-800 dark:text-amber-300">
                      ¿Confirmás abrir la caja con esta diferencia? Se registrará y se notificará al supervisor/dueño.
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button onClick={() => { setShowApertura(false); setShowDifConfirm(false) }}
                      className="flex-1 border-2 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-semibold py-2.5 rounded-xl text-sm">
                      Cancelar
                    </button>
                    <button
                      onClick={() => {
                        const dif = montoSugerido !== null ? parseFloat(montoApertura) - montoSugerido : 0
                        if (dif !== 0 && !showDifConfirm) { setShowDifConfirm(true); return }
                        abrirCaja.mutate()
                      }}
                      disabled={abrirCaja.isPending}
                      className={`flex-1 font-semibold py-2.5 rounded-xl text-sm text-white transition-all disabled:opacity-50 ${showDifConfirm ? 'bg-amber-500 hover:bg-amber-600' : 'bg-accent hover:bg-accent/90'}`}>
                      {abrirCaja.isPending ? 'Abriendo...' : showDifConfirm ? 'Sí, abrir con diferencia' : 'Confirmar apertura'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <button onClick={async () => {
                    // Sugerir monto = saldo calculado al cierre (monto_cierre) de la última sesión
                    if (cajaSeleccionada) {
                      const { data: ultima } = await supabase.from('caja_sesiones')
                        .select('monto_cierre, monto_real_cierre')
                        .eq('tenant_id', tenant!.id).eq('caja_id', cajaSeleccionada)
                        .eq('estado', 'cerrada')
                        .order('created_at', { ascending: false }).limit(1).maybeSingle()
                      // Preferir monto_real_cierre (conteo físico) si es positivo; sino monto_cierre (calculado)
                      const sugerido = (ultima?.monto_real_cierre != null && ultima.monto_real_cierre > 0)
                        ? ultima.monto_real_cierre
                        : ultima?.monto_cierre ?? null
                      if (sugerido != null) {
                        setMontoSugerido(sugerido)
                        setMontoApertura(String(sugerido))
                      } else {
                        setMontoSugerido(null)
                        setMontoApertura('')
                      }
                    }
                    setShowApertura(true)
                  }}
                    disabled={!puedeAbrirCaja || esSoloLectura}
                    title={esSoloLectura ? 'Solo lectura — CONTADOR no puede abrir cajas' : (!puedeAbrirCaja ? 'Ya tenés una caja abierta. Cerrala antes de abrir otra.' : undefined)}
                    className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-white font-semibold px-6 py-3 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                    <Unlock size={18} /> Abrir caja
                  </button>
                  {!puedeAbrirCaja && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 text-center max-w-xs">
                      Ya tenés una caja abierta. Cerrala antes de abrir otra.
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : cajaAjenaBloqueada ? (
            /* Caja abierta por otro usuario — CAJERO no puede ver contenido */
            <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-amber-200 dark:border-amber-800/50 space-y-3 text-center">
              <div className="w-12 h-12 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center mx-auto">
                <Lock size={22} className="text-amber-500 dark:text-amber-400" />
              </div>
              <h3 className="font-semibold text-gray-800 dark:text-gray-100">Caja abierta por otro usuario</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                <span className="font-medium text-gray-700 dark:text-gray-300">{abrioNombre ?? 'Otro usuario'}</span> tiene esta caja abierta.
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-xl px-3 py-2">
                No tenés permisos para ver el contenido de esta caja. Solo el dueño o un supervisor pueden verla.
              </p>
            </div>
          ) : (
            /* Caja abierta — columna centrada: resumen+acciones arriba, movimientos+arqueos+cierre abajo */
            <div className="max-w-3xl mx-auto space-y-4">
              {/* Resumen + acciones */}
              <div className="space-y-4">
              {/* Resumen */}
              <div className="bg-primary rounded-2xl p-5 text-white">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-blue-200 text-sm">{cajaActual?.nombre}</p>
                    <p className="text-xs text-blue-300">
                      Abierta: {new Date(sesionActiva.abierta_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
                      {abrioNombre && ` · ${abrioNombre}`}
                    </p>
                  </div>
                  <div className="w-10 h-10 bg-white dark:bg-gray-800/10 rounded-xl flex items-center justify-center">
                    <Unlock size={18} className="text-green-400" />
                  </div>
                </div>
                {esOtroUsuario && (
                  <div className="bg-amber-500/20 border border-amber-400/30 rounded-xl px-3 py-2 flex items-center gap-2 mb-3">
                    <AlertTriangle size={13} className="text-amber-300 flex-shrink-0" />
                    <p className="text-amber-200 text-xs">
                      Sesión abierta por {abrioNombre ?? 'otro usuario'}. Podés registrar movimientos pero {puedeAdministrarCaja ? 'sos supervisor/dueño y podés cerrarla' : 'no podés cerrar la caja'}.
                    </p>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-white dark:bg-gray-800/10 rounded-xl p-3 text-center">
                    <p className="text-blue-500 dark:text-blue-200 text-xs">Apertura</p>
                    <p className="font-bold text-lg text-gray-900 dark:text-white">{formatMoneda(sesionActiva.monto_apertura)}</p>
                  </div>
                  <div className="bg-green-400/20 rounded-xl p-3 text-center">
                    <p className="text-green-200 text-xs">Ingresos</p>
                    <p className="font-bold text-lg text-green-100">{formatMoneda(totalIngresos)}</p>
                  </div>
                  <div className="bg-red-400/20 rounded-xl p-3 text-center">
                    <p className="text-red-200 text-xs">Egresos</p>
                    <p className="font-bold text-lg text-red-100">{formatMoneda(totalEgresos)}</p>
                  </div>
                </div>
                <div className="mt-3 bg-white dark:bg-gray-800/10 rounded-xl p-3 flex items-center justify-between">
                  <span className="text-blue-500 dark:text-blue-200">Saldo actual</span>
                  <span className="text-2xl font-bold text-gray-900 dark:text-white">{formatMoneda(saldoActual)}</span>
                </div>
              </div>

              {/* Acciones — ocultas para CONTADOR (read-only) */}
              {esSoloLectura ? (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl px-4 py-3 flex items-center gap-2 text-sm text-blue-700 dark:text-blue-300">
                  <Info size={14} /> Modo solo lectura — CONTADOR puede consultar movimientos y reimprimir tickets de cierre, pero no operar la caja.
                </div>
              ) : (
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => setShowMovimiento(true)}
                  className="flex-1 flex items-center justify-center gap-2 bg-accent hover:bg-accent/90 text-white font-semibold py-3 rounded-xl transition-all">
                  <Plus size={18} /> Ingreso
                </button>
                <button onClick={() => setShowArqueo(true)}
                  title="Arqueo parcial — contar efectivo (podés hacer varios por sesión, sin cerrar la caja)"
                  className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 font-semibold rounded-xl transition-all">
                  <CheckCircle size={16} /> Arqueo
                </button>
                {cajaFuerte && (() => {
                  const cajaFuerteRoles: string[] = (tenant as any)?.caja_fuerte_roles ?? ['DUEÑO']
                  return accedeABoveda(user?.rol as any, (user as any)?.rol_custom_id, cajaFuerteRoles) ? (
                    <button onClick={() => { setDepositoFuenteSesionId(sesionActiva?.id ?? ''); setShowDepositoFuerte(true) }}
                      title="Depositar en Caja Fuerte"
                      className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-yellow-400 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 font-semibold rounded-xl transition-all">
                      🔒
                    </button>
                  ) : null
                })()}
                {cajasAbiertas.length >= 2 && (
                  <button onClick={() => setShowTraspaso(true)}
                    title="Transferir efectivo a otra caja"
                    className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-accent text-accent hover:bg-accent/10 font-semibold rounded-xl transition-all">
                    <ArrowRightLeft size={16} />
                  </button>
                )}
                {/* Solicitud a caja fuerte para CAJERO */}
                {user?.rol === 'CAJERO' && cajaFuerte && sesionActiva && (
                  <button onClick={() => setShowSolicitudFuerte(true)}
                    title="Solicitar transferencia de esta caja a la Caja Fuerte (requiere aprobación)"
                    className="flex items-center gap-1.5 px-3 py-3 border border-yellow-300 dark:border-yellow-600 text-yellow-700 dark:text-yellow-400 text-xs font-medium hover:bg-yellow-50 dark:hover:bg-yellow-900/20 rounded-xl transition-all">
                    <Lock size={14} /> Caja Fuerte
                  </button>
                )}
              </div>
              )}
              </div>{/* fin resumen + acciones */}

              {/* Movimientos + arqueos + cierre (debajo del resumen) */}
              <div className="space-y-4">
              {/* Movimientos */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                  <h3 className="font-semibold text-gray-700 dark:text-gray-300 text-sm">Movimientos de la sesión</h3>
                  <span className="text-xs text-gray-400 dark:text-gray-500">{movimientos.length} registros</span>
                </div>
                {movimientos.length === 0 ? (
                  <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">Sin movimientos aún</p>
                ) : (
                  <>
                    <div className="divide-y divide-gray-50 dark:divide-gray-700 max-h-72 overflow-y-auto">
                      {(movimientos as any[]).map((m) => {
                        const esEgreso = ['egreso','egreso_devolucion_sena','egreso_traspaso'].includes(m.tipo)
                        const esIngreso = ['ingreso','ingreso_reserva','ingreso_traspaso','ingreso_apertura'].includes(m.tipo)
                        const esInfo = m.tipo === 'ingreso_informativo' || m.tipo === 'egreso_informativo'
                        const numVenta = extraerNumeroVenta(m.concepto)
                        const medio = extraerMedioPago(m.tipo, m.concepto)
                        const tipoLabel = getTipoDisplay(m.tipo, m.concepto)
                        const conceptoLimpio = esInfo
                          ? m.concepto.replace(/^\[.+?\]\s*/, '')
                          : m.concepto
                        return (
                          <div key={m.id} className={`px-4 py-2.5 flex items-start justify-between gap-3 ${esInfo ? 'opacity-70' : ''}`}>
                            <div className="flex items-start gap-2 min-w-0 flex-1">
                              {esInfo && <Info size={13} className="text-blue-400 mt-1 flex-shrink-0" />}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                                    esIngreso ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                                    : esEgreso ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                                    : 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                                  }`}>{tipoLabel}</span>
                                  <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{conceptoLimpio}</p>
                                </div>
                                <div className="flex items-center gap-2 flex-wrap mt-0.5">
                                  <span className="text-xs text-gray-400 dark:text-gray-500">
                                    {new Date(m.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                  </span>
                                  {m.users?.nombre_display && (
                                    <span className="text-xs text-gray-400 dark:text-gray-500">· {m.users.nombre_display}</span>
                                  )}
                                  {medio && (
                                    <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded">{medio}</span>
                                  )}
                                  {numVenta && (
                                    <span className="text-xs bg-accent/10 text-accent px-1.5 py-0.5 rounded font-mono">#{numVenta}</span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <span className={`font-bold text-sm ${
                                esIngreso ? 'text-green-600 dark:text-green-400'
                                : esEgreso ? 'text-red-500'
                                : 'text-blue-400'
                              }`}>
                                {esIngreso ? '+' : esEgreso ? '−' : '~'}{formatMoneda(m.monto)}
                              </span>
                              {/* G1 — Corregir: solo en ingresos manuales (sin #venta), si rol tiene permiso */}
                              {puedeEditarMovimiento && m.tipo === 'ingreso' && !numVenta && !m.concepto.startsWith('[Reversión]') && !m.concepto.startsWith('[Corregido]') && !m.concepto.startsWith('[Diferencia caja]') && (
                                isPeriodoCerrado(m.created_at) ? (
                                  <span title={`Periodo contable cerrado hasta ${ultimoCierre} — movimiento no modificable`} className="p-1 text-amber-400 cursor-not-allowed">
                                    <Lock size={12} />
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => { setCorregirMov(m); setCorregirMonto(String(m.monto)); setCorregirConcepto(m.concepto) }}
                                    title="Corregir este movimiento"
                                    className="p-1 text-gray-300 hover:text-amber-600 dark:hover:text-amber-400 transition-colors">
                                    <RotateCcw size={12} />
                                  </button>
                                )
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    {/* Totales por medio de pago */}
                    {Object.keys(totalesMedios).length > 0 && (
                      <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-3 bg-gray-50 dark:bg-gray-700/50">
                        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">Totales por método</p>
                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                          {Object.entries(totalesMedios).map(([medio, total]) => (
                            <div key={medio} className="flex items-center gap-1.5 text-xs">
                              <span className="text-gray-500 dark:text-gray-400">{medio}:</span>
                              <span className={`font-semibold ${total >= 0 ? 'text-gray-800 dark:text-gray-100' : 'text-red-500'}`}>
                                {total >= 0 ? formatMoneda(total) : `−${formatMoneda(Math.abs(total))}`}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Arqueos de la sesión */}
              {arqueosSesion.length > 0 && (
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
                    <h3 className="font-semibold text-gray-700 dark:text-gray-300 text-sm flex items-center gap-2">
                      <CheckCircle size={14} className="text-accent" /> Arqueos ({arqueosSesion.length})
                    </h3>
                  </div>
                  <div className="divide-y divide-gray-50 dark:divide-gray-700">
                    {(arqueosSesion as any[]).map((a) => {
                      const dif = a.diferencia ?? 0
                      return (
                        <div key={a.id} className="px-4 py-3 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs text-gray-400 dark:text-gray-500">
                              {new Date(a.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                              {a.users?.nombre_display && ` · ${a.users.nombre_display}`}
                            </p>
                            {a.notas && <p className="text-xs text-gray-500 dark:text-gray-400 italic mt-0.5">{a.notas}</p>}
                          </div>
                          <div className="flex items-center gap-3 text-sm flex-shrink-0">
                            <span className="text-gray-500 dark:text-gray-400">{formatMoneda(a.saldo_calculado)} calc.</span>
                            <span className="font-semibold text-gray-800 dark:text-gray-100">{formatMoneda(a.saldo_real)} real</span>
                            <span className={`font-bold px-2 py-0.5 rounded-lg text-xs ${
                              dif > 0 ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' :
                              dif < 0 ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400' :
                              'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                            }`}>
                              {dif > 0 ? `+${formatMoneda(dif)}` : dif < 0 ? formatMoneda(dif) : 'OK'}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Cerrar caja — oculto para CONTADOR */}
              {esSoloLectura ? null : esOtroUsuario && !puedeAdministrarCaja ? (
                <div className="w-full flex items-center justify-center gap-2 border-2 border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 font-semibold py-3 rounded-xl cursor-not-allowed">
                  <Lock size={18} /> Solo {abrioNombre ?? 'quien abrió'} puede cerrar esta caja
                </div>
              ) : arqueosSesion.length === 0 ? (
                <button onClick={() => { toast('Hacé un arqueo parcial antes de cerrar', { icon: 'ℹ' }); setShowArqueo(true) }}
                  title="Para cerrar la caja, primero registrá al menos un arqueo parcial en esta sesión"
                  className="w-full flex items-center justify-center gap-2 border-2 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 font-semibold py-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-all">
                  <CheckCircle size={18} /> Arqueo requerido antes de cerrar
                </button>
              ) : (
                <button onClick={() => setShowCierre(true)}
                  className="w-full flex items-center justify-center gap-2 border-2 border-red-200 text-red-600 dark:text-red-400 font-semibold py-3 rounded-xl hover:bg-red-50 dark:bg-red-900/20 transition-all">
                  <Lock size={18} /> Cerrar caja
                </button>
              )}
              </div>{/* fin movimientos + arqueos + cierre */}
            </div>
          )}
        </div>
      )}

      {/* ── CAJA FUERTE ── */}
      {/* ── CAJA FUERTE TAB ── */}
      {/* ── REPORTES (Fase 2.4 / I1+I2) ── */}
      {tab === 'cobranzas' && <CajaCobranzasCC />}

      {tab === 'reportes' && <CajaReportes />}

      {tab === 'caja_fuerte' && cajaFuerte && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
            <div className="flex flex-col lg:flex-row lg:items-stretch gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-yellow-100 dark:bg-yellow-900/30 rounded-xl flex items-center justify-center">
                    <Lock size={18} className="text-yellow-600 dark:text-yellow-400" />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-800 dark:text-gray-100">Caja Fuerte / Bóveda</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">Efectivo + cuentas asociadas a métodos de pago.</p>
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => setShowDepositoFuerte(true)}
                    className="flex items-center gap-2 px-4 py-2.5 bg-yellow-500 hover:bg-yellow-600 text-white text-sm font-semibold rounded-xl transition-colors">
                    <Plus size={15} /> Ingresar a Caja Fuerte
                  </button>
                  <button onClick={() => { setShowRetiroFuerte(true); setRetiroCajaDestinoSesionId('') }}
                    disabled={fuerteSaldo <= 0}
                    title={fuerteSaldo <= 0 ? 'Sin saldo en caja fuerte' : ''}
                    className="flex items-center gap-2 px-4 py-2.5 bg-gray-700 dark:bg-gray-600 hover:bg-gray-800 dark:hover:bg-gray-500 text-white text-sm font-semibold rounded-xl disabled:opacity-50 transition-colors">
                    <ArrowRightLeft size={15} /> Enviar a Caja
                  </button>
                  {puedeExtraerBoveda && (
                    <button onClick={() => { setShowArqueoBoveda(true); setArqueoBovedaConteo({}); setArqueoBovedaNotas('') }}
                      title="Arqueo manual de la bóveda — contar el saldo sin cerrarla"
                      className="flex items-center gap-2 px-4 py-2.5 border-2 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-semibold rounded-xl transition-colors">
                      <CheckCircle size={15} /> Arquear bóveda
                    </button>
                  )}
                  {puedeExtraerBoveda && (
                    <button onClick={() => setShowExtraerBoveda(true)}
                      title="Extraer dinero del negocio (retiro personal, banco, gasto, etc.)"
                      className="flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl transition-colors">
                      <Minus size={15} /> Extraer dinero
                    </button>
                  )}
                </div>
              </div>
              {/* Tarjetas destacadas (estilo Dashboard): lo principal de la página.
                  (1) Plata física en la bóveda · (2) Capital total del negocio. */}
              {puedeExtraerBoveda && (
                <div className="lg:w-72 shrink-0 flex flex-col gap-3">
                  <div className="rounded-2xl p-5 bg-brand-gradient text-white shadow-lg">
                    <p className="text-xs font-semibold uppercase tracking-wide text-white/80">En la caja fuerte</p>
                    <p className="text-3xl font-bold leading-tight mt-1 break-words">{formatMoneda(fuerteSaldo)}</p>
                    <p className="text-[11px] text-white/70 mt-1.5">Plata que hay hoy en la bóveda</p>
                  </div>
                  <div className="rounded-2xl p-4 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-sm">
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Capital total del negocio</p>
                      <span
                        className="text-gray-400 dark:text-gray-500 cursor-help"
                        title={'Suma cada peso una sola vez: efectivo en cajas + bóveda + cuentas (bancos/tarjetas).\n\nSe calcula con los movimientos registrados (ventas, gastos, depósitos). El monto de apertura de una caja NO se suma aparte: es el arrastre del cierre anterior y ya viene de ventas ya contadas.\n\nSi tenés capital inicial que nunca registraste (ej. plata propia que pusiste en el negocio), ingresalo una vez como "Ingreso externo" a la Caja Fuerte para que cuente acá.\n\nSi tenés cuentas en varias monedas, se muestra el capital discriminado por moneda (no se convierte entre sí).'}
                      >
                        <Info size={13} />
                      </span>
                    </div>
                    {monedasCapital.length <= 1 ? (
                      <p className="text-2xl font-bold leading-tight mt-1 break-words text-gray-800 dark:text-gray-100">
                        {monedasCapital.length === 1 ? formatMonedaLib(monedasCapital[0][1], monedasCapital[0][0]) : formatMoneda(0)}
                      </p>
                    ) : (
                      <div className="mt-1.5 space-y-1">
                        {monedasCapital.map(([moneda, total]) => (
                          <div key={moneda} className="flex items-baseline justify-between gap-2">
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">{moneda}</span>
                            <span className="text-xl font-bold leading-tight break-words text-gray-800 dark:text-gray-100">{formatMonedaLib(total, moneda)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">Efectivo en cajas + bóveda + cuentas</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Saldos por Cuenta de Origen — bóveda discriminada (H1) */}
          {(() => {
            const cuentasActivas = cuentasActivasBoveda
            return (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Capital del negocio por cuenta</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {cuentasActivas.map((c: any) => {
                    const tipoColor = c.tipo === 'banco' ? 'blue' : c.tipo === 'billetera' ? 'purple' : c.tipo === 'efectivo' ? 'green' : 'gray'
                    const Icon = c.tipo === 'efectivo' ? Lock : DollarSign
                    return (
                      <div key={c.cuenta_origen_id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className={`w-7 h-7 bg-${tipoColor}-50 dark:bg-${tipoColor}-900/30 rounded-lg flex items-center justify-center shrink-0`}>
                              <Icon size={14} className={`text-${tipoColor}-600 dark:text-${tipoColor}-400`} />
                            </div>
                            <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate" title={c.nombre}>{c.nombre}</p>
                          </div>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 bg-${tipoColor}-50 dark:bg-${tipoColor}-900/20 text-${tipoColor}-700 dark:text-${tipoColor}-400`}>{c.tipo}</span>
                        </div>
                        <p className={`text-xl font-bold ${Number(c.saldo) > 0 ? 'text-gray-900 dark:text-white' : Number(c.saldo) < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400 dark:text-gray-500'}`}>
                          {formatMoneda(Number(c.saldo || 0))}
                        </p>
                        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                          {c.movimientos_count} mov · {c.moneda}
                          {c.banco && ` · ${c.banco}`}
                        </p>
                      </div>
                    )
                  })}

                  {cuentasActivas.length === 0 && (
                    <div className="col-span-full bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 flex items-start gap-3">
                      <Info size={16} className="text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                      <div className="text-xs text-blue-700 dark:text-blue-300">
                        <p className="font-semibold mb-1">Configurá las cuentas de origen</p>
                        <p>Andá a <strong>Configuración → Caja → Cuentas de Origen</strong> y asocialas a tus métodos de pago para ver la bóveda discriminada por banco/billetera.</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })()}

          {/* Historial de extracciones — solo DUEÑO/ADMIN/SUPER_USUARIO (RLS) */}
          {puedeExtraerBoveda && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-red-100 dark:border-red-900/40 overflow-hidden">
              <div className="px-5 py-3 border-b border-red-100 dark:border-red-900/40 bg-red-50/40 dark:bg-red-900/20 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Lock size={13} className="text-red-600 dark:text-red-400" />
                  <p className="text-xs font-semibold text-red-700 dark:text-red-300 uppercase tracking-wide">Historial de extracciones (privado)</p>
                </div>
                <span className="text-xs text-red-600 dark:text-red-400">{bovedaRetiros.length} {bovedaRetiros.length === 1 ? 'extracción' : 'extracciones'}</span>
              </div>
              {bovedaRetiros.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-6">Sin extracciones registradas</p>
              ) : (
                <div className="divide-y divide-gray-50 dark:divide-gray-700">
                  {(bovedaRetiros as any[]).map((r: any) => (
                    <div key={r.id} className="px-5 py-3 flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{r.motivo}</p>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 font-medium">
                            {r.tipo_retiro.replace('_', ' ')}
                          </span>
                          {r.cuentas_origen?.nombre && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                              {r.cuentas_origen.nombre}
                            </span>
                          )}
                        </div>
                        {r.notas && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{r.notas}</p>}
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                          {new Date(r.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
                          {r.users?.nombre_display && ` · ${r.users.nombre_display}`}
                        </p>
                      </div>
                      <span className="font-bold text-red-600 dark:text-red-400 shrink-0">
                        -{formatMoneda(r.monto)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* E3 — Historial de arqueos de bóveda — solo DUEÑO/ADMIN/SUPER_USUARIO (RLS) */}
          {puedeExtraerBoveda && (bovedaArqueos as any[]).length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle size={13} className="text-gray-500 dark:text-gray-400" />
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Historial de arqueos de bóveda</p>
                </div>
                <span className="text-xs text-gray-400 dark:text-gray-500">{(bovedaArqueos as any[]).length} registros</span>
              </div>
              <div className="divide-y divide-gray-50 dark:divide-gray-700">
                {(bovedaArqueos as any[]).map((a: any) => {
                  const dif = Number(a.diferencia || 0)
                  return (
                    <div key={a.id} className="px-5 py-3 flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{a.cuentas_origen?.nombre ?? 'Efectivo'}</p>
                          <span className="text-xs text-gray-400 dark:text-gray-500">Sistema {formatMoneda(Number(a.saldo_sistema))} · Contado {formatMoneda(Number(a.saldo_contado))}</span>
                        </div>
                        {a.notas && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{a.notas}</p>}
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                          {new Date(a.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
                          {a.users?.nombre_display && ` · ${a.users.nombre_display}`}
                        </p>
                      </div>
                      <span className={`font-bold shrink-0 ${dif === 0 ? 'text-gray-500 dark:text-gray-400' : dif > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                        {dif === 0 ? 'OK' : `${dif > 0 ? '+' : ''}${formatMoneda(dif)}`}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Historial completo de caja fuerte */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Historial de movimientos</p>
            </div>
            {fuerteMovimientos.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">Sin movimientos registrados</p>
            ) : (
              <div className="divide-y divide-gray-50 dark:divide-gray-700">
                {(fuerteMovimientos as any[]).map((m: any) => {
                  const esIngreso = m.tipo === 'ingreso_traspaso'
                  return (
                    <div key={m.id} className="px-5 py-3 flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-800 dark:text-gray-100">{m.concepto}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500">
                          {new Date(m.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
                          {m.users?.nombre_display && ` · ${m.users.nombre_display}`}
                        </p>
                      </div>
                      <span className={`font-bold ${esIngreso ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                        {esIngreso ? '+' : '-'}{formatMoneda(m.monto)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal ingresar a caja fuerte */}
      {showDepositoFuerte && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-800 dark:text-gray-100">Ingresar a Caja Fuerte</h3>
              <button onClick={() => { setShowDepositoFuerte(false); setFuerteMonto(''); setFuerteConcepto(''); setDepositoFuenteSesionId('') }}
                className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"><X size={16} /></button>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Caja de origen</label>
              <select value={depositoFuenteSesionId} onChange={e => setDepositoFuenteSesionId(e.target.value)}
                disabled={!modoAvanzado}
                title={!modoAvanzado ? 'En modo básico se transfiere desde la caja en la que estás operando' : undefined}
                className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-700 dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent disabled:opacity-60 disabled:cursor-not-allowed">
                <option value="">Ingreso externo (sin caja)</option>
                {(sesionesAbiertasAll as any[]).filter((s: any) => !cajaFuerte || s.caja_id !== cajaFuerte.id).map((s: any) => (
                  <option key={s.id} value={s.id}>{s.cajas?.nombre}</option>
                ))}
              </select>
              {depositoFuenteSesionId && (() => {
                const sesOrigen = (sesionesAbiertasAll as any[]).find((s: any) => s.id === depositoFuenteSesionId)
                return sesOrigen ? (
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Se descontará de <strong>{sesOrigen.cajas?.nombre}</strong>{!modoAvanzado ? ' (caja activa)' : ''}</p>
                ) : null
              })()}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Cuenta de destino</label>
              <select value={depositoCuentaId} onChange={e => setDepositoCuentaId(e.target.value)}
                className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-700 dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent">
                {(bovedaCuentas as any[]).filter((c: any) => c.activo).map((c: any) => (
                  <option key={c.cuenta_origen_id} value={c.cuenta_origen_id}>{c.nombre}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">A qué cuenta de la bóveda ingresa el dinero (default Efectivo).</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Monto *</label>
              <input type="number" onWheel={e => e.currentTarget.blur()} min="0" step="0.01"
                value={fuerteMonto} onChange={e => setFuerteMonto(e.target.value)} placeholder="0"
                className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-700 dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Concepto</label>
              <input type="text" value={fuerteConcepto} onChange={e => setFuerteConcepto(e.target.value)}
                placeholder={depositoFuenteSesionId ? 'Depósito desde caja' : 'Ingreso externo'}
                className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-700 dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent" />
            </div>
            {!depositoFuenteSesionId && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Ingreso externo — no sale de ninguna caja: suma plata nueva al negocio (capital inicial, aporte de socio, etc.) y la hace contar en el capital total.
              </p>
            )}
            <button onClick={() => operarCajaFuerte.mutate({
              tipo: 'deposito',
              monto: parseFloat(fuerteMonto) || 0,
              concepto: fuerteConcepto,
              desdeSessionId: depositoFuenteSesionId || undefined,
              cuentaOrigenId: depositoCuentaId || undefined,
            })}
              disabled={operarCajaFuerte.isPending || !fuerteMonto}
              className="w-full bg-yellow-500 hover:bg-yellow-600 text-white font-semibold py-3 rounded-xl transition-all disabled:opacity-50">
              {operarCajaFuerte.isPending ? 'Procesando...' : 'Confirmar ingreso'}
            </button>
          </div>
        </div>
      )}

      {/* Modal enviar desde caja fuerte a una caja */}
      {showRetiroFuerte && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-800 dark:text-gray-100">Enviar desde Caja Fuerte</h3>
              <button onClick={() => { setShowRetiroFuerte(false); setFuerteMonto(''); setFuerteConcepto(''); setRetiroCajaDestinoSesionId('') }}
                className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"><X size={16} /></button>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Caja destino *</label>
              <select value={retiroCajaDestinoSesionId} onChange={e => setRetiroCajaDestinoSesionId(e.target.value)}
                className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-700 dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent">
                <option value="">Seleccioná una caja con sesión abierta</option>
                {(sesionesAbiertasAll as any[]).map((s: any) => (
                  <option key={s.id} value={s.id}>{s.cajas?.nombre}</option>
                ))}
              </select>
              {(sesionesAbiertasAll as any[]).length === 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">No hay cajas con sesión abierta en este momento.</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Monto *</label>
              <input type="number" onWheel={e => e.currentTarget.blur()} min="0" step="0.01"
                value={fuerteMonto} onChange={e => setFuerteMonto(e.target.value)} placeholder="0"
                className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-700 dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent" />
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Saldo en caja fuerte: {formatMoneda(fuerteSaldo)}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Concepto</label>
              <input type="text" value={fuerteConcepto} onChange={e => setFuerteConcepto(e.target.value)}
                placeholder="Envío desde caja fuerte"
                className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-700 dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent" />
            </div>
            <button onClick={() => operarCajaFuerte.mutate({
              tipo: 'retiro',
              monto: parseFloat(fuerteMonto) || 0,
              concepto: fuerteConcepto,
              hastaSessionId: retiroCajaDestinoSesionId,
            })}
              disabled={operarCajaFuerte.isPending || !fuerteMonto || !retiroCajaDestinoSesionId}
              className="w-full bg-gray-700 dark:bg-gray-600 hover:bg-gray-800 dark:hover:bg-gray-500 text-white font-semibold py-3 rounded-xl transition-all disabled:opacity-50">
              {operarCajaFuerte.isPending ? 'Procesando...' : 'Confirmar envío'}
            </button>
          </div>
        </div>
      )}

      {/* Modal Extraer dinero — solo DUEÑO/ADMIN/SUPER_USUARIO */}
      {/* E3 — Modal arqueo de bóveda */}
      {showArqueoBoveda && puedeExtraerBoveda && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowArqueoBoveda(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                <CheckCircle size={16} className="text-accent" /> Arqueo de bóveda
              </h3>
              <button onClick={() => setShowArqueoBoveda(false)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"><X size={16} /></button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Contá el saldo real de cada cuenta. La bóveda <strong>no se cierra</strong>; el arqueo queda en el historial con tu usuario y la fecha. Dejá en blanco las cuentas que no quieras arquear.
            </p>
            <div className="space-y-3">
              {(bovedaCuentas as any[]).filter((c: any) => c.activo).map((c: any) => {
                const sistema = Number(c.saldo || 0)
                const raw = arqueoBovedaConteo[c.cuenta_origen_id] ?? ''
                const dif = raw.trim() === '' ? null : (parseFloat(raw) || 0) - sistema
                return (
                  <div key={c.cuenta_origen_id} className="border border-gray-100 dark:border-gray-700 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{c.nombre}</span>
                      <span className="text-xs text-gray-400 dark:text-gray-500">Sistema: {formatMoneda(sistema)}</span>
                    </div>
                    <input type="number" inputMode="decimal" placeholder="Saldo contado…"
                      value={raw}
                      onChange={e => setArqueoBovedaConteo(prev => ({ ...prev, [c.cuenta_origen_id]: e.target.value }))}
                      className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-700 dark:text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent" />
                    {dif !== null && (
                      <p className={`text-xs mt-1 font-medium ${dif === 0 ? 'text-gray-500 dark:text-gray-400' : dif > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                        {dif === 0 ? 'Coincide' : `Diferencia: ${dif > 0 ? '+' : ''}${formatMoneda(dif)}`}
                      </p>
                    )}
                  </div>
                )
              })}
              {(bovedaCuentas as any[]).filter((c: any) => c.activo).length === 0 && (
                <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">No hay cuentas activas para arquear.</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Notas (opcional)</label>
              <input type="text" value={arqueoBovedaNotas} onChange={e => setArqueoBovedaNotas(e.target.value)}
                placeholder="Observaciones del arqueo…"
                className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-700 dark:text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent" />
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setShowArqueoBoveda(false)}
                className="flex-1 px-4 py-2.5 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 text-sm font-semibold rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700">Cancelar</button>
              <button onClick={() => arquearBoveda.mutate()} disabled={arquearBoveda.isPending}
                className="flex-1 px-4 py-2.5 bg-accent hover:bg-accent/90 text-white text-sm font-semibold rounded-xl disabled:opacity-60">
                {arquearBoveda.isPending ? 'Guardando…' : 'Registrar arqueo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showExtraerBoveda && puedeExtraerBoveda && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowExtraerBoveda(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                <Minus size={16} className="text-red-600" /> Extraer dinero de la bóveda
              </h3>
              <button onClick={() => setShowExtraerBoveda(false)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"><X size={16} /></button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Este registro queda visible <strong>solo para vos</strong>. Descuenta el monto del saldo de la cuenta elegida.
            </p>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Cuenta de origen *</label>
              <select value={extraerCuentaId} onChange={e => setExtraerCuentaId(e.target.value)}
                className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-700 dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent">
                <option value="">Seleccioná una cuenta...</option>
                {(bovedaCuentas as any[]).filter((c: any) => c.activo && Number(c.saldo) > 0).map((c: any) => (
                  <option key={c.cuenta_origen_id} value={c.cuenta_origen_id}>
                    {c.nombre} ({c.tipo}) — {formatMoneda(Number(c.saldo))} disponible
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Monto *</label>
              <input type="number" onWheel={e => e.currentTarget.blur()} min="0" step="0.01"
                value={extraerMonto} onChange={e => setExtraerMonto(e.target.value)}
                placeholder="0"
                className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-700 dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent" />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Tipo de retiro *</label>
              <select value={extraerTipo} onChange={e => setExtraerTipo(e.target.value as any)}
                className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-700 dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent">
                <option value="retiro_personal">Retiro personal del dueño</option>
                <option value="banco">Depósito a banco / inversión bancaria</option>
                <option value="inversion">Inversión (compra activos, etc.)</option>
                <option value="gasto">Gasto del negocio</option>
                <option value="pago_proveedor">Pago a proveedor</option>
                <option value="otro">Otro</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Motivo *</label>
              <input type="text" value={extraerMotivo} onChange={e => setExtraerMotivo(e.target.value)}
                placeholder="Ej: Sueldo del dueño abril, Depósito Plazo Fijo, etc."
                className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-700 dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent" />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Notas (opcional)</label>
              <textarea value={extraerNotas} onChange={e => setExtraerNotas(e.target.value)}
                rows={2}
                placeholder="Detalle adicional para tu registro personal..."
                className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-700 dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent resize-none" />
            </div>

            <div className="flex gap-2 pt-2">
              <button onClick={() => setShowExtraerBoveda(false)}
                className="flex-1 border-2 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-semibold py-2.5 rounded-xl text-sm">
                Cancelar
              </button>
              <button onClick={() => extraerDeBoveda.mutate()}
                disabled={extraerDeBoveda.isPending || !extraerCuentaId || !extraerMonto || !extraerMotivo.trim()}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-2.5 rounded-xl text-sm transition-all disabled:opacity-50">
                {extraerDeBoveda.isPending ? 'Registrando...' : 'Confirmar extracción'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* G1 — Modal corregir movimiento manual (DUEÑO/SUPERVISOR) */}
      {corregirMov && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setCorregirMov(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-primary flex items-center gap-2">
                <RotateCcw size={18} className="text-amber-600" /> Corregir movimiento
              </h2>
              <button onClick={() => setCorregirMov(null)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400"><X size={16} /></button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              Se creará un movimiento de reversión + uno nuevo corregido. El original queda en el historial con audit log.
            </p>
            <div className="space-y-3 mb-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Concepto corregido</label>
                <input type="text" value={corregirConcepto} onChange={e => setCorregirConcepto(e.target.value)}
                  autoFocus
                  className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
                <p className="text-[11px] text-gray-400 mt-1">Original: <span className="italic">{corregirMov.concepto}</span></p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Monto corregido</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500">$</span>
                  <input type="number" onWheel={e => e.currentTarget.blur()} min="0" value={corregirMonto}
                    onChange={e => setCorregirMonto(e.target.value)}
                    className="w-full pl-7 pr-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
                </div>
                <p className="text-[11px] text-gray-400 mt-1">Original: {formatMoneda(corregirMov.monto)}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setCorregirMov(null)}
                className="flex-1 border-2 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-semibold py-2.5 rounded-xl text-sm">
                Cancelar
              </button>
              <button onClick={() => corregirMovimiento.mutate()} disabled={corregirMovimiento.isPending}
                className="flex-1 bg-amber-600 hover:bg-amber-700 text-white font-semibold py-2.5 rounded-xl text-sm transition-all disabled:opacity-50">
                {corregirMovimiento.isPending ? 'Corrigiendo...' : 'Confirmar corrección'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal solicitud CAJERO → caja fuerte */}
      {showSolicitudFuerte && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                <Lock size={16} className="text-yellow-500" /> Solicitar transferencia a Caja Fuerte
              </h3>
              <button onClick={() => { setShowSolicitudFuerte(false); setSolicitudMonto(''); setSolicitudConcepto('') }}
                className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"><X size={16} /></button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl px-3 py-2">
              Esta solicitud será enviada al Owner o Supervisor para su aprobación. No se ejecutará automáticamente.
            </p>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Monto *</label>
              <input type="number" onWheel={e => e.currentTarget.blur()} min="0" step="0.01"
                value={solicitudMonto} onChange={e => setSolicitudMonto(e.target.value)} placeholder="0"
                className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-700 dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent" />
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Disponible: {formatMoneda(saldoActual)}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Concepto</label>
              <input type="text" value={solicitudConcepto} onChange={e => setSolicitudConcepto(e.target.value)}
                placeholder="Motivo de la transferencia"
                className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-700 dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent" />
            </div>
            <button onClick={() => enviarSolicitudFuerte.mutate({ monto: parseFloat(solicitudMonto) || 0, concepto: solicitudConcepto })}
              disabled={enviarSolicitudFuerte.isPending || !solicitudMonto}
              className="w-full bg-yellow-500 hover:bg-yellow-600 text-white font-semibold py-3 rounded-xl transition-all disabled:opacity-50">
              {enviarSolicitudFuerte.isPending ? 'Enviando...' : 'Enviar solicitud'}
            </button>
          </div>
        </div>
      )}

      {/* ── HISTORIAL ── */}
      {tab === 'historial' && (
        <div className="space-y-3">
          {/* B4 — Reporte: diferencias acumuladas por cajero últimos 30 días */}
          {(puedeAdministrarCaja || puedeReimprimirTicket) && (difsPorCajero as any[]).length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide flex items-center gap-2">
                  <AlertTriangle size={13} className="text-amber-500" /> Diferencias por cajero (últimos 30 días)
                </p>
                <span className="text-[10px] text-gray-400">trazabilidad — sin descuento automático</span>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700/30">
                  <tr className="text-left text-xs text-gray-500 dark:text-gray-400">
                    <th className="px-4 py-2 font-medium">Cajero</th>
                    <th className="px-4 py-2 font-medium text-center">Cierres</th>
                    <th className="px-4 py-2 font-medium text-center">Con diferencia</th>
                    <th className="px-4 py-2 font-medium text-right">Neto</th>
                    <th className="px-4 py-2 font-medium text-right">Absoluto</th>
                    <th className="px-4 py-2 font-medium text-right">Máxima</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                  {(difsPorCajero as any[]).map((d: any) => {
                    const neto = Number(d.diferencia_neta_acumulada || 0)
                    return (
                      <tr key={d.usuario_id ?? d.cajero} className="text-gray-700 dark:text-gray-300">
                        <td className="px-4 py-2.5 font-medium">{d.cajero ?? '—'}</td>
                        <td className="px-4 py-2.5 text-center">{d.cierres_count}</td>
                        <td className="px-4 py-2.5 text-center">
                          {d.cierres_con_diferencia > 0 ? (
                            <span className="text-amber-600 dark:text-amber-400 font-medium">{d.cierres_con_diferencia}</span>
                          ) : (
                            <span className="text-gray-400">0</span>
                          )}
                        </td>
                        <td className={`px-4 py-2.5 text-right font-medium ${neto > 0 ? 'text-green-600 dark:text-green-400' : neto < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400'}`}>
                          {neto >= 0 ? '+' : ''}{formatMoneda(neto)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400">{formatMoneda(Number(d.diferencia_absoluta_acumulada || 0))}</td>
                        <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400">{formatMoneda(Number(d.diferencia_maxima || 0))}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {historialSesiones.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-10 text-center text-gray-400 dark:text-gray-500 shadow-sm border border-gray-100">
              <History size={36} className="mx-auto mb-3 opacity-30" />
              <p>No hay cierres de caja registrados</p>
            </div>
          ) : historialSesiones.map((s: any) => {
            const isExpanded = sesionExpandida === s.id
            const dif = s.diferencia_cierre
            const cerroNombre = s.cerrado_por?.nombre_display ?? s.abrio?.nombre_display ?? '—'
            return (
              <div key={s.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-gray-800 dark:text-gray-100">{s.cajas?.nombre}</p>
                        {isPeriodoCerrado(s.abierta_at) && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 flex items-center gap-1" title={`Periodo contable cerrado hasta ${ultimoCierre} — sesión y movimientos congelados`}>
                            <Lock size={9} /> Cerrado
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        <Clock size={11} className="inline mr-1" />
                        {new Date(s.abierta_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })} →&nbsp;
                        {new Date(s.cerrada_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">Cerró: {cerroNombre}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex flex-col gap-1">
                        {/* Diferencia de apertura */}
                        {(() => {
                          const da = s.diferencia_apertura
                          if (da == null) return null
                          return (
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-lg flex items-center gap-1 ${
                              da !== 0 ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400' :
                              'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                            }`}>
                              Apertura: {da === 0 ? 'Sin diferencia' : (da > 0 ? `+${formatMoneda(da)}` : `-${formatMoneda(Math.abs(da))}`)}
                            </span>
                          )
                        })()}
                        {/* Diferencia de cierre */}
                        {dif != null && (
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-lg ${
                            dif > 0 ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' :
                            dif < 0 ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400' :
                            'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                          }`}>
                            Cierre: {dif === 0 ? 'Sin diferencia' : (dif > 0 ? `+${formatMoneda(dif)}` : `-${formatMoneda(Math.abs(dif))}`)}
                          </span>
                        )}
                      </div>
                      {puedeReimprimirTicket && (
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => imprimirCierre(s, 'a4')}
                            title="Descargar ticket de cierre (formato A4)"
                            className="flex items-center gap-1.5 text-xs border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 px-3 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50">
                            <Printer size={13} /> A4
                          </button>
                          <button onClick={() => imprimirCierre(s, 'termico')}
                            title="Descargar ticket de cierre (formato térmico 80mm)"
                            className="flex items-center gap-1.5 text-xs border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 px-2.5 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50">
                            <Receipt size={13} /> Tícket
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Grilla de montos */}
                  <div className={`grid gap-2 text-center text-xs ${s.monto_real_cierre != null ? 'grid-cols-5' : 'grid-cols-4'}`}>
                    {[
                      { label: 'Apertura', val: s.monto_apertura, color: 'text-gray-700 dark:text-gray-300' },
                      { label: 'Ingresos', val: s.total_ingresos, color: 'text-green-600 dark:text-green-400' },
                      { label: 'Egresos', val: s.total_egresos, color: 'text-red-500' },
                      { label: 'Calculado', val: s.monto_cierre, color: 'text-primary' },
                      ...(s.monto_real_cierre != null ? [{ label: 'Conteo real', val: s.monto_real_cierre, color: 'font-bold text-primary' }] : []),
                    ].map(({ label, val, color }) => (
                      <div key={label} className="bg-gray-50 dark:bg-gray-700 rounded-lg p-2">
                        <p className="text-gray-400 dark:text-gray-500 mb-0.5">{label}</p>
                        <p className={`text-sm ${color}`}>{formatMoneda(val ?? 0)}</p>
                      </div>
                    ))}
                  </div>

                  {s.notas_cierre && <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 italic">"{s.notas_cierre}"</p>}

                  {/* Toggle detalle */}
                  <button
                    onClick={() => setSesionExpandida(isExpanded ? null : s.id)}
                    className="mt-3 flex items-center gap-1 text-xs text-accent hover:underline">
                    {isExpanded ? <><ChevronUp size={13} /> Ocultar detalle</> : <><ChevronDown size={13} /> Ver movimientos</>}
                  </button>
                </div>

                {/* Detalle expandido */}
                {isExpanded && (
                  <div className="border-t border-gray-100">
                    {movimientosDetalle.length === 0 ? (
                      <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-4">Sin movimientos registrados en esta sesión</p>
                    ) : (
                      <div className="divide-y divide-gray-50">
                        {movimientosDetalle.map((m: any) => (
                          <div key={m.id} className={`px-4 py-2.5 flex items-center justify-between ${m.tipo === 'ingreso_informativo' ? 'opacity-60' : ''}`}>
                            <div className="flex items-start gap-2 min-w-0">
                              {m.tipo === 'ingreso_informativo' && <Info size={13} className="text-blue-400 mt-0.5 flex-shrink-0" />}
                              <div className="min-w-0">
                                <p className="text-sm text-gray-800 dark:text-gray-100 truncate">{m.concepto}</p>
                                <p className="text-xs text-gray-400 dark:text-gray-500">
                                  {new Date(m.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
                                  {m.users?.nombre_display && ` · ${m.users.nombre_display}`}
                                </p>
                              </div>
                            </div>
                            <span className={`font-bold text-sm flex-shrink-0 ml-3 ${['ingreso','ingreso_reserva'].includes(m.tipo) ? 'text-green-600 dark:text-green-400' : ['egreso','egreso_devolucion_sena'].includes(m.tipo) ? 'text-red-500' : 'text-blue-400'}`}>
                              {['ingreso','ingreso_reserva'].includes(m.tipo) ? '+' : ['egreso','egreso_devolucion_sena'].includes(m.tipo) ? '-' : '~'}{formatMoneda(m.monto)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Arqueos de esta sesión */}
                    {arqueosHistorial.length > 0 && (
                      <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-3">
                        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1">
                          <CheckCircle size={11} className="text-accent" /> Arqueos ({arqueosHistorial.length})
                        </p>
                        <div className="space-y-1.5">
                          {(arqueosHistorial as any[]).map((a) => {
                            const dif = a.diferencia ?? 0
                            return (
                              <div key={a.id} className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                                <span>{new Date(a.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</span>
                                <span>{formatMoneda(a.saldo_calculado)} → {formatMoneda(a.saldo_real)}</span>
                                <span className={`font-bold ${dif > 0 ? 'text-green-600 dark:text-green-400' : dif < 0 ? 'text-red-500' : 'text-gray-400 dark:text-gray-500'}`}>
                                  {dif > 0 ? `+${formatMoneda(dif)}` : dif < 0 ? formatMoneda(dif) : 'OK'}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── CONFIGURACIÓN (solo Dueño/Supervisor/Admin) ── */}
      {tab === 'configuracion' && puedeAdministrarCaja && (
        <div className="space-y-4">
          {/* Cajas operativas */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-700 dark:text-gray-300">Cajas operativas</h2>
              <button onClick={() => setShowNuevaCaja(true)}
                className="flex items-center gap-1.5 text-sm bg-accent hover:bg-accent/90 text-white px-3 py-2 rounded-xl transition-all">
                <Plus size={15} /> Nueva caja
              </button>
            </div>

            {showNuevaCaja && (
              <div className="flex gap-2 mb-4 flex-wrap">
                <input type="text" value={nuevaCajaNombre} onChange={e => setNuevaCajaNombre(e.target.value)}
                  placeholder="Nombre de la caja (ej: Caja 1, Caja Principal)"
                  className="flex-1 min-w-[200px] px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
                <select value={nuevaCajaMoneda || (tenant as any)?.moneda || 'ARS'}
                  onChange={e => setNuevaCajaMoneda(e.target.value)}
                  title="Moneda de la caja (no se puede cambiar luego)"
                  className="w-24 px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent">
                  {MONEDAS_LISTA.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <button onClick={() => crearCaja.mutate()} disabled={crearCaja.isPending}
                  className="px-4 py-2 bg-primary text-white rounded-xl text-sm disabled:opacity-50">
                  Crear
                </button>
                <button onClick={() => setShowNuevaCaja(false)} className="px-3 py-2 text-gray-400 dark:text-gray-500 hover:text-gray-600">
                  <X size={18} />
                </button>
              </div>
            )}

            {cajasOperativas.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-6">
                {sucursalId ? 'No hay cajas asignadas a esta sucursal. Creá una o asigná una existente desde la vista global.' : 'No hay cajas creadas'}
              </p>
            ) : (
              <div className="space-y-2">
                {cajasOperativas.map((c: any) => {
                  const tieneSessionActiva = cajasAbiertas.includes(c.id)
                  return (
                    <div key={c.id} className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-700 rounded-xl gap-3">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center shrink-0">
                          <DollarSign size={15} className="text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="font-medium text-gray-800 dark:text-gray-100">{c.nombre}</span>
                          <span className="ml-2 text-[11px] font-mono px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200">{c.moneda || 'ARS'}</span>
                          {tieneSessionActiva && (
                            <span className="ml-2 text-xs text-green-600 dark:text-green-400 font-medium">● Abierta</span>
                          )}
                        </div>
                      </div>
                      {sucursales.length > 1 && (
                        <select
                          value={c.sucursal_id ?? ''}
                          onChange={async (e) => {
                            const val = e.target.value || null
                            const { error } = await supabase.from('cajas').update({ sucursal_id: val }).eq('id', c.id)
                            if (error) { toast.error(error.message); return }
                            qc.invalidateQueries({ queryKey: ['cajas'] })
                          }}
                          className="text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 focus:outline-none focus:border-accent">
                          <option value="">Sin sucursal</option>
                          {sucursales.map((s: any) => (
                            <option key={s.id} value={s.id}>{s.nombre}</option>
                          ))}
                        </select>
                      )}
                      <button
                        title={tieneSessionActiva ? 'No se puede eliminar una caja abierta' : 'Eliminar caja'}
                        disabled={tieneSessionActiva}
                        onClick={async () => {
                          if (!confirm(`¿Eliminar la caja "${c.nombre}"? El historial de movimientos se conserva.`)) return
                          const { error } = await supabase.from('cajas').update({ activo: false }).eq('id', c.id)
                          if (error) { toast.error(error.message); return }
                          toast.success('Caja eliminada')
                          qc.invalidateQueries({ queryKey: ['cajas'] })
                        }}
                        className="p-1.5 text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 shrink-0">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Roles que pueden ver la Caja Fuerte */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
            <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-1">Acceso a Caja Fuerte / Bóveda</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">Solo el Dueño ve el saldo de la bóveda por defecto (E1). Habilitá la visibilidad a otros roles estándar o personalizados.</p>
            <div className="space-y-2">
              {(() => {
                // value = identificador guardado en caja_fuerte_roles. Roles fijos por nombre, custom como 'custom:<id>'.
                const opciones: { value: string; label: string }[] = [
                  ...['SUPERVISOR', 'SUPER_USUARIO', 'CAJERO', 'CONTADOR', 'DEPOSITO', 'RRHH'].map(r => ({ value: r, label: r })),
                  ...(rolesCustom as any[]).map(rc => ({ value: `custom:${rc.id}`, label: `${rc.nombre} (personalizado)` })),
                ]
                return opciones.map(({ value, label }) => {
                  const roles: string[] = (tenant as any)?.caja_fuerte_roles ?? ['DUEÑO']
                  const enabled = roles.includes(value)
                  return (
                    <label key={value} className="flex items-center gap-3 cursor-pointer">
                      <div onClick={async () => {
                        const current: string[] = (tenant as any)?.caja_fuerte_roles ?? ['DUEÑO']
                        const updated = enabled ? current.filter(r => r !== value) : [...current, value]
                        await supabase.from('tenants').update({ caja_fuerte_roles: updated }).eq('id', tenant!.id)
                        qc.invalidateQueries({ queryKey: ['cajas'] })
                        window.location.reload() // reload para que authStore refresque el tenant
                      }}
                        className={`w-9 h-5 rounded-full transition-colors flex items-center px-0.5 ${enabled ? 'bg-accent' : 'bg-gray-200 dark:bg-gray-600'}`}>
                        <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                      </div>
                      <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
                    </label>
                  )
                })
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Modal arqueo */}
      {showArqueo && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-primary flex items-center gap-2">
                <CheckCircle size={20} className="text-accent" /> Arqueo parcial
              </h2>
              <button onClick={() => { setShowArqueo(false); setArqueoConteo(''); setArqueoNotas('') }}
                className="text-gray-400 dark:text-gray-500 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="space-y-4">
              <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-3 flex justify-between text-sm">
                <span className="text-gray-500 dark:text-gray-400">Saldo calculado</span>
                <span className="font-bold text-gray-800 dark:text-gray-100">{formatMoneda(saldoActual)}</span>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Conteo físico real *</label>
                <input type="number" onWheel={e => e.currentTarget.blur()}
                  value={arqueoConteo} onChange={e => setArqueoConteo(e.target.value)}
                  placeholder="0" min="0" step="0.01" autoFocus
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent" />
                {arqueoConteo !== '' && (
                  <p className={`mt-1.5 text-sm font-medium ${
                    parseFloat(arqueoConteo) - saldoActual > 0 ? 'text-green-600 dark:text-green-400' :
                    parseFloat(arqueoConteo) - saldoActual < 0 ? 'text-red-600 dark:text-red-400' :
                    'text-gray-400 dark:text-gray-500'
                  }`}>
                    Diferencia: {formatMoneda(parseFloat(arqueoConteo) - saldoActual)}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notas (opcional)</label>
                <input type="text" value={arqueoNotas} onChange={e => setArqueoNotas(e.target.value)}
                  placeholder="Observaciones..."
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent" />
              </div>
              <button onClick={() => realizarArqueo.mutate()} disabled={realizarArqueo.isPending || !arqueoConteo.trim()}
                className="w-full bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl transition-all disabled:opacity-50">
                {realizarArqueo.isPending ? 'Registrando...' : 'Registrar arqueo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal movimiento */}
      {showMovimiento && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-primary flex items-center gap-2">
                <Plus size={18} className="text-green-600 dark:text-green-400" /> Ingreso de caja
              </h2>
              <button onClick={() => setShowMovimiento(false)} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-400"><X size={20} /></button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 -mt-2">
              Para registrar un egreso, creá un <strong>Gasto</strong> con el monto y método de pago. Caja solo registra ingresos manuales (aportes, devoluciones, etc.).
            </p>
            <div className="space-y-3 mb-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Concepto</label>
                <input type="text" value={movConcepto} onChange={e => setMovConcepto(e.target.value)} autoFocus
                  placeholder="Ej: Pago a proveedor, Cobro efectivo..."
                  className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
                {(motivosCaja as any[]).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {(motivosCaja as any[]).map((m: any) => (
                      <button key={m.id} type="button"
                        onClick={() => setMovConcepto(m.nombre)}
                        className={`text-xs px-2.5 py-1 rounded-full border transition-all
                          ${movConcepto === m.nombre
                            ? 'bg-accent text-white border-accent'
                            : 'bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-accent hover:text-accent'}`}>
                        {m.nombre}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Monto</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500">$</span>
                  <input type="number" onWheel={e => e.currentTarget.blur()} min="0" value={movMonto} onChange={e => setMovMonto(e.target.value)}
                    placeholder="0"
                    className="w-full pl-7 pr-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
                </div>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowMovimiento(false)}
                className="flex-1 border-2 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-semibold py-2.5 rounded-xl text-sm">
                Cancelar
              </button>
              <button onClick={() => agregarMovimiento.mutate()} disabled={agregarMovimiento.isPending}
                className="flex-1 bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl text-sm transition-all disabled:opacity-50">
                {agregarMovimiento.isPending ? 'Guardando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal traspaso */}
      {showTraspaso && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowTraspaso(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-primary flex items-center gap-2">
                <ArrowRightLeft size={18} className="text-accent" /> Transferir a otra caja
              </h2>
              <button onClick={() => setShowTraspaso(false)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400 transition-colors"><X size={16} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Caja destino *</label>
                <select value={traspasoDestinoSesionId}
                  onChange={e => setTraspasoDestinoSesionId(e.target.value)}
                  className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-700 dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent">
                  <option value="">Seleccioná una caja...</option>
                  {(sesionesAbiertasAll as any[])
                    .filter(s => s.id !== sesionActiva?.id)
                    .map(s => (
                      <option key={s.id} value={s.id}>{s.cajas?.nombre ?? s.id}</option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Monto *</label>
                <input type="number" onWheel={e => e.currentTarget.blur()} min="0" step="0.01"
                  value={traspasoMonto} onChange={e => setTraspasoMonto(e.target.value)}
                  placeholder="0"
                  className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-700 dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent" />
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Disponible: {formatMoneda(saldoActual)}</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Concepto (opcional)</label>
                <input type="text" value={traspasoConcepto} onChange={e => setTraspasoConcepto(e.target.value)}
                  placeholder="Traspaso entre cajas"
                  className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-700 dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent" />
              </div>
              <button onClick={() => realizarTraspaso.mutate()}
                disabled={realizarTraspaso.isPending || !traspasoDestinoSesionId || !traspasoMonto}
                className="w-full bg-accent hover:bg-accent/90 text-white font-semibold py-3 rounded-xl transition-all disabled:opacity-50">
                {realizarTraspaso.isPending ? 'Procesando...' : 'Confirmar traspaso'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal cierre */}
      {showCierre && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-primary">Cerrar caja</h2>
              <button onClick={() => { setShowCierre(false); setMontoRealCierre('') }}
                className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-400"><X size={20} /></button>
            </div>

            {/* Resumen calculado — solo efectivo */}
            <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4 mb-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Apertura</span><span className="font-medium">{formatMoneda(sesionActiva?.monto_apertura ?? 0)}</span></div>
              <div className="flex justify-between text-green-600 dark:text-green-400"><span>+ Ingresos efectivo</span><span className="font-medium">{formatMoneda(totalIngresos)}</span></div>
              <div className="flex justify-between text-red-500"><span>− Egresos efectivo</span><span className="font-medium">{formatMoneda(totalEgresos)}</span></div>
              <div className="flex justify-between border-t border-gray-200 dark:border-gray-700 pt-2 font-bold text-primary">
                <span>Efectivo esperado</span><span>{formatMoneda(saldoActual)}</span>
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 pt-1">Tarjeta, transferencia y Mercado Pago no se cuentan aquí.</p>
            </div>

            {/* Conteo real */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Efectivo contado en caja <span className="text-red-500 font-normal">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500">$</span>
                <input type="number" onWheel={e => e.currentTarget.blur()} min="0" value={montoRealCierre}
                  onChange={e => setMontoRealCierre(e.target.value)}
                  placeholder={formatMoneda(saldoActual).replace('$', '')}
                  className="w-full pl-7 pr-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
              </div>
              {diferencia !== null && (
                <div className={`mt-2 flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg ${
                  diferencia > 0 ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' :
                  diferencia < 0 ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400' :
                  'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                }`}>
                  {diferencia > 0
                    ? <><CheckCircle size={15} /> Sobran {formatMoneda(diferencia)}</>
                    : diferencia < 0
                    ? <><AlertTriangle size={15} /> Faltan {formatMoneda(Math.abs(diferencia))}</>
                    : 'Sin diferencia'}
                </div>
              )}
            </div>

            <div className="mb-5">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notas de cierre <span className="text-gray-400 dark:text-gray-500 font-normal">(opcional)</span></label>
              <textarea value={notasCierre} onChange={e => setNotasCierre(e.target.value)} rows={2}
                placeholder="Observaciones del cierre..."
                className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent resize-none" />
            </div>

            {/* B5 — Clave maestra al cerrar caja ajena */}
            {(() => {
              const claveConfigurada = !!(tenant as any)?.clave_maestra
              const esCierreAjeno = sesionActiva?.usuario_id && sesionActiva.usuario_id !== user?.id
              if (!esCierreAjeno) return null
              // H3 — caja ajena SIN clave maestra configurada: el cierre queda autorizado
              // solo por rol. Lo hacemos VISIBLE (sin forzar a configurar la clave).
              if (!claveConfigurada) {
                return (
                  <div className="mb-5 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-xl p-3">
                    <p className="text-xs text-gray-600 dark:text-gray-400 flex items-start gap-1.5">
                      <Lock size={13} className="mt-0.5 shrink-0" />
                      <span>Esta caja la abrió otra persona. Sin <strong>clave maestra</strong> configurada, el cierre queda autorizado solo por tu rol. Podés exigir un 2º factor configurándola en Configuración → Negocio.</span>
                    </p>
                  </div>
                )
              }
              return (
                <div className="mb-5 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-xl p-3 space-y-2">
                  <label className="block text-sm font-medium text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                    <Lock size={13} /> Clave maestra requerida
                  </label>
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Esta caja fue abierta por otro usuario. Ingresá la clave maestra del negocio para cerrarla.
                  </p>
                  <input type="password" value={claveMaestraCierre}
                    onChange={e => setClaveMaestraCierre(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="off"
                    className="w-full px-3 py-2 border border-amber-300 dark:border-amber-600 rounded-lg text-sm focus:outline-none focus:border-amber-500 dark:bg-gray-800" />
                </div>
              )
            })()}

            {/* B7 — Doble validación: 2do usuario debe autenticarse */}
            {configCaja.doble_validacion_cierre && (
              <div className="mb-5 bg-blue-50 dark:bg-blue-900/20 border border-blue-300 dark:border-blue-700 rounded-xl p-3 space-y-2">
                <label className="block text-sm font-medium text-blue-800 dark:text-blue-300 flex items-center gap-1.5">
                  <Lock size={13} /> Doble validación del cierre
                </label>
                <p className="text-xs text-blue-700 dark:text-blue-400">
                  Este negocio requiere que un 2do usuario (DUEÑO/SUPERVISOR/ADMIN) confirme el cierre con sus credenciales.
                </p>
                <input type="email" value={dobleValEmail}
                  onChange={e => setDobleValEmail(e.target.value)}
                  placeholder="Email del 2do usuario"
                  autoComplete="off"
                  className="w-full px-3 py-2 border border-blue-300 dark:border-blue-600 rounded-lg text-sm focus:outline-none focus:border-blue-500 dark:bg-gray-800" />
                <input type="password" value={dobleValPassword}
                  onChange={e => setDobleValPassword(e.target.value)}
                  placeholder="Contraseña"
                  autoComplete="new-password"
                  className="w-full px-3 py-2 border border-blue-300 dark:border-blue-600 rounded-lg text-sm focus:outline-none focus:border-blue-500 dark:bg-gray-800" />
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => { setShowCierre(false); setMontoRealCierre(''); setClaveMaestraCierre(''); setDobleValEmail(''); setDobleValPassword('') }}
                className="flex-1 border-2 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-semibold py-2.5 rounded-xl text-sm">
                Cancelar
              </button>
              <button onClick={() => cerrarCaja.mutate()} disabled={cerrarCaja.isPending || montoRealCierre.trim() === ''}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50">
                {cerrarCaja.isPending ? 'Cerrando...' : 'Confirmar cierre'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
