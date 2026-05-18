import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { BRAND } from '@/config/brand'
import { logActividad } from '@/lib/actividadLog'
import { useModalKeyboard } from '@/hooks/useModalKeyboard'
import {
  DollarSign, Plus, Minus, Lock, Unlock, History, Trash2,
  Printer, X, ChevronDown, ChevronUp, CheckCircle, AlertTriangle, Clock, Info, ArrowRightLeft
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import toast from 'react-hot-toast'

type Tab = 'caja' | 'historial' | 'caja_fuerte' | 'configuracion'

function formatMoneda(v: number) {
  return `$${v.toLocaleString('es-AR', { minimumFractionDigits: 0 })}`
}

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

function extraerNumeroVenta(concepto: string): string | null {
  const m = concepto.match(/#(\d+)/)
  return m ? m[1] : null
}

function getTipoDisplay(tipo: string, concepto: string): string {
  if (tipo === 'ingreso') return extraerNumeroVenta(concepto) ? 'Venta' : 'Ingreso Manual'
  return TIPO_LABEL[tipo] ?? tipo
}

function extraerMedioPago(tipo: string, concepto: string): string {
  if (tipo === 'ingreso_informativo' || tipo === 'egreso_informativo') {
    const m = concepto.match(/^\[(.+?)\]/)
    return m ? m[1] : 'No efectivo'
  }
  if (['ingreso','ingreso_reserva','egreso','egreso_devolucion_sena','ingreso_apertura'].includes(tipo)) return 'Efectivo'
  if (tipo === 'ingreso_traspaso' || tipo === 'egreso_traspaso') return 'Traspaso'
  return ''
}

export default function CajaPage() {
  const { tenant, user, sucursales } = useAuthStore()
  const { sucursalId, applyFilter } = useSucursalFilter()
  const qc = useQueryClient()
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

  // Forms
  const [montoApertura, setMontoApertura] = useState('')
  const [montoSugerido, setMontoSugerido] = useState<number | null>(null)
  const [notasCierre, setNotasCierre] = useState('')
  const [montoRealCierre, setMontoRealCierre] = useState('')
  const [movTipo, setMovTipo] = useState<'ingreso' | 'egreso'>('ingreso')
  const [movConcepto, setMovConcepto] = useState('')
  const [movMonto, setMovMonto] = useState('')
  const [nuevaCajaNombre, setNuevaCajaNombre] = useState('')

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

  // Sesiones abiertas propias del usuario actual (para bloquear segunda apertura en CAJERO)
  const { data: misSesionesAbiertas = [] } = useQuery({
    queryKey: ['mis-sesiones-abiertas', tenant?.id, user?.id, sucursalId],
    queryFn: async () => {
      const { data } = await applyFilter(
        supabase.from('caja_sesiones')
          .select('caja_id').eq('tenant_id', tenant!.id).eq('usuario_id', user!.id).eq('estado', 'abierta')
      )
      return data ?? []
    },
    enabled: !!tenant && !!user,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
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

  // Auto-seleccionar caja (solo operativas, nunca caja fuerte)
  const prefKey = tenant?.id && user?.id ? `caja_preferida_${tenant.id}_${user.id}` : null
  useEffect(() => {
    if (cajaSeleccionada !== null || cajasOperativas.length === 0) return
    const preferida = prefKey ? localStorage.getItem(prefKey) : null
    if (preferida && cajasOperativas.find((c: any) => c.id === preferida)) {
      setCajaSeleccionada(preferida)
    } else if (cajasAbiertas.length > 0) {
      setCajaSeleccionada(cajasAbiertas[0])
    }
  }, [cajasOperativas, cajasAbiertas, cajaSeleccionada, prefKey])

  function guardarCajaDefault(id: string) {
    if (prefKey) {
      localStorage.setItem(prefKey, id)
      toast.success('Caja guardada como predeterminada')
    }
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
  const saldoActual = sesionActiva ? (sesionActiva.monto_apertura + totalIngresos - totalEgresos) : 0

  // Totales por medio de pago para el resumen de movimientos
  const totalesMedios = (() => {
    const map: Record<string, number> = {}
    for (const m of movimientos as any[]) {
      const medio = extraerMedioPago(m.tipo, m.concepto)
      if (!medio) continue
      const signo = ['egreso','egreso_informativo','egreso_devolucion_sena','egreso_traspaso'].includes(m.tipo) ? -1 : 1
      map[medio] = (map[medio] ?? 0) + signo * m.monto
    }
    return map
  })()

  // Diferencia al cierre
  const montoRealNum = parseFloat(montoRealCierre) || 0
  const diferencia = montoRealCierre !== '' ? montoRealNum - saldoActual : null

  // Multi-usuario: quién abrió la sesión
  const abrioNombre = (sesionActiva as any)?.abrio?.nombre_display ?? null
  const esOtroUsuario = !!sesionActiva && sesionActiva.usuario_id !== user?.id
  const puedeAdministrarCaja = user?.rol === 'DUEÑO' || user?.rol === 'SUPERVISOR' || user?.rol === 'SUPER_USUARIO'
  // B2: CAJERO puede abrir 1 caja, pero no más de una simultáneamente
  const puedeAbrirCaja = puedeAdministrarCaja || misSesionesAbiertas.length === 0
  // CAJERO no puede ver el contenido de cajas abiertas por otro usuario
  const esCajero = user?.rol === 'CAJERO'
  const cajaAjenaBloqueada = esCajero && esOtroUsuario

  // Mutations
  const abrirCaja = useMutation({
    mutationFn: async () => {
      if (!cajaId) throw new Error('Seleccioná una caja')
      // B2: CAJERO no puede tener más de 1 sesión abierta simultáneamente
      if (!puedeAdministrarCaja) {
        const { data: check } = await supabase.from('caja_sesiones')
          .select('id').eq('tenant_id', tenant!.id).eq('usuario_id', user!.id).eq('estado', 'abierta')
        if (check && check.length > 0) {
          throw new Error('Ya tenés una caja abierta. Cerrala antes de abrir otra.')
        }
      }
      // Verificar que no haya otra sesión abierta por otro usuario
      const { data: existente } = await supabase.from('caja_sesiones')
        .select('id, usuario_id, abrio:usuario_id(nombre_display)')
        .eq('caja_id', cajaId).eq('estado', 'abierta')
        .maybeSingle()
      if (existente && existente.usuario_id !== user?.id) {
        const nombre = (existente as any).abrio?.nombre_display ?? 'otro usuario'
        throw new Error(`Esta caja ya está abierta por ${nombre}`)
      }
      const montoReal = parseFloat(montoApertura) || 0
      const difApertura = montoSugerido !== null ? montoReal - montoSugerido : null
      const { error } = await supabase.from('caja_sesiones').insert({
        tenant_id: tenant!.id,
        caja_id: cajaId,
        usuario_id: user?.id,
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
      setShowApertura(false); setShowDifConfirm(false); setMontoApertura('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const cerrarCaja = useMutation({
    mutationFn: async () => {
      if (!sesionActiva) throw new Error('No hay caja abierta')
      if (montoRealCierre.trim() === '') throw new Error('Ingresá el monto contado para poder cerrar la caja')
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
      }
      const { error } = await supabase.from('caja_sesiones').update(payload).eq('id', sesionActiva.id)
      if (error) throw error
    },
    onSuccess: () => {
      logActividad({
        entidad: 'caja', entidad_id: sesionActiva?.id,
        entidad_nombre: cajaActual?.nombre ?? 'Caja',
        accion: 'cerrar',
        valor_nuevo: `Saldo: ${formatMoneda(saldoActual)}${diferencia !== null ? ` | Diferencia: ${formatMoneda(diferencia)}` : ''}`,
        pagina: '/caja',
      })
      // Auto-download ticket de cierre
      const closedSesion = {
        ...sesionActiva,
        cajas: { nombre: cajaActual?.nombre ?? 'Caja' },
        monto_cierre: saldoActual,
        total_ingresos: totalIngresos,
        total_egresos: totalEgresos,
        monto_real_cierre: montoRealCierre !== '' ? montoRealNum : null,
        diferencia_cierre: diferencia ?? 0,
        notas_cierre: notasCierre || null,
        cerrada_at: new Date().toISOString(),
        abrio: (sesionActiva as any)?.abrio,
        cerrado_por: { nombre_display: user?.nombre_display ?? '—' },
      }
      imprimirCierre(closedSesion)
      toast.success('Caja cerrada · PDF descargado')
      qc.invalidateQueries({ queryKey: ['sesion-activa'] })
      qc.invalidateQueries({ queryKey: ['historial-sesiones'] })
      setShowCierre(false); setNotasCierre(''); setMontoRealCierre('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const agregarMovimiento = useMutation({
    mutationFn: async () => {
      if (!sesionActiva) throw new Error('No hay caja abierta')
      if (!movConcepto.trim()) throw new Error('Ingresá un concepto')
      const monto = parseFloat(movMonto)
      if (!monto || monto <= 0) throw new Error('Ingresá un monto válido')
      if (movTipo === 'egreso' && monto > saldoActual) throw new Error(`Saldo insuficiente. Saldo actual: $${saldoActual.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`)
      const { error } = await supabase.from('caja_movimientos').insert({
        tenant_id: tenant!.id,
        sesion_id: sesionActiva.id,
        tipo: movTipo,
        concepto: movConcepto.trim(),
        monto,
        usuario_id: user?.id,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success(`${movTipo === 'ingreso' ? 'Ingreso' : 'Egreso'} registrado`)
      qc.invalidateQueries({ queryKey: ['caja-movimientos'] })
      setShowMovimiento(false); setMovConcepto(''); setMovMonto('')
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
      const { error: e1 } = await supabase.from('caja_movimientos').insert({
        tenant_id: tenant!.id, sesion_id: sesionActiva.id,
        tipo: 'egreso', concepto: `${concepto} → ${nombreDestino}`,
        monto, usuario_id: user!.id,
      })
      if (e1) throw e1
      // Ingreso en destino
      const { error: e2 } = await supabase.from('caja_movimientos').insert({
        tenant_id: tenant!.id, sesion_id: traspasoDestinoSesionId,
        tipo: 'ingreso', concepto: `${concepto} ← ${nombreOrigen}`,
        monto, usuario_id: user!.id,
      })
      if (e2) throw e2
      // Registro en tabla de traspasos
      const { error: e3 } = await supabase.from('caja_traspasos').insert({
        tenant_id: tenant!.id,
        sesion_origen_id: sesionActiva.id,
        sesion_destino_id: traspasoDestinoSesionId,
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
      tipo, monto, concepto, desdeSessionId, hastaSessionId,
    }: { tipo: 'deposito' | 'retiro'; monto: number; concepto: string; desdeSessionId?: string; hastaSessionId?: string }) => {
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

      if (tipo === 'deposito') {
        // Si viene de una caja activa: egreso en esa caja
        if (desdeSessionId) {
          const { error: e1 } = await supabase.from('caja_movimientos').insert({
            tenant_id: tenant!.id, sesion_id: desdeSessionId,
            tipo: 'egreso_traspaso', monto,
            concepto: concepto || 'Depósito en caja fuerte', usuario_id: user!.id,
          })
          if (e1) throw e1
        }
        // Ingreso en caja fuerte (siempre)
        const { error: e2 } = await supabase.from('caja_movimientos').insert({
          tenant_id: tenant!.id, sesion_id: fuerteSessionId,
          tipo: 'ingreso_traspaso', monto,
          concepto: concepto || (desdeSessionId ? `Depósito desde caja` : 'Ingreso externo'),
          usuario_id: user!.id,
        })
        if (e2) throw e2
      } else {
        const destSesionId = hastaSessionId
        if (!destSesionId) throw new Error('Seleccioná la caja de destino')
        const { error: e1 } = await supabase.from('caja_movimientos').insert({
          tenant_id: tenant!.id, sesion_id: fuerteSessionId,
          tipo: 'egreso_traspaso', monto,
          concepto: concepto || 'Retiro de caja fuerte', usuario_id: user!.id,
        })
        if (e1) throw e1
        const { error: e2 } = await supabase.from('caja_movimientos').insert({
          tenant_id: tenant!.id, sesion_id: destSesionId,
          tipo: 'ingreso_traspaso', monto,
          concepto: concepto || 'Ingreso desde caja fuerte', usuario_id: user!.id,
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
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Caja creada')
      qc.invalidateQueries({ queryKey: ['cajas'] })
      setShowNuevaCaja(false); setNuevaCajaNombre('')
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

  // Atajo de teclado: Shift+I = ingreso (solo con caja abierta)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!sesionActiva || tab !== 'caja') return
      if (e.shiftKey && e.key === 'I') { e.preventDefault(); setMovTipo('ingreso'); setShowMovimiento(true) }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [sesionActiva, tab])

  const imprimirCierre = (sesion: any) => {
    const doc = new jsPDF()
    doc.setFillColor(30, 58, 95)
    doc.rect(0, 0, doc.internal.pageSize.width, 25, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(16); doc.setFont('helvetica', 'bold')
    doc.text(BRAND.name, 14, 12)
    doc.setFontSize(11); doc.setFont('helvetica', 'normal')
    doc.text('Resumen de cierre de caja', 14, 20)

    doc.setTextColor(60, 60, 60)
    doc.setFontSize(10)
    doc.text(`Caja: ${sesion.cajas?.nombre ?? '—'}`, 14, 35)
    doc.text(`Negocio: ${tenant?.nombre}`, 14, 42)
    doc.text(`Apertura: ${new Date(sesion.abierta_at).toLocaleString('es-AR')}`, 14, 49)
    doc.text(`Cierre: ${new Date(sesion.cerrada_at).toLocaleString('es-AR')}`, 14, 56)
    const abrioNombre = sesion.abrio?.nombre_display ?? '—'
    const cerroNombre = sesion.cerrado_por?.nombre_display ?? abrioNombre
    doc.text(`Abrió: ${abrioNombre}`, 14, 63)
    doc.text(`Cerró: ${cerroNombre}`, 14, 70)

    const rows: any[] = [
      ['Monto de apertura', formatMoneda(sesion.monto_apertura)],
      ['Total ingresos', formatMoneda(sesion.total_ingresos)],
      ['Total egresos', formatMoneda(sesion.total_egresos)],
      ['Saldo calculado', formatMoneda(sesion.monto_cierre)],
    ]
    if (sesion.monto_real_cierre != null) {
      rows.push(['Conteo real', formatMoneda(sesion.monto_real_cierre)])
      const dif = sesion.diferencia_cierre ?? 0
      rows.push([dif >= 0 ? 'Sobrante' : 'Faltante', formatMoneda(Math.abs(dif))])
    }

    autoTable(doc, {
      startY: 78,
      head: [['Concepto', 'Monto']],
      body: rows,
      styles: { fontSize: 10 },
      headStyles: { fillColor: [30, 58, 95] },
      columnStyles: { 1: { halign: 'right' } },
    })

    if (sesion.notas_cierre) {
      const finalY = (doc as any).lastAutoTable.finalY + 10
      doc.text(`Notas: ${sesion.notas_cierre}`, 14, finalY)
    }

    doc.save(`cierre_caja_${new Date(sesion.cerrada_at).toISOString().split('T')[0]}.pdf`)
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Caja</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">Gestioná la caja de tu negocio</p>
        </div>
      </div>

      {/* Tabs */}
      {(() => {
        const cajaFuerteRoles: string[] = (tenant as any)?.caja_fuerte_roles ?? ['DUEÑO','SUPERVISOR','SUPER_USUARIO']
        const puedeCajaFuerte = !!user?.rol && cajaFuerteRoles.includes(user.rol)
        const tabs = [
          { id: 'caja', label: 'Caja actual', visible: true },
          { id: 'historial', label: 'Historial', visible: true },
          { id: 'caja_fuerte', label: '🔒 Caja Fuerte', visible: puedeCajaFuerte && !!cajaFuerte },
          { id: 'configuracion', label: 'Configuración', visible: puedeAdministrarCaja },
        ].filter(t => t.visible)
        return (
          <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 p-1 rounded-xl w-fit flex-wrap">
            {tabs.map(({ id, label }) => (
              <button key={id} onClick={() => setTab(id as Tab)}
                className={`py-2 px-4 rounded-lg text-sm font-medium transition-all
                  ${tab === id ? 'bg-white dark:bg-gray-800 text-primary shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}>
                {label}
              </button>
            ))}
          </div>
        )
      })()}

      {/* ── CAJA ACTUAL ── */}
      {tab === 'caja' && (
        <div className="space-y-4">
          {/* Selector de caja + badges cajitas (solo cajas operativas) */}
          {cajasOperativas.length > 1 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-gray-500 dark:text-gray-400">Caja:</span>
                <select value={cajaId ?? ''} onChange={e => setCajaSeleccionada(e.target.value)}
                  className="border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent">
                  {cajasOperativas.map((c: any) => {
                    const abierta = cajasAbiertas.includes(c.id)
                    const esPref = prefKey ? localStorage.getItem(prefKey) === c.id : false
                    return <option key={c.id} value={c.id}>{esPref ? '★ ' : ''}{c.nombre}{abierta ? ' ✓ Abierta' : ''}</option>
                  })}
                </select>
                <button onClick={() => cajaId && guardarCajaDefault(cajaId)}
                  title="Guardar esta caja como predeterminada"
                  className="text-xs text-gray-400 dark:text-gray-500 hover:text-accent transition-colors px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
                  ★ Predeterminar
                </button>
              </div>
              <div className="flex gap-2 flex-wrap">
                {cajasOperativas.map((c: any) => {
                  const abierta = cajasAbiertas.includes(c.id)
                  const activa = c.id === cajaId
                  return (
                    <button key={c.id} onClick={() => setCajaSeleccionada(c.id)}
                      title={abierta ? 'Abierta' : 'Cerrada'}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all
                        ${activa
                          ? 'border-accent bg-accent/10 text-accent'
                          : abierta
                            ? 'border-green-300 bg-green-50 dark:bg-green-900/20 dark:border-green-700 text-green-700 dark:text-green-400 hover:border-green-400'
                            : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-400 dark:text-gray-500 hover:border-gray-300'}`}>
                      <DollarSign size={12} />
                      {prefKey && localStorage.getItem(prefKey) === c.id && <span className="text-yellow-500">★</span>}
                      <span>{c.nombre}</span>
                      <span className={`w-2 h-2 rounded-full ${abierta ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                    </button>
                  )
                })}
              </div>
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
                    disabled={!puedeAbrirCaja}
                    title={!puedeAbrirCaja ? 'Ya tenés una caja abierta. Cerrala antes de abrir otra.' : undefined}
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
            /* Caja abierta */
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

              {/* Acciones */}
              <div className="flex gap-2">
                <button onClick={() => { setMovTipo('ingreso'); setShowMovimiento(true) }}
                  className="flex-1 flex items-center justify-center gap-2 bg-accent hover:bg-accent/90 text-white font-semibold py-3 rounded-xl transition-all">
                  <Plus size={18} /> Ingreso
                </button>
                <button onClick={() => setShowArqueo(true)}
                  title="Arqueo parcial — contar efectivo sin cerrar caja"
                  className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 font-semibold rounded-xl transition-all">
                  <CheckCircle size={16} />
                </button>
                {cajaFuerte && (() => {
                  const cajaFuerteRoles: string[] = (tenant as any)?.caja_fuerte_roles ?? ['DUEÑO','SUPERVISOR','SUPER_USUARIO']
                  return cajaFuerteRoles.includes(user?.rol ?? '') ? (
                    <button onClick={() => setShowDepositoFuerte(true)}
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
                            <span className={`font-bold text-sm flex-shrink-0 ${
                              esIngreso ? 'text-green-600 dark:text-green-400'
                              : esEgreso ? 'text-red-500'
                              : 'text-blue-400'
                            }`}>
                              {esIngreso ? '+' : esEgreso ? '−' : '~'}{formatMoneda(m.monto)}
                            </span>
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

              {/* Cerrar caja */}
              {esOtroUsuario && !puedeAdministrarCaja ? (
                <div className="w-full flex items-center justify-center gap-2 border-2 border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 font-semibold py-3 rounded-xl cursor-not-allowed">
                  <Lock size={18} /> Solo {abrioNombre ?? 'quien abrió'} puede cerrar esta caja
                </div>
              ) : (
                <button onClick={() => setShowCierre(true)}
                  className="w-full flex items-center justify-center gap-2 border-2 border-red-200 text-red-600 dark:text-red-400 font-semibold py-3 rounded-xl hover:bg-red-50 dark:bg-red-900/20 transition-all">
                  <Lock size={18} /> Cerrar caja
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── CAJA FUERTE ── */}
      {/* ── CAJA FUERTE TAB ── */}
      {tab === 'caja_fuerte' && cajaFuerte && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-yellow-100 dark:bg-yellow-900/30 rounded-xl flex items-center justify-center">
                <Lock size={18} className="text-yellow-600 dark:text-yellow-400" />
              </div>
              <div>
                <p className="font-semibold text-gray-800 dark:text-gray-100">Caja Fuerte / Bóveda</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">Registro de depósitos. No registra saldo.</p>
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
            </div>
          </div>

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
                className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-700 dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent">
                <option value="">Ingreso externo (sin caja)</option>
                {(sesionesAbiertasAll as any[]).filter((s: any) => !cajaFuerte || s.caja_id !== cajaFuerte.id).map((s: any) => (
                  <option key={s.id} value={s.id}>{s.cajas?.nombre}</option>
                ))}
              </select>
              {depositoFuenteSesionId && (() => {
                const sesOrigen = (sesionesAbiertasAll as any[]).find((s: any) => s.id === depositoFuenteSesionId)
                return sesOrigen ? (
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Se descontará de <strong>{sesOrigen.cajas?.nombre}</strong></p>
                ) : null
              })()}
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
                Ingreso externo — no hay caja de origen. Solo se registrará el ingreso en la Caja Fuerte.
              </p>
            )}
            <button onClick={() => operarCajaFuerte.mutate({
              tipo: 'deposito',
              monto: parseFloat(fuerteMonto) || 0,
              concepto: fuerteConcepto,
              desdeSessionId: depositoFuenteSesionId || undefined,
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
                      <p className="font-semibold text-gray-800 dark:text-gray-100">{s.cajas?.nombre}</p>
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
                      <button onClick={() => imprimirCierre(s)}
                        className="flex items-center gap-1.5 text-xs border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 px-3 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <Printer size={13} /> PDF
                      </button>
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
              <div className="flex gap-2 mb-4">
                <input type="text" value={nuevaCajaNombre} onChange={e => setNuevaCajaNombre(e.target.value)}
                  placeholder="Nombre de la caja (ej: Caja 1, Caja Principal)"
                  className="flex-1 px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
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
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">Dueño, Supervisor y Admin siempre tienen acceso. Podés habilitar otros roles.</p>
            <div className="space-y-2">
              {['CAJERO', 'CONTADOR', 'DEPOSITO', 'RRHH'].map(rol => {
                const roles: string[] = (tenant as any)?.caja_fuerte_roles ?? ['DUEÑO','SUPERVISOR','SUPER_USUARIO']
                const enabled = roles.includes(rol)
                return (
                  <label key={rol} className="flex items-center gap-3 cursor-pointer">
                    <div onClick={async () => {
                      const current: string[] = (tenant as any)?.caja_fuerte_roles ?? ['DUEÑO','SUPERVISOR','SUPER_USUARIO']
                      const updated = enabled ? current.filter(r => r !== rol) : [...current, rol]
                      await supabase.from('tenants').update({ caja_fuerte_roles: updated }).eq('id', tenant!.id)
                      // Reload tenant data
                      qc.invalidateQueries({ queryKey: ['cajas'] })
                      window.location.reload() // reload para que authStore refresque el tenant
                    }}
                      className={`w-9 h-5 rounded-full transition-colors flex items-center px-0.5 ${enabled ? 'bg-accent' : 'bg-gray-200 dark:bg-gray-600'}`}>
                      <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                    </div>
                    <span className="text-sm text-gray-700 dark:text-gray-300">{rol}</span>
                  </label>
                )
              })}
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
                {movTipo === 'ingreso'
                  ? <><Plus size={18} className="text-green-600 dark:text-green-400" /> Ingreso de caja</>
                  : <><Minus size={18} className="text-orange-500" /> Egreso de caja</>}
              </h2>
              <button onClick={() => setShowMovimiento(false)} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-400"><X size={20} /></button>
            </div>
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

            <div className="flex gap-3">
              <button onClick={() => { setShowCierre(false); setMontoRealCierre('') }}
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
