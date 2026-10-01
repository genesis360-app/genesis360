// Vista previa de los datos de ARCA al cargar un CUIT (ficha de cliente, proveedor, emisor fiscal, alta rápida POS).
//
// Decisión de GO (2026-10-01): la consulta es AUTOMÁTICA al completar un CUIT válido, pero nada se escribe solo —
// se muestra qué cambiaría y la persona elige qué usar. Un campo que ya tiene valor propio (p. ej. el nombre con el
// que el negocio conoce al cliente) no se preselecciona.
//
// Al abrir una ficha que YA tenía CUIT no se consulta sola (sería un viaje a ARCA cada vez que se abre); queda el
// botón "Consultar en ARCA".
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Search, X } from 'lucide-react'
import { consultarCuitArca, cuitValido, normalizarCuit, type PersonaPadron, type RespuestaPadron } from '@/lib/padronArca'

export interface CampoPadron {
  key: string
  label: string
  /** Valor actual del formulario. */
  actual: string
  /** Cómo mostrar el valor actual (p. ej. la etiqueta de la condición IVA). */
  actualTexto?: string
  /** Valor que se escribiría (ya traducido al vocabulario de la ficha). `null` = ARCA no lo informa. */
  nuevo: string | null
  /** Cómo mostrar el valor nuevo (p. ej. la etiqueta de la condición IVA). */
  nuevoTexto?: string
  /** Texto cuando `nuevo` es null. */
  sinDato?: string
  /** No preseleccionar si el formulario ya tiene un valor propio. */
  conservarSiHayValor?: boolean
}

interface Props {
  cuit: string
  armarCampos: (p: PersonaPadron) => CampoPadron[]
  onAplicar: (valores: Record<string, string>) => void
  /** Advertencia propia de la ficha (p. ej. un emisor que no está inscripto en IVA ni en monotributo). */
  advertencia?: (p: PersonaPadron) => string | null
}

type Estado =
  | { tipo: 'nada' }
  | { tipo: 'cargando' }
  | { tipo: 'listo'; cuit: string; r: RespuestaPadron }

export function PadronArcaSugerencia({ cuit, armarCampos, onAplicar, advertencia }: Props) {
  const normalizado = normalizarCuit(cuit)
  const valido = cuitValido(normalizado)
  const inicial = useRef(normalizado)
  const pedido = useRef(0)
  const [estado, setEstado] = useState<Estado>({ tipo: 'nada' })
  const [cerradoPara, setCerradoPara] = useState<string | null>(null)
  const [elegidos, setElegidos] = useState<Record<string, boolean>>({})

  const consultar = async (c: string) => {
    const id = ++pedido.current
    setEstado({ tipo: 'cargando' })
    setCerradoPara(null)
    const r = await consultarCuitArca(c)
    if (id !== pedido.current) return   // llegó tarde: el CUIT ya cambió
    setEstado({ tipo: 'listo', cuit: c, r })
    setElegidos({})
  }

  // Automática solo cuando el CUIT cambia respecto del que tenía la ficha al abrirse.
  useEffect(() => {
    if (!valido || normalizado === inicial.current) {
      pedido.current++
      setEstado({ tipo: 'nada' })
      return
    }
    const t = setTimeout(() => { void consultar(normalizado) }, 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `consultar` es estable en la práctica; dispara solo el CUIT
  }, [normalizado, valido])

  if (!valido) return null

  if (estado.tipo === 'nada' || cerradoPara === normalizado) {
    return (
      <button type="button" onClick={() => void consultar(normalizado)}
        className="mt-1 inline-flex items-center gap-1 text-xs text-accent-text hover:underline">
        <Search size={12} /> Consultar en ARCA
      </button>
    )
  }

  if (estado.tipo === 'cargando') {
    return (
      <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        <Loader2 size={12} className="animate-spin" /> Consultando ARCA…
      </p>
    )
  }

  if (estado.cuit !== normalizado) return null
  const { r } = estado
  const cerrar = () => setCerradoPara(normalizado)

  if (!r.ok) {
    const texto = r.motivo === 'no_existe' ? 'ARCA no tiene registrado ese CUIT.' : r.mensaje
    return (
      <div className="mt-2 flex items-start gap-2 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <span className="flex-1">{texto}</span>
        <button type="button" onClick={cerrar} aria-label="Cerrar" className="shrink-0"><X size={14} /></button>
      </div>
    )
  }

  const p = r.persona
  const campos = armarCampos(p)
  const cambian = campos.filter((c) => c.nuevo != null && c.nuevo !== c.actual)
  const marcado = (c: CampoPadron) => elegidos[c.key] ?? !(c.conservarSiHayValor && c.actual.trim())
  const aviso = advertencia?.(p) ?? null

  const aplicar = () => {
    const valores: Record<string, string> = {}
    for (const c of cambian) if (marcado(c) && c.nuevo != null) valores[c.key] = c.nuevo
    onAplicar(valores)
    cerrar()
  }

  return (
    <div role="region" aria-label="Datos en ARCA" className="mt-2 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-900/20 px-3 py-2.5 text-xs text-gray-700 dark:text-gray-200">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="font-semibold text-blue-700 dark:text-blue-300">Datos en ARCA</span>
        {r.ambiente === 'homologacion' && (
          <span className="rounded bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">padrón de prueba</span>
        )}
        <button type="button" onClick={cerrar} aria-label="Cerrar" className="ml-auto text-gray-400 hover:text-gray-600"><X size={14} /></button>
      </div>

      {!p.activa && (
        <p className="mb-1.5 flex items-start gap-1.5 text-amber-700 dark:text-amber-300">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          {p.estadoClave ? `El CUIT figura ${p.estadoClave.toLowerCase()} en ARCA.` : 'ARCA no informa el CUIT como activo.'}
        </p>
      )}
      {aviso && (
        <p className="mb-1.5 flex items-start gap-1.5 text-amber-700 dark:text-amber-300">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />{aviso}
        </p>
      )}

      <ul className="space-y-1">
        {campos.map((c) => {
          const cambia = c.nuevo != null && c.nuevo !== c.actual
          return (
            <li key={c.key} className="flex items-start gap-2">
              {cambia ? (
                <input type="checkbox" className="mt-0.5" checked={marcado(c)}
                  onChange={(e) => setElegidos((s) => ({ ...s, [c.key]: e.target.checked }))} />
              ) : (
                <span className="mt-0.5 w-[13px] shrink-0">{c.nuevo != null && <CheckCircle2 size={13} className="text-green-600" />}</span>
              )}
              <span className="w-28 shrink-0 text-gray-500 dark:text-gray-400">{c.label}</span>
              <span className="flex-1">
                {c.nuevo == null
                  ? <span className="italic text-gray-500 dark:text-gray-400">{c.sinDato ?? 'ARCA no lo informa'}</span>
                  : <>
                      <span className="font-medium">{c.nuevoTexto ?? c.nuevo}</span>
                      {cambia && c.actual.trim() && <span className="block text-[11px] text-gray-400 line-through">{c.actualTexto ?? c.actual}</span>}
                    </>}
              </span>
            </li>
          )
        })}
      </ul>

      {p.avisos.length > 0 && (
        <ul className="mt-1.5 list-disc pl-4 text-[11px] text-gray-500 dark:text-gray-400">
          {p.avisos.map((a) => <li key={a}>ARCA: {a}</li>)}
        </ul>
      )}

      <div className="mt-2 flex items-center gap-2">
        {cambian.length > 0 ? (
          <>
            <button type="button" onClick={aplicar} disabled={!cambian.some(marcado)}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
              Usar los datos marcados
            </button>
            <button type="button" onClick={cerrar} className="px-2 py-1.5 text-xs text-gray-500 hover:underline">Descartar</button>
          </>
        ) : (
          <span className="text-green-700 dark:text-green-400">Los datos de la ficha coinciden con ARCA.</span>
        )}
      </div>
    </div>
  )
}
