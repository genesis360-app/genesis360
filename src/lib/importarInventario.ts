// Reglas puras del importador de inventario (src/pages/ImportarInventarioPage.tsx, mig 449).

/**
 * Tope de filas por archivo. Más bajo que productos/clientes (5000): cada línea dispara los triggers de stock
 * (recalcular_stock, alertas, sync ML/TN), ~1,4 ms por fila, y el rol `authenticated` corta a los 8 s.
 * Tiene que coincidir con el de `fn_importar_inventario`.
 */
export const MAX_FILAS_INVENTARIO = 2000

type XlsxSsf = { SSF: { parse_date_code: (n: number) => { y: number; m: number; d: number } | null | undefined } }

/**
 * Fecha de una celda → 'AAAA-MM-DD'. Acepta serial de Excel, Date, 'AAAA-MM-DD' y 'DD/MM/AAAA' (o con guiones).
 * `undefined` = celda vacía; `'invalida'` = trae algo que no es una fecha real (antes se mandaba tal cual y la base
 * rechazaba la fila a mitad de la carga).
 */
export function fechaImportada(val: unknown, xlsx: XlsxSsf): string | undefined | 'invalida' {
  if (val === null || val === undefined || val === '') return undefined
  let y: number, m: number, d: number
  if (typeof val === 'number') {
    const c = xlsx.SSF.parse_date_code(val)
    if (!c) return 'invalida'
    ;({ y, m, d } = c)
  } else if (val instanceof Date) {
    if (Number.isNaN(val.getTime())) return 'invalida'
    y = val.getFullYear(); m = val.getMonth() + 1; d = val.getDate()
  } else {
    const s = String(val).trim()
    if (!s) return undefined
    const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
    const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (dmy) { d = +dmy[1]; m = +dmy[2]; y = +dmy[3] }
    else if (ymd) { y = +ymd[1]; m = +ymd[2]; d = +ymd[3] }
    else return 'invalida'
  }
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return 'invalida'
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
