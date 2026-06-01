// ISS-174 — Adapter OCA ePak (web service SOAP).
//
// ⚠ El más complejo: OCA expone SOAP (no REST). Implementado según la documentación
// pública de OCA e-Pak (Oepak.asmx). PENDIENTE de validar contra una cuenta real:
// namespaces, nombres de operación y el XML embebido de IngresoOR pueden requerir ajuste.
//
// Operaciones usadas:
//   Tarifar_Envio_Corporativo → cotización
//   IngresoOR                 → alta de Orden de Retiro (devuelve nº OR + etiqueta)
//   Tracking_Pieza            → seguimiento
//
// Credenciales esperadas: usuario, password, cuit, nro_cuenta (operativa)

import {
  CourierAdapter, CourierCred, CotizarParams, CotizacionOpcion,
  GenerarParams, GenerarResult, TrackingResult, CourierError, volumenCm3,
} from './types.ts'

const ENDPOINT = 'https://webservice.oca.com.ar/epak_tracking/Oepak.asmx'
const NS = 'Oca.Pheonix.Logistica'

// Extrae el primer valor de <tag>...</tag> (sin namespace). Parseo por índices (sin regex).
function xmlVal(xml: string, tag: string): string | null {
  const open = '<' + tag + '>'
  const close = '</' + tag + '>'
  const i = xml.indexOf(open)
  if (i < 0) return null
  const j = xml.indexOf(close, i + open.length)
  if (j < 0) return null
  return xml.slice(i + open.length, j).trim()
}
// Todas las filas <Table ...>...</Table> de un DataSet embebido.
function xmlRows(xml: string): string[] {
  const rows: string[] = []
  let from = 0
  while (true) {
    const i = xml.indexOf('<Table', from)
    if (i < 0) break
    const j = xml.indexOf('</Table>', i)
    if (j < 0) break
    rows.push(xml.slice(i, j + 8))
    from = j + 8
  }
  return rows
}
// Escapa &, <, > sin regex (para embeber el XML de la OR).
function xmlEscape(s: string): string {
  return s.split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;')
}

async function soapCall(action: string, bodyInner: string): Promise<string> {
  const envelope =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<soap:Body>${bodyInner}</soap:Body></soap:Envelope>`
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `${NS}/${action}` },
    body: envelope,
  })
  const text = await res.text()
  if (!res.ok) throw new CourierError(`OCA: ${action} falló (${res.status}). ${text.slice(0, 200)}`)
  return text
}

export const oca: CourierAdapter = {
  async cotizar(cred, p: CotizarParams): Promise<CotizacionOpcion[]> {
    if (!cred.cuit || !cred.nro_cuenta) throw new CourierError('OCA: faltan CUIT y/o Nº de cuenta (operativa).')
    const volumenM3 = (volumenCm3(p) / 1_000_000).toFixed(6)
    const inner =
      `<Tarifar_Envio_Corporativo xmlns="${NS}">` +
      `<PesoTotal>${p.peso_kg || 1}</PesoTotal>` +
      `<VolumenTotal>${volumenM3}</VolumenTotal>` +
      `<CodigoPostalOrigen>${p.origen_cp}</CodigoPostalOrigen>` +
      `<CodigoPostalDestino>${p.destino_cp}</CodigoPostalDestino>` +
      `<CantidadPaquetes>1</CantidadPaquetes>` +
      `<Cuit>${cred.cuit}</Cuit>` +
      `<Operativa>${cred.nro_cuenta}</Operativa>` +
      `</Tarifar_Envio_Corporativo>`
    const xml = await soapCall('Tarifar_Envio_Corporativo', inner)
    const rows = xmlRows(xml)
    const opciones: CotizacionOpcion[] = []
    for (const row of rows) {
      const precio = Number(xmlVal(row, 'Total') ?? xmlVal(row, 'Tarifa') ?? 0)
      if (precio <= 0) continue
      opciones.push({
        courier: 'OCA',
        servicio: xmlVal(row, 'Ambito') ?? xmlVal(row, 'Producto') ?? 'OCA e-Pak',
        codigo_servicio: cred.nro_cuenta,
        precio,
        plazo_dias: Number(xmlVal(row, 'PlazoEntrega') ?? 0) || null,
        disponible: true,
        moneda: 'ARS',
      })
    }
    if (opciones.length === 0) throw new CourierError('OCA: sin tarifa para ese destino (verificá CP/operativa).')
    return opciones
  },

  async generar(cred, p: GenerarParams): Promise<GenerarResult> {
    if (!cred.usuario || !cred.password) throw new CourierError('OCA: faltan usuario/contraseña.')
    // XML "OR" (Orden de Retiro) embebido que pide IngresoOR. Estructura mínima de 1 envío.
    const orXml =
      `<?xml version="1.0" encoding="iso-8859-1"?>` +
      `<ROWS><cabecera ver="2.0" nrocuenta="${cred.nro_cuenta}"/>` +
      `<origenes><origen calle="${p.origen.calle ?? ''}" nro="${p.origen.numero ?? ''}" cp="${p.origen.codigo_postal}" ` +
      `localidad="${p.origen.localidad ?? ''}" provincia="${p.origen.provincia ?? ''}" solicitante="Genesis360" ` +
      `observaciones="" centrocosto="" idfranjahoraria="1" idcentroimposicionorigen="0" fecha="">` +
      `<envios><envio idoperativa="${cred.nro_cuenta}" nroremito="">` +
      `<destinatario apellido="${p.destinatario.nombre}" nombre="" calle="${p.destino.calle ?? ''}" nro="${p.destino.numero ?? ''}" ` +
      `localidad="${p.destino.localidad ?? ''}" provincia="${p.destino.provincia ?? ''}" cp="${p.destino.codigo_postal}" ` +
      `telefono="${p.destinatario.telefono ?? ''}" email="${p.destinatario.email ?? ''}" celular="${p.destinatario.telefono ?? ''}"/>` +
      `<paquetes><paquete alto="${p.bulto.alto_cm ?? 10}" ancho="${p.bulto.ancho_cm ?? 10}" largo="${p.bulto.largo_cm ?? 10}" ` +
      `peso="${p.bulto.peso_kg || 1}" valor="${p.bulto.valor_declarado ?? 0}" cant="1"/></paquetes>` +
      `</envio></envios></origen></origenes></ROWS>`

    const inner =
      `<IngresoOR xmlns="${NS}">` +
      `<usr>${cred.usuario}</usr><psw>${cred.password}</psw>` +
      `<xml_Datos>${xmlEscape(orXml)}</xml_Datos>` +
      `<ConfirmarRetiro>false</ConfirmarRetiro><ArchivoCliente></ArchivoCliente></IngresoOR>`
    const xml = await soapCall('IngresoOR', inner)
    const orNumero = xmlVal(xml, 'NumeroOrden') ?? xmlVal(xml, 'OrdenRetiro') ?? xmlVal(xml, 'Numero')
    const nroEnvio = xmlVal(xml, 'NumeroEnvio') ?? xmlVal(xml, 'Envio')
    if (!orNumero && !nroEnvio) {
      const err = xmlVal(xml, 'Resultado') ?? xmlVal(xml, 'Mensaje') ?? ''
      throw new CourierError(`OCA: no se generó la orden. ${err.slice(0, 200)}`)
    }
    return {
      tracking_number: nroEnvio ?? orNumero,
      tracking_url: nroEnvio ? `https://www1.oca.com.ar/OcaEpak/Tracking_Cliente.asp?numero=${nroEnvio}` : null,
      etiqueta_url: null,  // OCA entrega la etiqueta vía GetPdfDeEtiquetasPorOrdenOrNumeroEnvio (operación aparte)
      courier_orden_id: orNumero ?? nroEnvio,
      costo_real: null,
    }
  },

  async tracking(cred, trackingNumber: string): Promise<TrackingResult> {
    const inner =
      `<Tracking_Pieza xmlns="${NS}">` +
      `<Pieza>${trackingNumber}</Pieza><NroDocumentoCliente>${cred.cuit ?? ''}</NroDocumentoCliente>` +
      `<CUIT>${cred.cuit ?? ''}</CUIT></Tracking_Pieza>`
    const xml = await soapCall('Tracking_Pieza', inner)
    const eventos = xmlRows(xml).map(row => ({
      fecha: xmlVal(row, 'fecha') ?? xmlVal(row, 'Fecha') ?? undefined,
      estado: xmlVal(row, 'Descripcion_Motivo') ?? xmlVal(row, 'Estado') ?? 'Desconocido',
      detalle: xmlVal(row, 'Sucursal') ?? xmlVal(row, 'Descripcion') ?? '',
    }))
    return { estado: eventos[0]?.estado ?? null, eventos }
  },
}
