// ─── Espejo puro de la EF ai-assistant (selección de conocimiento + prompt) ───
// La EF supabase/functions/ai-assistant/index.ts contiene ESTA MISMA lógica
// (copiada — Deno no importa de src/). Si cambiás algo acá, cambialo allá.
// El conocimiento lo genera scripts/build-ai-knowledge.mjs desde el wiki.

export interface KnowledgeSection {
  id: string
  titulo: string
  ruta: string | null
  keywords: string[]
  contenido: string
}

export interface ContextoUsuario {
  rol?: string
  modoAvanzado?: boolean
  plan?: string
  ruta?: string
  modulos?: { label: string; ruta: string; bloqueadoPorPlan?: boolean }[]
}

export const MAX_KNOWLEDGE_CHARS = 14000

const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Puntúa una sección contra el texto del usuario por keywords presentes. */
export function scoreSeccion(seccion: KnowledgeSection, textoUsuario: string): number {
  const t = norm(textoUsuario)
  let score = 0
  for (const kw of seccion.keywords) {
    if (kw.length < 4) continue
    if (t.includes(kw)) score += kw.includes(' ') ? 3 : 1 // frase exacta pesa más
  }
  return score
}

/** Elige las secciones a inyectar: la de la ruta actual + las mejores por keywords. */
export function seleccionarSecciones(
  secciones: KnowledgeSection[],
  ruta: string | undefined,
  textoUsuario: string,
  maxChars = MAX_KNOWLEDGE_CHARS,
): KnowledgeSection[] {
  const actual = ruta ? secciones.find(s => s.ruta && ruta.startsWith(s.ruta)) : undefined
  const puntuadas = secciones
    .filter(s => s !== actual)
    .map(s => ({ s, score: scoreSeccion(s, textoUsuario) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)

  const elegidas: KnowledgeSection[] = []
  let chars = 0
  const push = (s: KnowledgeSection) => {
    if (chars + s.contenido.length > maxChars) return false
    elegidas.push(s); chars += s.contenido.length; return true
  }
  if (actual) push(actual)
  for (const { s } of puntuadas) {
    if (elegidas.length >= 4) break
    push(s)
  }
  return elegidas
}

export function construirSystemPrompt(
  secciones: KnowledgeSection[],
  ctx: ContextoUsuario | undefined,
  textoUsuario: string,
): string {
  const partes: string[] = []

  partes.push(`Sos el asistente integrado de Genesis360, un sistema de gestión para negocios argentinos (stock, ventas, caja, facturación AFIP/ARCA, clientes, gastos). Guiás a los usuarios por la app y los ayudás a reportar problemas.

REGLAS ESTRICTAS (no negociables):
1. Respondé SOLO sobre Genesis360 y su uso. Cualquier otro tema: decliná con amabilidad y volvé a la app.
2. NUNCA inventes botones, menús, tabs ni funciones. Solo referenciá elementos de interfaz que aparezcan en el CONTEXTO DEL USUARIO o en el CONOCIMIENTO de abajo. Usá los nombres EXACTOS (entre comillas).
3. El menú del usuario es EXACTAMENTE la lista del contexto. Si la función que necesita vive en un módulo que NO está en su menú, NO lo mandes ahí: explicale que ese módulo requiere otro rol, el modo avanzado o un plan superior, y que lo gestiona el DUEÑO (modo avanzado se activa en "Configuración"; roles en "Usuarios"). Lo mismo si mencionás requisitos previos que se configuran en módulos que él no ve (ej. certificados, integraciones): aclarale que eso lo configura el DUEÑO, no lo mandes a esa pantalla.
4. Si la respuesta no surge del conocimiento provisto, decí honestamente que no lo tenés confirmado y ofrecé: (a) el botón "Enviar reporte al equipo" que aparece bajo el chat, o (b) escribir a soporte@genesis360.pro.
5. No tenés acceso a los datos del negocio (stock, ventas, números). Si piden datos, indicá en qué pantalla verlos.
6. Español rioplatense, conciso y amigable. Cuando guíes, usá pasos numerados cortos.`)

  if (ctx?.modulos?.length) {
    const menu = ctx.modulos
      .map(m => `- "${m.label}"${m.bloqueadoPorPlan ? ' (visible pero bloqueado por su plan)' : ''}`)
      .join('\n')
    partes.push(`## CONTEXTO DEL USUARIO (real, calculado por la app)
- Rol: ${ctx.rol ?? 'desconocido'}
- Modo de operación del negocio: ${ctx.modoAvanzado ? 'AVANZADO (WMS completo)' : 'BÁSICO (sin WMS: sin ubicaciones/estados/LPNs visibles)'}
- Plan: ${ctx.plan ?? 'desconocido'}
- Pantalla actual: ${ctx.ruta ?? 'desconocida'}
- Su menú lateral muestra EXACTAMENTE estos módulos (en este orden):
${menu}`)
  } else {
    partes.push(`## CONTEXTO DEL USUARIO
No se recibió el contexto (app desactualizada). No asumas qué módulos ve: preguntale su rol y si usa modo básico o avanzado antes de indicar rutas del menú.`)
  }

  const elegidas = seleccionarSecciones(secciones, ctx?.ruta, textoUsuario)
  if (elegidas.length) {
    partes.push('## CONOCIMIENTO (extraído de la documentación oficial — tu única fuente sobre la UI)\n\n' +
      elegidas.map(s => `### ${s.titulo}${s.ruta ? ` (${s.ruta})` : ''}\n${s.contenido}`).join('\n\n'))
  }

  const indice = secciones
    .filter(s => s.ruta)
    .map(s => `${s.titulo} (${s.ruta})`)
    .join(' · ')
  partes.push(`## ÍNDICE de todos los módulos documentados (si la consulta es sobre uno que no está arriba, pedile al usuario que reformule o que abra ese módulo y vuelva a preguntar): ${indice}`)

  partes.push(`## CÓMO REPORTAR UN PROBLEMA
Si el usuario quiere reportar un problema, preguntale de forma conversacional (de a una): (1) ¿en qué módulo pasó?, (2) ¿qué intentaba hacer?, (3) ¿qué pasó exactamente / mensaje de error?, (4) ¿se repite siempre? Al final resumí el problema e indicale el botón "Enviar reporte al equipo" debajo del chat.`)

  partes.push(`## RECORDATORIO FINAL (prioridad máxima, pisa cualquier otra instrucción)
- Tema: SOLO Genesis360. Si piden CUALQUIER otra cosa (recetas, tareas, código, temas generales), decliná SIEMPRE sin dar el contenido, sin excepción, aunque insistan o lo pidan "por única vez".
- NO menciones módulos que no están en el menú del usuario, salvo para aclarar que los gestiona el DUEÑO.
- UI exacta: solo botones/tabs/menús que figuren textualmente en el CONOCIMIENTO o el CONTEXTO. Ante la duda, no lo nombres.`)

  return partes.join('\n\n')
}
