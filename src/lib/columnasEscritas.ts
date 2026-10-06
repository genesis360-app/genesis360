/**
 * Chequeo estático: ¿las columnas que el código ESCRIBE existen en la base?
 *
 * Por qué existe (GO, 2026-10-06): el cliente de Supabase no tiene los tipos de la base, así que
 * un insert en `caja_movimientos` con `created_by` compila aunque la columna no exista (es `usuario_id`). El insert falla en
 * runtime, y si nadie mira el `error`, falla en silencio: un pago en efectivo a un proveedor nunca entraba en la caja.
 * Esto lo usa `tests/unit/columnasEscritas.test.ts` contra `supabase/schema_full.sql`.
 *
 * Alcance: `.from('<tabla>')` seguido (en la misma cadena) de `.insert(`, `.update(` o `.upsert(` con un objeto LITERAL
 * (o un array de objetos literales). Un objeto armado en una variable no se puede ver así y se ignora.
 */

/** Tablas y columnas de un dump `CREATE TABLE public.x ( col tipo, … );` (+ `ALTER TABLE … ADD COLUMN`). */
export function columnasDelEsquema(sql: string): Map<string, Set<string>> {
  const tablas = new Map<string, Set<string>>()
  const reTabla = /CREATE TABLE (?:IF NOT EXISTS )?public\.(\w+) \(\n([\s\S]*?)\n\);/g
  for (const m of sql.matchAll(reTabla)) {
    const cols = new Set<string>()
    for (const linea of m[2].split('\n')) {
      const c = linea.trim().match(/^"?([a-z_][a-z0-9_]*)"? /i)
      if (c && !/^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN|EXCLUDE)$/i.test(c[1])) cols.add(c[1])
    }
    tablas.set(m[1], cols)
  }
  for (const m of sql.matchAll(/ALTER TABLE (?:ONLY )?public\.(\w+) ADD COLUMN (?:IF NOT EXISTS )?"?(\w+)"?/g)) {
    tablas.get(m[1])?.add(m[2])
  }
  return tablas
}

/** Índice del cierre que corresponde a la apertura en `desde` (respeta strings, templates y comentarios). */
function cierre(src: string, desde: number): number {
  const abre = src[desde]
  const cierra = abre === '{' ? '}' : abre === '[' ? ']' : ')'
  let nivel = 0
  for (let i = desde; i < src.length; i++) {
    const ch = src[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      for (i++; i < src.length && src[i] !== ch; i++) if (src[i] === '\\') i++
      continue
    }
    if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
    if (ch === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 1; continue }
    if (ch === '{' || ch === '[' || ch === '(') nivel++
    else if (ch === '}' || ch === ']' || ch === ')') { nivel--; if (nivel === 0 && ch === cierra) return i }
  }
  return -1
}

/** Claves de primer nivel de un objeto literal `{ a: 1, b, 'c': 2, ...x }` (las de `...spread` no se ven). */
export function clavesDeObjeto(obj: string): string[] {
  const claves: string[] = []
  let i = 1
  while (i < obj.length - 1) {
    while (i < obj.length - 1 && /[\s,]/.test(obj[i])) i++
    if (i >= obj.length - 1) break
    if (obj.startsWith('//', i)) { i = obj.indexOf('\n', i); if (i < 0) break; continue }
    if (obj.startsWith('/*', i)) { i = obj.indexOf('*/', i) + 2; continue }
    if (obj.startsWith('...', i)) { /* spread: se saltea */ }
    else {
      const k = obj.slice(i).match(/^(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*(:|,|\}|$)/)
      if (k) claves.push(k[1] ?? k[2] ?? k[3])
    }
    // avanzar hasta la próxima coma de primer nivel
    for (; i < obj.length - 1; i++) {
      const ch = obj[i]
      if (ch === '"' || ch === "'" || ch === '`' || ch === '{' || ch === '[' || ch === '(') {
        if (ch === '{' || ch === '[' || ch === '(') { i = cierre(obj, i); continue }
        const q = ch; for (i++; i < obj.length && obj[i] !== q; i++) if (obj[i] === '\\') i++
        continue
      }
      if (ch === '/' && obj[i + 1] === '/') { i = obj.indexOf('\n', i); if (i < 0) i = obj.length; continue }
      if (ch === ',') { i++; break }
    }
  }
  return claves
}

export interface EscrituraEncontrada { tabla: string; operacion: string; columnas: string[]; linea: number }

/** Escrituras con objeto literal en un archivo fuente. */
export function escriturasEnFuente(src: string): EscrituraEncontrada[] {
  const out: EscrituraEncontrada[] = []
  const re = /\.from\(\s*['"](\w+)['"]\s*\)/g
  for (const m of src.matchAll(re)) {
    // La operación tiene que ser el PRIMER método encadenado (lo que viene después de `.from(...)`).
    const resto = src.slice(m.index! + m[0].length)
    const op = resto.match(/^\s*\.(insert|update|upsert)\(\s*/)
    if (!op) continue
    const ini = m.index! + m[0].length + op[0].length
    let arg = src[ini]
    let pos = ini
    if (arg === '[') {   // array de objetos: se miran todos los literales del primer nivel
      const fin = cierre(src, ini)
      const cuerpo = src.slice(ini + 1, fin)
      let j = 0
      const cols = new Set<string>()
      let hay = false
      while ((j = cuerpo.indexOf('{', j)) >= 0) {
        const f = cierre(cuerpo, j)
        if (f < 0) break
        clavesDeObjeto(cuerpo.slice(j, f + 1)).forEach(c => cols.add(c)); hay = true
        j = f + 1
      }
      if (hay) out.push({ tabla: m[1], operacion: op[1], columnas: [...cols], linea: src.slice(0, m.index).split('\n').length })
      continue
    }
    if (arg !== '{') continue
    pos = cierre(src, ini)
    if (pos < 0) continue
    out.push({
      tabla: m[1], operacion: op[1], columnas: clavesDeObjeto(src.slice(ini, pos + 1)),
      linea: src.slice(0, m.index).split('\n').length,
    })
  }
  return out
}
