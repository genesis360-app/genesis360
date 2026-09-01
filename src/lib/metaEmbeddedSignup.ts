/**
 * WhatsApp Embedded Signup (Meta, Tech Provider) — dispara el popup embebido para que el dueño de un
 * negocio conecte SU propio WhatsApp Business, sin repetir el trámite manual de developers.facebook.com.
 *
 * Verificado contra la documentación oficial vigente de Meta (no de memoria): el `code` que devuelve
 * FB.login() vive ~30 segundos, y los IDs del WABA/número llegan por un postMessage aparte
 * (`WA_EMBEDDED_SIGNUP`) que no está garantizado que llegue en el mismo tick — hay que combinar ambas
 * fuentes antes de mandar algo al backend (ver supabase/functions/wa-embedded-signup-exchange).
 *
 * Watchdog de 3 minutos: si Meta bloquea el flujo antes de completar la selección de WABA (ej. falta
 * Business Verification del lado de la plataforma), FB.login() igual puede devolver `code` con
 * status:'connected', pero el postMessage de FINISH nunca llega — sin este timeout, el botón "Conectar"
 * queda colgado para siempre (comportamiento real observado y reproducido, no hipotético).
 *
 * ⚠ BUG CONOCIDO — Google Chrome intercepta el popup vía FedCM (investigado 2026-08-31, NO es un bug
 * nuestro): en Chrome, el popup que abre `FB.login({config_id, response_type:'code', ...})` puede
 * terminar en una URL de Meta con `dialog_source=fedcm&scope=openid&response_type=token` — Meta le pisa
 * `config_id`/`response_type=code`/`override_default_response_type` y el login falla con "esta app
 * necesita al menos un supported permission" (la app de Facebook Login for Business no tiene el permiso
 * `openid`, porque nunca lo necesitó). En Edge, la misma llamada sí llega a Meta con los parámetros
 * correctos. Coincide en el tiempo con que Meta puso "Login with Facebook" en open beta el 27/8/2026 con
 * un nuevo modo one-tap basado en FedCM, opt-in vía `FB.init({ fedCM: true })` (fuentes secundarias:
 * ppc.land/facebook-login-gains-one-tap-sign-on-on-android-and-web-in-open-beta,
 * socialmediatoday.com/news/meta-updates-login-with-facebook/829135 — ambas citan un post del blog de
 * developers.meta.com que no pudo confirmarse de forma directa). Este código NUNCA seteó `fedCM: true`
 * ni ningún flag de FedCM, así que la intercepción no depende de nada que hagamos acá — ocurre del lado
 * de la página de facebook.com dentro del popup. No existe (a la fecha) un parámetro documentado de
 * `FB.init`/`FB.login` ni un `Permissions-Policy` del lado del sitio que la evite, por eso NO se aplicó
 * ningún workaround especulativo en este archivo. Acción pendiente de GO: reportar el bug a
 * developers.facebook.com/support/bugs/ (con la evidencia Chrome vs Edge) y volver a probar en Chrome
 * cuando Meta cierre el open beta — puede ser un problema temporal del rollout. Ver
 * G360.Wiki/wiki/features/asistente-whatsapp.md (sección "Embedded Signup") para el detalle completo.
 */

const GRAPH_API_VERSION = 'v23.0'
const TIMEOUT_MS = 3 * 60 * 1000

declare global {
  interface Window {
    FB?: any
    fbAsyncInit?: () => void
  }
}

let sdkPromise: Promise<void> | null = null

function cargarSdkFacebook(appId: string): Promise<void> {
  if (sdkPromise) return sdkPromise
  sdkPromise = new Promise((resolve) => {
    if (window.FB) { resolve(); return }
    window.fbAsyncInit = () => {
      window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version: GRAPH_API_VERSION })
      resolve()
    }
    const script = document.createElement('script')
    script.src = 'https://connect.facebook.net/es_LA/sdk.js'
    script.async = true
    script.defer = true
    document.body.appendChild(script)
  })
  return sdkPromise
}

export type ResultadoEmbeddedSignup =
  | { ok: true; code: string; wabaId: string; phoneNumberId: string }
  | { ok: false; motivo: 'cancelado' | 'error' | 'timeout' }

/** Abre el popup de Meta y resuelve cuando el usuario termina, cancela, falla, o pasa el timeout. */
export async function iniciarConexionWhatsapp(appId: string, configId: string): Promise<ResultadoEmbeddedSignup> {
  await cargarSdkFacebook(appId)

  return new Promise((resolve) => {
    let code: string | null = null
    let wabaId: string | null = null
    let phoneNumberId: string | null = null
    let resuelto = false

    const timeoutId = setTimeout(() => finalizar({ ok: false, motivo: 'timeout' }), TIMEOUT_MS)

    const finalizar = (resultado: ResultadoEmbeddedSignup) => {
      if (resuelto) return
      resuelto = true
      clearTimeout(timeoutId)
      window.removeEventListener('message', onMessage)
      resolve(resultado)
    }

    const intentarCompletar = () => {
      if (code && wabaId && phoneNumberId) finalizar({ ok: true, code, wabaId, phoneNumberId })
    }

    const onMessage = (event: MessageEvent) => {
      if (typeof event.origin !== 'string' || !event.origin.endsWith('facebook.com')) return
      let data: any
      try { data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data } catch { return }
      if (data?.type !== 'WA_EMBEDDED_SIGNUP') return

      if (data.event === 'FINISH' || data.event === 'FINISH_ONLY_WABA') {
        wabaId = data.data?.waba_id ?? null
        phoneNumberId = data.data?.phone_number_id ?? null
        intentarCompletar()
      } else if (data.event === 'CANCEL') {
        finalizar({ ok: false, motivo: data.data?.error_code ? 'error' : 'cancelado' })
      }
    }
    window.addEventListener('message', onMessage)

    window.FB.login((response: any) => {
      if (response?.authResponse?.code) {
        code = response.authResponse.code
        intentarCompletar()
      } else {
        finalizar({ ok: false, motivo: 'cancelado' })
      }
    }, {
      config_id: configId,
      response_type: 'code',
      override_default_response_type: true,
      extras: { setup: {} },
    })
  })
}
