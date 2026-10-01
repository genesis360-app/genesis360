// Exportación estándar (src/lib/exportarArchivo.ts). El ida y vuelta lee el archivo IGUAL que los importadores
// (XLSX.read como array de bytes + sheet_to_json con defval ''), así lo que se exporta se puede reimportar.
import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { anchosColumnas, filasACsv, nombreConFecha } from '@/lib/exportarArchivo'

const leerComoImportador = (bytes: Uint8Array) => {
  const wb = XLSX.read(bytes, { type: 'array' })
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' })
}

const filas = [
  { sku: '00123', nombre: 'Yerba "La Tranquera"', notas: 'línea 1\nlínea 2', precio: 1500.5, categoria: 'Almacén, seco' },
  { sku: 'A-2', nombre: 'Ñandú café', notas: '', precio: 0, categoria: 'Bebidas' },
]

describe('filasACsv', () => {
  it('arranca con BOM y separa con coma por defecto', () => {
    const csv = filasACsv(filas)
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv.split('\r\n')[0]).toBe('﻿sku,nombre,notas,precio,categoria')
  })

  it('escapa comillas, separador y saltos de línea', () => {
    const csv = filasACsv(filas)
    expect(csv).toContain('"Yerba ""La Tranquera"""')
    expect(csv).toContain('"línea 1\nlínea 2"')
    expect(csv).toContain('"Almacén, seco"')
  })

  it('con `;` solo comilla lo que tiene `;`', () => {
    const csv = filasACsv([{ a: 'x,y', b: 'p;q' }], ';')
    expect(csv.split('\r\n')[1]).toBe('x,y;"p;q"')
  })

  it('null/undefined → vacío; columnas = unión de claves en orden', () => {
    const csv = filasACsv([{ a: 1 }, { b: null, a: undefined }])
    expect(csv.split('\r\n')).toEqual(['﻿a,b', '1,', ','])
  })

  it('ida y vuelta: el importador relee exactamente lo exportado (acentos, Enter, comillas, coma)', () => {
    const bytes = new TextEncoder().encode(filasACsv(filas))
    const leidas = leerComoImportador(bytes)
    expect(leidas).toHaveLength(2)
    expect(leidas[0].nombre).toBe('Yerba "La Tranquera"')
    expect(leidas[0].notas).toBe('línea 1\nlínea 2')
    expect(leidas[0].categoria).toBe('Almacén, seco')
    expect(leidas[1].nombre).toBe('Ñandú café')
    expect(Object.keys(leidas[0])[0]).toBe('sku')   // el BOM no ensucia el nombre de la 1ª columna
  })
})

describe('Excel', () => {
  it('ida y vuelta: textos quedan como texto (SKU con ceros adelante) y números como números', () => {
    const ws = XLSX.utils.json_to_sheet(filas)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Productos')
    const bytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))
    const leidas = leerComoImportador(bytes)
    expect(leidas[0].sku).toBe('00123')
    expect(leidas[0].precio).toBe(1500.5)
    expect(leidas[0].notas).toBe('línea 1\nlínea 2')
    expect(leidas[1].nombre).toBe('Ñandú café')
  })

  it('anchos de columna según el contenido, acotados a 8..50', () => {
    expect(anchosColumnas([{ a: 'x', larga: 'y'.repeat(200) }])).toEqual([{ wch: 8 }, { wch: 50 }])
    expect(anchosColumnas([{ nombre: 'Yerba mate 1kg' }])).toEqual([{ wch: 16 }])
  })
})

describe('nombreConFecha', () => {
  it('usa la fecha LOCAL', () => {
    expect(nombreConFecha('productos', new Date(2026, 9, 1, 23, 30))).toBe('productos_2026-10-01')
  })
})
