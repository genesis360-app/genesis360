import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Upload, Download, CheckCircle, XCircle, FileSpreadsheet, RefreshCw, Tag, Truck, MapPin } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import toast from 'react-hot-toast'

type TipoMaster = 'categorias' | 'proveedores' | 'ubicaciones'

interface FilaMaster {
  idx: number
  nombre: string
  extra: Record<string, string>
  estado: 'nuevo' | 'existente' | 'error'
  errores: string[]
}

const MASTER_CONFIG: Record<TipoMaster, { label: string; icon: any; cols: string[]; extraCols: string[] }> = {
  categorias:  { label: 'Categorías',  icon: Tag,   cols: ['nombre', 'descripcion'],                      extraCols: ['descripcion'] },
  proveedores: { label: 'Proveedores', icon: Truck, cols: ['nombre', 'contacto', 'telefono', 'email'],    extraCols: ['contacto', 'telefono', 'email'] },
  ubicaciones: { label: 'Ubicaciones', icon: MapPin, cols: ['nombre', 'descripcion'],                     extraCols: ['descripcion'] },
}

export default function ImportarMasterPage() {
  const navigate = useNavigate()
  const { tenant } = useAuthStore()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [tipoMaster, setTipoMaster] = useState<TipoMaster>('categorias')
  const [filas, setFilas] = useState<FilaMaster[]>([])
  const [importando, setImportando] = useState(false)
  const [resultado, setResultado] = useState<{ creados: number; ignorados: number; errores: number } | null>(null)

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
  const { data: ubicaciones = [] } = useQuery({
    queryKey: ['ubicaciones', tenant?.id],
    queryFn: async () => { const { data } = await supabase.from('ubicaciones').select('id, nombre').eq('tenant_id', tenant!.id); return data ?? [] },
    enabled: !!tenant,
  })

  const descargarPlantilla = (tipo: TipoMaster) => {
    const cfg = MASTER_CONFIG[tipo]
    const ws = XLSX.utils.aoa_to_sheet([
      cfg.cols,
      tipo === 'categorias'  ? ['Ferretería', 'Productos de ferretería'] :
      tipo === 'proveedores' ? ['Proveedor A', 'Juan García', '1123456789', 'juan@proveedor.com'] :
                               ['Depósito A', 'Primer piso'],
    ])
    ws['!cols'] = cfg.cols.map(() => ({ wch: 24 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, cfg.label)
    XLSX.writeFile(wb, `plantilla_${tipo}.xlsx`)
  }

  const procesarArchivo = (file: File, tipo: TipoMaster) => {
    setResultado(null)
    const existentesMap: Record<string, boolean> = {}
    const listaExistentes = tipo === 'categorias' ? categorias : tipo === 'proveedores' ? proveedores : ubicaciones
    ;(listaExistentes as any[]).forEach((item: any) => { existentesMap[item.nombre.toLowerCase()] = true })

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' })
        if (rows.length === 0) { toast.error('El archivo está vacío'); return }

        const cfg = MASTER_CONFIG[tipo]
        const preview: FilaMaster[] = rows.map((row, idx) => {
          const errores: string[] = []
          const nombre = String(row.nombre || '').trim()
          if (!nombre) errores.push('Nombre requerido')
          const extra: Record<string, string> = {}
          cfg.extraCols.forEach(c => { extra[c] = String((row as any)[c] || '').trim() })
          const estado = errores.length > 0 ? 'error' : existentesMap[nombre.toLowerCase()] ? 'existente' : 'nuevo'
          return { idx, nombre, extra, estado, errores }
        })
        setFilas(preview)
      } catch {
        toast.error('Error al leer el archivo.')
      }
    }
    reader.readAsArrayBuffer(file)
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) procesarArchivo(file, tipoMaster)
  }

  const confirmarImportacion = async () => {
    setImportando(true)
    let creados = 0; let ignorados = 0; let errores = 0
    const nuevas = filas.filter(f => f.estado === 'nuevo')

    for (const fila of nuevas) {
      try {
        const payload: Record<string, any> = { tenant_id: tenant!.id, nombre: fila.nombre }
        Object.entries(fila.extra).forEach(([k, v]) => { if (v) payload[k] = v })
        await supabase.from(tipoMaster).insert(payload)
        creados++
      } catch {
        errores++
      }
    }

    ignorados = filas.filter(f => f.estado === 'existente').length
    qc.invalidateQueries({ queryKey: [tipoMaster] })
    setResultado({ creados, ignorados, errores })
    setImportando(false)
    toast.success(`${MASTER_CONFIG[tipoMaster].label}: ${creados} creados, ${ignorados} ignorados`)
  }

  const nuevosMaster = filas.filter(f => f.estado === 'nuevo').length
  const existentesMaster = filas.filter(f => f.estado === 'existente').length

  const cambiarTipo = (tipo: TipoMaster) => {
    setTipoMaster(tipo)
    setFilas([])
    setResultado(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/configuracion')} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft size={20} className="text-gray-600" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-primary">Importar datos maestros</h1>
          <p className="text-gray-500 text-sm mt-0.5">Cargá categorías, proveedores o ubicaciones desde Excel</p>
        </div>
      </div>

      {resultado && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-start gap-3">
          <CheckCircle size={20} className="text-green-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold text-green-800">Importación completada</p>
            <p className="text-sm text-green-700 mt-0.5">
              {resultado.creados} creado{resultado.creados !== 1 ? 's' : ''} · {resultado.ignorados} ignorado{resultado.ignorados !== 1 ? 's' : ''} (ya existían) · {resultado.errores} error{resultado.errores !== 1 ? 'es' : ''}
            </p>
            <button onClick={() => navigate('/configuracion')} className="mt-2 text-sm text-green-700 font-medium hover:underline">
              Volver a Configuración →
            </button>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="space-y-4">
          {/* Selector de tipo */}
          <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
            <h2 className="font-semibold text-gray-700 mb-3">¿Qué querés importar?</h2>
            <div className="space-y-2">
              {(Object.entries(MASTER_CONFIG) as [TipoMaster, typeof MASTER_CONFIG[TipoMaster]][]).map(([tipo, cfg]) => {
                const Icon = cfg.icon
                return (
                  <label key={tipo} className="flex items-center gap-3 cursor-pointer p-2 rounded-lg hover:bg-gray-50">
                    <input type="radio" name="tipoMaster" value={tipo} checked={tipoMaster === tipo}
                      onChange={() => cambiarTipo(tipo)} />
                    <Icon size={15} className="text-accent" />
                    <span className="text-sm font-medium text-gray-700">{cfg.label}</span>
                  </label>
                )
              })}
            </div>
          </div>

          {/* Plantilla */}
          <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
            <h2 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <FileSpreadsheet size={16} className="text-accent" /> Plantilla
            </h2>
            <button onClick={() => descargarPlantilla(tipoMaster)}
              className="w-full flex items-center justify-center gap-2 border border-accent text-accent font-medium py-2.5 rounded-xl hover:bg-blue-50 transition-all text-sm">
              <Download size={15} /> Descargar plantilla
            </button>
          </div>

          {/* Upload */}
          <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
            <h2 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Upload size={16} className="text-accent" /> Subir archivo
            </h2>
            <div
              className="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center cursor-pointer hover:border-accent hover:bg-blue-50/30 transition-all"
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) procesarArchivo(f, tipoMaster) }}
            >
              <FileSpreadsheet size={28} className="text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">Arrastrá o hacé click</p>
              <p className="text-xs text-gray-400 mt-1">.xlsx, .xls, .csv</p>
            </div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
            <p className="text-xs text-gray-400 mt-2 text-center">Los duplicados (mismo nombre) se ignoran</p>
          </div>
        </div>

        {/* Preview */}
        <div className="lg:col-span-2">
          {filas.length === 0 ? (
            <div className="bg-white rounded-xl p-12 shadow-sm border border-gray-100 text-center text-gray-400">
              <FileSpreadsheet size={40} className="mx-auto mb-3 opacity-30" />
              <p className="font-medium">Subí un archivo para ver la previsualización</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="grid grid-cols-2 divide-x divide-gray-100 border-b border-gray-100">
                <div className="px-4 py-3 text-center">
                  <p className="text-2xl font-bold text-green-600">{nuevosMaster}</p>
                  <p className="text-xs text-gray-500">Nuevos</p>
                </div>
                <div className="px-4 py-3 text-center">
                  <p className="text-2xl font-bold text-gray-400">{existentesMaster}</p>
                  <p className="text-xs text-gray-500">Ya existen (se ignoran)</p>
                </div>
              </div>

              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50">
                    <tr className="border-b border-gray-100">
                      <th className="text-left px-3 py-2 font-semibold text-gray-600">Estado</th>
                      <th className="text-left px-3 py-2 font-semibold text-gray-600">Nombre</th>
                      {MASTER_CONFIG[tipoMaster].extraCols.map(c => (
                        <th key={c} className="text-left px-3 py-2 font-semibold text-gray-600 capitalize">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map(fila => (
                      <tr key={fila.idx} className={`border-b border-gray-50 ${fila.errores.length > 0 ? 'bg-red-50' : fila.estado === 'existente' ? 'bg-gray-50' : ''}`}>
                        <td className="px-3 py-2">
                          {fila.errores.length > 0 ? (
                            <span className="flex items-center gap-1 text-red-500"><XCircle size={12} /> Error</span>
                          ) : fila.estado === 'existente' ? (
                            <span className="flex items-center gap-1 text-gray-400"><RefreshCw size={12} /> Existe</span>
                          ) : (
                            <span className="flex items-center gap-1 text-green-600"><CheckCircle size={12} /> Nuevo</span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-medium text-gray-800">{fila.nombre}</td>
                        {MASTER_CONFIG[tipoMaster].extraCols.map(c => (
                          <td key={c} className="px-3 py-2 text-gray-500">{fila.extra[c] || '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="p-4 border-t border-gray-100 bg-gray-50">
                <button
                  onClick={confirmarImportacion}
                  disabled={importando || nuevosMaster === 0}
                  className="w-full bg-primary hover:bg-accent text-white font-semibold py-3 rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                  {importando ? (
                    <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> Importando...</>
                  ) : (
                    <><Upload size={16} /> Crear {nuevosMaster} {MASTER_CONFIG[tipoMaster].label.toLowerCase()}</>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
