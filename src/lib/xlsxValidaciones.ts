// xlsxValidaciones — listas desplegables (validación de datos) en un .xlsx generado con SheetJS.
//
// D-3 (pedido de GO, 2026-09-25): la plantilla del importador de productos tiene que traer
// desplegables para categoría, proveedor, moneda, unidad, etc. La versión CE de SheetJS escribe el
// libro pero NO escribe `<dataValidations>`, así que se agregan después: un .xlsx es un zip, se abre
// con fflate, se inserta el bloque en el XML de la hoja y se vuelve a comprimir.
//
// Las listas NO van en línea (`"ARS,USD"`): una lista en línea tiene tope de 255 caracteres y se
// rompe con un nombre que tenga coma ("Pinturas, barnices"). Van como rango de una hoja aparte,
// referenciado por un NOMBRE DEFINIDO (`lst_categoria`), que es la forma que aceptan todas las
// versiones de Excel y LibreOffice.

import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'

export interface ValidacionLista {
  /** Columna de la hoja, en letras (`D`). */
  columna: string
  /** Primera y última fila a las que aplica (1-based, inclusive). */
  filaDesde: number
  filaHasta: number
  /** Nombre definido del libro que contiene los valores permitidos (`lst_categoria`). */
  nombreLista: string
  /** Título y texto del cartel cuando se escribe algo que no está en la lista. */
  errorTitulo: string
  errorTexto: string
}

const escXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Topes de Excel para el cartel de error: con uno más largo Excel da el archivo por dañado.
export const MAX_TITULO_ERROR = 32
export const MAX_TEXTO_ERROR = 255
const recortar = (s: string, max: number) => (s.length <= max ? s : s.slice(0, max - 1) + '…')

/** El bloque `<dataValidations>` para una lista de validaciones. */
export function xmlDataValidations(validaciones: ValidacionLista[]): string {
  if (validaciones.length === 0) return ''
  const items = validaciones.map(v =>
    `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" errorStyle="stop"` +
    ` errorTitle="${escXml(recortar(v.errorTitulo, MAX_TITULO_ERROR))}" error="${escXml(recortar(v.errorTexto, MAX_TEXTO_ERROR))}"` +
    ` sqref="${v.columna}${v.filaDesde}:${v.columna}${v.filaHasta}">` +
    `<formula1>${escXml(v.nombreLista)}</formula1></dataValidation>`,
  ).join('')
  return `<dataValidations count="${validaciones.length}">${items}</dataValidations>`
}

// Orden del esquema de `CT_Worksheet` (ECMA-376): `dataValidations` va DESPUÉS de sheetData,
// autoFilter, mergeCells, conditionalFormatting, etc., y ANTES de estos. Insertarlo fuera de orden
// hace que Excel diga "encontramos un problema con el contenido" y descarte la hoja.
const DESPUES_DE_DATA_VALIDATIONS = [
  '<hyperlinks', '<printOptions', '<pageMargins', '<pageSetup', '<headerFooter', '<rowBreaks',
  '<colBreaks', '<customProperties', '<cellWatches', '<ignoredErrors', '<smartTags', '<drawing',
  '<legacyDrawing', '<legacyDrawingHF', '<picture', '<oleObjects', '<controls', '<webPublishItems',
  '<tableParts', '<extLst',
]

/** Inserta el bloque en el XML de una hoja, en la posición que exige el esquema. */
export function insertarDataValidations(sheetXml: string, validaciones: ValidacionLista[]): string {
  const bloque = xmlDataValidations(validaciones)
  if (!bloque) return sheetXml
  if (sheetXml.includes('<dataValidations')) throw new Error('La hoja ya tiene validaciones de datos')
  const finData = sheetXml.indexOf('</sheetData>')
  if (finData < 0) throw new Error('XML de hoja sin <sheetData>')
  const desde = finData + '</sheetData>'.length
  const candidatos = DESPUES_DE_DATA_VALIDATIONS
    .map(tag => sheetXml.indexOf(tag, desde))
    .filter(i => i >= 0)
  const pos = candidatos.length > 0 ? Math.min(...candidatos) : sheetXml.lastIndexOf('</worksheet>')
  if (pos < 0) throw new Error('XML de hoja sin </worksheet>')
  return sheetXml.slice(0, pos) + bloque + sheetXml.slice(pos)
}

/**
 * Agrega validaciones a la hoja `xl/worksheets/sheet{n}.xml` de un .xlsx ya generado.
 * `hoja` es 1-based (la primera hoja del libro es 1), que es como SheetJS nombra los archivos.
 */
export function agregarValidacionesXlsx(xlsx: Uint8Array, hoja: number, validaciones: ValidacionLista[]): Uint8Array {
  if (validaciones.length === 0) return xlsx
  const archivos = unzipSync(xlsx)
  const ruta = `xl/worksheets/sheet${hoja}.xml`
  if (!archivos[ruta]) throw new Error(`El libro no tiene ${ruta}`)
  archivos[ruta] = strToU8(insertarDataValidations(strFromU8(archivos[ruta]), validaciones))
  return zipSync(archivos, { level: 6 })
}

/** `0 → A`, `25 → Z`, `26 → AA`. */
export function letraColumna(indice: number): string {
  let n = indice + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** Valores únicos, sin vacíos, ordenados alfabéticamente (es-AR, sin distinguir mayúsculas). */
export function valoresLista(valores: (string | null | undefined)[]): string[] {
  const vistos = new Map<string, string>()
  for (const v of valores) {
    const t = (v ?? '').trim()
    if (t && !vistos.has(t.toLowerCase())) vistos.set(t.toLowerCase(), t)
  }
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'es-AR', { sensitivity: 'base' }))
}
