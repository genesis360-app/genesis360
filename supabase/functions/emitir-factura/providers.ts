// ─── Dual-provider AFIP (fase 1) ───────────────────────────────────────────────
// Abstracción del TRANSPORTE de facturación electrónica. La lógica fiscal (armado del
// payload WSFE, importes, guards A/B/C, persistencia del CAE) vive en index.ts y es
// COMPARTIDA por ambos providers → los dos mandan exactamente los mismos números a AFIP,
// solo cambia CÓMO llegan. Así REGLA #0 no se bifurca.
//
//   • AfipSdkProvider   → circuito ACTUAL (AfipSDK cloud, firma WSAA "en su nube"). En PROD.
//   • WsfePropioProvider → circuito PROPIO (WSFE directo). STUB por ahora (fase 3).
//
// El provider se elige por-tenant (tenants.afip_provider), con rollback instantáneo por flag.
// Ver: sources/raw/project_pendientes.md (BACKLOG WSFE) + wiki/features/facturacion-afip.md.

// @ts-ignore — npm: import para Deno
import Afip from 'npm:@afipsdk/afip.js'

export type AfipProviderName = 'afipsdk' | 'propio'

// Lo que devuelve AFIP tras autorizar un comprobante (subset que usa index.ts).
export interface WsfeResult {
  CAE: string
  CAEFchVto: string
}

// Datos de autenticación/entorno que necesita cualquier provider. `accessToken` solo lo usa
// AfipSDK; `certPem`/`keyPem` los usan AfipSDK (opcional) y el propio (obligatorio, para firmar).
export interface AfipProviderOpts {
  cuit: number
  production: boolean
  accessToken: string
  certPem?: string
  keyPem?: string
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

// ── Provider PROPIO: WSFE directo ───────────────────────────────────────────────
// TODO(fase 3): TRA + firma CMS/PKCS#7 con el cert del tenant → WSAA LoginCms → TA
// cacheado ~12h → WSFEv1 SOAP (FECompUltimoAutorizado / FECAESolicitar). Primero
// homologación (reusar matriz A/B/C validada), después tenant piloto en PROD.
// Hasta entonces es un stub que falla claro: ningún tenant debe estar en 'propio' aún.
class WsfePropioProvider implements AfipProvider {
  constructor(_opts: AfipProviderOpts) {}

  private noImplError(): Error {
    return new Error(
      "WSFE propio todavía no está implementado (fase 3). El tenant debe usar tenants.afip_provider='afipsdk'.",
    )
  }

  getLastVoucher(_ptoVta: number, _cbteTipo: number): Promise<number> {
    return Promise.reject(this.noImplError())
  }

  createVoucher(_payload: Record<string, unknown>): Promise<WsfeResult> {
    return Promise.reject(this.noImplError())
  }
}

// Factory: elige el provider según la flag del tenant. Default seguro = AfipSDK.
export function makeAfipProvider(name: AfipProviderName, opts: AfipProviderOpts): AfipProvider {
  return name === 'propio' ? new WsfePropioProvider(opts) : new AfipSdkProvider(opts)
}
