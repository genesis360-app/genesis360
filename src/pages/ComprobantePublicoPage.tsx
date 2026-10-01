// Página pública de un comprobante compartido por WhatsApp (mig 451). Sin sesión: la base devuelve el comprobante solo
// por su código (128 bits, vence a los 90 días). Muestra el resumen y regenera el PDF desde la foto de datos.
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Download, FileText, AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { BRAND } from '@/config/brand'
import type { FacturaPDFData } from '@/lib/facturasPDF'
import type { TicketCompartidoData } from '@/lib/ticketPDF'

type Respuesta = { tipo: 'ticket' | 'factura' | 'nc'; datos: any; negocio: string; vence_at: string }

const $ = (n: number) => `$${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function ComprobantePublicoPage() {
  const { token } = useParams<{ token: string }>()
  const [estado, setEstado] = useState<'cargando' | 'no_encontrado' | 'ok'>('cargando')
  const [c, setC] = useState<Respuesta | null>(null)
  const [generando, setGenerando] = useState(false)

  // El código del link es la llave: que no lo indexe un buscador ni viaje en el Referer a otros sitios.
  useEffect(() => {
    const metas = [['robots', 'noindex, nofollow'], ['referrer', 'no-referrer']].map(([name, content]) => {
      const m = document.createElement('meta'); m.name = name; m.content = content
      document.head.appendChild(m); return m
    })
    return () => metas.forEach(m => m.remove())
  }, [])

  useEffect(() => {
    supabase.rpc('fn_comprobante_compartido', { p_token: token ?? '' }).then(({ data, error }) => {
      if (error || !data) { setEstado('no_encontrado'); return }
      setC(data as Respuesta); setEstado('ok')
    })
  }, [token])

  const descargar = async () => {
    if (!c) return
    setGenerando(true)
    try {
      if (c.tipo === 'ticket') {
        const { construirTicketPDF } = await import('@/lib/ticketPDF')
        const d = c.datos as TicketCompartidoData
        construirTicketPDF(d).save(`Ticket_${d.etiqueta.replace(/[^\w-]+/g, '_')}.pdf`)
      } else {
        const { generarFacturaPDF } = await import('@/lib/facturasPDF')
        await generarFacturaPDF(c.datos as FacturaPDFData, 'descargar')
      }
    } finally { setGenerando(false) }
  }

  if (estado === 'cargando') {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500">Cargando comprobante…</div>
  }
  if (estado === 'no_encontrado' || !c) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="max-w-sm text-center bg-white rounded-2xl shadow p-8">
          <AlertTriangle className="mx-auto text-amber-500 mb-3" size={32} />
          <p className="font-semibold text-gray-800">Este link no está disponible</p>
          <p className="text-sm text-gray-500 mt-1">Puede haber vencido. Pedile al comercio que te lo vuelva a enviar.</p>
        </div>
      </div>
    )
  }

  const titulo = c.tipo === 'ticket' ? 'Comprobante de compra' : c.tipo === 'factura' ? 'Factura' : 'Nota de crédito'
  const d = c.datos
  const fiscal = c.tipo !== 'ticket' ? (d as FacturaPDFData) : null
  const items: { nombre: string; cantidad: number; subtotal: number }[] = c.tipo === 'ticket'
    ? (d as TicketCompartidoData).items
    : ((d as any).items ?? []).map((i: any) => ({ nombre: i.descripcion ?? i.nombre ?? '', cantidad: Number(i.cantidad) || 0, subtotal: Number(i.subtotal) || 0 }))
  const total = c.tipo === 'ticket' ? (d as TicketCompartidoData).total : Number((d as any).total) || 0

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-md mx-auto bg-white rounded-2xl shadow p-6 space-y-4">
        <div className="text-center">
          <p className="text-xs uppercase tracking-wide text-gray-400">{titulo}</p>
          <h1 className="text-xl font-bold text-gray-900">{c.negocio}</h1>
          {c.tipo === 'ticket'
            ? <p className="text-sm text-gray-500">{(d as TicketCompartidoData).etiqueta} · {new Date((d as TicketCompartidoData).fecha).toLocaleDateString('es-AR')}</p>
            : <p className="text-sm text-gray-500">{(d as any).tipo_comprobante} {String((d as any).punto_venta ?? '').padStart(4, '0')}-{String((d as any).numero_comprobante ?? '').padStart(8, '0')}</p>}
          {fiscal && (fiscal as any).cae && <p className="text-xs text-gray-400 mt-1">CAE {(fiscal as any).cae}</p>}
        </div>

        {items.length > 0 && (
          <ul className="divide-y divide-gray-100 text-sm">
            {items.map((it, i) => (
              <li key={i} className="flex justify-between gap-3 py-1.5">
                <span className="text-gray-700">{it.cantidad} × {it.nombre}</span>
                <span className="text-gray-900 whitespace-nowrap">{$(it.subtotal)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-between items-center border-t border-gray-200 pt-3">
          <span className="font-semibold text-gray-700">Total</span>
          <span className="text-lg font-bold text-gray-900">{$(total)}</span>
        </div>

        <button onClick={descargar} disabled={generando}
          className="w-full flex items-center justify-center gap-2 bg-gray-900 hover:bg-gray-800 text-white font-medium py-3 rounded-xl disabled:opacity-60">
          {generando ? 'Generando…' : <><Download size={16} /> Descargar PDF</>}
        </button>
        <p className="text-[11px] text-center text-gray-400 flex items-center justify-center gap-1">
          <FileText size={11} /> Disponible hasta el {new Date(c.vence_at).toLocaleDateString('es-AR')} · {BRAND.name}
        </p>
      </div>
    </div>
  )
}
