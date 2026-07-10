// Tests del núcleo PURO del circuito WSFE propio (dual-provider AFIP, fase 3).
// Importa DIRECTO el módulo que usa la Edge Function (supabase/functions/emitir-factura/
// wsfe-core.ts) — sin espejo: el XML que se testea acá es byte a byte el que va a AFIP.
// 🛑 REGLA #0: el orden de los elementos del detalle sale del XSD real del servicio;
// si alguien lo rompe, AFIP rechaza TODA emisión del circuito propio → estos tests
// son el guard.
import { describe, it, expect } from 'vitest'
import {
  buildTRA,
  buildLoginCmsEnvelope,
  parseLoginCmsResponse,
  parseSoapFault,
  taVigente,
  escapeXml,
  unescapeXml,
  pickTag,
  pickTags,
  buildFECAEDetXml,
  buildFECAESolicitarEnvelope,
  buildFECompUltimoAutorizadoEnvelope,
  parseFECAESolicitarResponse,
  parseFECompUltimoAutorizadoResponse,
  fmtWsfeErrs,
  WsaaError,
  WSAA_URL,
  WSFE_URL,
  WSFE_SOAP_ACTION,
  type WsaaTa,
} from '../../supabase/functions/emitir-factura/wsfe-core'

const TA: WsaaTa = { token: 'TOK==', sign: 'SIG/+=', expirationTime: '2026-07-10T09:00:00.000-03:00' }
const CUIT = 23320315069

// Payload EXACTO como lo arma index.ts (estilo AfipSDK) — Factura B con IVA 21.
const payloadB = {
  CantReg: 1, PtoVta: 1, CbteTipo: 6,
  Concepto: 1,
  DocTipo: 99, DocNro: 0,
  CbteDesde: 124, CbteHasta: 124, CbteFch: 20260709,
  ImpTotal: 121, ImpTotConc: 0, ImpNeto: 100, ImpOpEx: 0,
  ImpIVA: 21, ImpTrib: 0,           // ⚠ index.ts los declara IVA antes que Trib
  MonId: 'PES', MonCotiz: 1,
  CondicionIVAReceptorId: 5,
  Iva: [{ Id: 5, BaseImp: 100, Importe: 21 }],
}

// Factura C (Monotributista): sin array Iva, todo a neto.
const payloadC = {
  CantReg: 1, PtoVta: 1, CbteTipo: 11,
  Concepto: 1, DocTipo: 99, DocNro: 0,
  CbteDesde: 55, CbteHasta: 55, CbteFch: 20260709,
  ImpTotal: 1500, ImpTotConc: 0, ImpNeto: 1500, ImpOpEx: 0,
  ImpIVA: 0, ImpTrib: 0,
  MonId: 'PES', MonCotiz: 1,
  CondicionIVAReceptorId: 5,
}

// NC-C con comprobante asociado (como la arma index.ts para devoluciones).
const payloadNC = {
  ...payloadC, CbteTipo: 13, CbteDesde: 7, CbteHasta: 7,
  CbtesAsoc: [{ Tipo: 11, PtoVta: 1, Nro: 55 }],
}

describe('WSAA — TRA y LoginCms', () => {
  it('buildTRA arma el loginTicketRequest con ventana ±20min y uniqueId en epoch-seconds', () => {
    const now = new Date('2026-07-09T18:00:00.000Z')
    const tra = buildTRA('wsfe', now)
    expect(tra).toContain('<service>wsfe</service>')
    expect(tra).toContain(`<uniqueId>${Math.floor(now.getTime() / 1000)}</uniqueId>`)
    expect(tra).toContain('<generationTime>2026-07-09T17:40:00.000Z</generationTime>')
    expect(tra).toContain('<expirationTime>2026-07-09T18:20:00.000Z</expirationTime>')
    expect(tra.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
  })

  it('buildLoginCmsEnvelope embebe el CMS en in0 con el namespace de WSAA', () => {
    const env = buildLoginCmsEnvelope('Q01TQjY0')
    expect(env).toContain('<wsaa:in0>Q01TQjY0</wsaa:in0>')
    expect(env).toContain('http://wsaa.view.sua.dvadac.desein.afip.gov')
  })

  it('parseLoginCmsResponse extrae token/sign/expirationTime del XML escapado', () => {
    const inner = escapeXml(`<?xml version="1.0" encoding="UTF-8"?>
<loginTicketResponse version="1.0">
  <header><uniqueId>1</uniqueId><generationTime>x</generationTime><expirationTime>2026-07-10T09:00:00.000-03:00</expirationTime></header>
  <credentials><token>PD94bWw=</token><sign>c2lnbg==</sign></credentials>
</loginTicketResponse>`)
    const xml = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><loginCmsResponse><loginCmsReturn>${inner}</loginCmsReturn></loginCmsResponse></soapenv:Body></soapenv:Envelope>`
    const ta = parseLoginCmsResponse(xml)
    expect(ta.token).toBe('PD94bWw=')
    expect(ta.sign).toBe('c2lnbg==')
    expect(ta.expirationTime).toBe('2026-07-10T09:00:00.000-03:00')
  })

  it('parseLoginCmsResponse lanza WsaaError con flag en coe.alreadyAuthenticated', () => {
    const xml = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><soapenv:Fault>
      <faultcode xmlns:ns1="urn:x">ns1:coe.alreadyAuthenticated</faultcode>
      <faultstring>El CEE ya posee un TA valido para el acceso al WSN solicitado</faultstring>
    </soapenv:Fault></soapenv:Body></soapenv:Envelope>`
    try {
      parseLoginCmsResponse(xml)
      expect.unreachable('debió lanzar')
    } catch (e) {
      expect(e).toBeInstanceOf(WsaaError)
      expect((e as WsaaError).alreadyAuthenticated).toBe(true)
      expect((e as WsaaError).message).toContain('TA valido')
    }
  })

  it('parseLoginCmsResponse lanza WsaaError SIN flag en otros faults (cms.bad)', () => {
    const xml = `<soapenv:Envelope><soapenv:Body><soapenv:Fault>
      <faultcode>ns1:cms.bad</faultcode><faultstring>Firma inválida</faultstring>
    </soapenv:Fault></soapenv:Body></soapenv:Envelope>`
    try {
      parseLoginCmsResponse(xml)
      expect.unreachable('debió lanzar')
    } catch (e) {
      expect(e).toBeInstanceOf(WsaaError)
      expect((e as WsaaError).alreadyAuthenticated).toBe(false)
    }
  })

  it('taVigente respeta el margen de 5 min y rechaza fechas inválidas', () => {
    const now = new Date('2026-07-09T18:00:00Z')
    expect(taVigente('2026-07-09T19:00:00Z', now)).toBe(true)
    expect(taVigente('2026-07-09T18:03:00Z', now)).toBe(false)  // vence en 3min < margen
    expect(taVigente('2026-07-09T17:00:00Z', now)).toBe(false)  // vencido
    expect(taVigente('no-es-fecha', now)).toBe(false)
    // El formato real de WSAA (offset -03:00) parsea bien
    expect(taVigente('2026-07-09T16:00:00.000-03:00', now)).toBe(true) // = 19:00Z
  })
})

describe('helpers XML', () => {
  it('escapeXml/unescapeXml son inversas para los 5 caracteres especiales', () => {
    const s = `a<b>&"c"'d'`
    expect(unescapeXml(escapeXml(s))).toBe(s)
  })

  it('pickTag tolera prefijos de namespace y atributos', () => {
    expect(pickTag('<ns1:Foo attr="x">val</ns1:Foo>', 'Foo')).toBe('val')
    expect(pickTag('<Foo>val</Foo>', 'Foo')).toBe('val')
    expect(pickTag('<Bar>val</Bar>', 'Foo')).toBeNull()
  })

  it('pickTags devuelve todas las ocurrencias', () => {
    expect(pickTags('<Err><Code>1</Code></Err><Err><Code>2</Code></Err>', 'Err')).toHaveLength(2)
  })
})

describe('WSFEv1 — FECAEDetRequest (orden del XSD = REGLA #0)', () => {
  it('emite los importes en el orden del XSD: ImpTrib ANTES que ImpIVA (aunque el payload los declare al revés)', () => {
    const xml = buildFECAEDetXml(payloadB)
    const iTrib = xml.indexOf('<ImpTrib>')
    const iIVA = xml.indexOf('<ImpIVA>')
    expect(iTrib).toBeGreaterThan(-1)
    expect(iIVA).toBeGreaterThan(-1)
    expect(iTrib).toBeLessThan(iIVA)
  })

  it('respeta la secuencia completa del XSD para Factura B', () => {
    const xml = buildFECAEDetXml(payloadB)
    const orden = ['Concepto', 'DocTipo', 'DocNro', 'CbteDesde', 'CbteHasta', 'CbteFch',
      'ImpTotal', 'ImpTotConc', 'ImpNeto', 'ImpOpEx', 'ImpTrib', 'ImpIVA',
      'MonId', 'MonCotiz', 'CondicionIVAReceptorId', 'Iva']
    const idx = orden.map((t) => xml.indexOf(`<${t}>`))
    expect(idx.every((i) => i > -1)).toBe(true)
    expect([...idx].sort((a, b) => a - b)).toEqual(idx)
  })

  it('Factura B lleva el array Iva con Id/BaseImp/Importe', () => {
    const xml = buildFECAEDetXml(payloadB)
    expect(xml).toContain('<Iva><AlicIva><Id>5</Id><BaseImp>100</BaseImp><Importe>21</Importe></AlicIva></Iva>')
  })

  it('Factura C NO lleva elemento Iva ni FchServ* (AFIP la rechaza si van)', () => {
    const xml = buildFECAEDetXml(payloadC)
    expect(xml).not.toContain('<Iva>')
    expect(xml).not.toContain('<FchServDesde>')
    expect(xml).toContain('<ImpIVA>0</ImpIVA>')
    expect(xml).toContain('<ImpNeto>1500</ImpNeto>')
  })

  it('NC lleva CbtesAsoc referenciando la factura original (error 10197 si falta)', () => {
    const xml = buildFECAEDetXml(payloadNC)
    expect(xml).toContain('<CbtesAsoc><CbteAsoc><Tipo>11</Tipo><PtoVta>1</PtoVta><Nro>55</Nro></CbteAsoc></CbtesAsoc>')
    // CbtesAsoc va DESPUÉS de CondicionIVAReceptorId y ANTES de Iva según el XSD
    expect(xml.indexOf('<CondicionIVAReceptorId>')).toBeLessThan(xml.indexOf('<CbtesAsoc>'))
  })

  it('Concepto 3 (con envío/servicios) agrega FchServDesde/Hasta/FchVtoPago entre ImpIVA y MonId', () => {
    const xml = buildFECAEDetXml({ ...payloadB, Concepto: 3, FchServDesde: 20260709, FchServHasta: 20260709, FchVtoPago: 20260709 })
    expect(xml.indexOf('<ImpIVA>')).toBeLessThan(xml.indexOf('<FchServDesde>'))
    expect(xml.indexOf('<FchVtoPago>')).toBeLessThan(xml.indexOf('<MonId>'))
  })

  it('los campos ausentes/undefined NO emiten elemento (CanMisMonExt, Tributos…)', () => {
    const xml = buildFECAEDetXml(payloadB)
    expect(xml).not.toContain('CanMisMonExt')
    expect(xml).not.toContain('<Tributos>')
    expect(xml).not.toContain('undefined')
    expect(xml).not.toContain('null')
  })

  it('buildFECAESolicitarEnvelope arma Auth + FeCabReq + FeDetReq completos', () => {
    const env = buildFECAESolicitarEnvelope(TA, CUIT, payloadB)
    expect(env).toContain(`<Cuit>${CUIT}</Cuit>`)
    expect(env).toContain('<Token>TOK==</Token>')
    expect(env).toContain('<Sign>SIG/+=</Sign>')
    expect(env).toContain('<FeCabReq><CantReg>1</CantReg><PtoVta>1</PtoVta><CbteTipo>6</CbteTipo></FeCabReq>')
    expect(env).toContain('<FECAESolicitar xmlns="http://ar.gov.afip.dif.FEV1/">')
  })

  it('buildFECompUltimoAutorizadoEnvelope manda PtoVta y CbteTipo', () => {
    const env = buildFECompUltimoAutorizadoEnvelope(TA, CUIT, 3, 11)
    expect(env).toContain('<PtoVta>3</PtoVta>')
    expect(env).toContain('<CbteTipo>11</CbteTipo>')
  })

  it('endpoints y SOAPAction correctos por ambiente', () => {
    expect(WSAA_URL.homologacion).toContain('wsaahomo')
    expect(WSAA_URL.produccion).not.toContain('homo')
    expect(WSFE_URL.homologacion).toContain('wswhomo')
    expect(WSFE_URL.produccion).toContain('servicios1')
    expect(WSFE_SOAP_ACTION('FECAESolicitar')).toBe('http://ar.gov.afip.dif.FEV1/FECAESolicitar')
  })
})

describe('WSFEv1 — parsers de respuesta', () => {
  const respAprobada = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body><FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECAESolicitarResult>
    <FeCabResp><Cuit>${CUIT}</Cuit><PtoVta>1</PtoVta><CbteTipo>6</CbteTipo><FchProceso>20260709211500</FchProceso><CantReg>1</CantReg><Resultado>A</Resultado><Reproceso>N</Reproceso></FeCabResp>
    <FeDetResp><FECAEDetResponse><Concepto>1</Concepto><DocTipo>99</DocTipo><DocNro>0</DocNro><CbteDesde>124</CbteDesde><CbteHasta>124</CbteHasta><CbteFch>20260709</CbteFch><Resultado>A</Resultado><CAE>76281234567890</CAE><CAEFchVto>20260719</CAEFchVto></FECAEDetResponse></FeDetResp>
  </FECAESolicitarResult></FECAESolicitarResponse></soap:Body>
</soap:Envelope>`

  const respRechazada = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body><FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECAESolicitarResult>
    <FeCabResp><Resultado>R</Resultado><CantReg>1</CantReg></FeCabResp>
    <FeDetResp><FECAEDetResponse><Resultado>R</Resultado><Observaciones><Obs><Code>10048</Code><Msg>El campo ImpTotal no es igual a la suma</Msg></Obs><Obs><Code>10018</Code><Msg>Otra obs</Msg></Obs></Observaciones></FECAEDetResponse></FeDetResp>
  </FECAESolicitarResult></FECAESolicitarResponse></soap:Body>
</soap:Envelope>`

  const respConErrores = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body><FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECAESolicitarResult>
    <Errors><Err><Code>600</Code><Msg>ValidacionDeToken: No apareci&#243; CUIT en lista de relaciones</Msg></Err></Errors>
  </FECAESolicitarResult></FECAESolicitarResponse></soap:Body>
</soap:Envelope>`

  it('aprobada → resultado A con CAE y vencimiento', () => {
    const p = parseFECAESolicitarResponse(respAprobada)
    expect(p.resultado).toBe('A')
    expect(p.cae).toBe('76281234567890')
    expect(p.caeFchVto).toBe('20260719')
    expect(p.errors).toHaveLength(0)
    expect(p.observaciones).toHaveLength(0)
  })

  it('rechazada → resultado R con las Observaciones parseadas (código y mensaje)', () => {
    const p = parseFECAESolicitarResponse(respRechazada)
    expect(p.resultado).toBe('R')
    expect(p.cae).toBe('')
    expect(p.observaciones).toEqual([
      { code: 10048, msg: 'El campo ImpTotal no es igual a la suma' },
      { code: 10018, msg: 'Otra obs' },
    ])
  })

  it('con Errors (p.ej. 600 token inválido) los expone parseados', () => {
    const p = parseFECAESolicitarResponse(respConErrores)
    expect(p.errors).toHaveLength(1)
    expect(p.errors[0].code).toBe(600)
    expect(p.errors[0].msg).toContain('ValidacionDeToken')
  })

  it('FECompUltimoAutorizado → CbteNro numérico', () => {
    const xml = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><FECompUltimoAutorizadoResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECompUltimoAutorizadoResult><PtoVta>1</PtoVta><CbteTipo>6</CbteTipo><CbteNro>123</CbteNro></FECompUltimoAutorizadoResult></FECompUltimoAutorizadoResponse></soap:Body></soap:Envelope>`
    const p = parseFECompUltimoAutorizadoResponse(xml)
    expect(p.cbteNro).toBe(123)
    expect(p.errors).toHaveLength(0)
  })

  it('FECompUltimoAutorizado con Errors los expone (sin inventar número)', () => {
    const xml = `<soap:Envelope><soap:Body><FECompUltimoAutorizadoResponse><FECompUltimoAutorizadoResult><Errors><Err><Code>601</Code><Msg>CUIT no autorizado</Msg></Err></Errors></FECompUltimoAutorizadoResult></FECompUltimoAutorizadoResponse></soap:Body></soap:Envelope>`
    const p = parseFECompUltimoAutorizadoResponse(xml)
    expect(p.errors[0]).toEqual({ code: 601, msg: 'CUIT no autorizado' })
    expect(Number.isNaN(p.cbteNro)).toBe(true)
  })

  it('un SOAP Fault de WSFE lanza (no devuelve un parsed vacío)', () => {
    const xml = `<soap:Envelope><soap:Body><soap:Fault><faultcode>soap:Server</faultcode><faultstring>Server error</faultstring></soap:Fault></soap:Body></soap:Envelope>`
    expect(() => parseFECAESolicitarResponse(xml)).toThrow(/fault/i)
    expect(() => parseFECompUltimoAutorizadoResponse(xml)).toThrow(/fault/i)
  })

  it('parseSoapFault devuelve null sin fault y fmtWsfeErrs formatea legible', () => {
    expect(parseSoapFault('<a>ok</a>')).toBeNull()
    expect(fmtWsfeErrs([{ code: 600, msg: 'x' }, { code: 601, msg: 'y' }])).toBe('600: x · 601: y')
  })
})
