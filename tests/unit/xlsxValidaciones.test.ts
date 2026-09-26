import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { unzipSync, strFromU8 } from 'fflate'
import {
  xmlDataValidations, insertarDataValidations, agregarValidacionesXlsx, letraColumna, valoresLista,
  MAX_TITULO_ERROR, MAX_TEXTO_ERROR, type ValidacionLista,
} from '@/lib/xlsxValidaciones'

// D-3 — listas desplegables en la plantilla del importador. Los tests usan un libro REAL generado
// por SheetJS (el mismo camino que la app), no un XML armado a mano.

const v = (over: Partial<ValidacionLista> = {}): ValidacionLista => ({
  columna: 'D', filaDesde: 2, filaHasta: 5000, nombreLista: 'lst_categoria',
  errorTitulo: 'Categoría inexistente', errorTexto: 'Elegí una de la lista', ...over,
})

function libroReal() {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['nombre', 'sku', 'x', 'categoria'], ['Tornillo', 'T1', '', 'Ferretería']]), 'Productos')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['lst_categoria'], ['Ferretería'], ['Pinturas, barnices & afines']]), 'Listas')
  wb.Workbook = {
    Sheets: [{ Hidden: 0 }, { Hidden: 1 }],
    Names: [{ Name: 'lst_categoria', Ref: 'Listas!$A$2:$A$3' }],
  }
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))
}

describe('letraColumna', () => {
  it('A, Z, AA, AI (columna 35 de la plantilla), AZ, BA', () => {
    expect(letraColumna(0)).toBe('A')
    expect(letraColumna(25)).toBe('Z')
    expect(letraColumna(26)).toBe('AA')
    expect(letraColumna(34)).toBe('AI')
    expect(letraColumna(51)).toBe('AZ')
    expect(letraColumna(52)).toBe('BA')
  })
})

describe('valoresLista', () => {
  it('saca vacíos y duplicados sin distinguir mayúsculas, y ordena', () => {
    expect(valoresLista(['Pinturas', '', null, 'ferretería', 'Ferretería', '  ', undefined, 'Álamo']))
      .toEqual(['Álamo', 'ferretería', 'Pinturas'])
  })
})

describe('xmlDataValidations', () => {
  it('sin validaciones no genera nada', () => {
    expect(xmlDataValidations([])).toBe('')
  })
  it('lista por NOMBRE DEFINIDO, con cartel de error que frena', () => {
    const x = xmlDataValidations([v()])
    expect(x).toContain('<dataValidations count="1">')
    expect(x).toContain('type="list"')
    expect(x).toContain('errorStyle="stop"')
    expect(x).toContain('allowBlank="1"')
    expect(x).toContain('sqref="D2:D5000"')
    expect(x).toContain('<formula1>lst_categoria</formula1>')
  })
  it('escapa & < > " en los textos (si no, el XML queda roto y Excel descarta la hoja)', () => {
    const x = xmlDataValidations([v({ errorTexto: 'A & B <x> "y"' })])
    expect(x).toContain('error="A &amp; B &lt;x&gt; &quot;y&quot;"')
  })
})

describe('topes de Excel del cartel de error', () => {
  it('título > 32 y texto > 255 se recortan (si no, Excel da el archivo por dañado)', () => {
    const x = xmlDataValidations([v({ errorTitulo: 'T'.repeat(40), errorTexto: 'x'.repeat(300) })])
    const titulo = x.match(/errorTitle="([^"]*)"/)![1]
    const texto = x.match(/ error="([^"]*)"/)![1]
    expect([...titulo].length).toBe(MAX_TITULO_ERROR)
    expect([...texto].length).toBe(MAX_TEXTO_ERROR)
  })
  it('los que entran quedan intactos', () => {
    expect(xmlDataValidations([v({ errorTitulo: 'Categoría no está en la lista' })])).toContain('errorTitle="Categoría no está en la lista"')
  })
})

describe('insertarDataValidations — posición que exige el esquema', () => {
  it('va después de </sheetData> y ANTES de <pageMargins>', () => {
    const xml = '<worksheet><sheetData><row/></sheetData><mergeCells/><pageMargins left="1"/></worksheet>'
    const r = insertarDataValidations(xml, [v()])
    expect(r.indexOf('<dataValidations')).toBeGreaterThan(r.indexOf('<mergeCells'))
    expect(r.indexOf('<dataValidations')).toBeLessThan(r.indexOf('<pageMargins'))
  })
  it('si no hay nada después de sheetData, va antes de </worksheet>', () => {
    const r = insertarDataValidations('<worksheet><sheetData/></worksheet>'.replace('<sheetData/>', '<sheetData></sheetData>'), [v()])
    expect(r).toMatch(/<\/sheetData><dataValidations.*<\/dataValidations><\/worksheet>$/)
  })
  it('no duplica si la hoja ya tiene validaciones', () => {
    expect(() => insertarDataValidations('<worksheet><sheetData></sheetData><dataValidations/></worksheet>', [v()])).toThrow()
  })
})

describe('agregarValidacionesXlsx — sobre un libro real de SheetJS', () => {
  it('la hoja 1 queda con las validaciones y el resto del libro intacto', () => {
    const salida = agregarValidacionesXlsx(libroReal(), 1, [v(), v({ columna: 'B', nombreLista: 'lst_moneda' })])
    const zip = unzipSync(salida)
    const hoja = strFromU8(zip['xl/worksheets/sheet1.xml'])
    expect(hoja).toContain('<dataValidations count="2">')
    expect(hoja.indexOf('<dataValidations')).toBeGreaterThan(hoja.indexOf('</sheetData>'))
    // La hoja de listas no se toca.
    expect(strFromU8(zip['xl/worksheets/sheet2.xml'])).not.toContain('dataValidation')
    // El nombre definido y la hoja oculta llegan al workbook.xml.
    const wbXml = strFromU8(zip['xl/workbook.xml'])
    expect(wbXml).toContain('lst_categoria')
    expect(wbXml).toMatch(/name="Listas"[^>]*state="hidden"|state="hidden"[^>]*name="Listas"/)
  })

  it('🔑 el archivo resultante se sigue pudiendo leer y el importador lee la primera hoja igual que antes', () => {
    const wb = XLSX.read(agregarValidacionesXlsx(libroReal(), 1, [v()]), { type: 'array' })
    expect(wb.SheetNames).toEqual(['Productos', 'Listas'])
    const filas: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
    expect(filas).toEqual([{ nombre: 'Tornillo', sku: 'T1', x: '', categoria: 'Ferretería' }])
    // Un nombre con coma y & sobrevive (por eso las listas no van en línea).
    expect(XLSX.utils.sheet_to_json(wb.Sheets.Listas, { header: 1 })).toContainEqual(['Pinturas, barnices & afines'])
  })

  it('sin validaciones devuelve los mismos bytes', () => {
    const b = libroReal()
    expect(agregarValidacionesXlsx(b, 1, [])).toBe(b)
  })

  it('hoja inexistente → error claro', () => {
    expect(() => agregarValidacionesXlsx(libroReal(), 9, [v()])).toThrow(/sheet9/)
  })
})
