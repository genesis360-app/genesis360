import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Upload, Download, CheckCircle, XCircle, AlertTriangle, FileSpreadsheet, Boxes } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { usePlanLimits } from '@/hooks/usePlanLimits'
import { UpgradePrompt } from '@/components/UpgradePrompt'
import toast from 'react-hot-toast'

// Convierte cualquier formato de fecha a YYYY-MM-DD
function parseFecha(val: any): string | undefined {
  if (val === null || val === undefined || val === '') return undefined
  if (typeof val === 'number') {
    const d = XLSX.SSF.parse_date_code(val)
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
    return undefined
  }
  if (val instanceof Date) return val.toISOString().slice(0, 10)
  const s = String(val).trim()
  if (!s) return undefined
  const m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return s
}

interface FilaInventario {
  idx: number
  sku: string
  producto_nombre: string
  producto_id: string
  tiene_series: boolean
  cantidad: number
  precio_costo?: number
  ubicacion?: string
  estado?: string
  proveedor?: string
  nro_lote?: string
  fecha_vencimiento?: string
  lpn?: string
  motivo?: string
  numeros_serie?: string[]
  estadoFilaImport: 'ok' | 'error'
  errores: string[]
}

export default function ImportarInventarioPage() {
  const { limits } = usePlanLimits()
  const navigate = useNavigate()
  const { tenant, user } = useAuthStore()
  const qc = useQueryClient()

  const fileRef = useRef<HTMLInputElement>(null)

  const [filas, setFilas] = useState<FilaInventario[]>([])
  const [importando, setImportando] = useState(false)
  const [resultado, setResultado] = useState<{ cargados: number; errores: number } | null>(null)

  const { data: ubicaciones = [] } = useQuery({
    queryKey: ['ubicaciones', tenant?.id],
    queryFn: async () => { const { data } = await supabase.from('ubicaciones').select('id, nombre').eq('tenant_id', tenant!.id); return data ?? [] },
    enabled: !!tenant,
  })
  const { data: estados = [] } = useQuery({
    queryKey: ['estados_inventario', tenant?.id],
    queryFn: async () => { const { data } = await supabase.from('estados_inventario').select('id, nombre').eq('tenant_id', tenant!.id).eq('activo', true); return data ?? [] },
    enabled: !!tenant,
  })
  const { data: proveedores = [] } = useQuery({
    queryKey: ['proveedores', tenant?.id],
    queryFn: async () => { const { data } = await supabase.from('proveedores').select('id, nombre').eq('tenant_id', tenant!.id); return data ?? [] },
    enabled: !!tenant,
  })
  const { data: productosMap = {} } = useQuery({
    queryKey: ['productos-sku-map', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('productos').select('id, nombre, sku, precio_costo, stock_actual, tiene_series').eq('tenant_id', tenant!.id).eq('activo', true)
      const map: Record<string, any> = {}
      ;(data ?? []).forEach(p => { map[p.sku.toUpperCase()] = p })
      return map
    },
    enabled: !!tenant,
  })

  const descargarPlantilla = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['sku','cantidad','precio_costo','ubicacion','estado','proveedor','nro_lote','fecha_vencimiento','lpn','motivo','numeros_serie'],
      ['TORN-0001',100,150,'Depósito A','Disponible','Proveedor A','L-2024-001','2025-12-31','','Carga inicial',''],
      ['PINT-0001',20,'','Estante 2','','','','','','',''],
      ['CELULAR-001','','','Depósito B','','','','','','Carga inicial','SN-0001,SN-0002,SN-0003'],
    ])
    const hdr = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '1E3A5F' } }, alignment: { horizontal: 'center' } }
    ;['A','B','C','D','E','F','G','H','I','J','K'].forEach(c => { if (ws[`${c}1`]) ws[`${c}1`].s = hdr })
    ws['!cols'] = [{ wch:15 },{ wch:12 },{ wch:14 },{ wch:15 },{ wch:15 },{ wch:15 },{ wch:15 },{ wch:18 },{ wch:15 },{ wch:20 },{ wch:35 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Inventario')
    const wsRef = XLSX.utils.aoa_to_sheet([
      ['Campo','Requerido','Notas'],
      ['sku','SÍ','Debe existir en el catálogo de productos'],
      ['cantidad','SÍ (no serializado)','Cantidad a ingresar. Ignorado para productos con series.'],
      ['precio_costo','no','Precio de costo del ingreso. Si vacío, usa el del producto.'],
      ['ubicacion','no','Nombre de la ubicación. Debe existir en Configuración.'],
      ['estado','no','Estado del inventario. Debe existir en Configuración.'],
      ['proveedor','no','Nombre del proveedor. Debe existir en Configuración.'],
      ['nro_lote','no','Número de lote'],
      ['fecha_vencimiento','no','Formato YYYY-MM-DD. Ej: 2025-12-31'],
      ['lpn','no','Identificador del bulto. Se autogenera si está vacío.'],
      ['motivo','no','Motivo del ingreso. Ej: Carga inicial, Reposición, etc.'],
      ['numeros_serie','SÍ (serializado)','Solo para productos con series. Separar con coma. Ej: SN-001,SN-002,SN-003.'],
    ])
    wsRef['!cols'] = [{ wch:20 },{ wch:18 },{ wch:75 }]
    XLSX.utils.book_append_sheet(wb, wsRef, 'Referencia')
    XLSX.writeFile(wb, 'plantilla_inventario.xlsx')
  }

  const procesarArchivo = (file: File) => {
    setResultado(null)
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target!.result as ArrayBuffer), { type: 'array' })
        const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
        if (!rows.length) { toast.error('El archivo está vacío'); return }

        const preview: FilaInventario[] = rows.map((row, idx) => {
          const errores: string[] = []
          const sku = String(row.sku || '').trim().toUpperCase()
          const cantidad = parseInt(String(row.cantidad || '0')) || 0
          const producto = productosMap[sku]
          const tieneSeries = producto?.tiene_series ?? false
          const numerosSerieRaw = String(row.numeros_serie || '').trim()
          const numerosSerie = numerosSerieRaw ? numerosSerieRaw.split(/[,;]/).map(s => s.trim()).filter(Boolean) : []

          if (!sku) errores.push('SKU requerido')
          else if (!producto) errores.push(`SKU "${sku}" no existe`)

          if (tieneSeries) {
            if (numerosSerie.length === 0) errores.push('Producto serializado: completá la columna numeros_serie')
          } else {
            if (cantidad <= 0) errores.push('Cantidad debe ser mayor a 0')
          }

          return {
            idx,
            sku,
            producto_nombre: producto?.nombre ?? '—',
            producto_id: producto?.id ?? '',
            tiene_series: tieneSeries,
            cantidad: tieneSeries ? numerosSerie.length : cantidad,
            precio_costo: parseFloat(String(row.precio_costo || '').replace(',', '.')) || undefined,
            ubicacion: String(row.ubicacion || '').trim() || undefined,
            estado: String(row.estado || '').trim() || undefined,
            proveedor: String(row.proveedor || '').trim() || undefined,
            nro_lote: String(row.nro_lote || '').trim() || undefined,
            fecha_vencimiento: parseFecha(row.fecha_vencimiento),
            lpn: String(row.lpn || '').trim() || undefined,
            motivo: String(row.motivo || '').trim() || undefined,
            numeros_serie: tieneSeries ? numerosSerie : undefined,
            estadoFilaImport: errores.length > 0 ? 'error' : 'ok',
            errores,
          }
        })
        setFilas(preview)
      } catch { toast.error('Error al leer el archivo.') }
    }
    reader.readAsArrayBuffer(file)
  }

  const confirmar = async () => {
    setImportando(true)
    let cargados = 0, errores = 0

    for (const fila of filas.filter(f => f.estadoFilaImport === 'ok')) {
      try {
        const ubicacion_id = fila.ubicacion
          ? ((ubicaciones as any[]).find(u => u.nombre.toLowerCase() === fila.ubicacion!.toLowerCase())?.id ?? null)
          : null
        const estado_id = fila.estado
          ? ((estados as any[]).find(e => e.nombre.toLowerCase() === fila.estado!.toLowerCase())?.id ?? null)
          : null
        const proveedor_id = fila.proveedor
          ? ((proveedores as any[]).find(p => p.nombre.toLowerCase() === fila.proveedor!.toLowerCase())?.id ?? null)
          : null

        const { data: prodAntes } = await supabase.from('productos').select('stock_actual, precio_costo').eq('id', fila.producto_id).single()
        const stockAntes = prodAntes?.stock_actual ?? 0
        const precioCosto = fila.precio_costo ?? prodAntes?.precio_costo ?? null
        const lpn = fila.lpn || `IMP-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${String(fila.idx + 1).padStart(4, '0')}`

        const { data: linea, error: lineaErr } = await supabase.from('inventario_lineas').insert({
          tenant_id: tenant!.id,
          producto_id: fila.producto_id,
          lpn,
          cantidad: fila.cantidad,
          estado_id,
          ubicacion_id,
          proveedor_id,
          nro_lote: fila.nro_lote ?? null,
          fecha_vencimiento: fila.fecha_vencimiento ?? null,
          precio_costo_snapshot: precioCosto,
        }).select().single()
        if (lineaErr) throw lineaErr

        if (fila.tiene_series && fila.numeros_serie && fila.numeros_serie.length > 0) {
          const { error: seriesErr } = await supabase.from('inventario_series').insert(
            fila.numeros_serie.map(nro_serie => ({
              tenant_id: tenant!.id,
              producto_id: fila.producto_id,
              linea_id: linea.id,
              nro_serie,
              estado_id,
              reservado: false,
              activo: true,
            }))
          )
          if (seriesErr) throw seriesErr
        }

        await supabase.from('movimientos_stock').insert({
          tenant_id: tenant!.id,
          producto_id: fila.producto_id,
          tipo: 'ingreso',
          cantidad: fila.cantidad,
          stock_antes: stockAntes,
          stock_despues: stockAntes + fila.cantidad,
          motivo: fila.motivo ?? 'Carga masiva',
          estado_id,
          usuario_id: user?.id,
          linea_id: linea.id,
        })

        cargados++
      } catch { errores++ }
    }

    qc.invalidateQueries({ queryKey: ['inventario_lineas_all'] })
    qc.invalidateQueries({ queryKey: ['productos'] })
    qc.invalidateQueries({ queryKey: ['movimientos'] })
    setResultado({ cargados, errores })
    setImportando(false)
    toast.success(`${cargados} líneas cargadas al inventario`)
  }

  const okCount    = filas.filter(f => f.estadoFilaImport === 'ok').length
  const errorCount = filas.filter(f => f.estadoFilaImport === 'error').length

  if (limits && !limits.puede_importar) return <UpgradePrompt feature="importar" />

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/inventario')} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
          <ArrowLeft size={20} className="text-gray-600 dark:text-gray-400" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-primary">Importar inventario</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">Cargá stock masivamente desde Excel</p>
        </div>
      </div>

      {resultado && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 rounded-xl p-4 flex items-start gap-3">
          <CheckCircle size={20} className="text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold text-green-800 dark:text-green-400">Carga completada</p>
            <p className="text-sm text-green-700 dark:text-green-400 mt-0.5">{resultado.cargados} línea{resultado.cargados !== 1 ? 's' : ''} cargada{resultado.cargados !== 1 ? 's' : ''} · {resultado.errores} errores</p>
            <button onClick={() => navigate('/inventario')} className="mt-2 text-sm text-green-700 dark:text-green-400 font-medium hover:underline">Ver inventario →</button>
          </div>
        </div>
      )}

      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 rounded-xl p-4 text-sm text-blue-700 dark:text-blue-400">
        <strong>Carga masiva de inventario</strong> — Cada fila crea una línea de stock (LPN) y registra un movimiento de ingreso. Los SKUs deben existir previamente en el catálogo de productos.
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100">
            <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2"><FileSpreadsheet size={16} className="text-accent" /> Plantilla</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Completá una fila por línea de inventario a cargar.</p>
            <button onClick={descargarPlantilla} className="w-full flex items-center justify-center gap-2 border border-accent text-accent font-medium py-2.5 rounded-xl hover:bg-accent/10 transition-all text-sm">
              <Download size={15} /> Descargar plantilla
            </button>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100">
            <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2"><Upload size={16} className="text-accent" /> Subir archivo</h2>
            <div className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-6 text-center cursor-pointer hover:border-accent hover:bg-accent/5 transition-all"
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) procesarArchivo(f) }}>
              <Boxes size={28} className="text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500 dark:text-gray-400">Arrastrá o hacé click</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">.xlsx, .xls, .csv</p>
            </div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) procesarArchivo(f) }} />
          </div>
        </div>

        <div className="lg:col-span-2">
          {filas.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-12 shadow-sm border border-gray-100 text-center text-gray-400 dark:text-gray-500">
              <Boxes size={40} className="mx-auto mb-3 opacity-30" />
              <p className="font-medium">Subí un archivo para ver la previsualización</p>
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="grid grid-cols-2 divide-x divide-gray-100 border-b border-gray-100">
                <div className="px-4 py-3 text-center"><p className="text-2xl font-bold text-green-600 dark:text-green-400">{okCount}</p><p className="text-xs text-gray-500 dark:text-gray-400">Líneas a cargar</p></div>
                <div className="px-4 py-3 text-center"><p className="text-2xl font-bold text-red-500">{errorCount}</p><p className="text-xs text-gray-500 dark:text-gray-400">Con errores</p></div>
              </div>
              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50 dark:bg-gray-700"><tr className="border-b border-gray-100">
                    <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-400">Estado</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-400">SKU</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-400">Producto</th>
                    <th className="text-right px-3 py-2 font-semibold text-gray-600 dark:text-gray-400">Cantidad</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-400">Ubicación</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-400">Estado inv.</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-400">Lote</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-400">Errores</th>
                  </tr></thead>
                  <tbody>
                    {filas.map(f => (
                      <tr key={f.idx} className={`border-b border-gray-50 ${f.estadoFilaImport === 'error' ? 'bg-red-50 dark:bg-red-900/20' : ''}`}>
                        <td className="px-3 py-2">
                          {f.estadoFilaImport === 'error'
                            ? <span className="flex items-center gap-1 text-red-500"><XCircle size={12} /> Error</span>
                            : <span className="flex items-center gap-1 text-green-600 dark:text-green-400"><CheckCircle size={12} /> OK</span>}
                        </td>
                        <td className="px-3 py-2 font-mono text-gray-600 dark:text-gray-400">{f.sku}</td>
                        <td className="px-3 py-2 font-medium text-gray-800 dark:text-gray-100 max-w-32 truncate">{f.producto_nombre}</td>
                        <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300 font-semibold">{f.cantidad}</td>
                        <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{f.ubicacion ?? '—'}</td>
                        <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{f.estado ?? '—'}</td>
                        <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{f.nro_lote ?? '—'}</td>
                        <td className="px-3 py-2 text-red-500">{f.errores.join(', ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="p-4 border-t border-gray-100 bg-gray-50 dark:bg-gray-700">
                <button onClick={confirmar} disabled={importando || okCount === 0}
                  className="w-full bg-accent hover:bg-accent/90 text-white font-semibold py-3 rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                  {importando ? <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> Cargando...</>
                    : <><Boxes size={16} /> Cargar {okCount} línea{okCount !== 1 ? 's' : ''} al inventario</>}
                </button>
                {errorCount > 0 && <p className="text-xs text-gray-400 dark:text-gray-500 text-center mt-2 flex items-center justify-center gap-1"><AlertTriangle size={11} /> Las filas con errores serán ignoradas</p>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
