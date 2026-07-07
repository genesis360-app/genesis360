// Genera el conocimiento del Asistente IA a partir del wiki (fuente única de verdad).
// Lee G360.Wiki/wiki/overview/app-reference.md y emite
// supabase/functions/ai-assistant/knowledge.generated.ts (commiteado; la EF lo importa).
//
// Correr tras actualizar el wiki y ANTES de redeployar la EF ai-assistant:
//   node scripts/build-ai-knowledge.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = resolve(root, 'G360.Wiki/wiki/overview/app-reference.md')
const OUT = resolve(root, 'supabase/functions/ai-assistant/knowledge.generated.ts')
const MAX_SECTION_CHARS = 5000

// Sinónimos/keywords por ruta (además del título de la sección). Español AR, sin tildes.
const ALIASES = {
  '/dashboard': ['inicio', 'kpi', 'resumen', 'tablero', 'metricas del negocio'],
  '/ventas': ['venta', 'vender', 'pos', 'cobrar', 'cobro', 'presupuesto', 'reserva', 'sena', 'ticket', 'carrito', 'devolucion', 'anular', 'recurrente', 'canal', 'vuelto', 'medio de pago', 'qr'],
  '/gastos': ['gasto', 'egreso', 'cheque', 'cuota', 'gasto fijo', 'categoria de gasto', 'cierre contable'],
  '/caja': ['caja', 'arqueo', 'apertura', 'cierre', 'efectivo', 'boveda', 'caja fuerte', 'turno', 'ingreso de caja', 'egreso de caja'],
  '/productos': ['producto', 'sku', 'codigo de barras', 'catalogo', 'precio', 'combo', 'kit', 'variante', 'categoria', 'mayorista'],
  '/inventario': ['inventario', 'stock', 'lpn', 'ubicacion', 'rebaje', 'ingreso de stock', 'conteo', 'movimiento', 'deposito', 'ajuste'],
  '/clientes': ['cliente', 'cuenta corriente', 'cc', 'crm', 'domicilio', 'cumpleanos', 'deuda', 'cobranza'],
  '/envios': ['envio', 'courier', 'reparto', 'tracking', 'remito', 'entrega', 'hoja de ruta', 'flete'],
  '/facturacion': ['factura', 'afip', 'arca', 'cae', 'nota de credito', 'comprobante', 'fiscal', 'iva', 'facturar'],
  '/proveedores': ['proveedor', 'orden de compra', 'oc', 'servicio', 'compra'],
  '/recursos': ['recurso', 'patrimonio', 'activo fijo', 'herramienta', 'vehiculo'],
  '/recepciones': ['recepcion', 'recibir mercaderia', 'ingreso de mercaderia'],
  '/biblioteca': ['biblioteca', 'archivo', 'documento'],
  '/alertas': ['alerta', 'notificacion', 'aviso', 'vencimiento', 'stock bajo'],
  '/rrhh': ['rrhh', 'empleado', 'sueldo', 'nomina', 'asistencia', 'vacaciones', 'fichar', 'recibo', 'licencia'],
  '/historial': ['historial', 'actividad', 'auditoria', 'quien hizo'],
  '/reportes': ['reporte', 'exportar', 'excel', 'pdf', 'rentabilidad'],
  '/sucursales': ['sucursal', 'local', 'deposito secundario', 'tarifa de envio'],
  '/usuarios': ['usuario', 'rol', 'permiso', 'invitar', 'contrasena', 'equipo'],
  '/configuracion': ['configuracion', 'ajustes', 'integracion', 'tiendanube', 'mercadolibre', 'mercadopago', 'metodo de pago', 'certificado', 'modo avanzado', 'modo basico'],
  '/movimientos': ['movimiento de stock', 'kardex', 'trazabilidad'],
  '/metricas': ['metricas', 'analisis', 'rotacion'],
  '/rentabilidad': ['rentabilidad', 'margen', 'ganancia'],
  '/recomendaciones': ['recomendacion', 'sugerencia', 'insight'],
  '/grupos-estados': ['grupo de estados', 'estado de stock'],
  '/importar/productos': ['importar productos', 'carga masiva'],
  '/importar/inventario': ['importar inventario', 'carga masiva de stock'],
  '/importar/master': ['importar datos maestros'],
  '/mi-cuenta': ['mi cuenta', 'perfil', 'cambiar email', 'cambiar contrasena', 'eliminar cuenta'],
  '/suscripcion': ['suscripcion', 'plan', 'pago del plan', 'addon', 'pack', 'upgrade', 'ampliar plan', 'comprobantes del plan'],
  '/ayuda': ['ayuda', 'soporte', 'contacto'],
  '/onboarding': ['onboarding', 'alta', 'registro', 'crear cuenta'],
}

// Keywords extra para secciones sin ruta, por prefijo de numeración o título.
const THEME_ALIASES = [
  { match: /^5\.1/, kw: ['proceso de venta', 'flujo de venta'] },
  { match: /^5\.2/, kw: ['proceso de compra', 'oc a recepcion', 'flujo de compra'] },
  { match: /^5\.3/, kw: ['devolucion', 'reembolso', 'cambio de producto'] },
  { match: /^5\.4/, kw: ['abrir caja', 'cerrar caja', 'flujo de caja'] },
  { match: /^5\.5/, kw: ['cuenta corriente', 'fiado', 'plazo de pago'] },
  { match: /^5\.6/, kw: ['acceso por sucursal', 'ver todas las sucursales'] },
  { match: /^6\./, kw: ['wms', 'fifo', 'fefo', 'kit', 'combo', 'estructura', 'lote', 'serie', 'vencimiento'] },
  { match: /^7\./, kw: ['alerta', 'notificacion', 'campana'] },
  { match: /^8\./, kw: ['integracion', 'tiendanube', 'mercadolibre', 'mercadopago', 'api externa'] },
  { match: /^9\./, kw: ['plan', 'limite', 'precio del plan', 'trial', 'prueba gratis'] },
  { match: /^10\./, kw: ['seguridad', 'login', 'google', 'sesion', 'contrasena'] },
]

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

const md = readFileSync(SRC, 'utf8')
const lines = md.split(/\r?\n/)

// Particionar: secciones ### N.M dentro de ## 3/4/5 (individuales) y bloques ## 6+ enteros.
const sections = []
let cur = null
let topBlock = null // { num } para ## 6..10 (bloque entero)

const pushCur = () => {
  if (!cur) return
  const contenido = cur.body.join('\n').trim()
  if (contenido.length > 60) sections.push({ ...cur, contenido })
  cur = null
}

for (const line of lines) {
  const h2 = line.match(/^## (\d+)\. (.+)$/)
  if (h2) {
    pushCur()
    const num = Number(h2[1])
    topBlock = num >= 6 ? { num } : null
    if (topBlock) cur = { id: `${num}.`, titulo: h2[2].trim(), ruta: null, body: [] }
    continue
  }
  const h3 = line.match(/^### (\d+\.\d+) (.+?)(?: \(`(\/[^`]*)`\))?$/)
  if (h3 && !topBlock) {
    pushCur()
    const [, id, titulo, ruta] = h3
    // Solo módulos (3.x, 4.x) y flujos (5.x); 1.x/2.x no existen como ###.
    cur = { id, titulo: titulo.trim(), ruta: ruta ?? null, body: [] }
    continue
  }
  if (cur) cur.body.push(line)
}
pushCur()

const out = sections.map((s) => {
  const kwSet = new Set(norm(s.titulo).split(/[^a-z0-9]+/).filter(w => w.length > 3))
  if (s.ruta && ALIASES[s.ruta]) ALIASES[s.ruta].forEach(k => kwSet.add(norm(k)))
  for (const t of THEME_ALIASES) if (t.match.test(s.id)) t.kw.forEach(k => kwSet.add(norm(k)))
  let contenido = s.contenido
  if (contenido.length > MAX_SECTION_CHARS) contenido = contenido.slice(0, MAX_SECTION_CHARS) + '\n[…sección recortada…]'
  return { id: s.id, titulo: s.titulo, ruta: s.ruta, keywords: [...kwSet], contenido }
})

// Sanity: si el wiki cambia de formato, fallar acá y no deployar un conocimiento vacío.
if (out.length < 20) throw new Error(`Solo ${out.length} secciones parseadas — ¿cambió el formato de app-reference.md?`)
const rutasEsperadas = ['/ventas', '/inventario', '/caja', '/gastos', '/facturacion', '/configuracion']
for (const r of rutasEsperadas) {
  if (!out.some(s => s.ruta === r)) throw new Error(`Falta la sección de ${r} — revisar app-reference.md`)
}

const ts = `// ⚠ ARCHIVO GENERADO por scripts/build-ai-knowledge.mjs — NO EDITAR A MANO.
// Fuente: G360.Wiki/wiki/overview/app-reference.md (el wiki es la única fuente de verdad).
// Regenerar tras actualizar el wiki y redeployar la EF ai-assistant.

export interface KnowledgeSection {
  id: string
  titulo: string
  ruta: string | null
  keywords: string[]
  contenido: string
}

export const KNOWLEDGE_GENERATED_AT = ${JSON.stringify(new Date().toISOString())}

export const KNOWLEDGE_SECTIONS: KnowledgeSection[] = ${JSON.stringify(out, null, 2)}
`
writeFileSync(OUT, ts, 'utf8')
console.log(`OK — ${out.length} secciones (${(ts.length / 1024).toFixed(0)} KB) → ${OUT}`)
