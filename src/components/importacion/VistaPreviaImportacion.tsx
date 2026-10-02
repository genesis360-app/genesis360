// Vista previa + resultado estándar de los importadores (D3-a, Fede/GO 2026-09-30 y 2026-10-01).
//
// Paso 1: TODAS las filas con su número de Excel y el motivo de cada error; "ver solo errores"; "bajar las filas con
// error" (Excel con el motivo, para corregir y volver a subir). Paso 2: botón aparte para cargar, que NO aparece
// mientras haya un solo error — la carga es todo o nada y el archivo se corrige y se re-sube (GO, D3-a).
import { useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle, Download, MinusCircle, RefreshCw, Upload, XCircle } from 'lucide-react'
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

// Mismo diseño que la vista previa de "Importar productos" (referencia de GO, 2026-10-01): contadores grandes arriba,
// tabla de borde a borde con el estado con ícono, y franja gris al pie con el botón de carga.
const ESTADO: Record<EstadoFilaImport, { fila: string; celda: ReactNode }> = {
  nuevo:     { fila: '', celda: <span className="flex items-center gap-1 text-green-600 dark:text-green-400"><CheckCircle size={12} /> Nuevo</span> },
  existente: { fila: 'bg-blue-50 dark:bg-blue-900/20', celda: <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400"><RefreshCw size={12} /> Existe</span> },
  omitida:   { fila: 'opacity-60', celda: <span className="flex items-center gap-1 text-gray-500 dark:text-gray-400"><MinusCircle size={12} /> Se ignora</span> },
  error:     { fila: 'bg-red-50 dark:bg-red-900/20', celda: <span className="flex items-center gap-1 text-red-500"><XCircle size={12} /> Error</span> },
}

interface Props {
  columnas: string[]
  filas: FilaVistaPrevia[]
  entidadPlural: string            // "clientes", "productos"…
  cargando: boolean
  onCargar: () => void
  onBajarErrores: () => void
  /** Opciones propias del importador dentro de la tarjeta (si no van en la columna izquierda). */
  opciones?: ReactNode
  /** Cuántas entidades se cargan, si no es una por fila (combos/perfiles del Maestro: varias filas = uno). */
  totalACargar?: number
}

export function VistaPreviaImportacion({ columnas, filas, entidadPlural, cargando, onCargar, onBajarErrores, opciones, totalACargar }: Props) {
  const [soloErrores, setSoloErrores] = useState(false)
  const n = (e: EstadoFilaImport) => filas.filter(f => f.estado === e).length
  const errores = n('error')
  const aCargar = totalACargar ?? n('nuevo') + n('existente')
  const visibles = soloErrores ? filas.filter(f => f.estado === 'error') : filas
  const th = 'text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-400 whitespace-nowrap'

  return (
    <div>
      <div className="grid grid-cols-3 divide-x divide-gray-100 dark:divide-gray-700 border-b border-gray-100 dark:border-gray-700">
        <div className="px-4 py-3 text-center"><p className="text-2xl font-bold text-green-600 dark:text-green-400">{n('nuevo')}</p><p className="text-xs text-gray-500 dark:text-gray-400">Nuevos</p></div>
        <div className="px-4 py-3 text-center"><p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{n('existente') + n('omitida')}</p><p className="text-xs text-gray-500 dark:text-gray-400">Existentes{n('omitida') > 0 ? ` (${n('omitida')} se ignoran)` : ''}</p></div>
        <div className="px-4 py-3 text-center"><p className="text-2xl font-bold text-red-500">{errores}</p><p className="text-xs text-gray-500 dark:text-gray-400">Con errores</p></div>
      </div>

      {opciones && <div className="p-4 border-b border-gray-100 dark:border-gray-700">{opciones}</div>}

      {errores > 0 && (
        <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-gray-100 dark:border-gray-700 text-xs flex-wrap">
          <label className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300 cursor-pointer">
            <input type="checkbox" checked={soloErrores} onChange={e => setSoloErrores(e.target.checked)} />
            Ver solo las filas con error
          </label>
          <button onClick={onBajarErrores} className="flex items-center gap-1 text-accent-text hover:underline">
            <Download size={12} /> Bajar las {errores} filas con error (Excel, con el motivo)
          </button>
        </div>
      )}

      <div className="overflow-x-auto max-h-96">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-50 dark:bg-gray-700">
            <tr className="border-b border-gray-100 dark:border-gray-700">
              <th className={th}>Fila</th>
              <th className={th}>Estado</th>
              {columnas.map(c => <th key={c} className={th}>{c}</th>)}
              <th className={th}>Errores</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map(f => (
              <tr key={f.idx} className={`border-b border-gray-50 dark:border-gray-700/50 ${ESTADO[f.estado].fila}`}>
                <td className="px-3 py-2 text-gray-400">{filaExcel(f.idx)}</td>
                <td className="px-3 py-2">
                  {ESTADO[f.estado].celda}
                  {f.estado !== 'error' && f.detalle && <span className="block text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 max-w-[14rem]">{f.detalle}</span>}
                </td>
                {f.celdas.map((c, i) => (
                  <td key={i} title={typeof c === 'string' || typeof c === 'number' ? String(c) : undefined}
                    className={`px-3 py-2 whitespace-nowrap max-w-[9rem] truncate ${i === 0 ? 'font-medium text-gray-800 dark:text-gray-100' : 'text-gray-600 dark:text-gray-400'}`}>{c ?? '—'}</td>
                ))}
                <td className="px-3 py-2 text-red-500 min-w-[8rem] break-words">{f.errores.join(', ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="p-4 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700">
        {errores > 0 ? (
          // D3-a: con una sola fila con error no se carga nada. Se corrige el ARCHIVO y se vuelve a subir.
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
    </div>
  )
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
