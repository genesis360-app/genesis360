// Aplica UNA migración del repo a un proyecto Supabase con el contenido EXACTO del archivo (byte a byte).
//
// Por qué existe: pasar SQL largo con tildes a `apply_migration` a mano perdió acentos en silencio (mig 368, ver
// memoria "apply_migration pierde acentos"). Esto lee el archivo y lo manda tal cual por la Management API
// (POST /v1/projects/{ref}/database/query), en UNA transacción junto con su registro en
// supabase_migrations.schema_migrations — igual que `apply_migration`. Si algo falla, no queda nada aplicado.
//
// Uso:  node scripts/aplicar-migracion.mjs <project_ref> supabase/migrations/NNN_nombre.sql
// Token: SUPABASE_ACCESS_TOKEN (env o .env.local), el mismo que usa `npm run schema:dump`.
// 🛑 De a UNA: la versión es el timestamp al segundo y dos seguidas en el mismo segundo chocan.

import { readFileSync } from 'node:fs'
import { resolve, basename } from 'node:path'

const [ref, file] = process.argv.slice(2)
if (!ref || !file) { console.error('Uso: node scripts/aplicar-migracion.mjs <project_ref> <archivo.sql>'); process.exit(1) }

const root = resolve(import.meta.dirname, '..')
const envVal = (key) => {
  try { return readFileSync(resolve(root, '.env.local'), 'utf8').match(new RegExp('^' + key + '=(.*)$', 'm'))?.[1].trim() }
  catch { return undefined }
}
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || envVal('SUPABASE_ACCESS_TOKEN')
if (!TOKEN) { console.error('Falta SUPABASE_ACCESS_TOKEN'); process.exit(1) }

const sql = readFileSync(resolve(root, file), 'utf8')
const name = basename(file, '.sql')
if (sql.includes('$migfile$')) { console.error('El archivo contiene el delimitador $migfile$'); process.exit(1) }
// La versión es un timestamp en SEGUNDOS: dos migraciones aplicadas en el mismo segundo chocaban en la PK de
// schema_migrations (pasó con 470/471 en el deploy v1.239.0, 2026-10-06). Si ya hay una versión igual o posterior, se
// usa la siguiente.
const fmt = (dt) => dt.toISOString().replace(/[-:T]/g, '').slice(0, 14)
let version = fmt(new Date())
{
  const rq = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'select max(version) v from supabase_migrations.schema_migrations' }),
  })
  const max = rq.ok ? (await rq.json())?.[0]?.v : null
  if (max && max >= version) {
    const t = new Date(Date.UTC(+max.slice(0, 4), +max.slice(4, 6) - 1, +max.slice(6, 8), +max.slice(8, 10), +max.slice(10, 12), +max.slice(12, 14)) + 1000)
    version = fmt(t)
  }
}

const query = `BEGIN;
${sql}
;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('${version}', '${name.replace(/'/g, "''")}', ARRAY[$migfile$${sql}$migfile$]);
COMMIT;`

const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query }),
})
const body = await r.text()
if (!r.ok) { console.error(`FALLÓ (${r.status}): ${body}`); process.exit(1) }
console.log(`OK → ${name} aplicada en ${ref} como versión ${version}`)
