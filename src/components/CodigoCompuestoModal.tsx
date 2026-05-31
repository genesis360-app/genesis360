import { useEffect, useRef, useState } from 'react'
import bwipjs from 'bwip-js/browser'
import { ScanBarcode, Download, X, Printer } from 'lucide-react'
import { BRAND } from '../config/brand'
import { buildGS1ElementString, gtinCheckDigit, isValidGtin, type GS1Fields } from '../lib/gs1'

export interface Perfil {
  id: string
  nombre: string
  simbologia: 'gs1_128' | 'datamatrix'
  ais: string[]
}

interface Props {
  /** Datos del LPN/producto para codificar */
  fields: GS1Fields
  lpn: string
  productoNombre: string
  sku: string
  /** Perfiles disponibles; si vacío, usa un default GS1-128 con AIs núcleo */
  perfiles?: Perfil[]
  onClose: () => void
}

const PERFIL_DEFAULT: Perfil = { id: '__default', nombre: 'GS1-128 (núcleo)', simbologia: 'gs1_128', ais: ['01', '10', '17', '30'] }

export function CodigoCompuestoModal({ fields, lpn, productoNombre, sku, perfiles, onClose }: Props) {
  const opciones = perfiles && perfiles.length > 0 ? perfiles : [PERFIL_DEFAULT]
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [perfilId, setPerfilId] = useState(opciones[0].id)
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const perfil = opciones.find(p => p.id === perfilId) ?? opciones[0]
  const elementString = buildGS1ElementString(fields, perfil.ais)

  // GS1 exige un AI primario (01 GTIN). Validamos antes de llamar a bwip-js para
  // dar un mensaje accionable en vez del error críptico del linter (GS1missingAIs).
  function traducirError(e: any): string {
    const msg = String(e?.message ?? e ?? '')
    if (msg.includes('GS1missingAIs')) return 'El código GS1 necesita un GTIN (01). Cargá el código de barras/GTIN del producto e incluí "GTIN (01)" en el perfil.'
    if (msg.includes('GS1badChecksum') || msg.includes('checksum')) return 'El código de barras del producto no es un GTIN válido (dígito verificador incorrecto). Revisalo en el producto.'
    if (msg.includes('GS1')) return `Datos GS1 inválidos: ${msg.replace(/^bwipp\.\w+#\d+:\s*/, '')}`
    return msg ? `No se pudo generar: ${msg}` : 'No se pudo generar el código (revisá GTIN/datos).'
  }

  useEffect(() => {
    if (!canvasRef.current) return
    setError(null)
    setDataUrl(null)
    if (!elementString) { setError('No hay datos para codificar con este perfil.'); return }
    if (!elementString.includes('(01)')) {
      setError(perfil.ais.includes('01')
        ? 'El producto no tiene GTIN ni código de barras. Cargá uno en el producto para generar el código GS1.'
        : 'El perfil no incluye el GTIN (01). Agregalo en Config → Inventario → Códigos.')
      return
    }
    // Validar el dígito verificador del GTIN antes de bwip-js (mensaje accionable).
    const gtinDigits = (fields.gtin ?? '').replace(/\D/g, '')
    if (gtinDigits && !isValidGtin(gtinDigits)) {
      const correcto = gtinCheckDigit(gtinDigits.slice(0, -1))
      setError(`El código de barras "${gtinDigits}" no es un GTIN válido (dígito verificador). El correcto sería ${correcto} — corregilo en el producto (último dígito).`)
      return
    }
    try {
      bwipjs.toCanvas(canvasRef.current, {
        bcid: perfil.simbologia === 'datamatrix' ? 'gs1datamatrix' : 'gs1-128',
        text: elementString,
        scale: 3,
        height: perfil.simbologia === 'datamatrix' ? undefined : 12,
        includetext: true,
        textxalign: 'center',
        backgroundcolor: 'FFFFFF',
      } as any)
      setDataUrl(canvasRef.current.toDataURL('image/png'))
    } catch (e: any) {
      setError(traducirError(e))
    }
  }, [elementString, perfil.simbologia])

  const descargar = () => {
    if (!dataUrl) return
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `gs1-${lpn}.png`
    a.click()
  }

  const imprimir = () => {
    if (!dataUrl) return
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(`
      <html><head><title>Código ${lpn}</title>
      <style>
        body { font-family: sans-serif; display: flex; flex-direction: column;
               align-items: center; justify-content: center; min-height: 100vh;
               margin: 0; background: white; }
        img { max-width: 320px; }
        p { margin: 4px 0; text-align: center; }
        .lpn { font-size: 14px; font-weight: 700; color: ${BRAND.color.primary}; font-family: monospace; }
        .nombre { font-size: 12px; color: #374151; max-width: 320px; }
        .sku { font-size: 11px; color: #6b7280; font-family: monospace; }
      </style>
      </head><body>
        <img src="${dataUrl}" />
        <p class="lpn">${lpn}</p>
        <p class="nombre">${productoNombre}</p>
        <p class="sku">${sku}</p>
        <script>window.onload = () => { window.print(); window.close(); }<\/script>
      </body></html>
    `)
    win.document.close()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <ScanBarcode size={17} className="text-accent" />
            <span className="font-semibold text-sm text-gray-800 dark:text-gray-100">Código compuesto (GS1)</span>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
            <X size={17} className="text-gray-500" />
          </button>
        </div>

        <div className="p-5 flex flex-col items-center gap-3">
          {opciones.length > 1 && (
            <select value={perfilId} onChange={e => setPerfilId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 focus:outline-none focus:border-accent">
              {opciones.map(p => <option key={p.id} value={p.id}>{p.nombre} · {p.simbologia === 'datamatrix' ? 'DataMatrix' : 'GS1-128'}</option>)}
            </select>
          )}

          {error ? (
            <div className="w-full text-center text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg py-6 px-3">{error}</div>
          ) : (
            <canvas ref={canvasRef} className="rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm max-w-full" />
          )}

          <p className="text-[11px] text-gray-400 dark:text-gray-500 font-mono break-all text-center px-2">{elementString || '—'}</p>

          <div className="text-center">
            <p className="font-bold text-gray-900 dark:text-white font-mono text-sm">{lpn}</p>
            <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5">{productoNombre}</p>
          </div>
        </div>

        <div className="flex gap-2 px-4 pb-4">
          <button onClick={descargar} disabled={!dataUrl}
            className="flex-1 flex items-center justify-center gap-2 border border-gray-200 dark:border-gray-600 rounded-xl py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40">
            <Download size={15} /> Descargar
          </button>
          <button onClick={imprimir} disabled={!dataUrl}
            className="flex-1 flex items-center justify-center gap-2 bg-primary text-white rounded-xl py-2.5 text-sm font-medium hover:bg-accent disabled:opacity-40">
            <Printer size={15} /> Imprimir
          </button>
        </div>
      </div>
    </div>
  )
}
