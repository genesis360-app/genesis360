// Importar la lista de descuentos de una categoría desde Excel (mig 466 — Categorías, Fase 4 parte A).
// Mismo diseño que los demás importadores (PaginaImportacion + vista previa). Por SKU; TODO O NADA (D3-a); actualiza
// solo lo que trae (B-3): una celda de descuento VACÍA no toca ese producto (no lo saca de la lista).
// La plantilla trae todos los productos activos con el % que ya tienen, para completarla y volver a subirla.
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Percent } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { traerTodoConError } from '@/lib/traerTodo'
import { useAuthStore } from '@/store/authStore'
import { descargarExcel } from '@/lib/exportarArchivo'
import { filaExcel, filasConErrorParaExportar, mensajeErrorCarga } from '@/lib/importacion'
import { leerPorcentaje, porcentajeLegible } from '@/lib/categoriaDescuentos'
import { useCategoriasCliente, puedeGestionarCategorias } from '@/hooks/useCategoriasCliente'
import { ResultadoImportacion, VistaPreviaImportacion, type ResultadoCarga } from '@/components/importacion/VistaPreviaImportacion'
import { PaginaImportacion } from '@/components/importacion/PaginaImportacion'
import { pedirRedaccionCartel } from '@/lib/cartelCategoriaIA'
import { CATEGORIAS_QUERY_KEY } from '@/hooks/useCategoriasCliente'

/** El plan prevé hasta 10.000 productos por categoría (B-9); los demás importadores cortan en 5.000. */
const MAX_FILAS_DESCUENTOS = 20000

interface Fila {
  idx: number
  sku: string
  nombre: string
  productoId?: string
  pct: number | null
  actual?: number
  errores: string[]
}

export default function ImportarDescuentosCategoriaPage() {
  const { id: categoriaId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { tenant, user } = useAuthStore()
  const { data: categorias = [] } = useCategoriasCliente()
  const categoria = categorias.find(c => c.id === categoriaId)
  const [filas, setFilas] = useState<Fila[]>([])
  const [originales, setOriginales] = useState<Record<string, unknown>[]>([])
  const [cargando, setCargando] = useState(false)
  const [resultado, setResultado] = useState<ResultadoCarga | null>(null)
  const volverA = `/clientes/categorias/${categoriaId}/descuentos`

  const traerProductosYActuales = async () => {
    const [prods, actuales] = await Promise.all([
      traerTodoConError<any>((d, h) => supabase.from('productos').select('id, sku, nombre, activo')
        .eq('tenant_id', tenant!.id).order('nombre').range(d, h)),
      traerTodoConError<any>((d, h) => supabase.from('categoria_cliente_descuentos').select('producto_id, descuento_pct')
        .eq('categoria_id', categoriaId!).range(d, h)),
    ])
    if (prods.error || actuales.error) throw new Error('No se pudieron leer los productos o la lista actual. Intentá de nuevo.')
    const actual = new Map<string, number>((actuales.data ?? []).map((a: any) => [a.producto_id, parseFloat(String(a.descuento_pct))]))
    return { productos: (prods.data ?? []) as any[], actual }
  }

  const descargarPlantilla = async () => {
    try {
      const { productos, actual } = await traerProductosYActuales()
      const XLSX = await import('xlsx')
      const wb = XLSX.utils.book_new()
      const ws = XLSX.utils.aoa_to_sheet([
        ['sku', 'nombre', 'descuento_pct'],
        ...productos.filter(p => p.activo !== false).map(p => [p.sku ?? '', p.nombre, actual.has(p.id) ? actual.get(p.id)! : '']),
      ])
      ws['!cols'] = [{ wch: 18 }, { wch: 40 }, { wch: 14 }]
      XLSX.utils.book_append_sheet(wb, ws, 'Descuentos')
      const ref = XLSX.utils.aoa_to_sheet([
        ['Columna', 'Notas'],
        ['sku', 'Identifica el producto. Tiene que existir y estar activo.'],
        ['nombre', 'Solo informativo: no se lee.'],
        ['descuento_pct', 'De 0 a 100, con hasta 2 decimales (12,5). 0 = sin descuento a propósito. VACÍO = no se toca ese producto.'],
        ['(sacar)', 'Para sacar un producto de la lista usá el tachito en la pantalla: el archivo no borra nada.'],
      ])
      ref['!cols'] = [{ wch: 16 }, { wch: 100 }]
      XLSX.utils.book_append_sheet(wb, ref, 'Referencia')
      const nombre = `descuentos_${(categoria?.nombre ?? 'categoria').replace(/\s+/g, '_')}.xlsx`
      XLSX.writeFile(wb, nombre)
    } catch (e: any) { toast.error(e.message ?? 'No se pudo armar la plantilla') }
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
        if (rows.length > MAX_FILAS_DESCUENTOS) {
          toast.error(`El archivo tiene ${rows.length} filas; el máximo es ${MAX_FILAS_DESCUENTOS}. Dividilo en partes.`); return
        }
        if (!('sku' in rows[0]) || !('descuento_pct' in rows[0])) {
          toast.error('Faltan las columnas "sku" y/o "descuento_pct". Bajá la plantilla y usala de base.'); return
        }
        const { productos, actual } = await traerProductosYActuales()
        const porSku = new Map<string, any>()
        for (const p of productos) if (p.sku) porSku.set(String(p.sku).trim().toUpperCase(), p)

        const vistos = new Map<string, number[]>()
        const nuevas: Fila[] = rows.map((row, idx) => {
          const errores: string[] = []
          const sku = String(row.sku ?? '').trim()
          const pct = leerPorcentaje(row.descuento_pct)
          const prod = sku ? porSku.get(sku.toUpperCase()) : undefined
          if (pct === 'invalido') errores.push(`Descuento "${row.descuento_pct}" no válido (de 0 a 100, hasta 2 decimales)`)
          if (pct !== null) {
            if (!sku) errores.push('Falta el SKU')
            else if (!prod) errores.push(`SKU "${sku}" no existe`)
            else if (prod.activo === false) errores.push(`El producto "${prod.nombre}" está desactivado`)
          }
          if (prod && pct !== null) vistos.set(prod.id, [...(vistos.get(prod.id) ?? []), filaExcel(idx)])
          return {
            idx, sku, nombre: prod?.nombre ?? String(row.nombre ?? ''), productoId: prod?.id,
            pct: pct === 'invalido' ? null : pct, actual: prod ? actual.get(prod.id) : undefined, errores,
          }
        })
        for (const f of nuevas) {
          const rep = f.productoId ? vistos.get(f.productoId) : undefined
          if (rep && rep.length > 1 && f.pct !== null) f.errores.push(`El mismo producto aparece en las filas ${rep.join(', ')}: dejá una sola`)
        }
        setFilas(nuevas)
        setOriginales(rows)
      } catch (err: any) { toast.error(err?.message ?? 'Error al leer el archivo.') }
    }
    reader.readAsArrayBuffer(file)
  }

  const aCargar = filas.filter(f => !f.errores.length && f.pct !== null && f.productoId && f.pct !== f.actual)

  const cargar = async () => {
    if (filas.some(f => f.errores.length)) return   // D3-a: todo o nada
    if (!aCargar.length) { toast('No hay cambios para cargar'); return }
    setCargando(true)
    try {
      const { data, error } = await supabase.rpc('fn_importar_descuentos_categoria', {
        p_categoria_id: categoriaId,
        p_filas: aCargar.map(f => ({ fila: filaExcel(f.idx), producto_id: f.productoId, descuento_pct: f.pct })),
      })
      if (error) { setResultado({ ok: false, mensaje: mensajeErrorCarga(error) }); return }
      const r = data as { creados: number; actualizados: number }
      const sinCambios = filas.length - aCargar.length
      setResultado({ ok: true, resumen: `${r.creados} agregados · ${r.actualizados} actualizados${sinCambios ? ` · ${sinCambios} sin cambios o vacías` : ''}` })
      setFilas([]); setOriginales([])
      qc.invalidateQueries({ queryKey: ['categoria-descuentos', categoriaId] })
      // Mig 469 (B-4): al guardar la promoción, la IA redacta el cartel del POS (sin esperar; si falla, queda el estándar).
      if (categoriaId) void pedirRedaccionCartel(categoriaId).then(() => qc.invalidateQueries({ queryKey: [CATEGORIAS_QUERY_KEY] }))
    } catch (e: any) {
      setResultado({ ok: false, mensaje: mensajeErrorCarga(e) })
    } finally {
      setCargando(false)
    }
  }

  if (!puedeGestionarCategorias(user as any, tenant)) {
    return <div className="p-6 text-sm text-amber-700">Tu rol no puede modificar las listas de descuento de las categorías.</div>
  }

  return (
    <PaginaImportacion
      titulo="Importar lista de descuentos"
      subtitulo={`Categoría: ${categoria?.nombre ?? '…'}`}
      volverA={volverA}
      onPlantilla={descargarPlantilla}
      onArchivo={procesarArchivo}
      hayFilas={filas.length > 0}
      iconoVacio={<Percent size={28} className="text-gray-300 mx-auto mb-2" />}
      resultado={resultado && (
        <ResultadoImportacion resultado={resultado} accion={resultado.ok && (
          <button onClick={() => navigate(volverA)} className="mt-2 text-sm text-green-700 dark:text-green-400 font-medium hover:underline">Ver la lista →</button>
        )} />
      )}
      aviso={
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900 rounded-xl p-4 text-sm text-blue-700 dark:text-blue-300">
          <strong>La plantilla trae todos tus productos</strong> con el descuento que ya tienen en esta categoría. Completá la
          columna <code>descuento_pct</code> (vacío = no se toca) y volvé a subirla. Todo o nada: con una fila con error no se
          carga ninguna. <strong>Los cambios se aplican en las ventas apenas se cargan.</strong>
        </div>
      }
    >
      <VistaPreviaImportacion
        entidadPlural="productos"
        columnas={['SKU', 'Producto', 'Descuento']}
        totalACargar={aCargar.length}
        filas={filas.map(f => {
          const cambia = f.pct !== null && f.pct !== f.actual
          return {
            idx: f.idx, errores: f.errores,
            estado: f.errores.length ? 'error' : !cambia ? 'omitida' : f.actual === undefined ? 'nuevo' : 'existente',
            detalle: f.errores.length ? undefined
              : f.pct === null ? 'Vacío: no se toca'
              : !cambia ? 'Sin cambios'
              : f.actual === undefined ? 'Se agrega a la lista' : `Antes ${porcentajeLegible(f.actual)}`,
            celdas: [f.sku || '—', f.nombre || '—', f.pct === null ? '—' : porcentajeLegible(f.pct)],
          }
        })}
        cargando={cargando}
        onCargar={cargar}
        onBajarErrores={() => {
          const err = filasConErrorParaExportar(originales, filas)
          if (err.length) void descargarExcel({ nombre: 'Filas con error', filas: err }, 'descuentos_filas_con_error')
        }}
      />
    </PaginaImportacion>
  )
}
