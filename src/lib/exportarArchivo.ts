// Exportación estándar de la app: Excel (.xlsx) y CSV, en un solo lugar.
//
// Por qué existe (2026-10-01): cada pantalla armaba su CSV a mano y cada una distinto — unas sin la marca UTF-8 (BOM,
// Excel abría los acentos "codificados", lo vio El Tilo), otras sin escapar los saltos de línea (una nota con Enter
// partía la fila en dos y corría las columnas al reimportar), y Productos/Clientes/Proveedores no ofrecían Excel.
//
// - Excel es el formato recomendado para abrir en la PC: no tiene problemas de acentos ni de separador.
// - El CSV usa coma por defecto porque es lo que leen los importadores (exportar → editar → reimportar).

export type FilaExport = Record<string, unknown>

const BOM = '﻿'

function celdaCsv(v: unknown, separador: string): string {
  if (v == null) return ''
  const s = v instanceof Date ? v.toISOString() : String(v)
  // Comillas si hay separador, comillas, o salto de línea (texto libre: notas, descripción).
  return s.includes(separador) || /["\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Texto CSV (con BOM) a partir de filas. Las columnas salen de la unión de claves, en orden de aparición. */
export function filasACsv(filas: FilaExport[], separador = ','): string {
  const columnas: string[] = []
  for (const f of filas) for (const k of Object.keys(f)) if (!columnas.includes(k)) columnas.push(k)
  const lineas = [
    columnas.map((c) => celdaCsv(c, separador)).join(separador),
    ...filas.map((f) => columnas.map((c) => celdaCsv(f[c], separador)).join(separador)),
  ]
  return BOM + lineas.join('\r\n')
}

function descargarBlob(blob: Blob, nombreArchivo: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombreArchivo
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Descarga un CSV. `nombre` sin extensión. */
export function descargarCsv(filas: FilaExport[], nombre: string, separador = ','): void {
  descargarBlob(new Blob([filasACsv(filas, separador)], { type: 'text/csv;charset=utf-8' }), `${nombre}.csv`)
}

/** Ancho de cada columna (en caracteres) según el contenido más largo, entre 8 y 50. */
export function anchosColumnas(filas: FilaExport[]): { wch: number }[] {
  const columnas: string[] = []
  for (const f of filas) for (const k of Object.keys(f)) if (!columnas.includes(k)) columnas.push(k)
  return columnas.map((c) => {
    let max = c.length
    for (const f of filas) {
      const v = f[c]
      if (v != null) max = Math.max(max, String(v).length)
    }
    return { wch: Math.min(50, Math.max(8, max + 2)) }
  })
}

export interface HojaExport {
  nombre: string
  filas: FilaExport[]
}

/** Descarga un Excel con una o más hojas. `nombre` sin extensión. Carga `xlsx` recién al usarse. */
export async function descargarExcel(hojas: HojaExport | HojaExport[], nombre: string): Promise<void> {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  for (const h of Array.isArray(hojas) ? hojas : [hojas]) {
    const ws = XLSX.utils.json_to_sheet(h.filas)
    ws['!cols'] = anchosColumnas(h.filas)
    // Excel limita el nombre de la hoja a 31 caracteres y prohíbe : \ / ? * [ ]
    XLSX.utils.book_append_sheet(wb, ws, h.nombre.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31) || 'Datos')
  }
  XLSX.writeFile(wb, `${nombre}.xlsx`)
}

export function descargarJson(datos: unknown, nombre: string): void {
  descargarBlob(new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' }), `${nombre}.json`)
}

/** `prefijo_AAAA-MM-DD` con la fecha local (no UTC: a la noche en Argentina el ISO ya es mañana). */
export function nombreConFecha(prefijo: string, fecha = new Date()): string {
  const d = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`
  return `${prefijo}_${d}`
}
