import { useEffect, useState } from 'react'
import { CalendarClock, X } from 'lucide-react'
import { fmtPesos } from '@/lib/formato'
import { formatearVigencia, validarVigencia, vigenciaSugerida } from '@/lib/precioProgramado'

export type EleccionVigencia = { modo: 'ahora' } | { modo: 'programar'; vigenteDesde: Date }

interface Props {
  abierto: boolean
  precioActual: number
  precioNuevo: number
  /** Cambio que ya estaba programado para este producto (A2: programar otro lo reemplaza). */
  pendiente?: { precio_venta: number | string; vigente_desde: string } | null
  guardando?: boolean
  onVolver: () => void
  onConfirmar: (eleccion: EleccionVigencia) => void
}

/**
 * Precio de venta con fecha/hora de vigencia (relevamiento de Fede, respondido por GO el 2026-09-14).
 * Aparece al guardar un producto cuando cambió el precio de venta. "Ahora" es la opción por defecto (A4):
 * el día a día no se vuelve más lento. Si se programa, el precio actual sigue rigiendo y el servidor aplica
 * el nuevo a la hora elegida (mig 422).
 */
export function PrecioVigenciaModal({ abierto, precioActual, precioNuevo, pendiente, guardando, onVolver, onConfirmar }: Props) {
  const [modo, setModo] = useState<'ahora' | 'programar'>('ahora')
  const [fecha, setFecha] = useState('')
  const [hora, setHora] = useState('')

  useEffect(() => {
    if (!abierto) return
    const sugerida = vigenciaSugerida()
    setModo('ahora')
    setFecha(sugerida.fecha)
    setHora(sugerida.hora)
  }, [abierto])

  if (!abierto) return null

  const validacion = modo === 'programar' ? validarVigencia(fecha, hora) : null
  const puedeConfirmar = !guardando && (modo === 'ahora' || validacion?.ok === true)

  const confirmar = () => {
    if (!puedeConfirmar) return
    if (modo === 'ahora') onConfirmar({ modo: 'ahora' })
    else if (validacion?.ok) onConfirmar({ modo: 'programar', vigenteDesde: validacion.vigenteDesde })
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onKeyDown={e => { if (e.key === 'Escape') onVolver(); if (e.key === 'Enter') { e.preventDefault(); confirmar() } }}>
      <div role="dialog" aria-modal="true" aria-labelledby="precio-vigencia-titulo"
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h2 id="precio-vigencia-titulo" className="font-semibold text-primary flex items-center gap-2">
            <CalendarClock size={18} /> ¿Desde cuándo rige el nuevo precio?
          </h2>
          <button type="button" onClick={onVolver} aria-label="Volver"
            className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Precio de venta: <span className="line-through text-gray-400">{fmtPesos(precioActual)}</span>
            {' → '}<strong>{fmtPesos(precioNuevo)}</strong>
          </p>

          {pendiente && (
            <div className="text-xs rounded-xl px-3 py-2 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300">
              Ya hay un cambio programado a <strong>{fmtPesos(Number(pendiente.precio_venta))}</strong> para el{' '}
              <strong>{formatearVigencia(pendiente.vigente_desde)}</strong>. Si programás otro, lo reemplaza; si
              elegís "Ahora", ese cambio sigue en pie.
            </div>
          )}

          <div className="space-y-2">
            <label className="flex items-start gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded-xl cursor-pointer">
              <input type="radio" name="vigenciaPrecio" checked={modo === 'ahora'} onChange={() => setModo('ahora')} className="mt-0.5 accent-accent" />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                <strong>Ahora</strong>
                <span className="block text-xs text-gray-500 dark:text-gray-400">El precio nuevo rige desde que guardás.</span>
              </span>
            </label>
            <label className="flex items-start gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded-xl cursor-pointer">
              <input type="radio" name="vigenciaPrecio" checked={modo === 'programar'} onChange={() => setModo('programar')} className="mt-0.5 accent-accent" />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                <strong>Programar fecha y hora</strong>
                <span className="block text-xs text-gray-500 dark:text-gray-400">
                  Hasta esa hora sigue rigiendo el precio actual. A esa hora se actualizan solos el POS, la tarea
                  del repositor y Mercado Libre / Tienda Nube.
                </span>
              </span>
            </label>
          </div>

          {modo === 'programar' && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} aria-label="Fecha de vigencia"
                  className="flex-1 min-w-[9rem] px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm dark:bg-gray-700 dark:text-white" />
                <input type="time" value={hora} onChange={e => setHora(e.target.value)} aria-label="Hora de vigencia"
                  className="w-32 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm dark:bg-gray-700 dark:text-white" />
              </div>
              {validacion && !validacion.ok && (
                <p className="text-xs text-red-600 dark:text-red-400">{validacion.error}</p>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-gray-100 dark:border-gray-700">
          <button type="button" onClick={onVolver}
            className="flex-1 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50">
            Volver
          </button>
          <button type="button" onClick={confirmar} disabled={!puedeConfirmar}
            className="flex-1 py-2.5 bg-accent hover:bg-accent/90 text-white rounded-xl text-sm font-semibold disabled:opacity-60">
            {guardando ? 'Guardando…' : modo === 'ahora' ? 'Guardar' : 'Guardar y programar'}
          </button>
        </div>
      </div>
    </div>
  )
}
