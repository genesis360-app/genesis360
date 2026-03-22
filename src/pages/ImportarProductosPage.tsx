import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Upload, Download, CheckCircle, XCircle, AlertTriangle, FileSpreadsheet, RefreshCw } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import toast from 'react-hot-toast'

const UNIDADES_VALIDAS = ['unidad', 'kg', 'g', 'litro', 'ml', 'metro', 'cm', 'caja', 'pack', 'docena']
const MONEDAS_VALIDAS = ['ARS', 'USD']

type ModoSKU = 'crear' | 'actualizar' | 'ambos'

interface FilaPreview {
  idx: number
  nombre: string
  sku: string
  codigo_barras?: string
  categoria?: string
  proveedor?: string
  precio_costo: number
  precio_costo_moneda: string
  precio_venta: number
  precio_venta_moneda: string
  stock_minimo: number
  unidad_medida: string
  descripcion?: string
  estado: 'nuevo' | 'existente' | 'error'
  errores: string[]
}

export default function ImportarProductosPage() {
  const navigate = useNavigate()
  const { tenant } = useAuthStore()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [filas, setFilas] = useState<FilaPreview[]>([])
  const [modo, setModo] = useState<ModoSKU>('ambos')
  const [importando, setImportando] = useState(false)
  const [resultado, setResultado] = useState<{ creados: number; actualizados: number; errores: number } | null>(null)

  const { data: categorias = [] } = useQuery({
    queryKey: ['categorias', tenant?.id],
    queryFn: async () => { const { data } = await supabase.from('categorias').select('id, nombre').eq('tenant_id', tenant!.id); return data ?? [] },
    enabled: !!tenant,
  })
  const { data: proveedores = [] } = useQuery({
    queryKey: ['proveedores', tenant?.id],
    queryFn: async () => { const { data } = await supabase.from('proveedores').select('id, nombre').eq('tenant_id', tenant!.id); return data ?? [] },
    enabled: !!tenant,
  })

  // ── Plantilla ─────────────────────────────────────────────────────────────
  const descargarPlantilla = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['nombre', 'sku', 'codigo_barras', 'categoria', 'proveedor', 'precio_costo', 'precio_costo_moneda', 'precio_venta', 'precio_venta_moneda', 'stock_minimo', 'unidad_medida', 'descripcion'],
      ['Tornillo hexagonal 1/4"', 'TORN-0001', '7791234567890', 'Ferretería', 'Proveedor A', 150, 'ARS', 250, 'ARS', 10, 'unidad', 'Tornillo de acero inoxidable'],
      ['Pintura blanca 4L', 'PINT-0001', '', 'Pinturas', '', 4.5, 'USD', 1200, 'ARS', 5, 'litro', ''],
    ])

    const headerStyle = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '1E3A5F' } }, alignment: { horizontal: 'center' } }
    const cols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']
    cols.forEach(c => { if (ws[`${c}1`]) ws[`${c}1`].s = headerStyle })
    ws['!cols'] = [
      { wch: 30 }, { wch: 15 }, { wch: 18 }, { wch: 15 }, { wch: 15 },
      { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 15 }, { wch: 30 },
    ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Productos')

    const wsRef = XLSX.utils.aoa_to_sheet([
      ['Campo', 'Requerido', 'Notas'],
      ['nombre', 'SÍ', 'Nombre del producto'],
      ['sku', 'SÍ', 'Identificador único (se generará automático si está vacío)'],
      ['codigo_barras', 'no', 'Código EAN/UPC'],
      ['categoria', 'no', 'Debe coincidir con una categoría existente o se creará nueva'],
      ['proveedor', 'no', 'Debe coincidir con un proveedor existente o se creará nuevo'],
      ['precio_costo', 'no', 'Número sin símbolos. Ej: 1500 o 4.5 (si es USD)'],
      ['precio_costo_moneda', 'no', 'ARS (default) o USD'],
      ['precio_venta', 'no', 'Número sin símbolos. Ej: 2500'],
      ['precio_venta_moneda', 'no', 'ARS (default) o USD'],
      ['stock_minimo', 'no', 'Número entero. Ej: 5'],
      ['unidad_medida', 'no', 'unidad / kg / g / litro / ml / metro / cm / caja / pack / docena'],
      ['descripcion', 'no', 'Texto libre'],
    ])
    wsRef['!cols'] = [{ wch: 22 }, { wch: 12 }, { wch: 55 }]
    XLSX.utils.book_append_sheet(wb, wsRef, 'Referencia')

    XLSX.writeFile(wb, 'plantilla_productos.xlsx')
  }

  // ── Procesar archivo ──────────────────────────────────────────────────────
  const procesarArchivo = async (file: File) => {
    setResultado(null)
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' })
        if (rows.length === 0) { toast.error('El archivo está vacío'); return }

        const skus = rows.map(r => String(r.sku || '').trim().toUpperCase()).filter(Boolean)
        const { data: existentes } = await supabase.from('productos')
          .select('sku').eq('tenant_id', tenant!.id).in('sku', skus)
        const skusExistentes = new Set((existentes ?? []).map((p: any) => p.sku.toUpperCase()))

        const preview: FilaPreview[] = rows.map((row, idx) => {
          const errores: string[] = []
          const nombre = String(row.nombre || '').trim()
          const sku = String(row.sku || '').trim().toUpperCase()
          const precio_costo = parseFloat(String(row.precio_costo || '0').replace(',', '.')) || 0
          const precio_costo_moneda = String(row.precio_costo_moneda || 'ARS').trim().toUpperCase()
          const precio_venta = parseFloat(String(row.precio_venta || '0').replace(',', '.')) || 0
          const precio_venta_moneda = String(row.precio_venta_moneda || 'ARS').trim().toUpperCase()
          const stock_minimo = parseInt(String(row.stock_minimo || '0')) || 0
          const unidad = String(row.unidad_medida || 'unidad').trim().toLowerCase()

          if (!nombre) errores.push('Nombre requerido')
          if (precio_costo < 0) errores.push('Precio costo inválido')
          if (precio_venta < 0) errores.push('Precio venta inválido')
          if (unidad && !UNIDADES_VALIDAS.includes(unidad)) errores.push(`Unidad "${unidad}" no válida`)
          if (precio_costo_moneda && !MONEDAS_VALIDAS.includes(precio_costo_moneda)) errores.push(`Moneda costo "${precio_costo_moneda}" inválida`)
          if (precio_venta_moneda && !MONEDAS_VALIDAS.includes(precio_venta_moneda)) errores.push(`Moneda venta "${precio_venta_moneda}" inválida`)

          const estado = errores.length > 0 ? 'error'
            : skusExistentes.has(sku) ? 'existente'
            : 'nuevo'

          return {
            idx,
            nombre,
            sku: sku || `AUTO-${(idx + 1).toString().padStart(4, '0')}`,
            codigo_barras: String(row.codigo_barras || '').trim() || undefined,
            categoria: String(row.categoria || '').trim() || undefined,
            proveedor: String(row.proveedor || '').trim() || undefined,
            precio_costo,
            precio_costo_moneda: MONEDAS_VALIDAS.includes(precio_costo_moneda) ? precio_costo_moneda : 'ARS',
            precio_venta,
            precio_venta_moneda: MONEDAS_VALIDAS.includes(precio_venta_moneda) ? precio_venta_moneda : 'ARS',
            stock_minimo,
            unidad_medida: UNIDADES_VALIDAS.includes(unidad) ? unidad : 'unidad',
            descripcion: String(row.descripcion || '').trim() || undefined,
            estado,
            errores,
          }
        })

        setFilas(preview)
      } catch {
        toast.error('Error al leer el archivo. Verificá que sea un Excel o CSV válido.')
      }
    }
    reader.readAsArrayBuffer(file)
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) procesarArchivo(file)
  }

  // ── Confirmar importación ─────────────────────────────────────────────────
  const confirmarImportacion = async () => {
    setImportando(true)
    let creados = 0; let actualizados = 0; let errores = 0

    const filasAImportar = filas.filter(f => {
      if (f.errores.length > 0) return false
      if (f.estado === 'nuevo' && modo === 'actualizar') return false
      if (f.estado === 'existente' && modo === 'crear') return false
      return true
    })

    for (const fila of filasAImportar) {
      try {
        let categoria_id: string | null = null
        if (fila.categoria) {
          const catExistente = (categorias as any[]).find(c => c.nombre.toLowerCase() === fila.categoria!.toLowerCase())
          if (catExistente) {
            categoria_id = catExistente.id
          } else {
            const { data: nuevaCat } = await supabase.from('categorias')
              .insert({ tenant_id: tenant!.id, nombre: fila.categoria }).select('id').single()
            categoria_id = nuevaCat?.id ?? null
            qc.invalidateQueries({ queryKey: ['categorias'] })
          }
        }

        let proveedor_id: string | null = null
        if (fila.proveedor) {
          const provExistente = (proveedores as any[]).find(p => p.nombre.toLowerCase() === fila.proveedor!.toLowerCase())
          if (provExistente) {
            proveedor_id = provExistente.id
          } else {
            const { data: nuevoProv } = await supabase.from('proveedores')
              .insert({ tenant_id: tenant!.id, nombre: fila.proveedor }).select('id').single()
            proveedor_id = nuevoProv?.id ?? null
            qc.invalidateQueries({ queryKey: ['proveedores'] })
          }
        }

        const payload = {
          tenant_id: tenant!.id,
          nombre: fila.nombre,
          sku: fila.sku,
          codigo_barras: fila.codigo_barras ?? null,
          categoria_id,
          proveedor_id,
          precio_costo: fila.precio_costo,
          precio_costo_moneda: fila.precio_costo_moneda,
          precio_venta: fila.precio_venta,
          precio_venta_moneda: fila.precio_venta_moneda,
          stock_minimo: fila.stock_minimo,
          unidad_medida: fila.unidad_medida,
          descripcion: fila.descripcion ?? null,
          activo: true,
        }

        if (fila.estado === 'nuevo') {
          await supabase.from('productos').insert(payload)
          creados++
        } else {
          await supabase.from('productos').update(payload).eq('sku', fila.sku).eq('tenant_id', tenant!.id)
          actualizados++
        }
      } catch {
        errores++
      }
    }

    qc.invalidateQueries({ queryKey: ['productos'] })
    setResultado({ creados, actualizados, errores })
    setImportando(false)
    toast.success(`Importación completada: ${creados} creados, ${actualizados} actualizados`)
  }

  const nuevos = filas.filter(f => f.estado === 'nuevo' && f.errores.length === 0).length
  const existentes = filas.filter(f => f.estado === 'existente' && f.errores.length === 0).length
  const conErrores = filas.filter(f => f.errores.length > 0).length

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/inventario')} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft size={20} className="text-gray-600" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-primary">Importar productos</h1>
          <p className="text-gray-500 text-sm mt-0.5">Cargá múltiples productos desde un archivo Excel o CSV</p>
        </div>
      </div>

      {resultado && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-start gap-3">
          <CheckCircle size={20} className="text-green-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold text-green-800">Importación completada</p>
            <p className="text-sm text-green-700 mt-0.5">
              {resultado.creados} producto{resultado.creados !== 1 ? 's' : ''} creado{resultado.creados !== 1 ? 's' : ''} · {resultado.actualizados} actualizado{resultado.actualizados !== 1 ? 's' : ''} · {resultado.errores} error{resultado.errores !== 1 ? 'es' : ''}
            </p>
            <button onClick={() => navigate('/inventario')} className="mt-2 text-sm text-green-700 font-medium hover:underline">
              Ver inventario →
            </button>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="space-y-4">
          <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
            <h2 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <FileSpreadsheet size={16} className="text-accent" /> Plantilla
            </h2>
            <p className="text-xs text-gray-500 mb-3">Descargá la plantilla, completá los datos y subila.</p>
            <button onClick={descargarPlantilla}
              className="w-full flex items-center justify-center gap-2 border border-accent text-accent font-medium py-2.5 rounded-xl hover:bg-blue-50 transition-all text-sm">
              <Download size={15} /> Descargar plantilla
            </button>
          </div>

          <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
            <h2 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Upload size={16} className="text-accent" /> Subir archivo
            </h2>
            <div
              className="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center cursor-pointer hover:border-accent hover:bg-blue-50/30 transition-all"
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) procesarArchivo(f) }}
            >
              <FileSpreadsheet size={28} className="text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">Arrastrá o hacé click</p>
              <p className="text-xs text-gray-400 mt-1">.xlsx, .xls, .csv</p>
            </div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
          </div>

          {filas.length > 0 && existentes > 0 && (
            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
              <h2 className="font-semibold text-gray-700 mb-3">Si el SKU ya existe</h2>
              <div className="space-y-2">
                {([
                  { val: 'crear',      label: 'Solo crear nuevos',  desc: 'Ignorar los existentes' },
                  { val: 'actualizar', label: 'Solo actualizar',     desc: 'Ignorar los nuevos' },
                  { val: 'ambos',      label: 'Crear y actualizar',  desc: 'Procesar todos' },
                ] as { val: ModoSKU; label: string; desc: string }[]).map(({ val, label, desc }) => (
                  <label key={val} className="flex items-start gap-3 cursor-pointer p-2 rounded-lg hover:bg-gray-50">
                    <input type="radio" name="modo" value={val} checked={modo === val}
                      onChange={() => setModo(val)} className="mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-gray-700">{label}</p>
                      <p className="text-xs text-gray-400">{desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-2">
          {filas.length === 0 ? (
            <div className="bg-white rounded-xl p-12 shadow-sm border border-gray-100 text-center text-gray-400">
              <FileSpreadsheet size={40} className="mx-auto mb-3 opacity-30" />
              <p className="font-medium">Subí un archivo para ver la previsualización</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="grid grid-cols-3 divide-x divide-gray-100 border-b border-gray-100">
                <div className="px-4 py-3 text-center">
                  <p className="text-2xl font-bold text-green-600">{nuevos}</p>
                  <p className="text-xs text-gray-500">Nuevos</p>
                </div>
                <div className="px-4 py-3 text-center">
                  <p className="text-2xl font-bold text-blue-600">{existentes}</p>
                  <p className="text-xs text-gray-500">Existentes</p>
                </div>
                <div className="px-4 py-3 text-center">
                  <p className="text-2xl font-bold text-red-500">{conErrores}</p>
                  <p className="text-xs text-gray-500">Con errores</p>
                </div>
              </div>

              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50">
                    <tr className="border-b border-gray-100">
                      <th className="text-left px-3 py-2 font-semibold text-gray-600">Estado</th>
                      <th className="text-left px-3 py-2 font-semibold text-gray-600">Nombre</th>
                      <th className="text-left px-3 py-2 font-semibold text-gray-600">SKU</th>
                      <th className="text-right px-3 py-2 font-semibold text-gray-600">Costo</th>
                      <th className="text-right px-3 py-2 font-semibold text-gray-600">Venta</th>
                      <th className="text-left px-3 py-2 font-semibold text-gray-600">Categoría</th>
                      <th className="text-left px-3 py-2 font-semibold text-gray-600">Errores</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map(fila => (
                      <tr key={fila.idx} className={`border-b border-gray-50 ${fila.errores.length > 0 ? 'bg-red-50' : fila.estado === 'existente' ? 'bg-blue-50/40' : ''}`}>
                        <td className="px-3 py-2">
                          {fila.errores.length > 0 ? (
                            <span className="flex items-center gap-1 text-red-500"><XCircle size={12} /> Error</span>
                          ) : fila.estado === 'existente' ? (
                            <span className="flex items-center gap-1 text-blue-600"><RefreshCw size={12} /> Existe</span>
                          ) : (
                            <span className="flex items-center gap-1 text-green-600"><CheckCircle size={12} /> Nuevo</span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-medium text-gray-800 max-w-32 truncate">{fila.nombre || <span className="text-red-400 italic">vacío</span>}</td>
                        <td className="px-3 py-2 font-mono text-gray-600">{fila.sku}</td>
                        <td className="px-3 py-2 text-right text-gray-600">
                          {fila.precio_costo > 0 ? `${fila.precio_costo_moneda === 'USD' ? 'USD ' : '$'}${fila.precio_costo.toLocaleString()}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-600">
                          {fila.precio_venta > 0 ? `${fila.precio_venta_moneda === 'USD' ? 'USD ' : '$'}${fila.precio_venta.toLocaleString()}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-gray-500">{fila.categoria ?? '—'}</td>
                        <td className="px-3 py-2 text-red-500">{fila.errores.join(', ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="p-4 border-t border-gray-100 bg-gray-50">
                <button
                  onClick={confirmarImportacion}
                  disabled={importando || (nuevos === 0 && existentes === 0) || filas.every(f => f.errores.length > 0)}
                  className="w-full bg-primary hover:bg-accent text-white font-semibold py-3 rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                  {importando ? (
                    <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> Importando...</>
                  ) : (
                    <><Upload size={16} /> Confirmar ({modo === 'crear' ? nuevos : modo === 'actualizar' ? existentes : nuevos + existentes} productos)</>
                  )}
                </button>
                {conErrores > 0 && (
                  <p className="text-xs text-gray-400 text-center mt-2 flex items-center justify-center gap-1">
                    <AlertTriangle size={11} /> Las filas con errores serán ignoradas
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
