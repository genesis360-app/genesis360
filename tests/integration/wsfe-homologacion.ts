// ─── Integración REAL del circuito WSFE propio contra HOMOLOGACIÓN de AFIP ──────
// Ejercita el transporte completo (los mismos módulos que usa la Edge Function):
//   1. FEDummy (conectividad, sin auth)
//   2. WSAA LoginCms (TRA firmado CMS con el cert del tenant) → TA
//   3. FECompUltimoAutorizado (numeración real)
//   4. FECAESolicitar: Factura B (con IVA 21) → CAE
//   5. FECAESolicitar: Factura C (sin discriminar IVA) → CAE
//   6. FECAESolicitar: NC-C asociada a la C del paso 5 (CbtesAsoc) → CAE
//
// ⚠ SOLO homologación (endpoints *homo* hardcodeados) — no emite nada fiscalmente real.
// ⚠ El TA se cachea en .ta-cache.json local (AFIP rechaza LoginCms repetidos: el TA
//   vive ~12h). Si otro sistema (p.ej. AfipSDK cloud) ya tiene TA vigente para el mismo
//   certificado, el login falla con coe.alreadyAuthenticated → esperar o usar otro cert.
//
// Uso (cert/key NUNCA commiteados — pasarlos por env):
//   AFIP_CUIT=23320315069 AFIP_CERT=path/al/cert.crt AFIP_KEY=path/a/la/key.key \
//     npx vite-node tests/integration/wsfe-homologacion.ts
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import forge from 'node-forge'
import { signTra } from '../../supabase/functions/emitir-factura/wsfe-sign'
import {
  buildTRA,
  buildLoginCmsEnvelope,
  parseLoginCmsResponse,
  buildFEDummyEnvelope,
  buildFECompUltimoAutorizadoEnvelope,
  parseFECompUltimoAutorizadoResponse,
  buildFECAESolicitarEnvelope,
  parseFECAESolicitarResponse,
  taVigente,
  fmtWsfeErrs,
  pickTag,
  WSAA_URL,
  WSFE_URL,
  WSFE_SOAP_ACTION,
  type WsaaTa,
} from '../../supabase/functions/emitir-factura/wsfe-core'

const CUIT = parseInt(process.env.AFIP_CUIT ?? '', 10)
const CERT_PATH = process.env.AFIP_CERT
const KEY_PATH = process.env.AFIP_KEY
const PTO_VTA = parseInt(process.env.AFIP_PTO_VTA ?? '1', 10)
if (!CUIT || !CERT_PATH || !KEY_PATH) {
  console.error('Faltan env vars: AFIP_CUIT, AFIP_CERT, AFIP_KEY (y opcional AFIP_PTO_VTA)')
  process.exit(1)
}

const TA_CACHE = resolve(dirname(CERT_PATH), '.ta-cache.json')
const hoy = new Date()
const fecha = parseInt(`${hoy.getFullYear()}${String(hoy.getMonth() + 1).padStart(2, '0')}${String(hoy.getDate()).padStart(2, '0')}`)

let paso = 0
function ok(msg: string) { console.log(`  ✅ [${++paso}] ${msg}`) }
function fail(msg: string): never { console.error(`  ❌ ${msg}`); process.exit(1) }

async function soapWsfe(op: string, envelope: string): Promise<string> {
  const resp = await fetch(WSFE_URL.homologacion, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${WSFE_SOAP_ACTION(op)}"` },
    body: envelope,
  })
  return await resp.text()
}

async function ensureTa(): Promise<WsaaTa> {
  if (existsSync(TA_CACHE)) {
    const cached = JSON.parse(readFileSync(TA_CACHE, 'utf8')) as WsaaTa
    if (taVigente(cached.expirationTime)) {
      ok(`WSAA: TA vigente desde cache (expira ${cached.expirationTime})`)
      return cached
    }
  }
  const certPem = readFileSync(CERT_PATH!, 'utf8')
  const keyPem = readFileSync(KEY_PATH!, 'utf8')
  const cms = signTra(forge, buildTRA('wsfe'), certPem, keyPem)
  ok(`CMS firmado (${cms.length} chars base64)`)
  const resp = await fetch(WSAA_URL.homologacion, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '""' },
    body: buildLoginCmsEnvelope(cms),
  })
  const xml = await resp.text()
  const ta = parseLoginCmsResponse(xml)
  writeFileSync(TA_CACHE, JSON.stringify(ta, null, 2))
  ok(`WSAA LoginCms OK — TA nuevo (expira ${ta.expirationTime})`)
  return ta
}

async function emitir(ta: WsaaTa, etiqueta: string, payload: Record<string, unknown>): Promise<number> {
  const xml = await soapWsfe('FECAESolicitar', buildFECAESolicitarEnvelope(ta, CUIT, payload))
  const p = parseFECAESolicitarResponse(xml)
  if (p.errors.length) fail(`${etiqueta}: AFIP devolvió errores → ${fmtWsfeErrs(p.errors)}`)
  if (p.resultado !== 'A' || !p.cae) fail(`${etiqueta}: Resultado=${p.resultado} — Obs: ${fmtWsfeErrs(p.observaciones)}`)
  const obs = p.observaciones.length ? ` (obs: ${fmtWsfeErrs(p.observaciones)})` : ''
  ok(`${etiqueta} N°${payload.CbteDesde} → CAE ${p.cae} (vto ${p.caeFchVto})${obs}`)
  return payload.CbteDesde as number
}

async function main() {
  console.log(`\nWSFE propio — integración HOMOLOGACIÓN · CUIT ${CUIT} · PtoVta ${PTO_VTA} · ${fecha}\n`)

  // 1. FEDummy (sin auth): servidores de AFIP vivos
  const dummy = await soapWsfe('FEDummy', buildFEDummyEnvelope())
  const app = pickTag(dummy, 'AppServer'); const db = pickTag(dummy, 'DbServer'); const auth = pickTag(dummy, 'AuthServer')
  if (app !== 'OK' || db !== 'OK' || auth !== 'OK') fail(`FEDummy: App=${app} Db=${db} Auth=${auth}`)
  ok(`FEDummy: AppServer/DbServer/AuthServer OK`)

  // 2. WSAA
  const ta = await ensureTa()

  // 3. Última numeración real por tipo
  async function ultimo(cbteTipo: number): Promise<number> {
    const xml = await soapWsfe('FECompUltimoAutorizado', buildFECompUltimoAutorizadoEnvelope(ta, CUIT, PTO_VTA, cbteTipo))
    const p = parseFECompUltimoAutorizadoResponse(xml)
    if (p.errors.length) fail(`FECompUltimoAutorizado(${cbteTipo}): ${fmtWsfeErrs(p.errors)}`)
    return p.cbteNro
  }
  const ultB = await ultimo(6); const ultC = await ultimo(11); const ultNCC = await ultimo(13)
  ok(`FECompUltimoAutorizado: B=${ultB} · C=${ultC} · NC-C=${ultNCC}`)

  // 4. Factura B con IVA 21 (mismo shape de payload que arma la EF)
  await emitir(ta, 'Factura B', {
    CantReg: 1, PtoVta: PTO_VTA, CbteTipo: 6, Concepto: 1,
    DocTipo: 99, DocNro: 0,
    CbteDesde: ultB + 1, CbteHasta: ultB + 1, CbteFch: fecha,
    ImpTotal: 121, ImpTotConc: 0, ImpNeto: 100, ImpOpEx: 0, ImpIVA: 21, ImpTrib: 0,
    MonId: 'PES', MonCotiz: 1, CondicionIVAReceptorId: 5,
    Iva: [{ Id: 5, BaseImp: 100, Importe: 21 }],
  })

  // 5. Factura C (sin array Iva)
  const nroC = await emitir(ta, 'Factura C', {
    CantReg: 1, PtoVta: PTO_VTA, CbteTipo: 11, Concepto: 1,
    DocTipo: 99, DocNro: 0,
    CbteDesde: ultC + 1, CbteHasta: ultC + 1, CbteFch: fecha,
    ImpTotal: 1500, ImpTotConc: 0, ImpNeto: 1500, ImpOpEx: 0, ImpIVA: 0, ImpTrib: 0,
    MonId: 'PES', MonCotiz: 1, CondicionIVAReceptorId: 5,
  })

  // 6. NC-C asociada a la Factura C recién emitida (CbtesAsoc — error 10197 si falta)
  await emitir(ta, 'NC-C (asociada)', {
    CantReg: 1, PtoVta: PTO_VTA, CbteTipo: 13, Concepto: 1,
    DocTipo: 99, DocNro: 0,
    CbteDesde: ultNCC + 1, CbteHasta: ultNCC + 1, CbteFch: fecha,
    ImpTotal: 1500, ImpTotConc: 0, ImpNeto: 1500, ImpOpEx: 0, ImpIVA: 0, ImpTrib: 0,
    MonId: 'PES', MonCotiz: 1, CondicionIVAReceptorId: 5,
    CbtesAsoc: [{ Tipo: 11, PtoVta: PTO_VTA, Nro: nroC }],
  })

  console.log('\n🎉 Circuito WSFE propio COMPLETO contra homologación: WSAA + numeración + B + C + NC-C con CAE.\n')
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)))
