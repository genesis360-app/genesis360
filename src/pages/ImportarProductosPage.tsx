import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Upload, Download, CheckCircle, XCircle, AlertTriangle, FileSpreadsheet, RefreshCw, Boxes } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import toast from 'react-hot-toast'

// ── Constantes ─────────────────────────────────────────────────────────────
const UNIDADES_VALIDAS = ['unidad', 'kg', 'g', 'litro', 'ml', 'metro', 'cm', 'caja', 'pack', 'docena']
const MONEDAS_VALIDAS  = ['ARS', 'USD']

// Convierte cualquier formato de fecha a YYYY-MM-DD (acepta DD-MM-YYYY, DD/MM/YYYY, serial Excel, o YYYY-MM-DD)
function parseFecha(val: any): string | undefined {
  if (val === null || val === undefined || val === '') return undefined
  if (typeof val === 'number') {
    // Serial de fecha de Excel
    const d = XLSX.SSF.parse_date_code(val)
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
    return undefined
  }
  if (val instanceof Date) {
    return val.toISOString().slice(0, 10)
  }
  const s = String(val).trim()
  if (!s) return undefined
  // DD-MM-YYYY o DD/MM/YYYY
  const m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  // Ya está en YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return s
}

type ModoSKU  = 'crear' | 'actualizar' | 'ambos'
type TabImport = 'productos' | 'inventario'

// ── Tipos ──────────────────────────────────────────────────────────────────
interface FilaProducto {
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

interface FilaInventario {
  idx: number
  sku: string
  producto_nombre: string   // resuelto al procesar
  producto_id: string       // resuelto al procesar
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
  numeros_serie?: string[]  // solo para productos serializados
  estadoFilaImport: 'ok' | 'error'
  errores: string[]
}

// ══════════════════════════════════════════════════════════════════════════════
export default function ImportarProductosPage() {
  const navigate = useNavigate()
  const { tenant, user } = useAuthStore()
  const qc = useQueryClient()

  const fileRefProd = useRef<HTMLInputElement>(null)
  const fileRefInv  = useRef<HTMLInputElement>(null)

  const [tab, setTab] = useState<TabImport>('productos')

  // ── Estado Productos ──────────────────────────────────────────────────────
  const [filasProducto, setFilasProducto] = useState<FilaProducto[]>([])
  const [modo, setModo] = useState<ModoSKU>('ambos')
  const [importandoProd, setImportandoProd] = useState(false)
  const [resultadoProd, setResultadoProd] = useState<{ creados: number; actualizados: number; errores: number } | null>(null)

  // ── Estado Inventario ─────────────────────────────────────────────────────
  const [filasInventario, setFilasInventario] = useState<FilaInventario[]>([])
  const [importandoInv, setImportandoInv] = useState(false)
  const [resultadoInv, setResultadoInv] = useState<{ cargados: number; errores: number } | null>(null)

  // ── Queries ───────────────────────────────────────────────────────────────
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
  const { data: estados = [] } = useQuery({
    queryKey: ['estados_inventario', tenant?.id],
    queryFn: async () => { const { data } = await supabase.from('estados_inventario').select('id, nombre').eq('tenant_id', tenant!.id).eq('activo', true); return data ?? [] },
    enabled: !!tenant,
  })
  // Mapa SKU → producto (para validar al importar inventario)
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

  // ─────────────────────────────────────────────────────────────────────────
  //  TAB PRODUCTOS
  // ─────────────────────────────────────────────────────────────────────────

  const descargarPlantillaProductos = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['nombre','sku','codigo_barras','categoria','proveedor','precio_costo','precio_costo_moneda','precio_venta','precio_venta_moneda','stock_minimo','unidad_medida','descripcion'],
      ['Tornillo hexagonal 1/4"','TORN-0001','7791234567890','Ferretería','Proveedor A',150,'ARS',250,'ARS',10,'unidad','Tornillo de acero inoxidable'],
      ['Pintura blanca 4L','PINT-0001','','Pinturas','',4.5,'USD',1200,'ARS',5,'litro',''],
    ])
    const hdr = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '1E3A5F' } }, alignment: { horizontal: 'center' } }
    ;['A','B','C','D','E','F','G','H','I','J','K','L'].forEach(c => { if (ws[`${c}1`]) ws[`${c}1`].s = hdr })
    ws['!cols'] = [{ wch:30 },{ wch:15 },{ wch:18 },{ wch:15 },{ wch:15 },{ wch:14 },{ wch:18 },{ wch:14 },{ wch:18 },{ wch:14 },{ wch:15 },{ wch:30 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Productos')
    const wsRef = XLSX.utils.aoa_to_sheet([
      ['Campo','Requerido','Notas'],
      ['nombre','SÍ','Nombre del producto'],
      ['sku','SÍ','Identificador único (se autogenera si vacío)'],
      ['codigo_barras','no','Código EAN/UPC'],
      ['categoria','no','Categoría existente o se crea nueva'],
      ['proveedor','no','Proveedor existente o se crea nuevo'],
      ['precio_costo','no','Número. Ej: 1500 o 4.5 (si USD)'],
      ['precio_costo_moneda','no','ARS (default) o USD'],
      ['precio_venta','no','Número. Ej: 2500'],
      ['precio_venta_moneda','no','ARS (default) o USD'],
      ['stock_minimo','no','Entero. Ej: 5'],
      ['unidad_medida','no','unidad/kg/g/litro/ml/metro/cm/caja/pack/docena'],
      ['descripcion','no','Texto libre'],
    ])
    wsRef['!cols'] = [{ wch:22 },{ wch:12 },{ wch:55 }]
    XLSX.utils.book_append_sheet(wb, wsRef, 'Referencia')
    XLSX.writeFile(wb, 'plantilla_productos.xlsx')
  }

  const procesarArchivoProductos = async (file: File) => {
    setResultadoProd(null)
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target!.result as ArrayBuffer), { type: 'array' })
        const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
        if (!rows.length) { toast.error('El archivo está vacío'); return }

        const skus = rows.map(r => String(r.sku || '').trim().toUpperCase()).filter(Boolean)
        const { data: existentes } = await supabase.from('productos').select('sku').eq('tenant_id', tenant!.id).in('sku', skus)
        const skusExistentes = new Set((existentes ?? []).map((p: any) => p.sku.toUpperCase()))

        setFilasProducto(rows.map((row, idx) => {
          const errores: string[] = []
          const nombre = String(row.nombre || '').trim()
          const sku = String(row.sku || '').trim().toUpperCase()
          const precio_costo = parseFloat(String(row.precio_costo || '0').replace(',', '.')) || 0
          const precio_costo_moneda = String(row.precio_costo_moneda || 'ARS').trim().toUpperCase()
          const precio_venta = parseFloat(String(row.precio_venta || '0').replace(',', '.')) || 0
          const precio_venta_moneda = String(row.precio_venta_moneda || 'ARS').trim().toUpperCase()
          const unidad = String(row.unidad_medida || 'unidad').trim().toLowerCase()

          if (!nombre) errores.push('Nombre requerido')
          if (precio_costo < 0) errores.push('Precio costo inválido')
          if (precio_venta < 0) errores.push('Precio venta inválido')
          if (unidad && !UNIDADES_VALIDAS.includes(unidad)) errores.push(`Unidad "${unidad}" no válida`)
          if (!MONEDAS_VALIDAS.includes(precio_costo_moneda)) errores.push(`Moneda costo inválida`)
          if (!MONEDAS_VALIDAS.includes(precio_venta_moneda)) errores.push(`Moneda venta inválida`)

          return {
            idx, nombre,
            sku: sku || `AUTO-${String(idx + 1).padStart(4, '0')}`,
            codigo_barras: String(row.codigo_barras || '').trim() || undefined,
            categoria: String(row.categoria || '').trim() || undefined,
            proveedor: String(row.proveedor || '').trim() || undefined,
            precio_costo, precio_costo_moneda: MONEDAS_VALIDAS.includes(precio_costo_moneda) ? precio_costo_moneda : 'ARS',
            precio_venta, precio_venta_moneda: MONEDAS_VALIDAS.includes(precio_venta_moneda) ? precio_venta_moneda : 'ARS',
            stock_minimo: parseInt(String(row.stock_minimo || '0')) || 0,
            unidad_medida: UNIDADES_VALIDAS.includes(unidad) ? unidad : 'unidad',
            descripcion: String(row.descripcion || '').trim() || undefined,
            estado: errores.length > 0 ? 'error' : skusExistentes.has(sku) ? 'existente' : 'nuevo',
            errores,
          } as FilaProducto
        }))
      } catch { toast.error('Error al leer el archivo.') }
    }
    reader.readAsArrayBuffer(file)
  }

  const confirmarProductos = async () => {
    setImportandoProd(true)
    let creados = 0, actualizados = 0, errores = 0

    for (const fila of filasProducto.filter(f => {
      if (f.errores.length > 0) return false
      if (f.estado === 'nuevo' && modo === 'actualizar') return false
      if (f.estado === 'existente' && modo === 'crear') return false
      return true
    })) {
      try {
        let categoria_id: string | null = null
        if (fila.categoria) {
          const existing = (categorias as any[]).find(c => c.nombre.toLowerCase() === fila.categoria!.toLowerCase())
          if (existing) { categoria_id = existing.id }
          else { const { data } = await supabase.from('categorias').insert({ tenant_id: tenant!.id, nombre: fila.categoria }).select('id').single(); categoria_id = data?.id ?? null; qc.invalidateQueries({ queryKey: ['categorias'] }) }
        }
        let proveedor_id: string | null = null
        if (fila.proveedor) {
          const existing = (proveedores as any[]).find(p => p.nombre.toLowerCase() === fila.proveedor!.toLowerCase())
          if (existing) { proveedor_id = existing.id }
          else { const { data } = await supabase.from('proveedores').insert({ tenant_id: tenant!.id, nombre: fila.proveedor }).select('id').single(); proveedor_id = data?.id ?? null; qc.invalidateQueries({ queryKey: ['proveedores'] }) }
        }
        const payload = { tenant_id: tenant!.id, nombre: fila.nombre, sku: fila.sku, codigo_barras: fila.codigo_barras ?? null, categoria_id, proveedor_id, precio_costo: fila.precio_costo, precio_costo_moneda: fila.precio_costo_moneda, precio_venta: fila.precio_venta, precio_venta_moneda: fila.precio_venta_moneda, stock_minimo: fila.stock_minimo, unidad_medida: fila.unidad_medida, descripcion: fila.descripcion ?? null, activo: true }
        if (fila.estado === 'nuevo') { await supabase.from('productos').insert(payload); creados++ }
        else { await supabase.from('productos').update(payload).eq('sku', fila.sku).eq('tenant_id', tenant!.id); actualizados++ }
      } catch { errores++ }
    }
    qc.invalidateQueries({ queryKey: ['productos'] })
    setResultadoProd({ creados, actualizados, errores })
    setImportandoProd(false)
    toast.success(`${creados} creados, ${actualizados} actualizados`)
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  TAB INVENTARIO
  // ─────────────────────────────────────────────────────────────────────────

  const descargarPlantillaInventario = () => {
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
      ['cantidad','SÍ (no serializado)','Cantidad a ingresar. Ignorado para productos con series (se usa la cantidad de numeros_serie).'],
      ['precio_costo','no','Precio de costo del ingreso. Si vacío, usa el del producto.'],
      ['ubicacion','no','Nombre de la ubicación. Debe existir en Configuración.'],
      ['estado','no','Estado del inventario. Debe existir en Configuración.'],
      ['proveedor','no','Nombre del proveedor. Debe existir en Configuración.'],
      ['nro_lote','no','Número de lote (si el producto lo requiere)'],
      ['fecha_vencimiento','no','Formato YYYY-MM-DD. Ej: 2025-12-31'],
      ['lpn','no','Identificador del bulto. Se autogenera si está vacío.'],
      ['motivo','no','Motivo del ingreso. Ej: Carga inicial, Reposición, etc.'],
      ['numeros_serie','SÍ (serializado)','Solo para productos con series. Separar con coma. Ej: SN-001,SN-002,SN-003. La cantidad se ignora y se usa la cantidad de series listadas.'],
    ])
    wsRef['!cols'] = [{ wch:20 },{ wch:18 },{ wch:75 }]
    XLSX.utils.book_append_sheet(wb, wsRef, 'Referencia')
    XLSX.writeFile(wb, 'plantilla_inventario.xlsx')
  }

  const procesarArchivoInventario = (file: File) => {
    setResultadoInv(null)
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
          // Parsear números de serie (separados por coma/punto y coma)
          const numerosSerieRaw = String(row.numeros_serie || '').trim()
          const numerosSerie = numerosSerieRaw
            ? numerosSerieRaw.split(/[,;]/).map(s => s.trim()).filter(Boolean)
            : []

          if (!sku) errores.push('SKU requerido')
          else if (!producto) errores.push(`SKU "${sku}" no existe`)

          if (tieneSeries) {
            if (numerosSerie.length === 0) errores.push('Producto serializado: completá la columna numeros_serie (ej: SN001,SN002)')
          } else {
            if (cantidad <= 0) errores.push('Cantidad debe ser mayor a 0')
          }

          const cantidadFinal = tieneSeries ? numerosSerie.length : cantidad

          return {
            idx,
            sku,
            producto_nombre: producto?.nombre ?? '—',
            producto_id: producto?.id ?? '',
            tiene_series: tieneSeries,
            cantidad: cantidadFinal,
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
        setFilasInventario(preview)
      } catch { toast.error('Error al leer el archivo.') }
    }
    reader.readAsArrayBuffer(file)
  }

  const confirmarInventario = async () => {
    setImportandoInv(true)
    let cargados = 0, errores = 0

    for (const fila of filasInventario.filter(f => f.estadoFilaImport === 'ok')) {
      try {
        // Resolver IDs por nombre
        const ubicacion_id = fila.ubicacion
          ? ((ubicaciones as any[]).find(u => u.nombre.toLowerCase() === fila.ubicacion!.toLowerCase())?.id ?? null)
          : null
        const estado_id = fila.estado
          ? ((estados as any[]).find(e => e.nombre.toLowerCase() === fila.estado!.toLowerCase())?.id ?? null)
          : null
        const proveedor_id = fila.proveedor
          ? ((proveedores as any[]).find(p => p.nombre.toLowerCase() === fila.proveedor!.toLowerCase())?.id ?? null)
          : null

        // Capturar stock ANTES del insert (el trigger lo modifica)
        const { data: prodAntes } = await supabase.from('productos').select('stock_actual, precio_costo').eq('id', fila.producto_id).single()
        const stockAntes = prodAntes?.stock_actual ?? 0
        const precioCosto = fila.precio_costo ?? prodAntes?.precio_costo ?? null

        // Auto-generar LPN si no viene
        const lpn = fila.lpn || `IMP-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${String(fila.idx + 1).padStart(4, '0')}`

        // 1. Insertar línea de inventario
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

        // 2. Si es serializado: insertar cada número de serie
        if (fila.tiene_series && fila.numeros_serie && fila.numeros_serie.length > 0) {
          const seriesPayload = fila.numeros_serie.map(nro_serie => ({
            tenant_id: tenant!.id,
            producto_id: fila.producto_id,
            linea_id: linea.id,
            nro_serie,
            estado_id,
            reservado: false,
            activo: true,
          }))
          const { error: seriesErr } = await supabase.from('inventario_series').insert(seriesPayload)
          if (seriesErr) throw seriesErr
        }

        // 3. Registrar movimiento
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
    setResultadoInv({ cargados, errores })
    setImportandoInv(false)
    toast.success(`${cargados} líneas cargadas al inventario`)
  }

  // ── Derivados ─────────────────────────────────────────────────────────────
  const nuevosProd    = filasProducto.filter(f => f.estado === 'nuevo' && !f.errores.length).length
  const existentesProd = filasProducto.filter(f => f.estado === 'existente' && !f.errores.length).length
  const errorProd     = filasProducto.filter(f => f.errores.length > 0).length
  const okInv         = filasInventario.filter(f => f.estadoFilaImport === 'ok').length
  const errorInv      = filasInventario.filter(f => f.estadoFilaImport === 'error').length

  // ─────────────────────────────────────────────────────────────────────────
  //  RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/inventario')} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
          <ArrowLeft size={20} className="text-gray-600 dark:text-gray-400" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-primary">Importar</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">Cargá productos o stock desde Excel</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 rounded-xl p-1 w-fit">
        <button onClick={() => setTab('productos')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === 'productos' ? 'bg-white dark:bg-gray-800 text-primary shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-300'}`}>
          Productos
        </button>
        <button onClick={() => setTab('inventario')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === 'inventario' ? 'bg-white dark:bg-gray-800 text-primary shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-300'}`}>
          <Boxes size={14} /> Inventario
        </button>
      </div>

      {/* ═══════════════════════  TAB PRODUCTOS  ═══════════════════════════ */}
      {tab === 'productos' && (
        <>
          {resultadoProd && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 rounded-xl p-4 flex items-start gap-3">
              <CheckCircle size={20} className="text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold text-green-800 dark:text-green-400">Importación completada</p>
                <p className="text-sm text-green-700 dark:text-green-400 mt-0.5">
                  {resultadoProd.creados} creados · {resultadoProd.actualizados} actualizados · {resultadoProd.errores} errores
                </p>
                <button onClick={() => navigate('/inventario')} className="mt-2 text-sm text-green-700 dark:text-green-400 font-medium hover:underline">Ver inventario →</button>
              </div>
            </div>
          )}
          <div className="grid lg:grid-cols-3 gap-5">
            <div className="space-y-4">
              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100">
                <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2"><FileSpreadsheet size={16} className="text-accent" /> Plantilla</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Descargá, completá y subí.</p>
                <button onClick={descargarPlantillaProductos} className="w-full flex items-center justify-center gap-2 border border-accent text-accent font-medium py-2.5 rounded-xl hover:bg-accent/10 transition-all text-sm">
                  <Download size={15} /> Descargar plantilla
                </button>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100">
                <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2"><Upload size={16} className="text-accent" /> Subir archivo</h2>
                <div className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-6 text-center cursor-pointer hover:border-accent hover:bg-accent/5 transition-all"
                  onClick={() => fileRefProd.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) procesarArchivoProductos(f) }}>
                  <FileSpreadsheet size={28} className="text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500 dark:text-gray-400">Arrastrá o hacé click</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">.xlsx, .xls, .csv</p>
                </div>
                <input ref={fileRefProd} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) procesarArchivoProductos(f) }} />
              </div>
              {filasProducto.length > 0 && existentesProd > 0 && (
                <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100">
                  <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-3">Si el SKU ya existe</h2>
                  <div className="space-y-2">
                    {([{ val:'crear', label:'Solo crear nuevos', desc:'Ignorar existentes' },{ val:'actualizar', label:'Solo actualizar', desc:'Ignorar nuevos' },{ val:'ambos', label:'Crear y actualizar', desc:'Procesar todos' }] as { val: ModoSKU; label: string; desc: string }[]).map(({ val, label, desc }) => (
                      <label key={val} className="flex items-start gap-3 cursor-pointer p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <input type="radio" name="modo" value={val} checked={modo === val} onChange={() => setModo(val)} className="mt-0.5" />
                        <div><p className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</p><p className="text-xs text-gray-400 dark:text-gray-500">{desc}</p></div>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="lg:col-span-2">
              {filasProducto.length === 0 ? (
                <div className="bg-white dark:bg-gray-800 rounded-xl p-12 shadow-sm border border-gray-100 text-center text-gray-400 dark:text-gray-500">
                  <FileSpreadsheet size={40} className="mx-auto mb-3 opacity-30" />
                  <p className="font-medium">Subí un archivo para ver la previsualización</p>
                </div>
              ) : (
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="grid grid-cols-3 divide-x divide-gray-100 border-b border-gray-100">
                    <div className="px-4 py-3 text-center"><p className="text-2xl font-bold text-green-600 dark:text-green-400">{nuevosProd}</p><p className="text-xs text-gray-500 dark:text-gray-400">Nuevos</p></div>
                    <div className="px-4 py-3 text-center"><p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{existentesProd}</p><p className="text-xs text-gray-500 dark:text-gray-400">Existentes</p></div>
                    <div className="px-4 py-3 text-center"><p className="text-2xl font-bold text-red-500">{errorProd}</p><p className="text-xs text-gray-500 dark:text-gray-400">Con errores</p></div>
                  </div>
                  <div className="overflow-x-auto max-h-96">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-gray-50 dark:bg-gray-700"><tr className="border-b border-gray-100">
                        <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-400">Estado</th>
                        <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-400">Nombre</th>
                        <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-400">SKU</th>
                        <th className="text-right px-3 py-2 font-semibold text-gray-600 dark:text-gray-400">Costo</th>
                        <th className="text-right px-3 py-2 font-semibold text-gray-600 dark:text-gray-400">Venta</th>
                        <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-400">Categoría</th>
                        <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-400">Errores</th>
                      </tr></thead>
                      <tbody>
                        {filasProducto.map(f => (
                          <tr key={f.idx} className={`border-b border-gray-50 ${f.errores.length > 0 ? 'bg-red-50 dark:bg-red-900/20' : f.estado === 'existente' ? 'bg-blue-50 dark:bg-blue-900/20/40' : ''}`}>
                            <td className="px-3 py-2">
                              {f.errores.length > 0 ? <span className="flex items-center gap-1 text-red-500"><XCircle size={12} /> Error</span>
                                : f.estado === 'existente' ? <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400"><RefreshCw size={12} /> Existe</span>
                                : <span className="flex items-center gap-1 text-green-600 dark:text-green-400"><CheckCircle size={12} /> Nuevo</span>}
                            </td>
                            <td className="px-3 py-2 font-medium text-gray-800 dark:text-gray-100 max-w-32 truncate">{f.nombre || <span className="text-red-400 italic">vacío</span>}</td>
                            <td className="px-3 py-2 font-mono text-gray-600 dark:text-gray-400">{f.sku}</td>
                            <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{f.precio_costo > 0 ? `${f.precio_costo_moneda === 'USD' ? 'USD ' : '$'}${f.precio_costo.toLocaleString()}` : '—'}</td>
                            <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{f.precio_venta > 0 ? `${f.precio_venta_moneda === 'USD' ? 'USD ' : '$'}${f.precio_venta.toLocaleString()}` : '—'}</td>
                            <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{f.categoria ?? '—'}</td>
                            <td className="px-3 py-2 text-red-500">{f.errores.join(', ') || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="p-4 border-t border-gray-100 bg-gray-50 dark:bg-gray-700">
                    <button onClick={confirmarProductos} disabled={importandoProd || (nuevosProd === 0 && existentesProd === 0)}
                      className="w-full bg-accent hover:bg-accent/90 text-white font-semibold py-3 rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                      {importandoProd ? <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> Importando...</>
                        : <><Upload size={16} /> Confirmar ({modo === 'crear' ? nuevosProd : modo === 'actualizar' ? existentesProd : nuevosProd + existentesProd} productos)</>}
                    </button>
                    {errorProd > 0 && <p className="text-xs text-gray-400 dark:text-gray-500 text-center mt-2 flex items-center justify-center gap-1"><AlertTriangle size={11} /> Las filas con errores serán ignoradas</p>}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ═══════════════════════  TAB INVENTARIO  ═══════════════════════════ */}
      {tab === 'inventario' && (
        <>
          {resultadoInv && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 rounded-xl p-4 flex items-start gap-3">
              <CheckCircle size={20} className="text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold text-green-800 dark:text-green-400">Carga completada</p>
                <p className="text-sm text-green-700 dark:text-green-400 mt-0.5">{resultadoInv.cargados} línea{resultadoInv.cargados !== 1 ? 's' : ''} cargada{resultadoInv.cargados !== 1 ? 's' : ''} · {resultadoInv.errores} errores</p>
                <button onClick={() => navigate('/inventario')} className="mt-2 text-sm text-green-700 dark:text-green-400 font-medium hover:underline">Ver inventario →</button>
              </div>
            </div>
          )}

          {/* Info box */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 rounded-xl p-4 text-sm text-blue-700 dark:text-blue-400">
            <strong>Carga masiva de inventario</strong> — Cada fila crea una línea de stock (LPN) y registra un movimiento de ingreso. Los SKUs deben existir previamente en el catálogo de productos.
          </div>

          <div className="grid lg:grid-cols-3 gap-5">
            <div className="space-y-4">
              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100">
                <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2"><FileSpreadsheet size={16} className="text-accent" /> Plantilla</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Completá una fila por línea de inventario a cargar.</p>
                <button onClick={descargarPlantillaInventario} className="w-full flex items-center justify-center gap-2 border border-accent text-accent font-medium py-2.5 rounded-xl hover:bg-accent/10 transition-all text-sm">
                  <Download size={15} /> Descargar plantilla
                </button>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100">
                <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2"><Upload size={16} className="text-accent" /> Subir archivo</h2>
                <div className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-6 text-center cursor-pointer hover:border-accent hover:bg-accent/5 transition-all"
                  onClick={() => fileRefInv.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) procesarArchivoInventario(f) }}>
                  <Boxes size={28} className="text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500 dark:text-gray-400">Arrastrá o hacé click</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">.xlsx, .xls, .csv</p>
                </div>
                <input ref={fileRefInv} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) procesarArchivoInventario(f) }} />
              </div>
            </div>

            <div className="lg:col-span-2">
              {filasInventario.length === 0 ? (
                <div className="bg-white dark:bg-gray-800 rounded-xl p-12 shadow-sm border border-gray-100 text-center text-gray-400 dark:text-gray-500">
                  <Boxes size={40} className="mx-auto mb-3 opacity-30" />
                  <p className="font-medium">Subí un archivo para ver la previsualización</p>
                </div>
              ) : (
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="grid grid-cols-2 divide-x divide-gray-100 border-b border-gray-100">
                    <div className="px-4 py-3 text-center"><p className="text-2xl font-bold text-green-600 dark:text-green-400">{okInv}</p><p className="text-xs text-gray-500 dark:text-gray-400">Líneas a cargar</p></div>
                    <div className="px-4 py-3 text-center"><p className="text-2xl font-bold text-red-500">{errorInv}</p><p className="text-xs text-gray-500 dark:text-gray-400">Con errores</p></div>
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
                        {filasInventario.map(f => (
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
                    <button onClick={confirmarInventario} disabled={importandoInv || okInv === 0}
                      className="w-full bg-accent hover:bg-accent/90 text-white font-semibold py-3 rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                      {importandoInv ? <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> Cargando...</>
                        : <><Boxes size={16} /> Cargar {okInv} línea{okInv !== 1 ? 's' : ''} al inventario</>}
                    </button>
                    {errorInv > 0 && <p className="text-xs text-gray-400 dark:text-gray-500 text-center mt-2 flex items-center justify-center gap-1"><AlertTriangle size={11} /> Las filas con errores serán ignoradas</p>}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
