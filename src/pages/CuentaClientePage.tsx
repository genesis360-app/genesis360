import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { formatMoneda as formatMonedaLib } from '@/lib/formato'
import { generarEstadoCuentaPDF } from '@/lib/estadoCuentaPDF'
import { FileText, CreditCard, AlertTriangle } from 'lucide-react'

/**
 * B8 — Portal público de estado de cuenta (sin login, por token).
 * Ruta: /cuenta/:token → RPC get_cuenta_cliente_by_token (SECURITY DEFINER, anon).
 */
export default function CuentaClientePage() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!token) return
    supabase.rpc('get_cuenta_cliente_by_token', { p_token: token })
      .then(({ data, error }) => {
        if (error || !data) { setError(true) }
        else setData(data)
        setLoading(false)
      })
  }, [token])

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Cargando…</div>
  if (error || !data) return (
    <div className="min-h-screen flex flex-col items-center justify-center text-gray-500 p-6 text-center">
      <AlertTriangle size={40} className="mb-3 opacity-40" />
      <p className="font-medium">Link inválido o vencido</p>
      <p className="text-sm mt-1">Pedile al negocio que te comparta un link actualizado.</p>
    </div>
  )

  const moneda = data.moneda ?? 'ARS'
  const fmt = (n: number) => formatMonedaLib(n, moneda)
  const ventas: any[] = data.ventas ?? []
  const hoyISO = new Date().toISOString().slice(0, 10)
  const total = ventas.reduce((a, v) => a + (v.saldo ?? 0) + (v.interes ?? 0), 0)

  const descargar = () => generarEstadoCuentaPDF({
    negocio: data.negocio ?? 'Negocio',
    moneda,
    cliente: { nombre: data.cliente?.nombre ?? '', telefono: data.cliente?.telefono, email: data.cliente?.email },
    ventas: ventas.map(v => ({ numero: v.numero, fecha: v.fecha, saldo: v.saldo, interes: v.interes ?? 0, vencimiento: v.vencimiento })),
  })

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="bg-primary text-white px-6 py-5">
            <p className="text-sm opacity-80">{data.negocio}</p>
            <h1 className="text-xl font-bold mt-0.5">Estado de cuenta</h1>
            <p className="text-sm opacity-90 mt-1">{data.cliente?.nombre}</p>
          </div>

          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between bg-red-50 dark:bg-red-900/20 rounded-xl p-4">
              <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                <CreditCard size={18} /> <span className="font-medium">Total adeudado</span>
              </div>
              <span className="text-2xl font-bold text-red-600 dark:text-red-400">{fmt(total)}</span>
            </div>

            {ventas.length === 0 ? (
              <p className="text-center text-gray-400 py-6">No tenés deuda pendiente. ¡Gracias!</p>
            ) : (
              <div className="border border-gray-100 dark:border-gray-700 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-700/50 text-xs text-gray-500 dark:text-gray-400 uppercase">
                      <th className="px-3 py-2 text-left">Venta</th>
                      <th className="px-3 py-2 text-left">Vencimiento</th>
                      <th className="px-3 py-2 text-right">Saldo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                    {ventas.map((v, i) => {
                      const vencida = v.vencimiento && v.vencimiento < hoyISO
                      return (
                        <tr key={i}>
                          <td className="px-3 py-2 text-gray-700 dark:text-gray-300">#{v.numero}</td>
                          <td className="px-3 py-2">
                            {v.vencimiento
                              ? <span className={vencida ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-500 dark:text-gray-400'}>
                                  {new Date(v.vencimiento + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })}{vencida ? ' (vencida)' : ''}
                                </span>
                              : <span className="text-gray-400">—</span>}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-gray-800 dark:text-gray-100">{fmt((v.saldo ?? 0) + (v.interes ?? 0))}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <button onClick={descargar}
              className="w-full flex items-center justify-center gap-2 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 font-medium py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
              <FileText size={16} /> Descargar PDF
            </button>
            <p className="text-center text-xs text-gray-400">Ante cualquier consulta, contactá al negocio.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
