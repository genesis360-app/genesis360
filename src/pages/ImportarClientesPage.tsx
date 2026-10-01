// Importar clientes desde Excel/CSV. Página completa con el mismo diseño que Importar productos / inventario
// (PaginaImportacion, pedido de GO 2026-10-01). Dos pasos y TODO O NADA (D3-a, mig 448 `fn_importar_clientes`).
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Users } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { traerTodoConError } from '@/lib/traerTodo'
import { useAuthStore } from '@/store/authStore'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'
import { descargarExcel } from '@/lib/exportarArchivo'
import { filaExcel, filasConErrorParaExportar, MAX_FILAS_IMPORTACION, mensajeErrorCarga, skusRepetidos } from '@/lib/importacion'
import { ResultadoImportacion, VistaPreviaImportacion, type ResultadoCarga } from '@/components/importacion/VistaPreviaImportacion'
import { PaginaImportacion, TarjetaImportacion } from '@/components/importacion/PaginaImportacion'

interface FilaCliente {
  idx: number
  nombre: string
  dni?: string
  telefono?: string
  email?: string
  notas?: string
  etiquetas?: string[]
  matchId?: string   // id del cliente existente si es duplicado (A5)
  estado: 'nuevo' | 'duplicado' | 'error'
  errores: string[]
}

type Modo = 'ignorar_existentes' | 'ignorar_nuevos' | 'procesar_todos'

export default function ImportarClientesPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { tenant, user } = useAuthStore()
  const { sucursalId } = useSucursalFilter()
  const [filas, setFilas] = useState<FilaCliente[]>([])
  const [originales, setOriginales] = useState<Record<string, unknown>[]>([])
  const [cargando, setCargando] = useState(false)
  // D3-a: la carga es todo o nada → o se cargó todo, o no se cargó nada (con el motivo).
  const [resultado, setResultado] = useState<ResultadoCarga | null>(null)
  // A5 — modo de resolución de duplicados (espeja importar productos)
  const [modo, setModo] = useState<Modo>('ignorar_existentes')

  // ── Importación masiva ───────────────────────────────────────────────────
  const descargarPlantilla = async () => {
    const XLSX = await import('xlsx')
    const ws = XLSX.utils.aoa_to_sheet([
      ['nombre', 'dni', 'telefono', 'email', 'notas', 'etiquetas'],
      ['Juan Pérez', '20123456', '+54 11 1234-5678', 'juan@email.com', 'Cliente frecuente', 'mayorista, vip'],
      ['María García', '27654321', '', 'maria@empresa.com', '', 'zona-norte'],
    ])
    const hdr = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '1E3A5F' } }, alignment: { horizontal: 'center' } }
    ;['A', 'B', 'C', 'D', 'E', 'F'].forEach(c => { if (ws[`${c}1`]) ws[`${c}1`].s = hdr })
    ws['!cols'] = [{ wch: 25 }, { wch: 20 }, { wch: 28 }, { wch: 35 }, { wch: 25 }, { wch: 22 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Clientes')
    XLSX.writeFile(wb, 'plantilla_clientes.xlsx')
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

        // A5 — detección de duplicados contra TODA la base (por DNI, teléfono o nombre)
        // Sin tope: "contra TODA la base" tiene que ser toda de verdad. Con mas de 1000 clientes,
        // PostgREST devolvia 1000 y el importador no veia los duplicados del resto.
        const { data: existentes, error: errExist } = await traerTodoConError<any>((desde, hasta) => supabase.from('clientes')
          .select('id, nombre, dni, telefono, email').eq('tenant_id', tenant!.id).range(desde, hasta))
        // Sin esta respuesta todos parecerían nuevos y se duplicarían: mejor no mostrar nada.
        if (errExist) { toast.error('No se pudo revisar qué clientes ya existen. Intentá de nuevo.'); return }
        const norm = (s: string) => (s ?? '').replace(/\D/g, '')
        const porDni = new Map<string, string>()
        const porTel = new Map<string, string>()
        const porNombre = new Map<string, string>()
        const porEmail = new Map<string, string>()
        const nombrePorId = new Map<string, string>()
        for (const c of (existentes ?? []) as any[]) {
          if (c.dni) porDni.set(String(c.dni).trim(), c.id)
          if (c.telefono && norm(c.telefono)) porTel.set(norm(c.telefono), c.id)
          if (c.email) porEmail.set(String(c.email).trim(), c.id)
          porNombre.set(c.nombre.trim().toLowerCase(), c.id)
          nombrePorId.set(c.id, c.nombre)
        }

        const dniRepetidos = skusRepetidos(rows.map(r => String(r.dni || '')))
        const emailRepetidos = skusRepetidos(rows.map(r => String(r.email || '')))
        const filas: FilaCliente[] = rows.map((row, idx) => {
          const errores: string[] = []
          const nombre = String(row.nombre || '').trim()
          if (!nombre) errores.push('Nombre requerido')
          const dni = String(row.dni || '').trim() || undefined
          const telefono = String(row.telefono || '').trim() || undefined
          const email = String(row.email || '').trim() || undefined
          const etiquetasRaw = String(row.etiquetas || '').trim()
          const matchId =
            (dni && porDni.get(dni)) ||
            (telefono && porTel.get(norm(telefono))) ||
            porNombre.get(nombre.toLowerCase()) || undefined
          if (dni && dniRepetidos.has(dni.toUpperCase())) errores.push(`DNI repetido en el archivo (filas ${dniRepetidos.get(dni.toUpperCase())!.join(', ')})`)
          if (email && emailRepetidos.has(email.toUpperCase())) errores.push(`Email repetido en el archivo (filas ${emailRepetidos.get(email.toUpperCase())!.join(', ')})`)
          // El DNI y el email son únicos por negocio: si ya los tiene OTRO cliente, la carga fallaría.
          const duenoDni = dni ? porDni.get(dni) : undefined
          if (duenoDni && duenoDni !== matchId) errores.push(`El DNI ya es de otro cliente (${nombrePorId.get(duenoDni)})`)
          const duenoEmail = email ? porEmail.get(email) : undefined
          if (duenoEmail && duenoEmail !== matchId) errores.push(`El email ya es de otro cliente (${nombrePorId.get(duenoEmail)})`)
          return {
            idx,
            nombre,
            dni,
            telefono,
            email,
            notas: String(row.notas || '').trim() || undefined,
            etiquetas: etiquetasRaw ? etiquetasRaw.split(/[,;]/).map(s => s.trim()).filter(Boolean) : undefined,
            matchId,
            estado: errores.length > 0 ? 'error' : matchId ? 'duplicado' : 'nuevo',
            errores,
          }
        })
        // Dos filas del archivo que caen sobre el MISMO cliente existente: antes "ganaba la última" sin aviso.
        const filasPorCliente = new Map<string, number[]>()
        filas.forEach(f => { if (f.matchId) filasPorCliente.set(f.matchId, [...(filasPorCliente.get(f.matchId) ?? []), filaExcel(f.idx)]) })
        for (const f of filas) {
          const otras = f.matchId ? filasPorCliente.get(f.matchId)! : []
          if (otras.length > 1) {
            f.errores.push(`Las filas ${otras.join(', ')} son el mismo cliente (${nombrePorId.get(f.matchId!)}): dejá una sola`)
            f.estado = 'error'
          }
        }
        setFilas(filas)
        setOriginales(rows)
      } catch { toast.error('Error al leer el archivo.') }
    }
    reader.readAsArrayBuffer(file)
  }

  // A5 — modo: ignorar_existentes (solo nuevos) · ignorar_nuevos (solo actualizar) · procesar_todos
  const accionCliente = (f: FilaCliente): 'crear' | 'actualizar' | null => {
    if (f.estado === 'error') return null
    if (f.estado === 'duplicado') return modo === 'ignorar_existentes' ? null : 'actualizar'
    return modo === 'ignorar_nuevos' ? null : 'crear'
  }

  const confirmarImport = async () => {
    if (filas.some(f => f.estado === 'error')) return   // D3-a: todo o nada (el botón no aparece con errores)
    // Solo las columnas con valor: al actualizar, una celda vacía NO borra el dato que ya tenía el cliente (antes sí).
    const items = filas.flatMap(f => {
      const accion = accionCliente(f)
      if (!accion) return []
      const campos: Record<string, unknown> = { nombre: f.nombre }
      if (f.dni) campos.dni = f.dni
      if (f.telefono) campos.telefono = f.telefono
      if (f.email) campos.email = f.email
      if (f.notas) campos.notas = f.notas
      if (f.etiquetas?.length) campos.etiquetas = f.etiquetas
      return [{ fila: filaExcel(f.idx), accion, id: accion === 'actualizar' ? f.matchId : undefined, campos }]
    })
    if (items.length === 0) return
    setCargando(true)
    try {
      // 🛑 D3-a — una sola llamada; la base aplica todo en una transacción (mig 448).
      const { data, error } = await supabase.rpc('fn_importar_clientes', { p_filas: items, p_sucursal_id: sucursalId || null })
      if (error) { setResultado({ ok: false, mensaje: mensajeErrorCarga(error) }); return }
      const r = data as { creados: number; actualizados: number }
      const ignorados = filas.length - items.length
      setResultado({ ok: true, resumen: `${r.creados} creados · ${r.actualizados} actualizados${ignorados ? ` · ${ignorados} ignorados` : ''}` })
      setFilas([])
      setOriginales([])
      toast.success(`${r.creados} creados · ${r.actualizados} actualizados`)
    } catch (e: any) {
      setResultado({ ok: false, mensaje: mensajeErrorCarga(e) })
    } finally {
      setCargando(false)
      qc.invalidateQueries({ queryKey: ['clientes'] })
      qc.invalidateQueries({ queryKey: ['cliente-etiquetas-catalogo'] })
    }
  }


  // H2 — el CONTADOR entra a Clientes en solo lectura; el Lector tampoco importa (la base lo rechaza igual, mig 448).
  if (user?.rol === 'CONTADOR' || (user?.rol as string | undefined) === 'VIEWER') {
    return <div className="p-6 text-sm text-amber-700">Tu rol tiene acceso de solo lectura en Clientes.</div>
  }

  return (
    <PaginaImportacion
      titulo="Importar clientes"
      subtitulo="Cargá tus clientes desde Excel"
      volverA="/clientes"
      onPlantilla={descargarPlantilla}
      onArchivo={procesarArchivo}
      hayFilas={filas.length > 0}
      iconoVacio={<Users size={28} className="text-gray-300 mx-auto mb-2" />}
      resultado={resultado && (
        <ResultadoImportacion resultado={resultado} accion={resultado.ok && (
          <button onClick={() => navigate('/clientes')} className="mt-2 text-sm text-green-700 dark:text-green-400 font-medium hover:underline">Ver clientes →</button>
        )} />
      )}
      aviso={
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900 rounded-xl p-4 text-sm text-blue-700 dark:text-blue-300">
          <strong>Carga masiva de clientes</strong> — un cliente que ya existe se reconoce por DNI, teléfono o nombre.
          Todo o nada: con una fila con error no se carga ninguna.
        </div>
      }
      opciones={filas.some(f => f.estado === 'duplicado') && (
        <TarjetaImportacion titulo="Si el cliente ya existe">
          <div className="space-y-2">
            {([
              ['ignorar_existentes', 'Solo crear nuevos', 'Ignorar los que ya existen'],
              ['ignorar_nuevos', 'Solo actualizar', 'Ignorar los nuevos'],
              ['procesar_todos', 'Crear y actualizar', 'Procesar todos'],
            ] as [Modo, string, string][]).map(([v, label, desc]) => (
              <label key={v} className="flex items-start gap-3 cursor-pointer p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50">
                <input type="radio" name="import-modo" checked={modo === v} onChange={() => setModo(v)} className="mt-0.5" />
                <div><p className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</p><p className="text-xs text-gray-400 dark:text-gray-500">{desc}</p></div>
              </label>
            ))}
            <p className="text-[11px] text-gray-500 dark:text-gray-400">Al actualizar se escriben solo las celdas con valor: una vacía no borra lo que ya tiene el cliente.</p>
          </div>
        </TarjetaImportacion>
      )}
    >
      <VistaPreviaImportacion
        entidadPlural="clientes"
        columnas={['Nombre', 'DNI', 'Teléfono', 'Email']}
        filas={filas.map(f => {
          const accion = accionCliente(f)
          return {
            idx: f.idx,
            errores: f.errores,
            estado: f.estado === 'error' ? 'error' : accion === 'crear' ? 'nuevo' : accion === 'actualizar' ? 'existente' : 'omitida',
            detalle: f.estado === 'duplicado' ? (accion ? 'Ya existe: se actualizan las columnas con valor' : 'Ya existe') : undefined,
            celdas: [f.nombre || '—', f.dni ?? '—', f.telefono ?? '—', f.email ?? '—'],
          }
        })}
        cargando={cargando}
        onCargar={confirmarImport}
        onBajarErrores={() => {
          const err = filasConErrorParaExportar(originales, filas)
          if (err.length) void descargarExcel({ nombre: 'Filas con error', filas: err }, 'clientes_filas_con_error')
        }}
      />
    </PaginaImportacion>
  )
}
