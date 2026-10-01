// Vista previa + resultado estándar de los importadores (D3-a, Fede/GO 2026-09-30 y 2026-10-01).
//
// Paso 1: TODAS las filas con su número de Excel y el motivo de cada error; "ver solo errores"; "bajar las filas con
// error" (Excel con el motivo, para corregir y volver a subir). Paso 2: botón aparte para cargar, que NO aparece
// mientras haya un solo error — la carga es todo o nada y el archivo se corrige y se re-sube (GO, D3-a).
import { useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle, Download, Upload, XCircle } from 'lucide-react'
import { filaExcel } from '@/lib/importacion'

export type EstadoFilaImport = 'nuevo' | 'existente' | 'omitida' | 'error'

export interface FilaVistaPrevia {
  idx: number
  estado: EstadoFilaImport
  errores: string[]
  /** Un valor por cada columna de `columnas`. */
  celdas: ReactNode[]
  /** Texto del estado cuando no es error (p. ej. "Se ignora: ya existe"). */
  detalle?: string
}

const ESTILO: Record<EstadoFilaImport, { fila: string; chip: string; texto: string }> = {
  nuevo:     { fila: '', chip: 'text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30', texto: 'Nuevo' },
  existente: { fila: 'bg-blue-50/60 dark:bg-blue-900/10', chip: 'text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/30', texto: 'Actualiza' },
  omitida:   { fila: 'opacity-60', chip: 'text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700', texto: 'Se ignora' },
  error:     { fila: 'bg-red-50 dark:bg-red-900/20', chip: 'text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/30', texto: 'Error' },
}

interface Props {
  columnas: string[]
  filas: FilaVistaPrevia[]
  entidadPlural: string            // "clientes", "productos"…
  cargando: boolean
  onCargar: () => void
  onBajarErrores: () => void
  /** Opciones propias del importador (p. ej. qué hacer con los que ya existen). */
  opciones?: ReactNode
}

export function VistaPreviaImportacion({ columnas, filas, entidadPlural, cargando, onCargar, onBajarErrores, opciones }: Props) {
  const [soloErrores, setSoloErrores] = useState(false)
  const n = (e: EstadoFilaImport) => filas.filter(f => f.estado === e).length
  const errores = n('error')
  const aCargar = n('nuevo') + n('existente')
  const visibles = soloErrores ? filas.filter(f => f.estado === 'error') : filas

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 text-sm flex-wrap">
        <span className="text-green-700 dark:text-green-400 font-medium">{n('nuevo')} nuevos</span>
        {n('existente') > 0 && <span className="text-blue-700 dark:text-blue-300 font-medium">{n('existente')} se actualizan</span>}
        {n('omitida') > 0 && <span className="text-gray-500 dark:text-gray-400 font-medium">{n('omitida')} se ignoran</span>}
        {errores > 0 && <span className="text-red-600 dark:text-red-400 font-medium flex items-center gap-1"><XCircle size={14} /> {errores} con error</span>}
      </div>

      {opciones}

      {errores > 0 && (
        <div className="flex items-center justify-between gap-2 text-xs flex-wrap">
          <label className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300 cursor-pointer">
            <input type="checkbox" checked={soloErrores} onChange={e => setSoloErroresSeguro(e.target.checked)} />
            Ver solo las filas con error
          </label>
          <button onClick={onBajarErrores} className="flex items-center gap-1 text-accent-text hover:underline">
            <Download size={12} /> Bajar las {errores} filas con error (Excel, con el motivo)
          </button>
        </div>
      )}

      <div className="border border-gray-100 dark:border-gray-700 rounded-xl overflow-auto max-h-[50vh]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-50 dark:bg-gray-700">
            <tr className="text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              <th className="px-3 py-2 text-left">Fila</th>
              {columnas.map(c => <th key={c} className="px-3 py-2 text-left">{c}</th>)}
              <th className="px-3 py-2 text-left">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
            {visibles.map(f => (
              <tr key={f.idx} className={ESTILO[f.estado].fila}>
                <td className="px-3 py-2 text-gray-400">{filaExcel(f.idx)}</td>
                {f.celdas.map((c, i) => (
                  <td key={i} className="px-3 py-2 text-gray-700 dark:text-gray-200 whitespace-nowrap max-w-[14rem] truncate">{c ?? '—'}</td>
                ))}
                <td className="px-3 py-2">
                  <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${ESTILO[f.estado].chip}`}>{ESTILO[f.estado].texto}</span>
                  {f.estado === 'error'
                    ? <span className="block text-red-600 dark:text-red-400 mt-0.5">{f.errores.join(' · ')}</span>
                    : f.detalle && <span className="block text-gray-500 dark:text-gray-400 mt-0.5">{f.detalle}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {errores > 0 ? (
        <div className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <p>
            <strong>{errores === 1 ? 'Hay 1 fila con error' : `Hay ${errores} filas con error`}.</strong>{' '}
            No se carga nada hasta que el archivo esté limpio: corregilo y volvé a subirlo
            {' '}(arriba podés bajar solo las filas con error, con el motivo).
          </p>
        </div>
      ) : (
        <button onClick={onCargar} disabled={cargando || aCargar === 0}
          className="w-full bg-accent hover:bg-accent/90 text-white font-semibold py-3 rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2">
          {cargando
            ? <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> Cargando...</>
            : <><Upload size={16} /> Cargar {aCargar} {entidadPlural}</>}
        </button>
      )}
    </div>
  )

  function setSoloErroresSeguro(v: boolean) { setSoloErrores(v) }
}

/** Resultado de la carga: o se cargó todo, o no se cargó nada (con el motivo). */
export type ResultadoCarga = { ok: true; resumen: string } | { ok: false; mensaje: string }

export function ResultadoImportacion({ resultado, accion }: { resultado: ResultadoCarga; accion?: ReactNode }) {
  if (resultado.ok) {
    return (
      <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 rounded-xl p-4 flex items-start gap-3">
        <CheckCircle size={20} className="text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
        <div>
          <p className="font-semibold text-green-800 dark:text-green-400">Importación completada</p>
          <p className="text-sm text-green-700 dark:text-green-400 mt-0.5">{resultado.resumen}</p>
          {accion}
        </div>
      </div>
    )
  }
  return (
    <div role="alert" className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 flex items-start gap-3">
      <XCircle size={20} className="text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
      <div>
        <p className="font-semibold text-red-800 dark:text-red-300">No se cargó nada</p>
        <p className="text-sm text-red-700 dark:text-red-300 mt-0.5">{resultado.mensaje.replace(/^No se cargó nada\.\s*/, '')}</p>
        <p className="text-xs text-red-600/80 dark:text-red-400/80 mt-1">La importación es todo o nada: corregí el archivo y volvé a subirlo.</p>
      </div>
    </div>
  )
}
