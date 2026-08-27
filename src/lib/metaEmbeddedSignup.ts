/**
 * WhatsApp Embedded Signup (Meta, Tech Provider) — dispara el popup embebido para que el dueño de un
 * negocio conecte SU propio WhatsApp Business, sin repetir el trámite manual de developers.facebook.com.
 *
 * Verificado contra la documentación oficial vigente de Meta (no de memoria): el `code` que devuelve
 * FB.login() vive ~30 segundos, y los IDs del WABA/número llegan por un postMessage aparte
 * (`WA_EMBEDDED_SIGNUP`) que no está garantizado que llegue en el mismo tick — hay que combinar ambas
 * fuentes antes de mandar algo al backend (ver supabase/functions/wa-embedded-signup-exchange).
 */

const GRAPH_API_VERSION = 'v23.0'

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
  | { ok: false; motivo: 'cancelado' | 'error' }

/** Abre el popup de Meta y resuelve cuando el usuario termina, cancela, o falla. */
export async function iniciarConexionWhatsapp(appId: string, configId: string): Promise<ResultadoEmbeddedSignup> {
  await cargarSdkFacebook(appId)

  return new Promise((resolve) => {
    let code: string | null = null
    let wabaId: string | null = null
    let phoneNumberId: string | null = null
    let resuelto = false

    const finalizar = (resultado: ResultadoEmbeddedSignup) => {
      if (resuelto) return
      resuelto = true
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
