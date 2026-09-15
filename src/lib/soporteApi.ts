// Consultas de soporte desde la app (Ayuda, mig 426) — acceso a datos.
//
// Todo pasa por las RPC con guard de la base (las tablas de soporte no tienen privilegios para `authenticated`) y los
// adjuntos van al bucket privado `soporte-adjuntos`, en la carpeta del negocio y del usuario.
import { supabase } from '@/lib/supabase'
import { rutaAdjunto, type TipoConsulta, type Urgencia } from '@/lib/soporte'

export type AdjuntoConsulta = { path: string; nombre: string; tipo: string; url?: string | null }

export type ConsultaResumen = {
  id: string
  asunto: string
  estado: string
  tipo: string | null
  prioridad: string
  created_at: string
  ultimo_mensaje_at: string
  usuario_id: string
  usuario_nombre: string | null
  es_mia: boolean
  ultimo_autor: string | null
  mensajes: number
}

export type MensajeConsulta = {
  id: string
  autor_tipo: 'cliente' | 'agente' | 'sistema'
  autor_nombre: string
  cuerpo: string
  created_at: string
  adjuntos: AdjuntoConsulta[]
}

export type ConsultaDetalle = {
  ticket: {
    id: string; asunto: string; estado: string; tipo: string | null; prioridad: string; created_at: string
    usuario_id: string; usuario_nombre: string | null; es_mia: boolean
  }
  mensajes: MensajeConsulta[]
}

const SOPORTE = 'soporte@genesis360.pro'

async function subirAdjuntos(tenantId: string, userId: string, archivos: File[]): Promise<AdjuntoConsulta[]> {
  const subidos: AdjuntoConsulta[] = []
  for (const archivo of archivos) {
    const path = rutaAdjunto(tenantId, userId, archivo.name, crypto.randomUUID())
    const { error } = await supabase.storage.from('soporte-adjuntos').upload(path, archivo, { contentType: archivo.type, upsert: false })
    if (error) throw new Error(`No se pudo subir "${archivo.name}": ${error.message}`)
    subidos.push({ path, nombre: archivo.name, tipo: archivo.type })
  }
  return subidos
}

/** Mail al equipo. El ticket ya quedó guardado: si el mail falla, el panel lo marca igual ("pendiente del equipo"). */
function avisarEquipo(d: { ticketId: string; asunto: string; cuerpo: string; tipo?: string; urgencia?: string; esRespuesta: boolean }) {
  void supabase.functions.invoke('send-email', {
    body: {
      type: 'soporte_consulta',
      to: SOPORTE,
      data: { ticket_id: d.ticketId, asunto: d.asunto, cuerpo: d.cuerpo, tipo: d.tipo, urgencia: d.urgencia, es_respuesta: d.esRespuesta },
    },
  }).catch(() => { /* el aviso por mail no es bloqueante */ })
}

export async function crearConsulta(c: {
  tenantId: string; userId: string; asunto: string; cuerpo: string; tipo: TipoConsulta; urgencia: Urgencia
  modulo?: string; archivos: File[]
}): Promise<string> {
  const adjuntos = await subirAdjuntos(c.tenantId, c.userId, c.archivos)
  const { data, error } = await supabase.rpc('fn_soporte_crear_consulta', {
    p_asunto: c.asunto, p_cuerpo: c.cuerpo, p_tipo: c.tipo, p_urgencia: c.urgencia,
    p_modulo: c.modulo ?? null, p_adjuntos: adjuntos,
  })
  if (error) throw new Error(error.message)
  const id = data as string
  avisarEquipo({ ticketId: id, asunto: c.asunto, cuerpo: c.cuerpo, tipo: c.tipo, urgencia: c.urgencia, esRespuesta: false })
  return id
}

export async function responderConsulta(r: {
  tenantId: string; userId: string; ticketId: string; asunto: string; cuerpo: string; archivos: File[]
}): Promise<void> {
  const adjuntos = await subirAdjuntos(r.tenantId, r.userId, r.archivos)
  const { error } = await supabase.rpc('fn_soporte_responder', {
    p_ticket_id: r.ticketId, p_cuerpo: r.cuerpo, p_adjuntos: adjuntos,
  })
  if (error) throw new Error(error.message)
  avisarEquipo({ ticketId: r.ticketId, asunto: r.asunto, cuerpo: r.cuerpo, esRespuesta: true })
}

export async function listarConsultas(): Promise<ConsultaResumen[]> {
  const { data, error } = await supabase.rpc('fn_soporte_mis_consultas')
  if (error) throw new Error(error.message)
  return (data ?? []) as ConsultaResumen[]
}

/** La consulta con su hilo. Los adjuntos traen un link firmado de 10 minutos. */
export async function verConsulta(ticketId: string): Promise<ConsultaDetalle> {
  const { data, error } = await supabase.rpc('fn_soporte_consulta', { p_ticket_id: ticketId })
  if (error) throw new Error(error.message)
  const detalle = data as ConsultaDetalle
  const mensajes = await Promise.all((detalle.mensajes ?? []).map(async (m) => ({
    ...m,
    adjuntos: await Promise.all((m.adjuntos ?? []).map(async (a) => {
      const { data: firmado } = await supabase.storage.from('soporte-adjuntos').createSignedUrl(a.path, 600)
      return { ...a, url: firmado?.signedUrl ?? null }
    })),
  })))
  return { ...detalle, mensajes }
}

/** Al abrir la consulta, los avisos de respuesta de esa consulta quedan leídos. */
export async function marcarAvisosLeidos(userId: string, ticketId: string): Promise<void> {
  await supabase.from('notificaciones')
    .update({ leida: true })
    .eq('user_id', userId)
    .eq('leida', false)
    .filter('metadata->>ticket_id', 'eq', ticketId)
}
