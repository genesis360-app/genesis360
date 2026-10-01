import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Upload, Download, FileSpreadsheet, Boxes, AlertTriangle } from 'lucide-react'
// xlsx se importa dinámicamente en descargarPlantilla/procesarArchivo (auditoría perf 2026-08-14, P5).
import { supabase } from '@/lib/supabase'
import { traerTodoConError } from '@/lib/traerTodo'
import { useAuthStore } from '@/store/authStore'
import { usePlanLimits } from '@/hooks/usePlanLimits'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'
import { useModoOperacion } from '@/hooks/useModoOperacion'
import { moduloSoloLectura } from '@/lib/permisosModulo'
import { UpgradePrompt } from '@/components/UpgradePrompt'
import { ResultadoImportacion, VistaPreviaImportacion, type ResultadoCarga } from '@/components/importacion/VistaPreviaImportacion'
import { descargarExcel } from '@/lib/exportarArchivo'
import { filaExcel, filasConErrorParaExportar, mensajeErrorCarga, resolverReferencia, type ItemMaestro } from '@/lib/importacion'
import { fechaImportada, MAX_FILAS_INVENTARIO } from '@/lib/importarInventario'
import toast from 'react-hot-toast'

// ─── Importar inventario (ingreso masivo de stock desde archivo) ───────────────────────────────────────────────────
// D3-a (Fede/GO): vista previa completa → botón aparte → TODO O NADA. La carga la hace la base en UNA transacción
// (mig 449 `fn_importar_inventario`) con el mismo resultado que el ingreso normal de Inventario: línea con su SUCURSAL,
// series, movimiento `ingreso` con stock antes/después por sucursal, lote/vencimiento/atributos obligatorios según el
// producto, LPN único, ubicación Mono-SKU, conteo wall-to-wall. Antes esto se escribía fila por fila desde el
// navegador, sin sucursal, ignorando en silencio ubicaciones/estados mal escritos y truncando decimales.

const ATRIBUTOS = ['talle', 'color', 'encaje', 'formato', 'sabor_aroma'] as const
type Atributo = typeof ATRIBUTOS[number]

interface FilaInventario {
  idx: number
  sku: string
  producto_nombre: string
  producto_id: string
  tiene_series: boolean
  cantidad: number
  series?: string[]
  precio_costo?: string
  ubicacion?: string
  ubicacion_id: string | null
  estado?: string
  estado_id: string | null
  proveedor?: string
  proveedor_id: string | null
  nro_lote?: string
  fecha_vencimiento?: string
  lpn?: string
  motivo?: string
  atributos: Partial<Record<Atributo, string>>
  avisos: string[]
  errores: string[]
}

export default function ImportarInventarioPage() {
  const { limits } = usePlanLimits()
  const navigate = useNavigate()
  const { tenant, user } = useAuthStore()
  const { sucursalId, sucursales } = useSucursalFilter()
  const { avanzado } = useModoOperacion()
  const qc = useQueryClient()
  const soloLectura = moduloSoloLectura(user as any, 'movimientos')

  const fileRef = useRef<HTMLInputElement>(null)
  const [sucursalElegida, setSucursalElegida] = useState<string>('')
  const sucursalDestino = sucursalId ?? (sucursalElegida || null)

  const [filas, setFilas] = useState<FilaInventario[]>([])
  const [originales, setOriginales] = useState<Record<string, unknown>[]>([])
  const [importando, setImportando] = useState(false)
  const [resultado, setResultado] = useState<ResultadoCarga | null>(null)

  const descargarPlantilla = async () => {
    const XLSX = await import('xlsx')
    const ws = XLSX.utils.aoa_to_sheet([
      ['sku', 'cantidad', 'precio_costo', 'ubicacion', 'estado', 'proveedor', 'nro_lote', 'fecha_vencimiento', 'lpn', 'motivo', 'numeros_serie', ...ATRIBUTOS],
      ['TORN-0001', 100, 150, 'Depósito A', 'Disponible', 'Proveedor A', 'L-2024-001', '2025-12-31', '', 'Carga inicial', ''],
      ['PINT-0001', 20, '', 'Estante 2', '', '', '', '', '', '', ''],
      ['CELULAR-001', '', '', 'Depósito B', '', '', '', '', '', 'Carga inicial', 'SN-0001,SN-0002,SN-0003'],
    ])
    ws['!cols'] = [15, 12, 14, 15, 15, 15, 15, 18, 15, 20, 35, 10, 10, 10, 10, 12].map(wch => ({ wch }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Inventario')
    const wsRef = XLSX.utils.aoa_to_sheet([
      ['Campo', 'Requerido', 'Notas'],
      ['sku', 'SÍ', 'Debe existir en el catálogo de productos (activo).'],
      ['cantidad', 'SÍ (sin series)', 'Número ENTERO mayor a 0, en la unidad base del producto. Ignorado para productos con series.'],
      ['precio_costo', 'no', 'Costo de este ingreso (solo para la línea). Si está vacío, usa el del producto.'],
      ['ubicacion', 'no', 'Nombre de la ubicación de la sucursal (o global). Debe existir y estar activa. Una ubicación Mono-SKU no admite un segundo producto.'],
      ['estado', 'no', 'Estado del inventario. Si está vacío, usa el predeterminado del producto.'],
      ['proveedor', 'no', 'Si está vacío, usa el del producto.'],
      ['nro_lote', 'si el producto lo pide', 'Número de lote.'],
      ['fecha_vencimiento', 'si el producto lo pide', 'AAAA-MM-DD o DD/MM/AAAA.'],
      ['lpn', 'no', 'Identificador del bulto. Único entre los activos; se autogenera si está vacío.'],
      ['motivo', 'no', 'Ej: Carga inicial. Por defecto "Carga masiva".'],
      ['numeros_serie', 'SÍ (con series)', 'Separadas por coma. No pueden estar ya cargadas.'],
      ['talle / color / encaje / formato / sabor_aroma', 'si el producto lo pide', 'Atributos de variante.'],
    ])
    wsRef['!cols'] = [{ wch: 28 }, { wch: 20 }, { wch: 90 }]
    XLSX.utils.book_append_sheet(wb, wsRef, 'Referencia')
    XLSX.writeFile(wb, 'plantilla_inventario.xlsx')
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
        if (rows.length > MAX_FILAS_INVENTARIO) {
          toast.error(`El archivo tiene ${rows.length} filas; el máximo por importación de stock es ${MAX_FILAS_INVENTARIO}. Dividilo en partes.`)
          return
        }

        // Maestros de AHORA (no los de cuando se abrió la pantalla) y sin tope de 1000 filas.
        const [prods, ubics, ests, provs] = await Promise.all([
          traerTodoConError<any>((d, h) => supabase.from('productos')
            .select('id, nombre, sku, tiene_series, tiene_lote, tiene_vencimiento, tiene_talle, tiene_color, tiene_encaje, tiene_formato, tiene_sabor_aroma, estado_id, proveedor_id')
            .eq('tenant_id', tenant!.id).eq('activo', true).range(d, h)),
          traerTodoConError<any>((d, h) => supabase.from('ubicaciones').select('id, nombre, activo, sucursal_id')
            .eq('tenant_id', tenant!.id).range(d, h)),
          traerTodoConError<any>((d, h) => supabase.from('estados_inventario').select('id, nombre, activo')
            .eq('tenant_id', tenant!.id).range(d, h)),
          traerTodoConError<any>((d, h) => supabase.from('proveedores').select('id, nombre, activo')
            .eq('tenant_id', tenant!.id).range(d, h)),
        ])
        if (prods.error || ubics.error || ests.error || provs.error) {
          toast.error('No se pudieron leer los productos o la configuración. Intentá de nuevo.')
          return
        }
        const porSku = new Map<string, any>((prods.data ?? []).map((p: any) => [String(p.sku).toUpperCase(), p]))
        // Ubicaciones de la sucursal destino o globales.
        const ubicacionesSuc: ItemMaestro[] = (ubics.data ?? []).filter((u: any) => !u.sucursal_id || u.sucursal_id === sucursalDestino)
        const seriesVistas = new Map<string, number>()
        const lpnsVistos = new Map<string, number>()

        const preview: FilaInventario[] = rows.map((row, idx) => {
          const errores: string[] = []
          const avisos: string[] = []
          const sku = String(row.sku || '').trim().toUpperCase()
          const producto = porSku.get(sku)
          if (!sku) errores.push('SKU requerido')
          else if (!producto) errores.push(`SKU "${sku}" no existe o está inactivo`)
          const tieneSeries = !!producto?.tiene_series

          // Cantidad: entero > 0 (la línea de stock es entera). Antes `parseInt` truncaba 1,5 → 1 sin avisar.
          const cantRaw = String(row.cantidad ?? '').trim().replace(',', '.')
          let cantidad = 0
          let series: string[] | undefined
          if (tieneSeries) {
            series = String(row.numeros_serie || '').split(/[,;]/).map(s => s.trim()).filter(Boolean)
            if (series.length === 0) errores.push('Producto con series: completá numeros_serie')
            for (const s of series) {
              const k = `${sku}|${s}`
              if (seriesVistas.has(k)) errores.push(`La serie ${s} ya aparece en la fila ${filaExcel(seriesVistas.get(k)!)}`)
              else seriesVistas.set(k, idx)
            }
            cantidad = series.length
          } else if (!/^\d+$/.test(cantRaw) || Number(cantRaw) <= 0) {
            errores.push(/^\d+\.\d+$/.test(cantRaw) ? `Cantidad "${row.cantidad}": tiene que ser un número entero` : 'Cantidad: número entero mayor a 0')
          } else {
            cantidad = Number(cantRaw)
          }

          // Referencias (D3-a: desactivada → error con motivo). En modo básico no se usan ubicaciones ni estados.
          const ubicNombre = String(row.ubicacion || '').trim()
          const estNombre = String(row.estado || '').trim()
          const provNombre = String(row.proveedor || '').trim()
          let ubicacion_id: string | null = null
          let estado_id: string | null = null
          if (avanzado) {
            const u = resolverReferencia(ubicNombre, ubicacionesSuc, 'Ubicación')
            if (u.error) errores.push(u.error)
            ubicacion_id = u.id
            const es = resolverReferencia(estNombre, ests.data ?? [], 'Estado')
            if (es.error) errores.push(es.error)
            estado_id = es.id ?? (estNombre ? null : producto?.estado_id ?? null)
            if (!ubicacion_id && !ubicNombre && producto) avisos.push('Sin ubicación: el POS no lo va a poder vender hasta ubicarlo')
          } else if (ubicNombre || estNombre) {
            avisos.push('Modo básico: se ignoran ubicación y estado')
          }
          const pv = resolverReferencia(provNombre, provs.data ?? [], 'Proveedor')
          if (pv.error) errores.push(pv.error)
          const proveedor_id = pv.id ?? (provNombre ? null : producto?.proveedor_id ?? null)

          const nro_lote = String(row.nro_lote || '').trim() || undefined
          const fv = fechaImportada(row.fecha_vencimiento, XLSX)
          if (fv === 'invalida') errores.push(`Fecha de vencimiento "${row.fecha_vencimiento}" inválida (usá AAAA-MM-DD o DD/MM/AAAA)`)
          const fecha_vencimiento = fv && fv !== 'invalida' ? fv : undefined
          if (producto?.tiene_lote && !nro_lote) errores.push('El producto requiere lote')
          if (producto?.tiene_vencimiento && !fecha_vencimiento && fv !== 'invalida') errores.push('El producto requiere fecha de vencimiento')
          const atributos: Partial<Record<Atributo, string>> = {}
          for (const a of ATRIBUTOS) {
            const v = String(row[a] || '').trim()
            if (producto?.[`tiene_${a}`]) {
              if (!v) errores.push(`El producto requiere ${a.replace('_', '/')}`)
              else atributos[a] = v
            }
          }

          const lpn = String(row.lpn || '').trim() || undefined
          if (lpn) {
            if (lpnsVistos.has(lpn)) errores.push(`El LPN "${lpn}" ya aparece en la fila ${filaExcel(lpnsVistos.get(lpn)!)}`)
            else lpnsVistos.set(lpn, idx)
          }
          const costoRaw = String(row.precio_costo ?? '').trim().replace(',', '.')
          if (costoRaw && !/^\d+(\.\d+)?$/.test(costoRaw)) errores.push(`Precio de costo "${row.precio_costo}" inválido`)

          return {
            idx, sku, producto_nombre: producto?.nombre ?? '—', producto_id: producto?.id ?? '',
            tiene_series: tieneSeries, cantidad, series,
            precio_costo: costoRaw || undefined,
            ubicacion: ubicNombre || undefined, ubicacion_id,
            estado: estNombre || undefined, estado_id,
            proveedor: provNombre || undefined, proveedor_id,
            nro_lote, fecha_vencimiento, lpn,
            motivo: String(row.motivo || '').trim() || undefined,
            atributos, avisos, errores,
          }
        })
        setFilas(preview)
        setOriginales(rows)
      } catch { toast.error('Error al leer el archivo.') }
    }
    reader.readAsArrayBuffer(file)
  }

  const confirmar = async () => {
    if (filas.some(f => f.errores.length > 0)) return   // D3-a: todo o nada (el botón no aparece con errores)
    if (!sucursalDestino) { toast.error('Elegí la sucursal de destino del ingreso.'); return }
    if (limits && !limits.puede_crear_movimiento) {
      setResultado({ ok: false, mensaje: 'Límite de movimientos del plan alcanzado. Upgradeá tu plan o comprá movimientos extra.' })
      return
    }
    setImportando(true)
    try {
      // 🛑 REGLA #0 / D3-a — una sola llamada; la base hace línea + series + movimiento en una transacción (mig 449).
      const { data, error } = await supabase.rpc('fn_importar_inventario', {
        p_sucursal_id: sucursalDestino,
        p_filas: filas.map(f => ({
          fila: filaExcel(f.idx),
          producto_id: f.producto_id,
          cantidad: f.tiene_series ? null : String(f.cantidad),
          series: f.series ?? null,
          ubicacion_id: f.ubicacion_id, estado_id: f.estado_id, proveedor_id: f.proveedor_id,
          nro_lote: f.nro_lote ?? null, fecha_vencimiento: f.fecha_vencimiento ?? null,
          lpn: f.lpn ?? null, motivo: f.motivo ?? null, precio_costo: f.precio_costo ?? null,
          ...f.atributos,
        })),
      })
      if (error) { setResultado({ ok: false, mensaje: mensajeErrorCarga(error) }); return }
      const r = data as { lineas: number; unidades: number }
      setResultado({ ok: true, resumen: `${r.lineas} línea${r.lineas !== 1 ? 's' : ''} cargada${r.lineas !== 1 ? 's' : ''} · ${r.unidades} unidades` })
      setFilas([])
      setOriginales([])
      toast.success(`${r.lineas} líneas cargadas al inventario`)
    } catch (e: any) {
      setResultado({ ok: false, mensaje: mensajeErrorCarga(e) })
    } finally {
      setImportando(false)
      qc.invalidateQueries({ queryKey: ['inventario_lineas_all'] })
      qc.invalidateQueries({ queryKey: ['productos'] })
      qc.invalidateQueries({ queryKey: ['movimientos'] })
      qc.invalidateQueries({ queryKey: ['alertas'] })
    }
  }

  if (limits && !limits.puede_importar) return <UpgradePrompt feature="importar" />

  const sinSucursal = !sucursalDestino

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/inventario')} aria-label="Volver" className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
          <ArrowLeft size={20} className="text-gray-600 dark:text-gray-400" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-primary">Importar inventario</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">Cargá stock masivamente desde Excel</p>
        </div>
      </div>

      {soloLectura ? (
        <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-5 flex items-start gap-3 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" /> Tu rol tiene acceso de solo lectura en Inventario.
        </div>
      ) : (
        <>
          {resultado && (
            <ResultadoImportacion resultado={resultado} accion={resultado.ok && (
              <button onClick={() => navigate('/inventario')} className="mt-2 text-sm text-green-700 dark:text-green-400 font-medium hover:underline">Ver inventario →</button>
            )} />
          )}

          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900 rounded-xl p-4 text-sm text-blue-700 dark:text-blue-300 space-y-1">
            <p><strong>Carga masiva de inventario</strong> — cada fila crea una línea de stock (LPN) en la sucursal elegida y registra un movimiento de ingreso, igual que el ingreso manual. Los SKU tienen que existir en el catálogo.</p>
            <p className="text-xs">Todo o nada: con una fila con error no se carga ninguna. Hasta {MAX_FILAS_INVENTARIO} filas por archivo. El importador no consulta la regla de rotación por vencimiento.</p>
          </div>

          <div className="grid lg:grid-cols-3 gap-5">
            <div className="space-y-4">
              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
                <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-2">Sucursal de destino</h2>
                {sucursalId ? (
                  <p className="text-sm text-gray-700 dark:text-gray-200">{(sucursales as any[]).find(s => s.id === sucursalId)?.nombre ?? 'Sucursal activa'}</p>
                ) : (
                  <select value={sucursalElegida} onChange={e => { setSucursalElegida(e.target.value); setFilas([]); setResultado(null) }}
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700">
                    <option value="">Elegí la sucursal…</option>
                    {(sucursales as any[]).map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                  </select>
                )}
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
                <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2"><FileSpreadsheet size={16} className="text-accent-text" /> Plantilla</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Una fila por línea de inventario a cargar.</p>
                <button onClick={descargarPlantilla} className="w-full flex items-center justify-center gap-2 border border-accent-text text-accent-text font-medium py-2.5 rounded-xl hover:bg-accent/10 transition-all text-sm">
                  <Download size={15} /> Descargar plantilla
                </button>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
                <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2"><Upload size={16} className="text-accent-text" /> Subir archivo</h2>
                <div className={`border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-6 text-center transition-all ${sinSucursal ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-accent-text hover:bg-accent/5'}`}
                  onClick={() => { if (!sinSucursal) fileRef.current?.click() }}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && !sinSucursal) procesarArchivo(f) }}>
                  <Boxes size={28} className="text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {sinSucursal ? 'Primero elegí la sucursal' : filas.length > 0 ? 'Subí el archivo corregido' : 'Arrastrá o hacé click'}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">.xlsx, .xls, .csv</p>
                </div>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) procesarArchivo(f); e.target.value = '' }} />
              </div>
            </div>

            <div className="lg:col-span-2">
              {filas.length === 0 ? (
                <div className="bg-white dark:bg-gray-800 rounded-xl p-12 shadow-sm border border-gray-100 dark:border-gray-700 text-center text-gray-400 dark:text-gray-500">
                  <Boxes size={40} className="mx-auto mb-3 opacity-30" />
                  <p className="font-medium">Subí un archivo para ver la previsualización</p>
                </div>
              ) : (
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
                  <VistaPreviaImportacion
                    entidadPlural="líneas al inventario"
                    columnas={['SKU', 'Producto', 'Cantidad', 'Ubicación', 'Estado', 'Lote', 'Vence']}
                    filas={filas.map(f => ({
                      idx: f.idx,
                      errores: f.errores,
                      estado: f.errores.length ? 'error' : 'nuevo',
                      detalle: f.avisos.join(' · ') || undefined,
                      celdas: [f.sku, f.producto_nombre, f.tiene_series ? `${f.cantidad} (series)` : f.cantidad || '—',
                        f.ubicacion ?? '—', f.estado ?? '—', f.nro_lote ?? '—', f.fecha_vencimiento ?? '—'],
                    }))}
                    cargando={importando}
                    onCargar={confirmar}
                    onBajarErrores={() => {
                      const filasErr = filasConErrorParaExportar(originales, filas)
                      if (filasErr.length) void descargarExcel({ nombre: 'Filas con error', filas: filasErr }, 'inventario_filas_con_error')
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
