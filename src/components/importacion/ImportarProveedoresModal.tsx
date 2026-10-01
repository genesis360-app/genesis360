// Importar proveedores desde Excel/CSV (backlog "estandarizar importar", GO 2026-10-01).
// Dos pasos y TODO O NADA (D3-a): vista previa completa → "Cargar"; la base aplica todo en una transacción
// (mig 450 `fn_importar_proveedores`). Al actualizar un proveedor existente se escriben solo las columnas con valor.
import { useRef, useState } from 'react'
import { Download, FileSpreadsheet, Upload, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { traerTodoConError } from '@/lib/traerTodo'
import { useAuthStore } from '@/store/authStore'
import { descargarExcel } from '@/lib/exportarArchivo'
import { filaExcel, filasConErrorParaExportar, MAX_FILAS_IMPORTACION, mensajeErrorCarga } from '@/lib/importacion'
import { cuitValido, normalizarCuit } from '@/lib/padronArca'
import { cbuValido, condicionIvaProveedor, CONDICION_IVA_PLANTILLA, tipoProveedor } from '@/lib/importarProveedores'
import { agregarValidacionesXlsx, letraColumna, type ValidacionLista } from '@/lib/xlsxValidaciones'
import { ResultadoImportacion, VistaPreviaImportacion, type ResultadoCarga } from './VistaPreviaImportacion'

const COLUMNAS = ['nombre', 'razon_social', 'cuit', 'condicion_iva', 'domicilio', 'contacto', 'telefono', 'email',
  'plazo_pago_dias', 'banco', 'cbu', 'tipo', 'dni', 'etiquetas', 'notas'] as const

interface FilaProv {
  idx: number
  nombre: string
  campos: Record<string, unknown>     // solo columnas con valor, ya normalizadas
  matchId?: string
  matchNombre?: string
  errores: string[]
}

type Modo = 'ignorar_existentes' | 'ignorar_nuevos' | 'procesar_todos'

export function ImportarProveedoresModal({ onClose, onCargado }: { onClose: () => void; onCargado: () => void }) {
  const { tenant } = useAuthStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const [filas, setFilas] = useState<FilaProv[]>([])
  const [originales, setOriginales] = useState<Record<string, unknown>[]>([])
  const [modo, setModo] = useState<Modo>('ignorar_existentes')
  const [cargando, setCargando] = useState(false)
  const [resultado, setResultado] = useState<ResultadoCarga | null>(null)

  const descargarPlantilla = async () => {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([
      [...COLUMNAS],
      ['Distribuidora Central', 'Distribuidora Central SRL', '30-71234567-8', 'Responsable Inscripto', 'Av. Siempre Viva 742, CABA', 'Juan Pérez', '11 1234-5678', 'ventas@ejemplo.com', 30, 'Banco Nación', '', 'proveedor', '', 'insumos, mayorista', ''],
    ])
    ws['!cols'] = [24, 28, 16, 22, 30, 18, 16, 26, 10, 16, 24, 12, 12, 20, 24].map(wch => ({ wch }))
    XLSX.utils.book_append_sheet(wb, ws, 'Proveedores')
    const ref = XLSX.utils.aoa_to_sheet([
      ['Columna', 'Requerida', 'Notas'],
      ['nombre', 'SÍ (alta)', 'Nombre comercial. Si ya existe un proveedor con ese CUIT (o, sin CUIT, con ese nombre) se lo trata como existente.'],
      ['cuit', 'no', '11 dígitos, con o sin guiones. Se valida el dígito verificador.'],
      ['condicion_iva', 'no', 'Responsable Inscripto, Monotributo, Exento o Consumidor Final.'],
      ['plazo_pago_dias', 'no', 'Días enteros (0 a 365).'],
      ['cbu', 'no', '22 dígitos. Se validan los dígitos verificadores.'],
      ['tipo', 'no', 'proveedor (por defecto) o servicio.'],
      ['etiquetas', 'no', 'Separadas por coma.'],
      ['(actualizar)', '', 'Al actualizar un proveedor existente se escriben solo las celdas con valor: una vacía NO borra el dato.'],
    ])
    ref['!cols'] = [{ wch: 18 }, { wch: 12 }, { wch: 100 }]
    XLSX.utils.book_append_sheet(wb, ref, 'Referencia')
    const listas = [
      { nombre: 'lst_cond_iva', valores: CONDICION_IVA_PLANTILLA, col: 'condicion_iva', titulo: 'Condición IVA no válida', texto: 'Elegí una de la lista.' },
      { nombre: 'lst_tipo', valores: ['proveedor', 'servicio'], col: 'tipo', titulo: 'Tipo no válido', texto: 'proveedor o servicio.' },
    ]
    const filasListas: string[][] = [listas.map(l => l.nombre)]
    for (let i = 0; i < Math.max(...listas.map(l => l.valores.length)); i++) filasListas.push(listas.map(l => l.valores[i] ?? ''))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filasListas), 'Listas')
    wb.Workbook = {
      Sheets: [{ Hidden: 0 }, { Hidden: 0 }, { Hidden: 1 }],
      Names: listas.map((l, i) => ({ Name: l.nombre, Ref: `Listas!$${letraColumna(i)}$2:$${letraColumna(i)}$${l.valores.length + 1}` })),
    }
    const validaciones: ValidacionLista[] = listas.map(l => ({
      columna: letraColumna(COLUMNAS.indexOf(l.col as any)), filaDesde: 2, filaHasta: MAX_FILAS_IMPORTACION,
      nombreLista: l.nombre, errorTitulo: l.titulo, errorTexto: l.texto,
    }))
    const bytes = agregarValidacionesXlsx(new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })), 1, validaciones)
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
    const a = document.createElement('a'); a.href = url; a.download = 'plantilla_proveedores.xlsx'; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const procesarArchivo = (file: File) => {
    setResultado(null)
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const XLSX = await import('xlsx')
        const wb = XLSX.read(new Uint8Array(e.target!.result as ArrayBuffer), { type: 'array' })
        const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
        if (!rows.length) { toast.error('El archivo está vacío'); return }
        if (rows.length > MAX_FILAS_IMPORTACION) {
          toast.error(`El archivo tiene ${rows.length} filas; el máximo por importación es ${MAX_FILAS_IMPORTACION}. Dividilo en partes.`)
          return
        }
        const { data: existentes, error } = await traerTodoConError<any>((d, h) => supabase.from('proveedores')
          .select('id, nombre, cuit').eq('tenant_id', tenant!.id).range(d, h))
        // Sin esta respuesta todos parecerían nuevos y se duplicarían.
        if (error) { toast.error('No se pudo revisar qué proveedores ya existen. Intentá de nuevo.'); return }
        const porCuit = new Map<string, any>()
        const porNombre = new Map<string, any>()
        for (const p of (existentes ?? []) as any[]) {
          const c = normalizarCuit(p.cuit)
          if (c) porCuit.set(c, p)
          porNombre.set(String(p.nombre).trim().toLowerCase(), p)
        }

        const cuitsArchivo = new Map<string, number[]>()
        const nuevas: FilaProv[] = rows.map((row, idx) => {
          const errores: string[] = []
          const txt = (k: string) => String(row[k] ?? '').trim()
          const campos: Record<string, unknown> = {}
          const nombre = txt('nombre')
          if (nombre) campos.nombre = nombre
          for (const k of ['razon_social', 'domicilio', 'contacto', 'telefono', 'banco', 'dni', 'notas']) if (txt(k)) campos[k] = txt(k)

          const cuit = normalizarCuit(txt('cuit'))
          if (txt('cuit')) {
            if (!cuitValido(cuit)) errores.push(`CUIT "${txt('cuit')}" inválido (revisá el dígito verificador)`)
            else { campos.cuit = cuit; cuitsArchivo.set(cuit, [...(cuitsArchivo.get(cuit) ?? []), filaExcel(idx)]) }
          }
          const cond = condicionIvaProveedor(row.condicion_iva)
          if (cond === 'invalida') errores.push(`Condición IVA "${txt('condicion_iva')}" no válida (Responsable Inscripto, Monotributo, Exento o Consumidor Final)`)
          else if (cond) campos.condicion_iva = cond
          const email = txt('email')
          if (email) {
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errores.push(`Email "${email}" no válido`)
            else campos.email = email
          }
          const plazo = txt('plazo_pago_dias')
          if (plazo) {
            if (!/^\d{1,3}$/.test(plazo) || Number(plazo) > 365) errores.push(`Plazo de pago "${plazo}": días enteros de 0 a 365`)
            else campos.plazo_pago_dias = Number(plazo)
          }
          const cbu = txt('cbu').replace(/\D/g, '')
          if (txt('cbu')) {
            if (!cbuValido(cbu)) errores.push(`CBU "${txt('cbu')}" inválido (22 dígitos con verificadores correctos)`)
            else campos.cbu = cbu
          }
          const tipo = tipoProveedor(row.tipo)
          if (tipo === 'invalida') errores.push(`Tipo "${txt('tipo')}" no válido (proveedor o servicio)`)
          else if (txt('tipo')) campos.tipo = tipo
          const etiquetas = txt('etiquetas').split(/[,;]/).map(s => s.trim()).filter(Boolean)
          if (etiquetas.length) campos.etiquetas = etiquetas

          // Existente: primero por CUIT; sin CUIT, por nombre.
          const match = (cuit && porCuit.get(cuit)) || (!cuit && nombre ? porNombre.get(nombre.toLowerCase()) : undefined)
          if (!match && !nombre) errores.push('Nombre requerido')
          return { idx, nombre, campos, matchId: match?.id, matchNombre: match?.nombre, errores }
        })
        // CUIT repetido en el archivo, o dos filas sobre el mismo proveedor existente.
        const porMatch = new Map<string, number[]>()
        nuevas.forEach(f => { if (f.matchId) porMatch.set(f.matchId, [...(porMatch.get(f.matchId) ?? []), filaExcel(f.idx)]) })
        for (const f of nuevas) {
          const c = f.campos.cuit as string | undefined
          if (c && cuitsArchivo.get(c)!.length > 1) f.errores.push(`CUIT repetido en el archivo (filas ${cuitsArchivo.get(c)!.join(', ')})`)
          else if (f.matchId && porMatch.get(f.matchId)!.length > 1) {
            f.errores.push(`Las filas ${porMatch.get(f.matchId)!.join(', ')} son el mismo proveedor (${f.matchNombre}): dejá una sola`)
          }
        }
        setFilas(nuevas)
        setOriginales(rows)
      } catch { toast.error('Error al leer el archivo.') }
    }
    reader.readAsArrayBuffer(file)
  }

  const accion = (f: FilaProv): 'crear' | 'actualizar' | null => {
    if (f.errores.length) return null
    if (f.matchId) return modo === 'ignorar_existentes' ? null : 'actualizar'
    return modo === 'ignorar_nuevos' ? null : 'crear'
  }

  const cargar = async () => {
    if (filas.some(f => f.errores.length)) return   // D3-a: todo o nada
    const items = filas.flatMap(f => {
      const a = accion(f)
      return a ? [{ fila: filaExcel(f.idx), accion: a, id: a === 'actualizar' ? f.matchId : undefined, campos: f.campos }] : []
    })
    if (!items.length) return
    setCargando(true)
    try {
      const { data, error } = await supabase.rpc('fn_importar_proveedores', { p_filas: items })
      if (error) { setResultado({ ok: false, mensaje: mensajeErrorCarga(error) }); return }
      const r = data as { creados: number; actualizados: number }
      const ignorados = filas.length - items.length
      setResultado({ ok: true, resumen: `${r.creados} creados · ${r.actualizados} actualizados${ignorados ? ` · ${ignorados} ignorados` : ''}` })
      setFilas([]); setOriginales([])
      onCargado()
    } catch (e: any) {
      setResultado({ ok: false, mensaje: mensajeErrorCarga(e) })
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-6xl h-[95vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <h2 className="text-lg font-bold text-primary flex items-center gap-2">
            <FileSpreadsheet size={18} className="text-accent-text" /> Importar proveedores
          </h2>
          <button onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {resultado && (
            <ResultadoImportacion resultado={resultado} accion={resultado.ok && (
              <button onClick={onClose} className="mt-2 text-sm text-green-700 dark:text-green-400 font-medium hover:underline">Cerrar →</button>
            )} />
          )}
          {!resultado?.ok && (
            <div className="flex gap-3 flex-wrap">
              <button onClick={descargarPlantilla}
                className="flex items-center gap-2 border border-accent-text text-accent-text font-medium px-4 py-2 rounded-xl hover:bg-accent/5 text-sm">
                <Download size={14} /> Descargar plantilla
              </button>
              <button onClick={() => fileRef.current?.click()}
                className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-white font-medium px-4 py-2 rounded-xl text-sm">
                <Upload size={14} /> {filas.length > 0 || resultado ? 'Subir el archivo corregido' : 'Subir archivo'}
              </button>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) procesarArchivo(f); e.target.value = '' }} />
            </div>
          )}
          {filas.length > 0 && !resultado?.ok && (
            <VistaPreviaImportacion
              entidadPlural="proveedores"
              columnas={['Nombre', 'Razón social', 'CUIT', 'Condición IVA', 'Teléfono', 'Email']}
              filas={filas.map(f => {
                const a = accion(f)
                return {
                  idx: f.idx, errores: f.errores,
                  estado: f.errores.length ? 'error' : a === 'crear' ? 'nuevo' : a === 'actualizar' ? 'existente' : 'omitida',
                  detalle: f.matchId ? (a ? `Ya existe (${f.matchNombre}): se actualizan las columnas con valor` : `Ya existe (${f.matchNombre})`) : undefined,
                  celdas: [f.nombre || f.matchNombre || '—', (f.campos.razon_social as string) ?? '—', (f.campos.cuit as string) ?? '—',
                    (f.campos.condicion_iva as string)?.replace('_', ' ') ?? '—', (f.campos.telefono as string) ?? '—', (f.campos.email as string) ?? '—'],
                }
              })}
              cargando={cargando}
              onCargar={cargar}
              onBajarErrores={() => {
                const err = filasConErrorParaExportar(originales, filas)
                if (err.length) void descargarExcel({ nombre: 'Filas con error', filas: err }, 'proveedores_filas_con_error')
              }}
              opciones={filas.some(f => f.matchId) && (
                <div className="bg-gray-50 dark:bg-gray-700/40 border border-gray-100 dark:border-gray-700 rounded-xl p-3">
                  <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2">Hay proveedores que ya existen. ¿Qué hago con ellos?</p>
                  {([
                    ['ignorar_existentes', 'Ignorar existentes — solo crear los nuevos'],
                    ['ignorar_nuevos', 'Ignorar nuevos — solo actualizar los existentes'],
                    ['procesar_todos', 'Procesar todos — crear nuevos y actualizar existentes'],
                  ] as [Modo, string][]).map(([v, label]) => (
                    <label key={v} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                      <input type="radio" name="imp-prov-modo" checked={modo === v} onChange={() => setModo(v)} /> {label}
                    </label>
                  ))}
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">Al actualizar se escriben solo las columnas con valor: una celda vacía no borra lo que ya tiene el proveedor.</p>
                </div>
              )}
            />
          )}
          {filas.length === 0 && !resultado && (
            <div className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-8 text-center cursor-pointer hover:border-accent-text hover:bg-accent/5"
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) procesarArchivo(f) }}>
              <FileSpreadsheet size={32} className="text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500 dark:text-gray-400">Arrastrá o hacé click para subir tu Excel</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Columnas: {COLUMNAS.join(', ')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
