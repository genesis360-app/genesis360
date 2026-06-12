import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CreditCard, DollarSign, MessageCircle, CheckCircle, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { formatMoneda as formatMonedaLib } from '@/lib/formato'
import { buildWhatsAppUrl } from '@/lib/whatsapp'
import { cobrarDeudaCCFIFO } from '@/lib/cobranzaCC'
import { notificarPagoCC } from '@/lib/notificacionesCC'
import toast from 'react-hot-toast'

/**
 * B5 — Cobranza masiva de cuenta corriente desde Caja.
 * Lista los clientes con deuda CC pendiente y permite cobrar (FIFO) por cliente.
 * Reusa `cobrarDeudaCCFIFO` (mismo flujo que la ficha y el POS).
 */
export default function CajaCobranzasCC() {
  const { tenant, user } = useAuthStore()
  const qc = useQueryClient()
  const formatMoneda = (v: number) => formatMonedaLib(v, (tenant as any)?.moneda ?? 'ARS')
  const [cobrarId, setCobrarId] = useState<string | null>(null)
  const [monto, setMonto] = useState('')
  const [metodo, setMetodo] = useState('Efectivo')
  const [saving, setSaving] = useState(false)

  const { data: ventasCC = [] } = useQuery({
    queryKey: ['caja-cobranzas-cc', tenant?.id],
    queryFn: async () => {
      // B3 — recálculo de intereses (sweep-lazy) antes de leer
      await supabase.rpc('recalcular_intereses_cc', { p_tenant: tenant!.id })
      const { data } = await supabase.from('ventas')
        .select('id, cliente_id, cliente_nombre, total, monto_pagado, interes_cc, fecha_vencimiento_cc, created_at')
        .eq('tenant_id', tenant!.id)
        .eq('es_cuenta_corriente', true)
        .in('estado', ['despachada', 'facturada'])
      return (data ?? []).filter((v: any) => (v.total ?? 0) - (v.monto_pagado ?? 0) > 0.5)
    },
    enabled: !!tenant,
  })

  const { data: clientes = [] } = useQuery({
    queryKey: ['caja-cobranzas-clientes', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('clientes')
        .select('id, nombre, telefono').eq('tenant_id', tenant!.id)
      return data ?? []
    },
    enabled: !!tenant,
  })

  const hoyISO = new Date().toISOString().slice(0, 10)
  const deudaMap: Record<string, { total: number; interes: number; count: number; vencida: boolean }> = {}
  for (const v of ventasCC as any[]) {
    if (!v.cliente_id) continue
    const saldo = (v.total ?? 0) - (v.monto_pagado ?? 0)
    const interes = v.interes_cc ?? 0
    if (!deudaMap[v.cliente_id]) deudaMap[v.cliente_id] = { total: 0, interes: 0, count: 0, vencida: false }
    deudaMap[v.cliente_id].total += saldo + interes
    deudaMap[v.cliente_id].interes += interes
    deudaMap[v.cliente_id].count += 1
    if (v.fecha_vencimiento_cc && v.fecha_vencimiento_cc < hoyISO) deudaMap[v.cliente_id].vencida = true
  }
  const cliMap: Record<string, any> = Object.fromEntries((clientes as any[]).map(c => [c.id, c]))
  const conDeuda = Object.entries(deudaMap)
    .map(([id, d]) => ({ id, nombre: cliMap[id]?.nombre ?? 'Cliente', telefono: cliMap[id]?.telefono, ...d }))
    .sort((a, b) => b.total - a.total)
  const totalGlobal = conDeuda.reduce((a, c) => a + c.total, 0)

  const cobrar = async (clienteId: string) => {
    const m = parseFloat(monto)
    if (!m || m <= 0) { toast.error('Ingresá un monto válido'); return }
    setSaving(true)
    try {
      const nomb = conDeuda.find(x => x.id === clienteId)?.nombre ?? 'cliente'
      const { aplicado, cajaRegistrada } = await cobrarDeudaCCFIFO(supabase, {
        tenantId: tenant!.id, clienteId, monto: m, metodo,
        usuarioId: user?.id, clienteNombre: nomb,
      })
      if (aplicado <= 0) { toast.error('Sin ventas CC pendientes'); return }
      toast.success(`Cobranza de ${formatMoneda(aplicado)} registrada`)
      // Impacto en arqueo: efectivo sin caja a la que imputar → avisar (descuadre seguro)
      if (metodo === 'Efectivo' && !cajaRegistrada) {
        toast('El efectivo cobrado no quedó en ningún arqueo: no hay caja abierta a la que imputarlo.', { icon: '⚠️', duration: 7000 })
      }
      void notificarPagoCC(tenant, clienteId, nomb, aplicado)  // CL4/C4
      setCobrarId(null); setMonto(''); setMetodo('Efectivo')
      qc.invalidateQueries({ queryKey: ['caja-cobranzas-cc'] })
      qc.invalidateQueries({ queryKey: ['caja-sesiones-abiertas'] })
      qc.invalidateQueries({ queryKey: ['caja-movimientos'] })
    } catch (e: any) { toast.error(e.message ?? 'Error al registrar la cobranza') }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700 flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400">Deuda total en cuentas corrientes</p>
          <p className="text-2xl font-bold text-red-600 dark:text-red-400">{formatMoneda(totalGlobal)}</p>
        </div>
        <p className="text-sm text-gray-400 dark:text-gray-500">{conDeuda.length} cliente{conDeuda.length !== 1 ? 's' : ''} con saldo</p>
      </div>

      {conDeuda.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-10 flex flex-col items-center text-gray-400 dark:text-gray-500">
          <CheckCircle size={36} className="mb-3 opacity-30" />
          <p className="font-medium text-sm">No hay cuentas corrientes pendientes</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 divide-y divide-gray-50 dark:divide-gray-700">
          {conDeuda.map(c => (
            <div key={c.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-gray-800 dark:text-gray-100">{c.nombre}</p>
                    {c.vencida && <span className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-2 py-0.5 rounded-full font-semibold">Vencida</span>}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {c.count} venta{c.count !== 1 ? 's' : ''} pendiente{c.count !== 1 ? 's' : ''}
                    {c.interes > 0.5 && <span className="text-red-500 dark:text-red-400"> · Interés mora {formatMoneda(c.interes)}</span>}
                  </p>
                </div>
                <p className={`text-lg font-bold ${c.vencida ? 'text-red-600 dark:text-red-400' : 'text-gray-800 dark:text-gray-100'}`}>{formatMoneda(c.total)}</p>
                <div className="flex items-center gap-2">
                  {c.telefono && (
                    <a href={buildWhatsAppUrl(c.telefono, `Hola ${c.nombre}! Te recordamos que tenés un saldo pendiente de ${formatMoneda(c.total)} en cuenta corriente. Por favor coordiná el pago. Gracias!`)}
                      target="_blank" rel="noreferrer"
                      className="flex items-center gap-1.5 text-xs bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg transition-colors">
                      <MessageCircle size={12} /> WhatsApp
                    </a>
                  )}
                  <button onClick={() => { setCobrarId(cobrarId === c.id ? null : c.id); setMonto(String(Math.round(c.total))); setMetodo('Efectivo') }}
                    className="flex items-center gap-1.5 text-xs bg-accent hover:bg-accent/90 text-white px-3 py-1.5 rounded-lg transition-colors">
                    <DollarSign size={12} /> Cobrar
                  </button>
                </div>
              </div>
              {cobrarId === c.id && (
                <div className="mt-3 flex items-end gap-2 flex-wrap bg-gray-50 dark:bg-gray-700/40 rounded-xl p-3">
                  <div className="flex-1 min-w-[120px]">
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Monto</label>
                    <input type="number" min="0" onWheel={e => e.currentTarget.blur()} value={monto}
                      onChange={e => setMonto(e.target.value)}
                      className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent" />
                  </div>
                  <div className="flex-1 min-w-[120px]">
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Medio de pago</label>
                    <select value={metodo} onChange={e => setMetodo(e.target.value)}
                      className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-800">
                      {['Efectivo', 'Transferencia', 'Débito', 'Crédito', 'MercadoPago', 'Otro'].map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <button onClick={() => cobrar(c.id)} disabled={saving}
                    className="bg-accent hover:bg-accent/90 text-white font-semibold px-4 py-2 rounded-lg text-sm disabled:opacity-50">
                    {saving ? '...' : 'Registrar'}
                  </button>
                  <button onClick={() => setCobrarId(null)} className="text-gray-400 hover:text-gray-600 p-2"><X size={16} /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">
        <CreditCard size={12} /> La cobranza salda las ventas CC más antiguas primero (FIFO). El detalle por venta está en la ficha del cliente.
      </p>
    </div>
  )
}
