import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { columnasDelEsquema, clavesDeObjeto, escriturasEnFuente, lecturasEnFuente } from '@/lib/columnasEscritas'

// 🛑 REGLA #0 (GO, 2026-10-06): un insert con una columna que no existe compila (el cliente de Supabase no tiene los
// tipos de la base) y falla en runtime. Así un pago en efectivo a un proveedor nunca entraba en la caja
// (`caja_movimientos.created_by`, la columna es `usuario_id`). Este test cruza TODAS las escrituras con objeto literal
// del front y de las Edge Functions contra `supabase/schema_full.sql` (que se regenera con `npm run schema:dump`).

const raiz = join(__dirname, '..', '..')
const esquema = columnasDelEsquema(readFileSync(join(raiz, 'supabase/schema_full.sql'), 'utf8'))

function archivos(dir: string): string[] {
  const out: string[] = []
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) { if (n !== 'node_modules') out.push(...archivos(p)) }
    else if (/\.(ts|tsx)$/.test(n) && !n.endsWith('.generated.ts')) out.push(p)
  }
  return out
}

describe('el parser', () => {
  it('lee las columnas del dump', () => {
    expect(esquema.size).toBeGreaterThan(100)
    expect(esquema.get('caja_movimientos')?.has('usuario_id')).toBe(true)
    expect(esquema.get('caja_movimientos')?.has('created_by')).toBe(false)
  })
  it('claves de un objeto literal (anidados, strings con comas, shorthand y spread)', () => {
    expect(clavesDeObjeto(`{ a: 1, b: { x: 1, y: 2 }, c: 'h, i', d, ...e, f: fn(1, 2), g: [1, 2] }`))
      .toEqual(['a', 'b', 'c', 'd', 'f', 'g'])
  })
  it('detecta la escritura y su tabla (solo si el insert/update es lo primero de la cadena)', () => {
    const src = `await supabase.from('caja_movimientos').insert({ tenant_id: t, created_by: u })
      await supabase.from('ventas').select('id').eq('id', 1)
      await supabase.from('venta_items').insert([{ a: 1 }, { b: 2 }])`
    expect(escriturasEnFuente(src)).toEqual([
      { tabla: 'caja_movimientos', operacion: 'insert', columnas: ['tenant_id', 'created_by'], linea: 1 },
      { tabla: 'venta_items', operacion: 'insert', columnas: ['a', 'b'], linea: 3 },
    ])
  })
})

describe('🛑 toda columna que el código escribe existe en la base', () => {
  const fuentes = [...archivos(join(raiz, 'src')), ...archivos(join(raiz, 'supabase/functions'))]
  const escrituras = fuentes.flatMap(f =>
    escriturasEnFuente(readFileSync(f, 'utf8')).map(e => ({ ...e, archivo: relative(raiz, f).replace(/\\/g, '/') })))

  it('el chequeo ve una cantidad razonable de escrituras (anti-vacío)', () => {
    expect(escrituras.length).toBeGreaterThan(300)
  })

  it('ninguna escritura usa una columna inexistente', () => {
    const errores: string[] = []
    for (const e of escrituras) {
      const cols = esquema.get(e.tabla)
      if (!cols) { errores.push(`${e.archivo}:${e.linea} — la tabla "${e.tabla}" no existe`); continue }
      for (const c of e.columnas) if (!cols.has(c)) errores.push(`${e.archivo}:${e.linea} — ${e.tabla}.${c} no existe (${e.operacion})`)
    }
    expect(errores).toEqual([])
  })
})

// 2026-10-08: lo mismo pasa al LEER. `users.email` no existe y 5 selects lo pedían → PostgREST da 400, el `data` llega
// null y nadie miraba el `error`: los avisos de diferencia de caja nunca salieron y el selector de cajeros quedaba vacío.
describe('🛑 toda columna que el código lee con .select() existe en la base', () => {
  it('el parser: columnas propias, alias y casts; saltea embeds, * y conteos', () => {
    const src = `supabase.from('users').select('id, nombre:nombre_display, rol::text, tenants(nombre), count')
      supabase.from('ventas').select('*, cliente:clientes(nombre)')`
    expect(lecturasEnFuente(src)).toEqual([
      { tabla: 'users', columnas: ['id', 'nombre_display', 'rol', 'count'], linea: 1 },
    ])
  })

  const fuentes = [...archivos(join(raiz, 'src')), ...archivos(join(raiz, 'supabase/functions'))]
  const lecturas = fuentes.flatMap(f =>
    lecturasEnFuente(readFileSync(f, 'utf8')).map(l => ({ ...l, archivo: relative(raiz, f).replace(/\\/g, '/') })))

  it('el chequeo ve una cantidad razonable de lecturas (anti-vacío)', () => {
    expect(lecturas.length).toBeGreaterThan(600)
  })

  it('ninguna lectura usa una columna inexistente', () => {
    const errores: string[] = []
    for (const l of lecturas) {
      const cols = esquema.get(l.tabla)
      if (!cols) {
        // Las vistas (`vw_…`) no están como CREATE TABLE en el dump: no se pueden chequear acá.
        if (!l.tabla.startsWith('vw_')) errores.push(`${l.archivo}:${l.linea} — la tabla "${l.tabla}" no existe`)
        continue
      }
      for (const c of l.columnas) if (!cols.has(c)) errores.push(`${l.archivo}:${l.linea} — ${l.tabla}.${c} no existe (select)`)
    }
    expect(errores).toEqual([])
  })
})
