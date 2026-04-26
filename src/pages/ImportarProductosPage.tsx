import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Upload, Download, CheckCircle, XCircle, AlertTriangle, FileSpreadsheet, RefreshCw } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { usePlanLimits } from '@/hooks/usePlanLimits'
import { UpgradePrompt } from '@/components/UpgradePrompt'
import toast from 'react-hot-toast'

// ── Constantes ─────────────────────────────────────────────────────────────
const UNIDADES_VALIDAS  = ['unidad', 'kg', 'g', 'litro', 'ml', 'metro', 'cm', 'caja', 'pack', 'docena']
const MONEDAS_VALIDAS   = ['ARS', 'USD']
const ALICUOTAS_VALIDAS = [0, 10.5, 21, 27]
const REGLAS_VALIDAS    = ['FIFO', 'FEFO', 'LEFO', 'LIFO', 'Manual']

type ModoSKU = 'crear' | 'actualizar' | 'ambos'

const parseBool = (val: any): boolean => {
  const s = String(val ?? '').trim().toUpperCase()
  return s === 'SI' || s === 'SÍ' || s === 'YES' || s === 'TRUE' || s === '1'
}

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
  notas?: string
  alicuota_iva: number
  margen_objetivo?: number
  tiene_series: boolean
  tiene_lote: boolean
  tiene_vencimiento: boolean
  regla_inventario?: string
  es_kit: boolean
  estr_nombre?: string
  estr_unidades_por_caja?: number
  estr_cajas_por_pallet?: number
  estr_peso_unidad?: number
  estr_alto_unidad?: number
  estr_ancho_unidad?: number
  estr_largo_unidad?: number
  estr_peso_caja?: number
  estr_alto_caja?: number
  estr_ancho_caja?: number
  estr_largo_caja?: number
  estr_peso_pallet?: number
  estr_alto_pallet?: number
  estr_ancho_pallet?: number
  estr_largo_pallet?: number
  estado: 'nuevo' | 'existente' | 'error'
  errores: string[]
}

// ══════════════════════════════════════════════════════════════════════════════
export default function ImportarProductosPage() {
  const { limits } = usePlanLimits()
  const navigate = useNavigate()
  const { tenant } = useAuthStore()

  const qc = useQueryClient()

  const fileRefProd = useRef<HTMLInputElement>(null)

  const [filasProducto, setFilasProducto] = useState<FilaProducto[]>([])
  const [modo, setModo] = useState<ModoSKU>('ambos')
  const [importandoProd, setImportandoProd] = useState(false)
  const [resultadoProd, setResultadoProd] = useState<{ creados: number; actualizados: number; errores: number } | null>(null)

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

  const descargarPlantillaProductos = () => {
    // ── Hoja principal ──────────────────────────────────────────────────────
    const headers = [
      'nombre','sku','codigo_barras','categoria','proveedor',
      'precio_costo','precio_costo_moneda','precio_venta','precio_venta_moneda',
      'stock_minimo','unidad_medida','descripcion','notas',
      'alicuota_iva','margen_objetivo',
      'tiene_series','tiene_lote','tiene_vencimiento',
      'regla_inventario','es_kit',
      'estr_nombre',
      'estr_unidades_por_caja','estr_cajas_por_pallet',
      'estr_peso_unidad','estr_alto_unidad','estr_ancho_unidad','estr_largo_unidad',
      'estr_peso_caja','estr_alto_caja','estr_ancho_caja','estr_largo_caja',
      'estr_peso_pallet','estr_alto_pallet','estr_ancho_pallet','estr_largo_pallet',
    ]
    const ws = XLSX.utils.aoa_to_sheet([
      headers,
      [
        'Tornillo hexagonal 1/4"','TORN-0001','7791234567890','Ferretería','Proveedor A',
        150,'ARS',250,'ARS',
        10,'unidad','Tornillo de acero inoxidable','',
        21,'',
        'NO','NO','NO',
        '','NO',
        50,4,0.5,
      ],
      [
        'Pintura blanca 4L','PINT-0001','','Pinturas','',
        4.5,'USD',1200,'ARS',
        5,'litro','','',
        10.5,35,
        'NO','NO','NO',
        'FIFO','NO',
        '','','',
      ],
    ])
    const hdr = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '1E3A5F' } }, alignment: { horizontal: 'center' } }
    const cols = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W']
    cols.forEach(c => { if (ws[`${c}1`]) ws[`${c}1`].s = hdr })
    ws['!cols'] = [
      { wch:30 },{ wch:15 },{ wch:18 },{ wch:15 },{ wch:15 },
      { wch:14 },{ wch:18 },{ wch:14 },{ wch:18 },
      { wch:14 },{ wch:15 },{ wch:30 },{ wch:25 },
      { wch:13 },{ wch:15 },
      { wch:14 },{ wch:13 },{ wch:16 },
      { wch:17 },{ wch:10 },
      { wch:22 },{ wch:22 },{ wch:16 },
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Productos')

    // ── Hoja de referencia ──────────────────────────────────────────────────
    const wsRef = XLSX.utils.aoa_to_sheet([
      ['Campo','Requerido','Valores / Notas'],
      ['nombre','SÍ','Nombre del producto'],
      ['sku','no','Identificador único (se autogenera si vacío)'],
      ['codigo_barras','no','Código EAN/UPC'],
      ['categoria','no','Debe existir en Configuración → Categorías (error si no existe)'],
      ['proveedor','no','Debe existir en Configuración → Proveedores (error si no existe)'],
      ['precio_costo','no','Número. Ej: 1500 o 4.5 (si USD)'],
      ['precio_costo_moneda','no','ARS (default) o USD'],
      ['precio_venta','no','Número. Ej: 2500'],
      ['precio_venta_moneda','no','ARS (default) o USD'],
      ['stock_minimo','no','Entero. Ej: 5'],
      ['unidad_medida','no','unidad / kg / g / litro / ml / metro / cm / caja / pack / docena'],
      ['descripcion','no','Texto libre (descripción del producto)'],
      ['notas','no','Notas internas (no visible en ventas)'],
      ['','',''],
      ['── Atributos ──','',''],
      ['alicuota_iva','no','0 / 10.5 / 21 (default) / 27'],
      ['margen_objetivo','no','Porcentaje objetivo 0–100. Ej: 35'],
      ['tiene_series','no','SI o NO (default NO). Activa trazabilidad por N/S'],
      ['tiene_lote','no','SI o NO (default NO). Activa N° de lote'],
      ['tiene_vencimiento','no','SI o NO (default NO). Activa fecha de vencimiento'],
      ['regla_inventario','no','FIFO / FEFO / LEFO / LIFO / Manual (vacío = usa default del negocio)'],
      ['es_kit','no','SI o NO (default NO). Marca el producto como KIT de kitting'],
      ['','',''],
      ['── Estructura (opcional) ──','','Solo completa si necesitás datos de embalaje/logística'],
      ['estr_nombre','no','Nombre de la estructura. Ej: Embalaje estándar (default: "Default")'],
      ['estr_unidades_por_caja','no','Cuántas unidades entran en una caja. Ej: 50'],
      ['estr_cajas_por_pallet','no','Cuántas cajas entran en un pallet. Ej: 4'],
      ['── Nivel Unidad ──','',''],
      ['estr_peso_unidad','no','Peso de 1 unidad en kg. Ej: 0.5'],
      ['estr_alto_unidad','no','Alto de 1 unidad en cm. Ej: 10'],
      ['estr_ancho_unidad','no','Ancho de 1 unidad en cm. Ej: 5'],
      ['estr_largo_unidad','no','Largo de 1 unidad en cm. Ej: 8'],
      ['── Nivel Caja ──','',''],
      ['estr_peso_caja','no','Peso de 1 caja llena en kg. Ej: 26'],
      ['estr_alto_caja','no','Alto de 1 caja en cm. Ej: 40'],
      ['estr_ancho_caja','no','Ancho de 1 caja en cm. Ej: 30'],
      ['estr_largo_caja','no','Largo de 1 caja en cm. Ej: 50'],
      ['── Nivel Pallet ──','',''],
      ['estr_peso_pallet','no','Peso de 1 pallet lleno en kg. Ej: 120'],
      ['estr_alto_pallet','no','Alto de 1 pallet en cm. Ej: 120'],
      ['estr_ancho_pallet','no','Ancho de 1 pallet en cm. Ej: 80'],
      ['estr_largo_pallet','no','Largo de 1 pallet en cm. Ej: 120'],
    ])
    wsRef['!cols'] = [{ wch:26 },{ wch:12 },{ wch:60 }]
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

          // alicuota_iva
          const ivaRaw = parseFloat(String(row.alicuota_iva || '21').replace(',', '.'))
          const alicuota_iva = isNaN(ivaRaw) ? 21 : ivaRaw
          if (row.alicuota_iva !== '' && row.alicuota_iva != null && !ALICUOTAS_VALIDAS.includes(alicuota_iva)) {
            errores.push(`IVA "${row.alicuota_iva}" inválido (0/10.5/21/27)`)
          }

          // margen_objetivo
          const margenStr = String(row.margen_objetivo || '').trim()
          const margen_objetivo = margenStr ? (parseFloat(margenStr.replace(',', '.')) || undefined) : undefined
          if (margen_objetivo !== undefined && (margen_objetivo < 0 || margen_objetivo > 100)) {
            errores.push('Margen objetivo debe ser entre 0 y 100')
          }

          // regla_inventario
          const reglaRaw = String(row.regla_inventario || '').trim()
          const reglaMatch = REGLAS_VALIDAS.find(r => r.toUpperCase() === reglaRaw.toUpperCase())
          const regla_inventario = reglaRaw ? (reglaMatch ?? undefined) : undefined
          if (reglaRaw && !reglaMatch) {
            errores.push(`Regla "${reglaRaw}" inválida (FIFO/FEFO/LEFO/LIFO/Manual)`)
          }

          // estructura
          const parseNum = (v: any) => parseFloat(String(v || '').replace(',', '.')) || undefined
          const estr_nombre            = String(row.estr_nombre || '').trim() || undefined
          const estr_unidades_por_caja = parseNum(row.estr_unidades_por_caja)
          const estr_cajas_por_pallet  = parseNum(row.estr_cajas_por_pallet)
          const estr_peso_unidad       = parseNum(row.estr_peso_unidad)
          const estr_alto_unidad       = parseNum(row.estr_alto_unidad)
          const estr_ancho_unidad      = parseNum(row.estr_ancho_unidad)
          const estr_largo_unidad      = parseNum(row.estr_largo_unidad)
          const estr_peso_caja         = parseNum(row.estr_peso_caja)
          const estr_alto_caja         = parseNum(row.estr_alto_caja)
          const estr_ancho_caja        = parseNum(row.estr_ancho_caja)
          const estr_largo_caja        = parseNum(row.estr_largo_caja)
          const estr_peso_pallet       = parseNum(row.estr_peso_pallet)
          const estr_alto_pallet       = parseNum(row.estr_alto_pallet)
          const estr_ancho_pallet      = parseNum(row.estr_ancho_pallet)
          const estr_largo_pallet      = parseNum(row.estr_largo_pallet)

          // Validar categoria y proveedor — deben existir, no se crean automáticamente
          const catNombre = String(row.categoria || '').trim()
          const provNombre = String(row.proveedor || '').trim()
          if (catNombre && !(categorias as any[]).find(c => c.nombre.toLowerCase() === catNombre.toLowerCase())) {
            errores.push(`Categoría "${catNombre}" no existe — creala primero en Configuración`)
          }
          if (provNombre && !(proveedores as any[]).find(p => p.nombre.toLowerCase() === provNombre.toLowerCase())) {
            errores.push(`Proveedor "${provNombre}" no existe — crealo primero en Configuración`)
          }

          if (!nombre) errores.push('Nombre requerido')
          if (precio_costo < 0) errores.push('Precio costo inválido')
          if (precio_venta < 0) errores.push('Precio venta inválido')
          if (unidad && !UNIDADES_VALIDAS.includes(unidad)) errores.push(`Unidad "${unidad}" no válida`)
          if (!MONEDAS_VALIDAS.includes(precio_costo_moneda)) errores.push('Moneda costo inválida')
          if (!MONEDAS_VALIDAS.includes(precio_venta_moneda)) errores.push('Moneda venta inválida')

          return {
            idx, nombre,
            sku: sku || `AUTO-${String(idx + 1).padStart(4, '0')}`,
            codigo_barras: String(row.codigo_barras || '').trim() || undefined,
            categoria: String(row.categoria || '').trim() || undefined,
            proveedor: String(row.proveedor || '').trim() || undefined,
            precio_costo,
            precio_costo_moneda: MONEDAS_VALIDAS.includes(precio_costo_moneda) ? precio_costo_moneda : 'ARS',
            precio_venta,
            precio_venta_moneda: MONEDAS_VALIDAS.includes(precio_venta_moneda) ? precio_venta_moneda : 'ARS',
            stock_minimo: parseInt(String(row.stock_minimo || '0')) || 0,
            unidad_medida: UNIDADES_VALIDAS.includes(unidad) ? unidad : 'unidad',
            descripcion: String(row.descripcion || '').trim() || undefined,
            notas: String(row.notas || '').trim() || undefined,
            alicuota_iva: ALICUOTAS_VALIDAS.includes(alicuota_iva) ? alicuota_iva : 21,
            margen_objetivo,
            tiene_series: parseBool(row.tiene_series),
            tiene_lote: parseBool(row.tiene_lote),
            tiene_vencimiento: parseBool(row.tiene_vencimiento),
            regla_inventario,
            es_kit: parseBool(row.es_kit),
            estr_nombre,
            estr_unidades_por_caja,
            estr_alto_unidad, estr_ancho_unidad, estr_largo_unidad,
            estr_peso_caja, estr_alto_caja, estr_ancho_caja, estr_largo_caja,
            estr_peso_pallet, estr_alto_pallet, estr_ancho_pallet, estr_largo_pallet,
            estr_cajas_por_pallet,
            estr_peso_unidad,
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
        // Categoria y proveedor SOLO se buscan — no se crean automáticamente
        const categoria_id = fila.categoria
          ? ((categorias as any[]).find(c => c.nombre.toLowerCase() === fila.categoria!.toLowerCase())?.id ?? null)
          : null
        const proveedor_id = fila.proveedor
          ? ((proveedores as any[]).find(p => p.nombre.toLowerCase() === fila.proveedor!.toLowerCase())?.id ?? null)
          : null

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
          notas: fila.notas ?? null,
          activo: true,
          alicuota_iva: fila.alicuota_iva,
          margen_objetivo: fila.margen_objetivo ?? null,
          tiene_series: fila.tiene_series,
          tiene_lote: fila.tiene_lote,
          tiene_vencimiento: fila.tiene_vencimiento,
          regla_inventario: fila.regla_inventario ?? null,
          es_kit: fila.es_kit,
        }

        const hasEstr = !!(fila.estr_nombre || fila.estr_unidades_por_caja || fila.estr_cajas_por_pallet ||
          fila.estr_peso_unidad || fila.estr_alto_unidad || fila.estr_peso_caja || fila.estr_peso_pallet)
        let productoId: string | null = null

        if (fila.estado === 'nuevo') {
          const { data: inserted } = await supabase.from('productos').insert(payload).select('id').single()
          productoId = inserted?.id ?? null
          creados++
        } else {
          await supabase.from('productos').update(payload).eq('sku', fila.sku).eq('tenant_id', tenant!.id)
          if (hasEstr) {
            const { data: p } = await supabase.from('productos').select('id').eq('sku', fila.sku).eq('tenant_id', tenant!.id).single()
            productoId = p?.id ?? null
          }
          actualizados++
        }

        if (hasEstr && productoId) {
          const estrPayload = {
            tenant_id: tenant!.id,
            producto_id: productoId,
            nombre: fila.estr_nombre ?? 'Default',
            is_default: true,
            unidades_por_caja: fila.estr_unidades_por_caja ?? null,
            cajas_por_pallet:  fila.estr_cajas_por_pallet ?? null,
            peso_unidad:  fila.estr_peso_unidad  ?? null,
            alto_unidad:  fila.estr_alto_unidad  ?? null,
            ancho_unidad: fila.estr_ancho_unidad ?? null,
            largo_unidad: fila.estr_largo_unidad ?? null,
            peso_caja:    fila.estr_peso_caja    ?? null,
            alto_caja:    fila.estr_alto_caja    ?? null,
            ancho_caja:   fila.estr_ancho_caja   ?? null,
            largo_caja:   fila.estr_largo_caja   ?? null,
            peso_pallet:  fila.estr_peso_pallet  ?? null,
            alto_pallet:  fila.estr_alto_pallet  ?? null,
            ancho_pallet: fila.estr_ancho_pallet ?? null,
            largo_pallet: fila.estr_largo_pallet ?? null,
          }
          const { data: estrExisting } = await supabase.from('producto_estructuras').select('id').eq('producto_id', productoId).eq('is_default', true).maybeSingle()
          if (estrExisting) {
            await supabase.from('producto_estructuras').update(estrPayload).eq('id', estrExisting.id)
          } else {
            await supabase.from('producto_estructuras').insert(estrPayload)
          }
        }
      } catch { errores++ }
    }
    qc.invalidateQueries({ queryKey: ['productos'] })
    setResultadoProd({ creados, actualizados, errores })
    setImportandoProd(false)
    toast.success(`${creados} creados, ${actualizados} actualizados`)
  }

  const nuevosProd     = filasProducto.filter(f => f.estado === 'nuevo' && !f.errores.length).length
  const existentesProd = filasProducto.filter(f => f.estado === 'existente' && !f.errores.length).length
  const errorProd      = filasProducto.filter(f => f.errores.length > 0).length

  if (limits && !limits.puede_importar) return <UpgradePrompt feature="importar" />

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/productos')} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
          <ArrowLeft size={20} className="text-gray-600 dark:text-gray-400" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-primary">Importar productos</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">Cargá el catálogo de productos desde Excel</p>
        </div>
      </div>

      <>
          {resultadoProd && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 rounded-xl p-4 flex items-start gap-3">
              <CheckCircle size={20} className="text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold text-green-800 dark:text-green-400">Importación completada</p>
                <p className="text-sm text-green-700 dark:text-green-400 mt-0.5">
                  {resultadoProd.creados} creados · {resultadoProd.actualizados} actualizados · {resultadoProd.errores} errores
                </p>
                <button onClick={() => navigate('/productos')} className="mt-2 text-sm text-green-700 dark:text-green-400 font-medium hover:underline">Ver inventario →</button>
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
                        <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-400">IVA</th>
                        <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-400">Categoría</th>
                        <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-400">Errores</th>
                      </tr></thead>
                      <tbody>
                        {filasProducto.map(f => (
                          <tr key={f.idx} className={`border-b border-gray-50 ${f.errores.length > 0 ? 'bg-red-50 dark:bg-red-900/20' : f.estado === 'existente' ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
                            <td className="px-3 py-2">
                              {f.errores.length > 0 ? <span className="flex items-center gap-1 text-red-500"><XCircle size={12} /> Error</span>
                                : f.estado === 'existente' ? <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400"><RefreshCw size={12} /> Existe</span>
                                : <span className="flex items-center gap-1 text-green-600 dark:text-green-400"><CheckCircle size={12} /> Nuevo</span>}
                            </td>
                            <td className="px-3 py-2 font-medium text-gray-800 dark:text-gray-100 max-w-32 truncate">{f.nombre || <span className="text-red-400 italic">vacío</span>}</td>
                            <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{f.sku}</td>
                            <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{f.precio_costo > 0 ? `${f.precio_costo_moneda === 'USD' ? 'USD ' : '$'}${f.precio_costo.toLocaleString()}` : '—'}</td>
                            <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{f.precio_venta > 0 ? `${f.precio_venta_moneda === 'USD' ? 'USD ' : '$'}${f.precio_venta.toLocaleString()}` : '—'}</td>
                            <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{f.alicuota_iva}%</td>
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
    </div>
  )
}
