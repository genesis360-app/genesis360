// Genera el HTML imprimible de "Consultas para el Contador" desde el markdown del wiki.
//
// El markdown (G360.Wiki/wiki/business/consultas-contador.md) es la UNICA fuente de verdad: es el
// registro vivo que se edita cada vez que aparece una duda fiscal. Este script solo lo maqueta para
// imprimir y le agrega un recuadro de respuesta debajo de cada pregunta.
//
// Por que generado y no un segundo documento a mano: mantener dos copias garantiza que se
// desincronicen, y la que se le termina entregando al contador siempre es la vieja.
//
//   npm run contador:doc   ->   G360.Wiki/wiki/business/consultas-contador.html
//
// Para entregarlo: abrir el HTML en el navegador -> Imprimir -> Guardar como PDF.

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ORIGEN = resolve(raiz, 'G360.Wiki/wiki/business/consultas-contador.md')
const DESTINO = resolve(raiz, 'G360.Wiki/wiki/business/consultas-contador.html')

const BACKTICK = String.fromCharCode(96)

const escapar = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Marcas dentro de una linea.
 *
 * Se parte el texto por los backticks y se procesan los segmentos alternados: los pares son texto
 * normal (se escapan y se les aplican negrita, italica y wikilinks) y los impares son codigo (solo
 * se escapan). Sin marcadores intermedios a proposito: un placeholder tipo " 3 " colisionaria con
 * cualquier numero suelto del texto y se comeria el 12 de "art. 12 Ley 23.349".
 */
function inline(texto) {
  return texto
    .split(BACKTICK)
    .map((seg, i) => {
      if (i % 2 === 1) return '<code>' + escapar(seg) + '</code>'
      let t = escapar(seg)
      t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>')
      // Los wikilinks no navegan en papel: se muestran como referencia en texto.
      t = t.replace(/\[\[([^\]]+)\]\]/g, (_, ref) => '<span class="ref">' + ref.split('/').pop() + '</span>')
      return t
    })
    .join('')
}

const RECUADRO = [
  '  <div class="respuesta">',
  '    <p class="respuesta-label">Respuesta del contador</p>',
  '    <div class="lineas"></div>',
  '    <p class="firma">Firma / sello &nbsp;____________________________ &nbsp;&nbsp; Fecha &nbsp;____ / ____ / ________</p>',
  '  </div>',
].join('\n')

function convertir(md) {
  // El frontmatter es metadata del wiki, no del documento impreso.
  const cuerpo = md.replace(/^---\n[\s\S]*?\n---\n/, '')
  const out = []

  let enLista = false
  let enTabla = false
  let enCita = null            // clase de la cita abierta, o null
  let preguntaAbierta = false  // hay un bloque C-NN esperando su recuadro de respuesta

  const cerrarLista = () => { if (enLista) { out.push('</ul>'); enLista = false } }
  const cerrarTabla = () => { if (enTabla) { out.push('</tbody></table>'); enTabla = false } }
  const cerrarCita = () => { if (enCita) { out.push('</div>'); enCita = null } }
  const cerrarPregunta = () => { if (preguntaAbierta) { out.push(RECUADRO); preguntaAbierta = false } }
  const cerrarBloques = () => { cerrarLista(); cerrarTabla(); cerrarCita() }

  for (const linea of cuerpo.split('\n')) {
    const t = linea.trim()

    if (t === '') { cerrarLista(); cerrarTabla(); continue }

    // Citas (incluidos los callouts del wiki, que se pintan como aviso)
    if (t.startsWith('>')) {
      const contenido = t.replace(/^>\s?/, '')
      const callout = /^\[!\w+\]/.test(contenido)
      if (!enCita) {
        enCita = callout ? 'cita aviso' : 'cita'
        out.push('<div class="' + enCita + '">')
      }
      if (callout) continue            // la etiqueta [!WARNING] no se imprime
      if (contenido) out.push('<p>' + inline(contenido) + '</p>')
      continue
    }
    cerrarCita()

    // Separador: cierra la pregunta anterior con su recuadro de respuesta
    if (/^---+$/.test(t)) { cerrarBloques(); cerrarPregunta(); out.push('<hr>'); continue }

    // Tablas
    if (t.startsWith('|')) {
      if (/^\|[\s|:-]+\|$/.test(t)) continue   // la fila separadora no se imprime
      const celdas = t.split('|').slice(1, -1).map((c) => c.trim())
      if (!enTabla) {
        enTabla = true
        out.push('<table><thead><tr>' + celdas.map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>')
      } else {
        out.push('<tr>' + celdas.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>')
      }
      continue
    }
    cerrarTabla()

    // Titulos
    const h = t.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      cerrarLista(); cerrarPregunta()
      const nivel = h[1].length
      const pregunta = h[2].match(/^(C-\d+)\s*[·.-]\s*(.*)$/)
      if (nivel === 3 && pregunta) {
        preguntaAbierta = true
        out.push('<h3 class="pregunta"><span class="chip">' + pregunta[1] + '</span> ' + inline(pregunta[2]) + '</h3>')
      } else {
        out.push('<h' + nivel + '>' + inline(h[2]) + '</h' + nivel + '>')
      }
      continue
    }

    // Listas
    if (/^[-*]\s+/.test(t)) {
      if (!enLista) { out.push('<ul>'); enLista = true }
      out.push('<li>' + inline(t.replace(/^[-*]\s+/, '')) + '</li>')
      continue
    }
    if (/^\d+\.\s+/.test(t)) {
      if (!enLista) { out.push('<ul class="num">'); enLista = true }
      out.push('<li>' + inline(t.replace(/^\d+\.\s+/, '')) + '</li>')
      continue
    }
    cerrarLista()

    out.push('<p>' + inline(t) + '</p>')
  }

  cerrarBloques()
  cerrarPregunta()
  return out.join('\n')
}

const ESTILO = [
  ':root { --tinta:#1a1a1a; --gris:#666; --linea:#d8d8d8; --marca:#7B00FF; --aviso:#b45309; }',
  '* { box-sizing: border-box; }',
  'body {',
  '  font-family: "Segoe UI", system-ui, -apple-system, sans-serif;',
  '  color: var(--tinta); line-height: 1.55; margin: 0 auto; max-width: 820px;',
  '  padding: 32px 28px 64px; font-size: 11pt;',
  '}',
  'header { border-bottom: 3px solid var(--marca); padding-bottom: 14px; margin-bottom: 8px; }',
  'header h1 { margin: 0 0 4px; font-size: 21pt; letter-spacing: -.4px; }',
  'header .sub { color: var(--gris); font-size: 10pt; margin: 0; }',
  'h1 { font-size: 18pt; margin: 26px 0 8px; }',
  'h2 { font-size: 14pt; margin: 30px 0 10px; padding-bottom: 5px; border-bottom: 1px solid var(--linea); }',
  'h3 { font-size: 11.5pt; margin: 22px 0 8px; }',
  'h3.pregunta { page-break-after: avoid; break-after: avoid; }',
  'h4 { font-size: 11pt; margin: 16px 0 6px; }',
  'p { margin: 7px 0; }',
  'ul { margin: 7px 0; padding-left: 20px; }',
  'ul.num { list-style: decimal; }',
  'li { margin: 3px 0; }',
  'code { font-family: Consolas, "SF Mono", monospace; font-size: .88em; background: #f2f2f5; padding: 1px 4px; border-radius: 3px; }',
  '.ref { font-style: italic; color: var(--gris); }',
  'hr { border: 0; border-top: 1px solid var(--linea); margin: 26px 0; }',
  'table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 10pt; }',
  'th, td { border: 1px solid var(--linea); padding: 5px 9px; text-align: left; }',
  'th { background: #f6f4fb; }',
  '.chip {',
  '  display: inline-block; background: var(--marca); color: #fff; font-size: 9pt;',
  '  padding: 1px 8px; border-radius: 10px; margin-right: 6px; vertical-align: 2px;',
  '}',
  '.cita { border-left: 3px solid var(--linea); padding: 2px 0 2px 14px; margin: 12px 0; color: #444; }',
  '.cita.aviso { border-left-color: var(--aviso); background: #fffbeb; padding: 8px 14px; }',
  '.cita p { margin: 4px 0; }',
  '',
  '/* El recuadro donde el contador escribe. Se mantiene junto a su pregunta al paginar. */',
  '.respuesta {',
  '  border: 1.5px solid var(--marca); border-radius: 8px; padding: 12px 14px 10px;',
  '  margin: 14px 0 4px; page-break-inside: avoid; break-inside: avoid;',
  '}',
  '.respuesta-label {',
  '  margin: 0 0 8px; font-size: 8.5pt; font-weight: 700; letter-spacing: .8px;',
  '  text-transform: uppercase; color: var(--marca);',
  '}',
  '.lineas {',
  '  height: 108px;',
  '  background-image: repeating-linear-gradient(to bottom, transparent 0 25px, var(--linea) 25px 26px);',
  '}',
  '.firma { margin: 12px 0 0; font-size: 9pt; color: var(--gris); }',
  '',
  '@media print {',
  '  body { padding: 0; max-width: none; font-size: 10.5pt; }',
  '  header { border-bottom-width: 2px; }',
  '  a { text-decoration: none; color: inherit; }',
  '}',
].join('\n')

const hoy = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })
const cuerpo = convertir(readFileSync(ORIGEN, 'utf8'))

const html = [
  '<!doctype html>',
  '<html lang="es">',
  '<head>',
  '<meta charset="utf-8">',
  '<title>Genesis360 - Consultas para el Contador</title>',
  '<style>',
  ESTILO,
  '</style>',
  '</head>',
  '<body>',
  '<header>',
  '  <h1>Genesis360 &mdash; Consultas para el Contador</h1>',
  '  <p class="sub">Documento generado el ' + hoy + ' &middot; version imprimible de <code>wiki/business/consultas-contador.md</code></p>',
  '</header>',
  cuerpo,
  '</body>',
  '</html>',
  '',
].join('\n')

writeFileSync(DESTINO, html, 'utf8')
const preguntas = (html.match(/class="chip"/g) || []).length
console.log('OK ' + DESTINO)
console.log('   ' + preguntas + ' preguntas con recuadro de respuesta.')
