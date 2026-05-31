import { useEffect, useState } from 'react'
import bwipjs from 'bwip-js/browser'
import { ScanBarcode, Printer, X, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { BRAND } from '../config/brand'
import { buildGS1ElementString, isValidGtin, type GS1Fields } from '../lib/gs1'

interface LineaEtiqueta {
  lpn: string
  cantidad: number
  producto_id: string
  nro_lote?: string | null
  fecha_vencimiento?: string | null
}

interface Props {
  lineas: LineaEtiqueta[]
  tenantId: string
  onClose: () => void
}

interface Etiqueta { lpn: string; nombre: string; dataUrl: string | null; error?: string }

export function CodigoMasivoModal({ lineas, tenantId, onClose }: Props) {
  const [cargando, setCargando] = useState(true)
  const [perfiles, setPerfiles] = useState<any[]>([])
  const [perfilId, setPerfilId] = useState<string>('__default')
  const [etiquetas, setEtiquetas] = useState<Etiqueta[]>([])
  const [productos, setProductos] = useState<Record<string, any>>({})

  // Cargar productos (gtin/barcode) + perfiles activos
  useEffect(() => {
    (async () => {
      const ids = Array.from(new Set(lineas.map(l => l.producto_id)))
      const [{ data: prods }, { data: perfs }] = await Promise.all([
        supabase.from('productos').select('id, nombre, sku, gtin, codigo_barras, precio_venta').in('id', ids),
        supabase.from('codigo_perfiles').select('id, nombre, simbologia, ais').eq('tenant_id', tenantId).eq('activo', true).order('created_at'),
      ])
      const map: Record<string, any> = {}
      for (const p of prods ?? []) map[p.id] = p
      setProductos(map)
      setPerfiles(perfs ?? [])
      setPerfilId(perfs && perfs.length ? perfs[0].id : '__default')
      setCargando(false)
    })()
  }, [])

  const perfil = perfiles.find(p => p.id === perfilId) ?? { simbologia: 'gs1_128', ais: ['01', '10', '17', '30'] }

  // Generar todas las etiquetas al canvas (offscreen) → dataURL
  useEffect(() => {
    if (cargando) return
    const out: Etiqueta[] = []
    for (const l of lineas) {
      const prod = productos[l.producto_id]
      const nombre = prod?.nombre ?? l.lpn
      const fields: GS1Fields = {
        gtin: prod?.gtin || prod?.codigo_barras || undefined,
        lote: l.nro_lote || undefined,
        vencimiento: l.fecha_vencimiento ? String(l.fecha_vencimiento).slice(0, 10) : undefined,
        cantidad: l.cantidad,
        precio: prod?.precio_venta ?? undefined,
      }
      const elementString = buildGS1ElementString(fields, perfil.ais)
      if (!elementString.includes('(01)')) { out.push({ lpn: l.lpn, nombre, dataUrl: null, error: 'sin GTIN' }); continue }
      const g = (fields.gtin ?? '').replace(/\D/g, '')
      if (g && !isValidGtin(g)) { out.push({ lpn: l.lpn, nombre, dataUrl: null, error: 'GTIN inválido' }); continue }
      try {
        const canvas = document.createElement('canvas')
        const opts: Record<string, any> = {
          bcid: perfil.simbologia === 'datamatrix' ? 'gs1datamatrix' : 'gs1-128',
          text: elementString, scale: 3, backgroundcolor: 'FFFFFF',
        }
        if (perfil.simbologia !== 'datamatrix') { opts.height = 12; opts.includetext = true; opts.textxalign = 'center' }
        bwipjs.toCanvas(canvas, opts as any)
        out.push({ lpn: l.lpn, nombre, dataUrl: canvas.toDataURL('image/png') })
      } catch {
        out.push({ lpn: l.lpn, nombre, dataUrl: null, error: 'error' })
      }
    }
    setEtiquetas(out)
  }, [cargando, perfilId, productos])

  const ok = etiquetas.filter(e => e.dataUrl)
  const fallidas = etiquetas.length - ok.length

  const imprimir = () => {
    const win = window.open('', '_blank')
    if (!win) return
    const cards = ok.map(e => `
      <div class="card">
        <img src="${e.dataUrl}" />
        <p class="lpn">${e.lpn}</p>
        <p class="nombre">${e.nombre}</p>
      </div>`).join('')
    win.document.write(`
      <html><head><title>Etiquetas GS1 (${ok.length})</title>
      <style>
        body { font-family: sans-serif; margin: 12px; }
        .grid { display: flex; flex-wrap: wrap; gap: 10px; }
        .card { border: 1px solid #ddd; border-radius: 6px; padding: 8px; width: 230px;
                display: flex; flex-direction: column; align-items: center; page-break-inside: avoid; }
        img { max-width: 210px; }
        .lpn { font-size: 12px; font-weight: 700; color: ${BRAND.color.primary}; font-family: monospace; margin: 4px 0 0; }
        .nombre { font-size: 11px; color: #374151; margin: 2px 0 0; text-align: center; }
      </style></head><body>
        <div class="grid">${cards}</div>
        <script>window.onload = () => { window.print(); window.close(); }<\/script>
      </body></html>`)
    win.document.close()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <ScanBarcode size={17} className="text-accent" />
            <span className="font-semibold text-sm text-gray-800 dark:text-gray-100">Etiquetas GS1 — {lineas.length} LPN(s)</span>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"><X size={17} className="text-gray-500" /></button>
        </div>

        <div className="p-4 overflow-y-auto">
          {cargando ? (
            <div className="flex items-center justify-center py-10 text-gray-400 gap-2"><Loader2 size={18} className="animate-spin" /> Generando…</div>
          ) : (
            <>
              {perfiles.length > 0 && (
                <select value={perfilId} onChange={e => setPerfilId(e.target.value)}
                  className="w-full mb-3 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 focus:outline-none focus:border-accent">
                  {perfiles.map(p => <option key={p.id} value={p.id}>{p.nombre} · {p.simbologia === 'datamatrix' ? 'DataMatrix' : 'GS1-128'}</option>)}
                </select>
              )}
              {fallidas > 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mb-2">{fallidas} sin generar (falta GTIN o inválido). Cargá el código de barras en esos productos.</p>
              )}
              <div className="grid grid-cols-2 gap-2">
                {etiquetas.map((e, i) => (
                  <div key={i} className="border border-gray-100 dark:border-gray-700 rounded-lg p-2 flex flex-col items-center">
                    {e.dataUrl
                      ? <img src={e.dataUrl} className="max-w-full" />
                      : <div className="text-[11px] text-red-500 py-3">⚠ {e.error}</div>}
                    <p className="text-[11px] font-mono text-gray-700 dark:text-gray-200 mt-1">{e.lpn}</p>
                    <p className="text-[10px] text-gray-400 truncate w-full text-center">{e.nombre}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700">
          <button onClick={imprimir} disabled={cargando || ok.length === 0}
            className="w-full flex items-center justify-center gap-2 bg-primary text-white rounded-xl py-2.5 text-sm font-medium hover:bg-accent disabled:opacity-40">
            <Printer size={15} /> Imprimir {ok.length} etiqueta(s)
          </button>
        </div>
      </div>
    </div>
  )
}
