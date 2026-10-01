// Importar el Maestro (categorías, ubicaciones, estados, motivos, combos, perfiles de vencimiento, grupos de estados).
// Mismo diseño y criterio que los otros importadores (PaginaImportacion, D3-a): vista previa completa → "Cargar" →
// TODO O NADA en la base (mig 452 `fn_importar_maestro`). Solo crea: lo que ya existe (mismo nombre) se ignora.
// Las reglas por tipo viven en src/lib/importarMaestro.ts. Proveedores tiene su propio importador (/proveedores/importar).
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Tag, Truck, MapPin, CircleDot, MessageSquare, Gift, Timer, Layers, ArrowRight } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { traerTodoConError } from '@/lib/traerTodo'
import { useAuthStore } from '@/store/authStore'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'
import { descargarExcel } from '@/lib/exportarArchivo'
import { filasConErrorParaExportar, MAX_FILAS_IMPORTACION, mensajeErrorCarga } from '@/lib/importacion'
import {
  COLUMNAS_MAESTRO, TIPOS_DESCUENTO_PLANTILLA, TIPOS_MOTIVO_PLANTILLA, validarMaestro,
  type FilaMaestro, type TipoMaestro,
} from '@/lib/importarMaestro'
import { agregarValidacionesXlsx, letraColumna, type ValidacionLista } from '@/lib/xlsxValidaciones'
import { ResultadoImportacion, VistaPreviaImportacion, type ResultadoCarga } from '@/components/importacion/VistaPreviaImportacion'
import { PaginaImportacion, TarjetaImportacion } from '@/components/importacion/PaginaImportacion'

interface ConfigTipo {
  label: string
  plural: string          // para "Cargar N …"
  icon: any
  tabla: string
  queryKey: string
  ejemplos: (string | number)[][]
  notas: [string, string, string][]   // columna, requerida, notas (hoja "Referencia")
  /** Destino por sucursal (ubicaciones y combos). */
  porSucursal?: boolean
}

const CONFIG: Record<TipoMaestro, ConfigTipo> = {
  categorias: {
    label: 'Categorías', plural: 'categorías', icon: Tag, tabla: 'categorias', queryKey: 'categorias',
    ejemplos: [['Ferretería', 'Herramientas y materiales']],
    notas: [['nombre', 'SÍ', 'Si ya existe una categoría con ese nombre, la fila se ignora.'], ['descripcion', 'no', '']],
  },
  ubicaciones: {
    label: 'Ubicaciones', plural: 'ubicaciones', icon: MapPin, tabla: 'ubicaciones', queryKey: 'ubicaciones', porSucursal: true,
    ejemplos: [['Depósito A', 'DEP-A', 'Primer piso'], ['Góndola 1', '', '']],
    notas: [
      ['nombre', 'SÍ', 'Si ya existe en la sucursal elegida, la fila se ignora.'],
      ['codigo', 'no', 'Letras y números en mayúscula separados por guiones (ej. A-03-02). Vacío = se genera solo. No puede repetirse en el negocio.'],
      ['descripcion', 'no', ''],
    ],
  },
  estados: {
    label: 'Estados', plural: 'estados', icon: CircleDot, tabla: 'estados_inventario', queryKey: 'estados_inventario',
    ejemplos: [['Bloqueado', '#ef4444'], ['En análisis', '#f97316']],
    notas: [['nombre', 'SÍ', 'Si ya existe, la fila se ignora.'], ['color', 'no', 'Código hex (ej. #22c55e). Vacío = gris.']],
  },
  motivos: {
    label: 'Motivos', plural: 'motivos', icon: MessageSquare, tabla: 'motivos_movimiento', queryKey: 'motivos',
    ejemplos: [['Venta mayorista', 'rebaje'], ['Ingreso proveedor', 'ingreso'], ['Ajuste caja', 'caja']],
    notas: [['nombre', 'SÍ', 'Si ya existe, la fila se ignora.'], ['tipo', 'no', 'ambos (por defecto), ingreso, rebaje o caja. "egreso" se toma como rebaje.']],
  },
  combos: {
    label: 'Combos', plural: 'combos', icon: Gift, tabla: 'combos', queryKey: 'combos', porSucursal: true,
    ejemplos: [
      ['3x Shampoo 10%', 'SKU-001', 3, 'pct', 10, '', ''],
      ['Pack desayuno', 'SKU-010', 1, 'monto_ars', 500, '01/10/2026', '31/12/2026'],
      ['Pack desayuno', 'SKU-011', 2, '', '', '', ''],
    ],
    notas: [
      ['nombre', 'SÍ', 'Varias filas con el mismo nombre = un combo de varios productos (una fila por producto). Si ya existe un combo activo con ese nombre, se ignora.'],
      ['sku', 'SÍ', 'SKU de un producto activo del catálogo.'],
      ['cantidad', 'SÍ', 'Entero de 1 en adelante. Un combo de un solo producto necesita 2 o más.'],
      ['descuento_tipo', 'SÍ', 'pct (porcentaje), monto_ars o monto_usd. Alcanza con ponerlo en la primera fila del combo.'],
      ['descuento_valor', 'SÍ', 'Número con hasta 2 decimales, sin separador de miles. En pct, hasta 100.'],
      ['vigencia_desde / vigencia_hasta', 'no', 'Fechas DD/MM/AAAA. Vacías = sin límite.'],
    ],
  },
  aging: {
    label: 'Perfiles de vencimiento', plural: 'perfiles', icon: Timer, tabla: 'aging_profiles', queryKey: 'aging_profiles',
    ejemplos: [['PERECEDERO', 'Próx a Vencer', 30], ['PERECEDERO', 'Vencido', 0]],
    notas: [
      ['nombre_perfil', 'SÍ', 'Varias filas con el mismo nombre = un perfil con varias reglas. Si el perfil ya existe, se ignora entero.'],
      ['estado', 'SÍ', 'Nombre de un estado de inventario activo (lista desplegable).'],
      ['dias', 'SÍ', 'Días hasta el vencimiento (entero, 0 = vencido). No puede repetirse dentro del perfil.'],
    ],
  },
  grupos: {
    label: 'Grupos de estados', plural: 'grupos', icon: Layers, tabla: 'grupos_estados', queryKey: 'grupos_estados',
    ejemplos: [['Disponible para venta', 'Estados vendibles', 'Disponible|Próx a Vencer', 'SI']],
    notas: [
      ['nombre', 'SÍ', 'Si ya existe, la fila se ignora.'],
      ['estados', 'SÍ', 'Nombres de estados activos separados por | (ej. Disponible|Próx a Vencer).'],
      ['es_default', 'no', 'SI o NO. Solo uno puede ser el predeterminado: reemplaza al actual.'],
    ],
  },
}

const TIPOS = Object.keys(CONFIG) as TipoMaestro[]

export default function ImportarMasterPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { tenant, user } = useAuthStore()
  const { sucursalId, sucursales } = useSucursalFilter()

  const [tipo, setTipo] = useState<TipoMaestro>('categorias')
  // '' = todas las sucursales (como el alta manual sin sucursal).
  const [sucursalDestino, setSucursalDestino] = useState<string>(sucursalId ?? '')
  const [filas, setFilas] = useState<FilaMaestro[]>([])
  const [items, setItems] = useState<Record<string, unknown>[]>([])
  const [originales, setOriginales] = useState<Record<string, unknown>[]>([])
  const [cargando, setCargando] = useState(false)
  const [resultado, setResultado] = useState<ResultadoCarga | null>(null)
  const cfg = CONFIG[tipo]

  const limpiar = () => { setFilas([]); setItems([]); setOriginales([]); setResultado(null) }

  const traerEstados = () => traerTodoConError<any>((d, h) => supabase.from('estados_inventario')
    .select('id, nombre, activo').eq('tenant_id', tenant!.id).range(d, h))

  const descargarPlantilla = async () => {
    const XLSX = await import('xlsx')
    const cols = COLUMNAS_MAESTRO[tipo]
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([cols, ...cfg.ejemplos])
    ws['!cols'] = cols.map(() => ({ wch: 24 }))
    XLSX.utils.book_append_sheet(wb, ws, cfg.label.slice(0, 31))
    const ref = XLSX.utils.aoa_to_sheet([['Columna', 'Requerida', 'Notas'], ...cfg.notas,
      ['(todo o nada)', '', 'Con una sola fila con error no se carga nada: se corrige el archivo y se vuelve a subir.']])
    ref['!cols'] = [{ wch: 30 }, { wch: 12 }, { wch: 100 }]
    XLSX.utils.book_append_sheet(wb, ref, 'Referencia')

    // Listas desplegables donde los valores son fijos (o, en perfiles, los estados del negocio).
    const listas: { nombre: string; valores: string[]; col: string; titulo: string; texto: string }[] = []
    if (tipo === 'motivos') listas.push({ nombre: 'lst_tipo', valores: TIPOS_MOTIVO_PLANTILLA, col: 'tipo', titulo: 'Tipo no válido', texto: 'ambos, ingreso, rebaje o caja.' })
    if (tipo === 'combos') listas.push({ nombre: 'lst_desc', valores: TIPOS_DESCUENTO_PLANTILLA, col: 'descuento_tipo', titulo: 'Tipo de descuento no válido', texto: 'pct, monto_ars o monto_usd.' })
    if (tipo === 'grupos') listas.push({ nombre: 'lst_sino', valores: ['SI', 'NO'], col: 'es_default', titulo: 'Valor no válido', texto: 'SI o NO.' })
    if (tipo === 'aging') {
      const { data } = await traerEstados()
      const activos = ((data ?? []) as any[]).filter(e => e.activo !== false).map(e => e.nombre as string)
      if (activos.length) listas.push({ nombre: 'lst_estado', valores: activos, col: 'estado', titulo: 'Estado no válido', texto: 'Elegí un estado de la lista.' })
    }
    let bytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))
    if (listas.length) {
      const filasListas: string[][] = [listas.map(l => l.nombre)]
      for (let i = 0; i < Math.max(...listas.map(l => l.valores.length)); i++) filasListas.push(listas.map(l => l.valores[i] ?? ''))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filasListas), 'Listas')
      wb.Workbook = {
        Sheets: [{ Hidden: 0 }, { Hidden: 0 }, { Hidden: 1 }],
        Names: listas.map((l, i) => ({ Name: l.nombre, Ref: `Listas!$${letraColumna(i)}$2:$${letraColumna(i)}$${l.valores.length + 1}` })),
      }
      const validaciones: ValidacionLista[] = listas.map(l => ({
        columna: letraColumna(cols.indexOf(l.col)), filaDesde: 2, filaHasta: MAX_FILAS_IMPORTACION,
        nombreLista: l.nombre, errorTitulo: l.titulo, errorTexto: l.texto,
      }))
      bytes = agregarValidacionesXlsx(new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })), 1, validaciones) as Uint8Array
    }
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
    const a = document.createElement('a'); a.href = url; a.download = `plantilla_${tipo}.xlsx`; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const procesarArchivo = (file: File) => {
    setResultado(null)
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const XLSX = await import('xlsx')
        const wb = XLSX.read(new Uint8Array(e.target!.result as ArrayBuffer), { type: 'array' })
        const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
        if (!rows.length) { toast.error('El archivo está vacío'); return }
        if (rows.length > MAX_FILAS_IMPORTACION) {
          toast.error(`El archivo tiene ${rows.length} filas; el máximo por importación es ${MAX_FILAS_IMPORTACION}. Dividilo en partes.`)
          return
        }
        // Sin estas respuestas todo parecería nuevo (y se duplicaría) o las referencias no se resolverían.
        const cols = tipo === 'ubicaciones' ? 'id, nombre, sucursal_id, codigo' : 'id, nombre'
        const [exist, ests, prods] = await Promise.all([
          traerTodoConError<any>((d, h) => {
            let q = supabase.from(cfg.tabla).select(cols).eq('tenant_id', tenant!.id)
            if (tipo === 'combos') q = q.eq('activo', true)
            return q.range(d, h)
          }),
          tipo === 'aging' || tipo === 'grupos' ? traerEstados() : Promise.resolve({ data: [], error: null }),
          tipo === 'combos'
            ? traerTodoConError<any>((d, h) => supabase.from('productos').select('id, nombre, sku, activo').eq('tenant_id', tenant!.id).range(d, h))
            : Promise.resolve({ data: [], error: null }),
        ])
        if (exist.error || ests.error || prods.error) { toast.error('No se pudo revisar lo que ya existe. Intentá de nuevo.'); return }
        const v = validarMaestro(tipo, rows, {
          existentes: exist.data ?? [], estados: ests.data ?? [], productos: prods.data ?? [],
          sucursalId: cfg.porSucursal ? (sucursalDestino || null) : null, xlsx: XLSX,
        })
        setFilas(v.filas); setItems(v.items); setOriginales(rows)
      } catch { toast.error('Error al leer el archivo.') }
    }
    reader.readAsArrayBuffer(file)
  }

  const cargar = async () => {
    if (filas.some(f => f.estado === 'error') || !items.length) return   // D3-a: todo o nada
    setCargando(true)
    try {
      const { data, error } = await supabase.rpc('fn_importar_maestro', {
        p_tipo: tipo, p_filas: items, p_sucursal_id: cfg.porSucursal ? (sucursalDestino || null) : null,
      })
      if (error) { setResultado({ ok: false, mensaje: mensajeErrorCarga(error) }); return }
      const creados = (data as { creados: number }).creados
      const ignorados = filas.filter(f => f.estado === 'existente').length
      setResultado({ ok: true, resumen: `${creados} ${cfg.plural} creados${ignorados ? ` · ${ignorados} filas ignoradas (ya existían)` : ''}` })
      setFilas([]); setItems([]); setOriginales([])
      qc.invalidateQueries({ queryKey: [cfg.queryKey] })
      if (tipo === 'aging') qc.invalidateQueries({ queryKey: ['aging_profile_reglas'] })
    } catch (e: any) {
      setResultado({ ok: false, mensaje: mensajeErrorCarga(e) })
    } finally {
      setCargando(false)
    }
  }

  if ((user?.rol as string | undefined) === 'VIEWER') {
    return <div className="p-6 text-sm text-amber-700">Tu rol tiene acceso de solo lectura.</div>
  }

  const nombreSucursal = (id: string) => (sucursales as any[]).find(s => s.id === id)?.nombre ?? 'Sucursal'

  return (
    <PaginaImportacion
      titulo="Importar datos maestros"
      subtitulo="Cargá configuración desde Excel"
      volverA="/configuracion"
      onPlantilla={descargarPlantilla}
      onArchivo={procesarArchivo}
      hayFilas={filas.length > 0}
      resultado={resultado && (
        <ResultadoImportacion resultado={resultado} accion={resultado.ok && (
          <button onClick={() => navigate('/configuracion')} className="mt-2 text-sm text-green-700 dark:text-green-400 font-medium hover:underline">Volver a Configuración →</button>
        )} />
      )}
      aviso={
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900 rounded-xl p-4 text-sm text-blue-700 dark:text-blue-300">
          <strong>Carga masiva del maestro</strong> — solo crea: lo que ya existe con el mismo nombre se ignora.
          Todo o nada: con una fila con error no se carga ninguna. La hoja "Referencia" de cada plantilla explica las columnas.
        </div>
      }
      antes={<>
        <TarjetaImportacion titulo="¿Qué querés importar?">
          <div className="space-y-1">
            {TIPOS.map(t => {
              const Icon = CONFIG[t].icon
              return (
                <label key={t} className="flex items-center gap-3 cursor-pointer p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <input type="radio" name="tipoMaster" value={t} checked={tipo === t} onChange={() => { setTipo(t); limpiar() }} />
                  <Icon size={15} className="text-accent-text flex-shrink-0" />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{CONFIG[t].label}</span>
                </label>
              )
            })}
            <button onClick={() => navigate('/proveedores/importar')}
              className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 text-left">
              <Truck size={15} className="text-gray-400 flex-shrink-0 ml-[22px]" />
              <span className="text-sm text-gray-500 dark:text-gray-400 flex-1">Proveedores (importador propio)</span>
              <ArrowRight size={14} className="text-gray-400" />
            </button>
          </div>
        </TarjetaImportacion>
        {cfg.porSucursal && (
          <TarjetaImportacion titulo={tipo === 'combos' ? 'Sucursal del combo' : 'Sucursal de las ubicaciones'}>
            <select value={sucursalDestino} onChange={e => { setSucursalDestino(e.target.value); limpiar() }}
              aria-label="Sucursal de destino"
              className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700">
              <option value="">Todas las sucursales</option>
              {(sucursales as any[]).map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">
              {sucursalDestino ? `Se crean solo para ${nombreSucursal(sucursalDestino)}.` : 'Se crean para todas las sucursales.'}
            </p>
          </TarjetaImportacion>
        )}
      </>}
    >
      <VistaPreviaImportacion
        entidadPlural={cfg.plural}
        totalACargar={items.length}
        columnas={COLUMNAS_MAESTRO[tipo].map(c => c === 'nombre_perfil' ? 'Perfil' : c.charAt(0).toUpperCase() + c.slice(1).replace('_', ' '))}
        filas={filas.map(f => ({
          idx: f.idx, errores: f.errores, detalle: f.detalle,
          // Lo que ya existe se ignora (el Maestro solo crea).
          estado: f.estado === 'existente' ? 'omitida' : f.estado,
          celdas: [f.nombre || '—', ...f.celdas.map(c => c || '—')],
        }))}
        cargando={cargando}
        onCargar={cargar}
        onBajarErrores={() => {
          const err = filasConErrorParaExportar(originales, filas)
          if (err.length) void descargarExcel({ nombre: 'Filas con error', filas: err }, `${tipo}_filas_con_error`)
        }}
      />
    </PaginaImportacion>
  )
}
