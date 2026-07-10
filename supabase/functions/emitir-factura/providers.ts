// ─── Dual-provider AFIP ─────────────────────────────────────────────────────────
// Abstracción del TRANSPORTE de facturación electrónica. La lógica fiscal (armado del
// payload WSFE, importes, guards A/B/C, persistencia del CAE) vive en index.ts y es
// COMPARTIDA por ambos providers → los dos mandan exactamente los mismos números a AFIP,
// solo cambia CÓMO llegan. Así REGLA #0 no se bifurca.
//
//   • AfipSdkProvider   → circuito ACTUAL (AfipSDK cloud, firma WSAA "en su nube"). En PROD.
//   • WsfePropioProvider → circuito PROPIO (fase 3): firma CMS local + WSAA LoginCms +
//     WSFEv1 SOAP directo. TA cacheado en DB (tabla afip_wsaa_ta) vía TaCache inyectado.
//
// El provider se elige por-tenant (tenants.afip_provider), con rollback instantáneo por flag.
// 🛑 REGLA #0 — SIN fallback automático en la emisión: si el propio falla con error de
// transporte, el comprobante PUDO haberse autorizado en AFIP; reintentar por el otro
// provider = comprobante duplicado. El rollback es manual (flip del flag) previa
// reconciliación con FECompUltimoAutorizado.
// Ver: sources/raw/project_pendientes.md (BACKLOG WSFE) + wiki/features/facturacion-afip.md.

// @ts-ignore — npm: import para Deno
import Afip from 'npm:@afipsdk/afip.js'
// @ts-ignore — npm: import para Deno (firma CMS/PKCS#7 del TRA, pure-JS)
import forge from 'npm:node-forge@1.4.0'
import { signTra } from './wsfe-sign.ts'
import {
  buildTRA,
  buildLoginCmsEnvelope,
  parseLoginCmsResponse,
  buildFECompUltimoAutorizadoEnvelope,
  parseFECompUltimoAutorizadoResponse,
  buildFECAESolicitarEnvelope,
  parseFECAESolicitarResponse,
  taVigente,
  fmtWsfeErrs,
  WsaaError,
  WSAA_URL,
  WSFE_URL,
  WSFE_SOAP_ACTION,
  type WsaaTa,
} from './wsfe-core.ts'

export type AfipProviderName = 'afipsdk' | 'propio'

// Lo que devuelve AFIP tras autorizar un comprobante (subset que usa index.ts).
export interface WsfeResult {
  CAE: string
  CAEFchVto: string
}

// Cache persistente del TA de WSAA (~12h de vida). OBLIGATORIO para el provider propio:
// AFIP rechaza un nuevo LoginCms mientras exista un TA vigente para el mismo certificado
// (coe.alreadyAuthenticated) → sin cache, la segunda emisión dentro de las 12h fallaría.
// La implementación real (tabla afip_wsaa_ta, service_role-only) la inyecta index.ts.
export interface TaCache {
  get(): Promise<WsaaTa | null>
  set(ta: WsaaTa): Promise<void>
}

// Datos de autenticación/entorno que necesita cualquier provider. `accessToken` solo lo usa
// AfipSDK; `certPem`/`keyPem` los usan AfipSDK (opcional) y el propio (obligatorio, para firmar).
export interface AfipProviderOpts {
  cuit: number
  production: boolean
  accessToken: string
  certPem?: string
  keyPem?: string
  taCache?: TaCache
}

// Interfaz común del transporte: pedir el último autorizado y crear el comprobante.
export interface AfipProvider {
  getLastVoucher(ptoVta: number, cbteTipo: number): Promise<number>
  createVoucher(payload: Record<string, unknown>): Promise<WsfeResult>
}

// ── Provider ACTUAL: AfipSDK ────────────────────────────────────────────────────
// Envuelve @afipsdk/afip.js sin cambiar su comportamiento (mismas llamadas que hacía
// index.ts antes del refactor: ElectronicBilling.getLastVoucher / .createVoucher).
class AfipSdkProvider implements AfipProvider {
  // deno-lint-ignore no-explicit-any
  private eb: any
  constructor(opts: AfipProviderOpts) {
    const afip = new Afip({
      CUIT: opts.cuit,
      production: opts.production,
      access_token: opts.accessToken,
      ...(opts.certPem && opts.keyPem ? { cert: opts.certPem, key: opts.keyPem } : {}),
    })
    this.eb = afip.ElectronicBilling
  }

  getLastVoucher(ptoVta: number, cbteTipo: number): Promise<number> {
    return this.eb.getLastVoucher(ptoVta, cbteTipo)
  }

  async createVoucher(payload: Record<string, unknown>): Promise<WsfeResult> {
    const r = await this.eb.createVoucher(payload)
    return { CAE: r.CAE, CAEFchVto: r.CAEFchVto }
  }
}

// ── Provider PROPIO: WSAA + WSFEv1 directo ──────────────────────────────────────
// Flujo: TRA → firma CMS/PKCS#7 (cert+key del tenant, node-forge) → WSAA LoginCms →
// TA (cacheado en DB ~12h) → WSFEv1 (FECompUltimoAutorizado / FECAESolicitar).
// La numeración SIEMPRE sale de FECompUltimoAutorizado (nunca contador local) → se
// puede alternar de provider sin saltear ni duplicar números por punto de venta.
class WsfePropioProvider implements AfipProvider {
  private opts: AfipProviderOpts
  private env: 'homologacion' | 'produccion'

  constructor(opts: AfipProviderOpts) {
    this.opts = opts
    this.env = opts.production ? 'produccion' : 'homologacion'
  }

  // Firma el TRA como CMS/PKCS#7 (base64, el in0 del loginCms). La implementación real
  // vive en wsfe-sign.ts (compartida con el script de integración de Node — misma firma).
  private signTraCms(traXml: string): string {
    if (!this.opts.certPem || !this.opts.keyPem) {
      throw new Error("WSFE propio: el tenant no tiene certificado AFIP cargado (Config → Facturación). El circuito propio necesita cert + key para firmar el WSAA; cargalos o volvé el tenant a afip_provider='afipsdk'.")
    }
    return signTra(forge, traXml, this.opts.certPem, this.opts.keyPem)
  }

  // TA vigente: primero el cache (DB); si no hay o venció, LoginCms nuevo y se cachea.
  // Si WSAA contesta alreadyAuthenticated (otra instancia/AfipSDK ya tiene TA vigente
  // para este cert), se re-lee el cache con un pequeño delay por si otra instancia lo
  // acaba de escribir; si tampoco está, error claro (no hay forma de recuperar un TA
  // que quedó en manos de otro sistema — expira solo, ≤12h).
  private async ensureTa(): Promise<WsaaTa> {
    const cached = await this.opts.taCache?.get()
    if (cached && taVigente(cached.expirationTime)) return cached

    const cms = this.signTraCms(buildTRA('wsfe'))
    const resp = await fetch(WSAA_URL[this.env], {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '""' },
      body: buildLoginCmsEnvelope(cms),
    })
    const xml = await resp.text()
    try {
      const ta = parseLoginCmsResponse(xml)
      await this.opts.taCache?.set(ta)
      return ta
    } catch (e) {
      if (e instanceof WsaaError && e.alreadyAuthenticated) {
        await new Promise((r) => setTimeout(r, 1500))
        const retry = await this.opts.taCache?.get()
        if (retry && taVigente(retry.expirationTime)) return retry
        throw new Error('WSAA: ya existe un Ticket de Acceso vigente para este certificado pero no está en el cache local (probablemente lo tiene AfipSDK u otro sistema). Esperá a que expire (máx. 12h) o volvé el tenant a afipsdk mientras tanto.')
      }
      throw e
    }
  }

  private async soapCall(op: string, envelope: string): Promise<string> {
    const resp = await fetch(WSFE_URL[this.env], {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${WSFE_SOAP_ACTION(op)}"` },
      body: envelope,
    })
    return await resp.text()
  }

  async getLastVoucher(ptoVta: number, cbteTipo: number): Promise<number> {
    const ta = await this.ensureTa()
    const xml = await this.soapCall(
      'FECompUltimoAutorizado',
      buildFECompUltimoAutorizadoEnvelope(ta, this.opts.cuit, ptoVta, cbteTipo),
    )
    const parsed = parseFECompUltimoAutorizadoResponse(xml)
    if (parsed.errors.length) throw new Error(`AFIP (FECompUltimoAutorizado) devolvió error: ${fmtWsfeErrs(parsed.errors)}`)
    if (!Number.isFinite(parsed.cbteNro)) throw new Error('AFIP (FECompUltimoAutorizado) no devolvió CbteNro')
    return parsed.cbteNro
  }

  async createVoucher(payload: Record<string, unknown>): Promise<WsfeResult> {
    const ta = await this.ensureTa()
    let xml: string
    try {
      xml = await this.soapCall('FECAESolicitar', buildFECAESolicitarEnvelope(ta, this.opts.cuit, payload))
    } catch (e) {
      // 🛑 REGLA #0: error de RED durante la emisión = estado DUDOSO (el request pudo
      // llegar a AFIP y autorizarse). Prohibido reintentar a ciegas o caer al otro provider.
      const msg = e instanceof Error ? e.message : String(e)
      throw new Error(`Error de transporte al emitir contra AFIP (WSFE propio): ${msg}. ⚠ NO reintentar la emisión a ciegas: el comprobante pudo haberse autorizado igual. Verificar primero con "último autorizado" si el número avanzó.`)
    }
    const parsed = parseFECAESolicitarResponse(xml)

    if (parsed.errors.length) {
      throw new Error(`AFIP rechazó la solicitud (FECAESolicitar): ${fmtWsfeErrs(parsed.errors)}`)
    }
    if (parsed.resultado !== 'A' || !parsed.cae) {
      const obs = parsed.observaciones.length ? ` — Observaciones: ${fmtWsfeErrs(parsed.observaciones)}` : ''
      throw new Error(`AFIP rechazó el comprobante (Resultado=${parsed.resultado || '?'})${obs}`)
    }
    // Aprobado con observaciones: el CAE es válido, pero se loguea para trazabilidad.
    if (parsed.observaciones.length) {
      console.warn(`[wsfe-propio] CAE aprobado CON observaciones: ${fmtWsfeErrs(parsed.observaciones)}`)
    }
    return { CAE: parsed.cae, CAEFchVto: parsed.caeFchVto }
  }
}

// Factory: elige el provider según la flag del tenant. Default seguro = AfipSDK.
export function makeAfipProvider(name: AfipProviderName, opts: AfipProviderOpts): AfipProvider {
  return name === 'propio' ? new WsfePropioProvider(opts) : new AfipSdkProvider(opts)
}
