import {
  X, Search, Bug, MessageCircle, Youtube,
  ChevronDown, ChevronUp, Send,
} from 'lucide-react'
import { useState } from 'react'
import toast from 'react-hot-toast'

interface AyudaModalProps {
  isOpen: boolean
  onClose: () => void
  currentModule?: string
}

interface Faq { q: string; a: string }

const FAQS: Record<string, Faq[]> = {
  default: [
    { q: '¿Cómo creo mi primer producto?', a: 'Ve a Productos → Nuevo producto y completá los campos obligatorios: nombre, SKU y precio de venta.' },
    { q: '¿Cómo abro la caja?', a: 'Ve a Caja → Abrir caja. Ingresá el monto inicial y confirmá.' },
    { q: '¿Cómo registro una venta?', a: 'Ve a Ventas, buscá los productos, elegí el método de pago y hacé clic en Venta directa.' },
  ],
  '/ventas': [
    { q: '¿Cómo hago una reserva?', a: 'En el checkout seleccioná el modo "Reservar". Podés cobrar parcial o sin pago.' },
    { q: '¿Cómo despacho una reserva?', a: 'En historial, encontrá la venta reservada y hacé clic en "Finalizar".' },
    { q: '¿Cómo modifico una reserva?', a: 'En el modal de detalle de la reserva, usá el botón "Modificar productos".' },
  ],
  '/inventario': [
    { q: '¿Qué es un LPN?', a: 'Un LPN (License Plate Number) identifica un lote físico de mercadería en una ubicación específica.' },
    { q: '¿Cómo ingreso stock?', a: 'Tab Movimientos → Ingreso. Seleccioná el producto, cantidad, ubicación y confirmá.' },
    { q: '¿Cómo rebajo stock?', a: 'Tab Movimientos → Rebaje. El sistema aplica FIFO/FEFO según la configuración del SKU.' },
  ],
  '/productos': [
    { q: '¿Qué es el stock mínimo?', a: 'Es el umbral que activa alertas automáticas. Cuando el stock cae por debajo, el sistema te avisa.' },
    { q: '¿Cómo configuro regla de inventario?', a: 'En Producto → Atributos. Por defecto usa la regla del negocio (FIFO).' },
  ],
  '/caja': [
    { q: '¿Qué medios de pago afectan la caja?', a: 'Solo Efectivo. Tarjeta, transferencia y MP se registran como informativos sin afectar el saldo.' },
    { q: '¿Cómo cierro la caja?', a: 'En Caja → Cerrar caja. Ingresá el conteo real y confirmá.' },
  ],
  '/rrhh': [
    { q: '¿Cómo registro la asistencia?', a: 'Tab Asistencia → Nuevo registro. Elegí empleado, fecha y estado (presente/ausente/tardanza/licencia).' },
    { q: '¿Cómo liquido la nómina?', a: 'Tab Nómina → Generar nómina del mes → completá ítems → Pagar.' },
  ],
}

type ReportForm = {
  tipo: string
  urgencia: string
  asunto: string
  descripcion: string
}

export function AyudaModal({ isOpen, onClose, currentModule }: AyudaModalProps) {
  const [search, setSearch] = useState('')
  const [openFaq, setOpenFaq] = useState<number | null>(null)
  const [form, setForm] = useState<ReportForm>({ tipo: 'bug', urgencia: 'media', asunto: '', descripcion: '' })

  // FAQs del módulo actual o las default
  const moduleFaqs = FAQS[currentModule ?? ''] ?? FAQS.default
  const filteredFaqs: Faq[] = search
    ? Object.values(FAQS).flat().filter(f =>
        f.q.toLowerCase().includes(search.toLowerCase()) ||
        f.a.toLowerCase().includes(search.toLowerCase())
      )
    : moduleFaqs

  const handleSendReport = () => {
    if (!form.asunto.trim() || !form.descripcion.trim()) {
      toast.error('Completá asunto y descripción')
      return
    }
    const subject = encodeURIComponent(`[${form.tipo.toUpperCase()}][${form.urgencia}] ${form.asunto}`)
    const body = encodeURIComponent(`Descripción:\n${form.descripcion}\n\nMódulo: ${currentModule ?? 'N/A'}`)
    window.open(`mailto:soporte@genesis360.pro?subject=${subject}&body=${body}`, '_blank')
    toast.success('Abrimos tu cliente de correo para enviar el reporte.')
    setForm({ tipo: 'bug', urgencia: 'media', asunto: '', descripcion: '' })
  }

  if (!isOpen) return null

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/30 z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer desde la derecha */}
      <div
        className="fixed right-0 top-0 h-screen w-full sm:w-96 bg-surface border-l border-border-ds shadow-2xl z-50 flex flex-col"
        role="dialog"
        aria-label="Centro de Ayuda"
      >
        {/* Header del drawer */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-ds flex-shrink-0">
          <h2 className="font-semibold text-base text-primary dark:text-white">Centro de Ayuda</h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-primary dark:hover:text-white transition-colors p-1"
            title="Cerrar"
          >
            <X size={18} />
          </button>
        </div>

        {/* Contenido scrollable */}
        <div className="flex-1 overflow-y-auto">

          {/* Buscador */}
          <div className="px-4 py-3 border-b border-border-ds">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              <input
                value={search}
                onChange={e => { setSearch(e.target.value); setOpenFaq(null) }}
                placeholder="Buscar en preguntas frecuentes..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-border-ds rounded-xl bg-page focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          {/* FAQs */}
          <div className="px-4 py-4">
            <h3 className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-3">
              {search ? 'Resultados' : 'Preguntas frecuentes'}
            </h3>
            {filteredFaqs.length === 0 ? (
              <p className="text-sm text-muted text-center py-4">Sin resultados para "{search}"</p>
            ) : (
              <div className="space-y-1.5">
                {filteredFaqs.map((faq, i) => (
                  <div key={i} className="border border-border-ds rounded-xl overflow-hidden">
                    <button
                      onClick={() => setOpenFaq(openFaq === i ? null : i)}
                      className="w-full flex items-start justify-between gap-2 px-3 py-2.5 text-left text-sm font-medium text-primary dark:text-white hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    >
                      <span className="leading-snug">{faq.q}</span>
                      {openFaq === i
                        ? <ChevronUp size={14} className="flex-shrink-0 mt-0.5 text-muted" />
                        : <ChevronDown size={14} className="flex-shrink-0 mt-0.5 text-muted" />
                      }
                    </button>
                    {openFaq === i && (
                      <div className="px-3 pb-3">
                        <p className="text-sm text-muted leading-relaxed">{faq.a}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Cursos — placeholder */}
          <div className="px-4 py-3 border-t border-border-ds">
            <h3 className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Youtube size={12} /> Cursos y recursos
            </h3>
            <div className="bg-page rounded-xl p-4 text-center border border-border-ds">
              <p className="text-sm text-muted">Próximamente</p>
            </div>
          </div>

          {/* Reporte de problema */}
          <div className="px-4 py-4 border-t border-border-ds">
            <h3 className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Bug size={12} /> Reportar un problema
            </h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted block mb-1">Tipo</label>
                  <select
                    value={form.tipo}
                    onChange={e => setForm(p => ({ ...p, tipo: e.target.value }))}
                    className="w-full text-sm border border-border-ds rounded-xl px-3 py-2 focus:outline-none focus:border-accent bg-white dark:bg-gray-700"
                  >
                    <option value="bug">Bug</option>
                    <option value="sugerencia">Sugerencia</option>
                    <option value="otro">Otro</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted block mb-1">Urgencia</label>
                  <select
                    value={form.urgencia}
                    onChange={e => setForm(p => ({ ...p, urgencia: e.target.value }))}
                    className="w-full text-sm border border-border-ds rounded-xl px-3 py-2 focus:outline-none focus:border-accent bg-white dark:bg-gray-700"
                  >
                    <option value="baja">Baja</option>
                    <option value="media">Media</option>
                    <option value="alta">Alta</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">Asunto *</label>
                <input
                  value={form.asunto}
                  onChange={e => setForm(p => ({ ...p, asunto: e.target.value }))}
                  placeholder="Descripción breve del problema"
                  className="w-full text-sm border border-border-ds rounded-xl px-3 py-2 focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">Descripción *</label>
                <textarea
                  value={form.descripcion}
                  onChange={e => setForm(p => ({ ...p, descripcion: e.target.value }))}
                  rows={3}
                  placeholder="Describí el problema en detalle..."
                  className="w-full text-sm border border-border-ds rounded-xl px-3 py-2 focus:outline-none focus:border-accent resize-none"
                />
              </div>
              <button
                onClick={handleSendReport}
                className="w-full bg-accent hover:bg-accent/90 text-white text-sm font-medium py-2.5 rounded-xl flex items-center justify-center gap-2 transition-colors"
              >
                <Send size={14} />
                Enviar reporte
              </button>
            </div>
          </div>

          {/* Contacto */}
          <div className="px-4 py-4 border-t border-border-ds mb-2">
            <h3 className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <MessageCircle size={12} /> Contacto directo
            </h3>
            <p className="text-sm text-muted">
              Email:{' '}
              <a
                href="mailto:soporte@genesis360.pro"
                className="text-accent hover:underline"
              >
                soporte@genesis360.pro
              </a>
            </p>
          </div>

        </div>
      </div>
    </>
  )
}
