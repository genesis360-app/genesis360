import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { makeAfipProvider, type AfipProviderName } from '../emitir-factura/providers.ts'

// ─── Facturación automática de ingresos de PLATAFORMA (no de un tenant) ──────────────────
// Plan aprobado 2026-07-08 (facturación de Fede). Federico Messina (monotributista, CUIT
// 20-42237416-8) factura los cobros de suscripción que le entran a su cuenta de Mercado
// Pago / banco. Reusa el MISMO transporte AfipSDK probado de `emitir-factura` (providers.ts)
// pero NO su lógica — acá no hay venta/cliente/IVA discriminado: un emisor Monotributista
// SIEMPRE factura tipo C, y la C es SIEMPRE Consumidor Final (DocTipo=99/DocNro=0), sin
// excepción, confirmado en src/lib/facturacionLogic.ts (`tiposComprobantePermitidos`).
// Por eso este payload es mucho más simple que el de emitir-factura: sin desglose de IVA,
// sin CbtesAsoc, sin identificación del receptor.
//
// Concepto=2 (Servicios) — la actividad de Fede es Locaciones de Servicios (no productos) —
// AFIP exige FchServDesde/FchServHasta/FchVtoPago cuando Concepto ∈ {2,3}.
//
// 🛑 Fail-OPEN ante error de AFIP (a propósito, distinto del resto de REGLA #0): el cobro YA
// se confirmó cuando se llama a esta EF — si AFIP está caído, NO hay que revertir el pago ni
// bloquear el webhook que la invocó. Se loguea fuerte + se alerta a soporte para facturar a
// mano después. El fail-closed de siempre sigue aplicando a la PLATA, no a este paso.
//
// Solo invocable con service_role (no hay JWT de usuario — la llaman otras EFs internamente).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

async function alertarSoporte(subject: string, html: string) {
  const rk = Deno.env.get('RESEND_API_KEY')
  if (!rk) return
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${rk}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Genesis360 <noreply@genesis360.pro>', to: ['soporte@genesis360.pro'],
      subject, html,
    }),
  }).catch(() => {})
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Solo service_role puede llamar esta EF (otras EFs internamente, nunca un cliente).
    const auth = req.headers.get('Authorization') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!serviceKey || !auth.includes(serviceKey)) return json({ error: 'No autorizado' }, 401)

    const body = await req.json().catch(() => ({}))
    const monto = Number(body?.monto ?? 0)
    const concepto = String(body?.concepto ?? '').trim()
    const origenPago = String(body?.origen_pago ?? '')
    const tenantOrigenId = body?.tenant_origen_id ? String(body.tenant_origen_id) : null
    // payment_ref: id del pago de MP, o billing_manual_pagos.id para carga staff — SIEMPRE
    // requerido. Es la clave de idempotencia: sin esto, un reintento de webhook (o una doble
    // corrida del sweep) podría emitir el mismo cobro dos veces en AFIP (irreversible sin NC).
    const paymentRef = String(body?.payment_ref ?? '').trim()
    if (!(monto > 0)) return json({ error: 'monto inválido' }, 400)
    if (!concepto) return json({ error: 'Falta concepto' }, 400)
    if (!paymentRef) return json({ error: 'Falta payment_ref' }, 400)
    if (!['mp_recurrente', 'mp_manual', 'manual_staff'].includes(origenPago)) {
      return json({ error: 'origen_pago inválido' }, 400)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // Claim ANTES de tocar AFIP (no solo al persistir el resultado): si ya se reclamó este
    // payment_ref, es un reintento/duplicado — no se vuelve a llamar a AFIP.
    const { error: claimErr } = await supabase.from('platform_facturas_claims')
      .insert({ payment_ref: paymentRef })
    if (claimErr) {
      if ((claimErr as any).code === '23505') {
        console.log(`emitir-factura-plataforma: payment_ref ${paymentRef} ya reclamado (idempotente)`)
        return json({ ok: true, facturado: false, reason: 'ya_procesado' })
      }
      console.error('emitir-factura-plataforma: no se pudo reclamar payment_ref', claimErr)
      return json({ error: 'No se pudo registrar el claim de idempotencia' }, 500)
    }

    const { data: biller, error: bErr } = await supabase.from('platform_billers')
      .select('*').eq('activo', true).order('created_at').limit(1).maybeSingle()
    if (bErr || !biller) {
      await alertarSoporte(
        '🛑 Factura de plataforma sin emitir — sin biller configurado',
        `<p>Se cobró un pago (${origenPago}, $${monto}) pero no hay ningún <code>platform_billers</code> activo. Concepto: ${concepto}.</p><p>Facturar a mano cuando esté configurado.</p>`,
      )
      return json({ ok: false, facturado: false, reason: 'sin_biller' })
    }
    // El token de AfipSDK solo es requisito del circuito 'afipsdk'; el propio usa cert+key.
    if (biller.afip_provider !== 'propio' && !biller.afipsdk_token) {
      await alertarSoporte(
        '🛑 Factura de plataforma sin emitir — falta token AfipSDK',
        `<p>Cobro confirmado (${origenPago}, $${monto}) pero <code>platform_billers</code> (${biller.nombre}) no tiene <code>afipsdk_token</code> configurado todavía. Concepto: ${concepto}.</p>`,
      )
      return json({ ok: false, facturado: false, reason: 'sin_token' })
    }

    // Certificado propio (mismo bucket que tenant_certificates, sin la FK a tenants).
    let certPem: string | undefined
    let keyPem: string | undefined
    if (biller.cert_crt_path && biller.cert_key_path) {
      const [crtDl, keyDl] = await Promise.all([
        supabase.storage.from('certificados-afip').download(biller.cert_crt_path),
        supabase.storage.from('certificados-afip').download(biller.cert_key_path),
      ])
      if (crtDl.data && keyDl.data) {
        certPem = await crtDl.data.text()
        keyPem = await keyDl.data.text()
      }
    }

    const cuit = Number(biller.cuit)
    const masterKill = Deno.env.get('AFIP_FORCE_HOMOLOGACION') === 'true'
    const isProduction = !masterKill && biller.afip_produccion === true
    const providerName: AfipProviderName = biller.afip_provider === 'propio' ? 'propio' : 'afipsdk'
    if (providerName === 'propio' && (!certPem || !keyPem)) {
      await alertarSoporte(
        '🛑 Factura de plataforma sin emitir — biller en WSFE propio sin certificado',
        `<p>Cobro confirmado (${origenPago}, $${monto}) pero el biller (${biller.nombre}) está en <code>afip_provider='propio'</code> sin cert/key en el bucket. Concepto: ${concepto}.</p><p>Cargar certificado o volver el biller a 'afipsdk'.</p>`,
      )
      return json({ ok: false, facturado: false, reason: 'sin_cert' })
    }
    // Cache del TA de WSAA (tabla afip_wsaa_ta, mig 264) — mismo cache que emitir-factura,
    // clave (cuit, service, environment): sin esto la 2ª emisión dentro de ~12h fallaría
    // contra WSAA (coe.alreadyAuthenticated). Solo lo usa el circuito 'propio'.
    const taEnvironment = isProduction ? 'produccion' : 'homologacion'
    const provider = makeAfipProvider(providerName, {
      cuit, production: isProduction, accessToken: biller.afipsdk_token, certPem, keyPem,
      taCache: {
        get: async () => {
          const { data } = await supabase.from('afip_wsaa_ta')
            .select('token, sign, expiration_time')
            .eq('cuit', cuit).eq('service', 'wsfe').eq('environment', taEnvironment)
            .maybeSingle()
          return data ? { token: data.token, sign: data.sign, expirationTime: data.expiration_time } : null
        },
        set: async (ta) => {
          const { error } = await supabase.from('afip_wsaa_ta').upsert({
            cuit, service: 'wsfe', environment: taEnvironment,
            token: ta.token, sign: ta.sign, expiration_time: ta.expirationTime,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'cuit,service,environment' })
          if (error) console.warn('[emitir-factura-plataforma] no se pudo cachear el TA:', error.message)
        },
      },
    })

    const CBTE_TIPO_C = 11
    const hoy = new Date()
    const fecha = parseInt(
      `${hoy.getFullYear()}${String(hoy.getMonth() + 1).padStart(2, '0')}${String(hoy.getDate()).padStart(2, '0')}`,
    )
    const impTotal = parseFloat(monto.toFixed(2))

    let proximo: number
    try {
      const ultimo = await provider.getLastVoucher(biller.punto_venta, CBTE_TIPO_C)
      proximo = ultimo + 1
    } catch (e) {
      await alertarSoporte(
        '🛑 Factura de plataforma sin emitir — error consultando AFIP',
        `<p>Cobro confirmado (${origenPago}, $${monto}) pero falló <code>getLastVoucher</code>: ${(e as Error).message}. Concepto: ${concepto}.</p><p>Facturar a mano.</p>`,
      )
      return json({ ok: false, facturado: false, reason: 'afip_getlastvoucher_error' })
    }

    // Factura C (Monotributista): sin array Iva, ImpNeto = ImpTotal, ImpIVA = 0, siempre
    // Consumidor Final (DocTipo=99/DocNro=0) — ver src/lib/facturacionLogic.ts.
    const payload: Record<string, unknown> = {
      CantReg: 1,
      PtoVta: biller.punto_venta,
      CbteTipo: CBTE_TIPO_C,
      Concepto: 2, // Servicios (Locaciones de Servicios — monotributo de Fede)
      FchServDesde: fecha, FchServHasta: fecha, FchVtoPago: fecha,
      DocTipo: 99, DocNro: 0,
      CbteDesde: proximo, CbteHasta: proximo, CbteFch: fecha,
      ImpTotal: impTotal, ImpTotConc: 0, ImpNeto: impTotal, ImpOpEx: 0, ImpIVA: 0, ImpTrib: 0,
      MonId: 'PES', MonCotiz: 1,
      CondicionIVAReceptorId: 5, // Consumidor Final
    }

    let resultado: { CAE: string; CAEFchVto: string }
    try {
      resultado = await provider.createVoucher(payload)
    } catch (e) {
      await alertarSoporte(
        '🛑 Factura de plataforma sin emitir — AFIP rechazó el comprobante',
        `<p>Cobro confirmado (${origenPago}, $${monto}) pero <code>createVoucher</code> falló: ${(e as Error).message}. Concepto: ${concepto}.</p><p>Facturar a mano — revisar próximo número real antes de reintentar (no duplicar).</p>`,
      )
      return json({ ok: false, facturado: false, reason: 'afip_createvoucher_error' })
    }

    console.log(`emitir-factura-plataforma: CAE ${resultado.CAE} emitido — ${origenPago} $${monto} (biller ${biller.id})`)

    const { error: insErr } = await supabase.from('platform_facturas').insert({
      biller_id: biller.id, tenant_origen_id: tenantOrigenId,
      monto: impTotal, concepto, punto_venta: biller.punto_venta, numero_comprobante: proximo,
      tipo_comprobante: 'C', cae: resultado.CAE, cae_vencimiento: resultado.CAEFchVto,
      afip_provider_usado: providerName, origen_pago: origenPago, payment_ref: paymentRef,
    })
    if (insErr) {
      // AFIP YA autorizó — REGLA #0: nunca perder un CAE emitido, aunque el insert falle.
      console.error(`emitir-factura-plataforma: PERSISTENCIA FALLÓ tras CAE ${resultado.CAE} (N° ${proximo})`, insErr)
      await alertarSoporte(
        '🛑 CAE emitido pero NO se pudo guardar — reconciliar a mano',
        `<p>AFIP autorizó CAE <b>${resultado.CAE}</b> (N° ${proximo}, $${monto}) pero no se pudo persistir en <code>platform_facturas</code>: ${insErr.message}.</p><p>NO reintentar la emisión — registrar el CAE a mano.</p>`,
      )
      return json({ ok: true, facturado: true, cae: resultado.CAE, persistido: false })
    }

    return json({ ok: true, facturado: true, cae: resultado.CAE, numero: proximo, vencimiento: resultado.CAEFchVto })
  } catch (e) {
    console.error('emitir-factura-plataforma error', e)
    return json({ error: (e as Error).message ?? 'Error' }, 500)
  }
})
