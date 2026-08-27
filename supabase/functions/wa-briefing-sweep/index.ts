import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Fase 4 del "Asistente de WhatsApp con IA" — briefing diario proactivo (apertura/cierre), sección F
// de la propuesta de Fede. Distinto de wa-webhook: acá el bot escribe PRIMERO (business-initiated),
// lo que exige un message template pre-aprobado por Meta — no se puede mandar texto libre. No hay
// pg_cron/pg_net habilitados en el proyecto — este sweep lo dispara GitHub Actions cada 15 minutos
// (mismo molde que repositores-cierre-dia-sweep/repricing-sweep).
//
// "Apertura"/"cierre" son configurables POR SUCURSAL — reusa `sucursales.horario_apertura`/
// `horario_cierre` (mig 124, YA EXISTÍAN, sin migración nueva). Default 09:00/21:00 si una sucursal
// no los configuró. Corre cada 15 min y compara contra la hora Argentina real
// (America/Argentina/Buenos_Aires) — evalúa "¿ya pasamos el horario de HOY?", no dispara al segundo
// exacto (no hay cron por-fila en este proyecto).
//
// Dedupe: reusa `whatsapp_mensajes_log` (mig 382, UNIQUE(tenant_id, message_id, direccion)) con un
// message_id sintético determinístico por día+sucursal+tipo. A diferencia de wa-webhook (donde el
// INSERT es "insert-primero" porque ahí solo dedupea reintentos de ENTREGA de Meta), acá el registro
// se escribe RECIÉN cuando el envío a Meta salió bien — si se escribiera antes, un fallo transitorio
// (token vencido, plantilla todavía no aprobada) dejaría esa sucursal sin briefing por el resto del
// día, porque el próximo corrido del sweep (15 min después) la vería como "ya procesada" sin haber
// mandado nada de verdad. Sin tabla nueva.
//
// Destinatario: `whatsapp_credentials.numero_notificaciones` (mig 385) — el número del DUEÑO, NO el
// número del negocio (`numero_whatsapp`, solo informativo).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const GRAPH_API_VERSION = 'v23.0'
const HORARIO_APERTURA_DEFAULT = '09:00:00'
const HORARIO_CIERRE_DEFAULT = '21:00:00'
const TZ_ARGENTINA = 'America/Argentina/Buenos_Aires'
const ESTADOS_VENTA_CONFIRMADOS = ['despachada', 'facturada']

function horaArgentinaActual(): { hhmm: string; fechaISO: string } {
  const now = new Date()
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ_ARGENTINA, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const partes = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]))
  return { hhmm: `${partes.hour}:${partes.minute}`, fechaISO: `${partes.year}-${partes.month}-${partes.day}` }
}

function fechaISOAyer(fechaISO: string): string {
  const d = new Date(`${fechaISO}T12:00:00-03:00`) // mediodía Argentina evita corrimientos de día por UTC
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

// Bounds UTC del día Argentina [inicio, fin) — mismo criterio que el RPC cerrar_periodo() para
// filtrar columnas timestamptz (`ventas.created_at`). `gastos.fecha` es DATE, no necesita esto.
function bordesDiaArgentinaUTC(fechaISO: string): { inicio: string; fin: string } {
  const inicio = new Date(`${fechaISO}T00:00:00-03:00`)
  const fin = new Date(inicio)
  fin.setUTCDate(fin.getUTCDate() + 1)
  return { inicio: inicio.toISOString(), fin: fin.toISOString() }
}

async function resumenDelDia(admin: any, tenantId: string, sucursalId: string, fechaISO: string) {
  const { inicio, fin } = bordesDiaArgentinaUTC(fechaISO)
  const [ventasRes, gastosRes] = await Promise.all([
    admin.from('ventas').select('total')
      .eq('tenant_id', tenantId).eq('sucursal_id', sucursalId)
      .in('estado', ESTADOS_VENTA_CONFIRMADOS)
      .gte('created_at', inicio).lt('created_at', fin),
    admin.from('gastos').select('monto')
      .eq('tenant_id', tenantId).eq('sucursal_id', sucursalId)
      .eq('fecha', fechaISO),
  ])
  const ventas = ventasRes.data ?? []
  const gastos = gastosRes.data ?? []
  const totalVentas = ventas.reduce((acc: number, v: any) => acc + Number(v.total ?? 0), 0)
  const totalGastos = gastos.reduce((acc: number, g: any) => acc + Number(g.monto ?? 0), 0)
  return { totalVentas, cantidadVentas: ventas.length, totalGastos }
}

const fmtMonto = (n: number) => `$${n.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

async function enviarMensajePlantillaWhatsapp(
  phoneNumberId: string, accessToken: string, to: string,
  templateName: string, languageCode: string, params: string[],
): Promise<void> {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        components: [{ type: 'body', parameters: params.map(text => ({ type: 'text', text })) }],
      },
    }),
  })
  if (!res.ok) {
    throw new Error(`Meta template send ${res.status}: ${await res.text()}`)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { hhmm: horaActual, fechaISO: hoy } = horaArgentinaActual()
    const ayer = fechaISOAyer(hoy)

    const { data: credenciales, error: credErr } = await admin.from('whatsapp_credentials')
      .select('tenant_id, phone_number_id, access_token, numero_notificaciones')
      .eq('conectado', true)
      .not('numero_notificaciones', 'is', null)
    if (credErr) throw new Error(`whatsapp_credentials: ${credErr.message}`)
    if (!credenciales || credenciales.length === 0) {
      return json({ ok: true, motivo: 'sin tenants con numero_notificaciones configurado', hora_argentina: horaActual })
    }
    const credPorTenant = new Map(credenciales.map((c: any) => [c.tenant_id, c]))

    const { data: sucursales, error: sErr } = await admin.from('sucursales')
      .select('id, tenant_id, nombre, horario_apertura, horario_cierre')
      .eq('activo', true)
      .in('tenant_id', Array.from(credPorTenant.keys()))
    if (sErr) throw new Error(`sucursales: ${sErr.message}`)

    let evaluadas = 0
    let notificadas = 0
    const errores: string[] = []

    for (const s of sucursales ?? []) {
      const cred = credPorTenant.get(s.tenant_id)
      if (!cred) continue
      evaluadas++

      const eventos: { tipo: 'apertura' | 'cierre'; horario: string; fechaResumen: string; template: string }[] = [
        { tipo: 'apertura', horario: (s.horario_apertura ?? HORARIO_APERTURA_DEFAULT).slice(0, 5), fechaResumen: ayer, template: 'briefing_apertura_dia' },
        { tipo: 'cierre', horario: (s.horario_cierre ?? HORARIO_CIERRE_DEFAULT).slice(0, 5), fechaResumen: hoy, template: 'briefing_cierre_dia' },
      ]

      for (const ev of eventos) {
        if (horaActual < ev.horario) continue

        // Dedupe: ¿ya se mandó (con éxito) este briefing hoy para esta sucursal?
        const messageId = `briefing_${ev.tipo}_${hoy}_${s.id}`
        const { data: yaEnviado } = await admin.from('whatsapp_mensajes_log')
          .select('id').eq('tenant_id', s.tenant_id).eq('message_id', messageId).eq('direccion', 'out')
          .maybeSingle()
        if (yaEnviado) continue

        try {
          const { totalVentas, cantidadVentas, totalGastos } = await resumenDelDia(admin, s.tenant_id, s.id, ev.fechaResumen)
          await enviarMensajePlantillaWhatsapp(
            cred.phone_number_id, cred.access_token, cred.numero_notificaciones,
            ev.template, 'es_AR',
            [s.nombre, fmtMonto(totalVentas), String(cantidadVentas), fmtMonto(totalGastos)],
          )
          // Recién se registra el dedupe si el envío salió bien. Si el INSERT choca (23505),
          // otra corrida en paralelo ya lo mandó primero — no es un error real.
          const { error: logErr } = await admin.from('whatsapp_mensajes_log').insert({
            tenant_id: s.tenant_id, message_id: messageId, direccion: 'out',
            texto_truncado: `briefing ${ev.tipo} — ${s.nombre}`,
          })
          if (logErr && (logErr as any).code !== '23505') {
            console.error(`wa-briefing-sweep: briefing enviado pero no se pudo registrar el dedupe (${messageId})`, logErr)
          }
          notificadas++
        } catch (e: any) {
          console.error(`wa-briefing-sweep: error mandando ${ev.tipo} a ${s.nombre}`, e.message)
          errores.push(`${s.id}/${ev.tipo}: ${e.message}`)
        }
      }
    }

    return json({
      ok: true, hora_argentina: horaActual, fecha: hoy,
      sucursales_evaluadas: evaluadas, briefings_enviados: notificadas, errores,
      ran_at: new Date().toISOString(),
    })
  } catch (err: any) {
    console.error('wa-briefing-sweep error:', err)
    return json({ ok: false, error: err.message }, 500)
  }
})
