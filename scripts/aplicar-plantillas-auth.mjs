// Aplica los correos de Supabase Auth (asunto + contenido) desde supabase/templates/ a un proyecto.
//
// Por qué existe: los correos de Auth (invitación, recuperar contraseña, confirmar cuenta, link de ingreso) se
// configuran en el dashboard y no quedan en ninguna migración → drift DEV≠PROD y nadie sabe qué texto tiene cada uno.
// Hasta el 2026-10-05 eran los de fábrica, en inglés ("You have been invited"). Ahora viven en el repo.
//
// Uso:  node scripts/aplicar-plantillas-auth.mjs <project_ref> [--ver]   (--ver: muestra lo que hay, no cambia nada)
// Token: SUPABASE_ACCESS_TOKEN (env o .env.local).

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const [ref, flag] = process.argv.slice(2)
if (!ref) { console.error('Uso: node scripts/aplicar-plantillas-auth.mjs <project_ref> [--ver]'); process.exit(1) }
const root = resolve(import.meta.dirname, '..')
const envVal = (k) => { try { return readFileSync(resolve(root, '.env.local'), 'utf8').match(new RegExp('^' + k + '=(.*)$', 'm'))?.[1].trim() } catch { return undefined } }
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || envVal('SUPABASE_ACCESS_TOKEN')
if (!TOKEN) { console.error('Falta SUPABASE_ACCESS_TOKEN'); process.exit(1) }

const url = `https://api.supabase.com/v1/projects/${ref}/config/auth`
const headers = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
const TIPOS = ['invite', 'recovery', 'confirmation', 'magic_link']

if (flag === '--ver') {
  const actual = await (await fetch(url, { headers })).json()
  for (const t of TIPOS) console.log(`${t}: "${actual[`mailer_subjects_${t}`]}" (${(actual[`mailer_templates_${t}_content`] ?? '').length} caracteres)`)
  process.exit(0)
}

const base = readFileSync(resolve(root, 'supabase/templates/_base.html'), 'utf8')
const plantillas = JSON.parse(readFileSync(resolve(root, 'supabase/templates/plantillas.json'), 'utf8'))
const cuerpo = {}
for (const t of TIPOS) {
  const p = plantillas[t]
  if (!p?.asunto || !p?.contenido) { console.error(`Falta la plantilla "${t}"`); process.exit(1) }
  cuerpo[`mailer_subjects_${t}`] = p.asunto
  cuerpo[`mailer_templates_${t}_content`] = base.replace('{{CONTENIDO}}', p.contenido)
}

const r = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify(cuerpo) })
if (!r.ok) { console.error(`Error ${r.status}: ${(await r.text()).slice(0, 500)}`); process.exit(1) }
const nuevo = await r.json()
for (const t of TIPOS) console.log(`OK ${t}: "${nuevo[`mailer_subjects_${t}`]}"`)
