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
const d = new Date()
const version = d.toISOString().replace(/[-:T]/g, '').slice(0, 14)

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
