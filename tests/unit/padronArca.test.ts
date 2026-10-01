// Tests del núcleo PURO del padrón de ARCA (supabase/functions/_shared/padronArca.ts) — el mismo módulo que usa
// la EF `consultar-cuit`. Los XML salen de los ejemplos del manual ws_sr_constancia_inscripcion v3.4; los datos
// de personas son inventados.
// 🛑 REGLA #0: la condición IVA decide Factura A o B → sin datos del régimen NUNCA se asume Consumidor Final.
import { describe, it, expect } from 'vitest'
import {
  buildGetPersonaV2Envelope,
  condicionIvaDesde,
  cuitValido,
  normalizarCuit,
  parseGetPersonaV2Response,
} from '../../supabase/functions/_shared/padronArca'

const envolver = (persona: string) => `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>
<ns2:getPersona_v2Response xmlns:ns2="http://a5.soap.ws.server.puc.sr/"><personaReturn>${persona}
<metadata><fechaHora>2026-10-01T10:00:00-03:00</fechaHora><servidor>setiwsh2</servidor></metadata>
</personaReturn></ns2:getPersona_v2Response></soap:Body></soap:Envelope>`

const generalesJuridica = `<datosGenerales>
<domicilioFiscal><codPostal>1425</codPostal><descripcionProvincia>CIUDAD AUTONOMA BUENOS AIRES</descripcionProvincia>
<direccion>AV SIEMPRE VIVA 742 Piso:3</direccion><idProvincia>0</idProvincia><localidad>CIUDAD AUTONOMA BUENOS AIRES</localidad>
<tipoDomicilio>FISCAL</tipoDomicilio></domicilioFiscal>
<estadoClave>ACTIVO</estadoClave><idPersona>30712345678</idPersona><mesCierre>12</mesCierre>
<razonSocial>EJEMPLO &amp; HIJOS SRL</razonSocial><tipoClave>CUIT</tipoClave><tipoPersona>JURIDICA</tipoPersona>
</datosGenerales>`

const generalesFisica = `<datosGenerales><apellido>PRUEBA</apellido>
<domicilioFiscal><codPostal>5000</codPostal><descripcionProvincia>CORDOBA</descripcionProvincia><direccion>CALLE FALSA 123</direccion>
<idProvincia>3</idProvincia><localidad>BARRIO INVENTADO   *</localidad><tipoDomicilio>FISCAL</tipoDomicilio></domicilioFiscal>
<estadoClave>ACTIVO</estadoClave><idPersona>20111111112</idPersona><nombre>JUAN</nombre><tipoClave>CUIT</tipoClave><tipoPersona>FISICA</tipoPersona>
</datosGenerales>`

const impuesto = (id: number, desc: string) =>
  `<impuesto><descripcionImpuesto>${desc}</descripcionImpuesto><idImpuesto>${id}</idImpuesto><periodo>201801</periodo></impuesto>`

describe('CUIT', () => {
  it('normaliza guiones y espacios', () => {
    expect(normalizarCuit('20-11111111-2')).toBe('20111111112')
    expect(normalizarCuit(' 30 71234567 8 ')).toBe('30712345678')
    expect(normalizarCuit(null)).toBe('')
  })

  it('valida el dígito verificador', () => {
    expect(cuitValido('20-11111111-2')).toBe(true)
    expect(cuitValido('20111111113')).toBe(false)
  })

  it('DV 10 → 9 y DV 11 → 0', () => {
    // Construidos para cubrir las dos ramas especiales del módulo 11.
    const conDv = (base: string) => {
      const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
      const s = pesos.reduce((a, p, i) => a + p * Number(base[i]), 0)
      return 11 - (s % 11)
    }
    const bases = Array.from({ length: 2000 }, (_, i) => `20${String(10000000 + i * 7919).padStart(8, '0')}`)
    const b10 = bases.find((b) => conDv(b) === 10)!
    const b11 = bases.find((b) => conDv(b) === 11)!
    expect(cuitValido(`${b10}9`)).toBe(true)
    expect(cuitValido(`${b11}0`)).toBe(true)
  })

  it('rechaza largo o prefijo inválido', () => {
    expect(cuitValido('2011111111')).toBe(false)
    expect(cuitValido('99111111112')).toBe(false)
    expect(cuitValido('')).toBe(false)
  })
})

describe('getPersona_v2 — request', () => {
  it('arma el sobre con cuitRepresentada e idPersona normalizados y token escapado', () => {
    const x = buildGetPersonaV2Envelope('tok<en>', 'si&gn', '20-42237416-8', '20-11111111-2')
    expect(x).toContain('<a5:getPersona_v2>')
    expect(x).toContain('<token>tok&lt;en&gt;</token>')
    expect(x).toContain('<sign>si&amp;gn</sign>')
    expect(x).toContain('<cuitRepresentada>20422374168</cuitRepresentada>')
    expect(x).toContain('<idPersona>20111111112</idPersona>')
  })
})

describe('getPersona_v2 — condición IVA', () => {
  it('impuesto 30 → Responsable Inscripto', () => {
    const r = parseGetPersonaV2Response(envolver(generalesJuridica + `<datosRegimenGeneral>${impuesto(10, 'GANANCIAS SOCIEDADES')}${impuesto(30, 'IVA')}</datosRegimenGeneral>`), '30712345678')
    expect(r.ok && r.persona.condicionIva).toBe('RI')
  })

  it('datosMonotributo → Monotributo (aunque haya régimen general)', () => {
    const r = parseGetPersonaV2Response(envolver(generalesFisica +
      `<datosMonotributo><categoriaMonotributo><descripcionCategoria>B LOCACIONES DE SERVICIO</descripcionCategoria><idCategoria>36</idCategoria><idImpuesto>20</idImpuesto><periodo>201804</periodo></categoriaMonotributo>${impuesto(20, 'MONOTRIBUTO')}</datosMonotributo>` +
      `<datosRegimenGeneral>${impuesto(301, 'EMPLEADOR-APORTES SEG. SOCIAL')}</datosRegimenGeneral>`), '20111111112')
    expect(r.ok && r.persona.condicionIva).toBe('MONOTRIBUTO')
  })

  it('impuesto 32 → Exento', () => {
    const r = parseGetPersonaV2Response(envolver(generalesJuridica + `<datosRegimenGeneral>${impuesto(32, 'IVA EXENTO')}</datosRegimenGeneral>`), '30712345678')
    expect(r.ok && r.persona.condicionIva).toBe('EXENTO')
  })

  it('régimen general completo sin IVA ni monotributo → Consumidor Final', () => {
    const r = parseGetPersonaV2Response(envolver(generalesFisica + `<datosRegimenGeneral>${impuesto(11, 'GANANCIAS PERSONAS FISICAS')}</datosRegimenGeneral>`), '20111111112')
    expect(r.ok && r.persona.condicionIva).toBe('CF')
  })

  it('🛑 errorRegimenGeneral sin datos de impuestos → null, nunca CF', () => {
    const r = parseGetPersonaV2Response(envolver(generalesFisica +
      `<errorRegimenGeneral><error>Actividad económica principal inexistente</error><mensaje>No cumple con las condiciones para enviar datos del regimen general</mensaje></errorRegimenGeneral>`), '20111111112')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.persona.condicionIva).toBeNull()
    expect(r.persona.avisos).toContain('Actividad económica principal inexistente')
  })

  it('🛑 régimen general vacío pero con errorMonotributo → null', () => {
    expect(condicionIvaDesde(`<datosRegimenGeneral></datosRegimenGeneral><errorMonotributo><error>Datos de monotributo incompletos- no posee categoría.</error></errorMonotributo>`)).toBeNull()
  })

  it('sin ningún régimen → null', () => {
    const r = parseGetPersonaV2Response(envolver(generalesFisica), '20111111112')
    expect(r.ok && r.persona.condicionIva).toBeNull()
  })
})

describe('getPersona_v2 — datos generales y domicilio', () => {
  it('jurídica: razón social decodificada y domicilio en una línea', () => {
    const r = parseGetPersonaV2Response(envolver(generalesJuridica + `<datosRegimenGeneral>${impuesto(30, 'IVA')}</datosRegimenGeneral>`), '30712345678')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.persona.nombre).toBe('EJEMPLO & HIJOS SRL')
    expect(r.persona.tipoPersona).toBe('JURIDICA')
    expect(r.persona.activa).toBe(true)
    expect(r.persona.domicilio?.texto).toBe('AV SIEMPRE VIVA 742 Piso:3, (1425) CIUDAD AUTONOMA BUENOS AIRES, CIUDAD AUTONOMA BUENOS AIRES')
  })

  it('física: "APELLIDO NOMBRE" y saca el relleno "*" de la localidad', () => {
    const r = parseGetPersonaV2Response(envolver(generalesFisica), '20111111112')
    if (!r.ok) throw new Error('esperaba ok')
    expect(r.persona.nombre).toBe('PRUEBA JUAN')
    expect(r.persona.domicilio?.localidad).toBe('BARRIO INVENTADO')
  })

  it('clave INACTIVA → activa=false', () => {
    const r = parseGetPersonaV2Response(envolver(generalesFisica.replace('ACTIVO', 'INACTIVO')), '20111111112')
    expect(r.ok && r.persona.activa).toBe(false)
  })

  it('errorConstancia junto a datos: devuelve los datos y los avisos (sin duplicar)', () => {
    const r = parseGetPersonaV2Response(envolver(generalesFisica + `<datosRegimenGeneral>${impuesto(30, 'IVA')}</datosRegimenGeneral>` +
      `<errorConstancia><apellido>PRUEBA</apellido><error>Domicilio Incompleto</error><error>Domicilio Incompleto</error><idPersona>20111111112</idPersona><nombre>JUAN</nombre></errorConstancia>`), '20111111112')
    if (!r.ok) throw new Error('esperaba ok')
    expect(r.persona.condicionIva).toBe('RI')
    expect(r.persona.avisos).toEqual(['Domicilio Incompleto'])
  })
})

describe('getPersona_v2 — errores', () => {
  it('"No existe persona" dentro de errorConstancia → no_existe', () => {
    const r = parseGetPersonaV2Response(envolver(`<errorConstancia><error>No existe persona con ese Id</error><idPersona>20111111112</idPersona></errorConstancia>`), '20111111112')
    expect(r).toMatchObject({ ok: false, motivo: 'no_existe' })
  })

  it('"No existe persona" como SOAP fault → no_existe', () => {
    const xml = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><soap:Fault><faultcode>soap:Server</faultcode><faultstring>No existe persona con ese Id</faultstring></soap:Fault></soap:Body></soap:Envelope>`
    expect(parseGetPersonaV2Response(xml, '20111111112')).toMatchObject({ ok: false, motivo: 'no_existe' })
  })

  it('otro fault → error_arca con el mensaje', () => {
    const xml = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><soap:Fault><faultcode>soap:Server</faultcode><faultstring>Token expirado</faultstring></soap:Fault></soap:Body></soap:Envelope>`
    expect(parseGetPersonaV2Response(xml, '20111111112')).toMatchObject({ ok: false, motivo: 'error_arca', detalle: 'Token expirado' })
    expect(parseGetPersonaV2Response(xml, '20111111112')).not.toMatchObject({ mensaje: 'Token expirado' })
  })

  it('constancia bloqueada sin datosGenerales pero con nombre → ok con avisos y condición null', () => {
    const r = parseGetPersonaV2Response(envolver(`<errorConstancia><apellido>PRUEBA</apellido><error>La CUIT del contribuyente fue limitada en los términos de la RG AFIP 3832/16.</error><idPersona>20111111112</idPersona><nombre>JUAN</nombre></errorConstancia>`), '20111111112')
    if (!r.ok) throw new Error('esperaba ok')
    expect(r.persona.nombre).toBe('PRUEBA JUAN')
    expect(r.persona.condicionIva).toBeNull()
    expect(r.persona.activa).toBe(false)
    expect(r.persona.avisos[0]).toMatch(/limitada/)
  })

  it('respuesta sin personaReturn → error_arca', () => {
    expect(parseGetPersonaV2Response('<html>502 Bad Gateway</html>', '20111111112')).toMatchObject({ ok: false, motivo: 'error_arca' })
  })
})
