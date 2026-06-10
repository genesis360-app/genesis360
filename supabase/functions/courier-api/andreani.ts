// ISS-174 — Adapter Andreani (API REST).
//
// ⚠ Implementado según la documentación pública de Andreani (developers.andreani.com).
// PENDIENTE de validar contra una cuenta B2B real: endpoints, nombres de campos y el
// formato de respuesta pueden requerir ajustes cuando existan credenciales productivas.
//
// Flujo: login Basic (usuario/password) → token en header `x-authorization-token` →
//        GET /v1/tarifas (cotización) · POST /v2/ordenes-de-envio (alta) · /trazas (tracking).
//
// Credenciales esperadas (courier_credenciales.credenciales):
//   usuario, password, nro_contrato, nro_cliente (sucursal origen, opcional)

import {
  CourierAdapter, CourierCred, CotizarParams, CotizacionOpcion,
  GenerarParams, GenerarResult, TrackingResult, ProbarResult, CourierError,
  volumenCm3, courierFetch,
} from './types.ts'

const BASE = 'https://apis.andreani.com'

// Servicios típicos por código de contrato. El código real de servicio es el nº de
// contrato que el cliente tiene habilitado; acá exponemos etiquetas legibles.
const SERVICIOS: Record<string, string> = {
  estandar: 'Estándar',
  urgente: 'Urgente',
  expreso: 'Expreso',
}

async function login(cred: CourierCred): Promise<string> {
  if (!cred.usuario || !cred.password) throw new CourierError('Andreani: falta usuario/contraseña en las credenciales.')
  const basic = btoa(`${cred.usuario}:${cred.password}`)
  const res = await courierFetch('Andreani login', `${BASE}/login`, { headers: { Authorization: `Basic ${basic}` } })
  if (!res.ok) throw new CourierError(`Andreani: login falló (${res.status}). Verificá usuario/contraseña.`)
  const token = res.headers.get('x-authorization-token')
  if (!token) throw new CourierError('Andreani: el login no devolvió token.')
  return token
}

export const andreani: CourierAdapter = {
  async cotizar(cred, p: CotizarParams): Promise<CotizacionOpcion[]> {
    if (!cred.nro_contrato) throw new CourierError('Andreani: falta el Nº de contrato.')
    const token = await login(cred)
    const contratos = cred.nro_contrato.split(',').flatMap((x) => x.split(' ')).map((s) => s.trim()).filter(Boolean)
    const opciones: CotizacionOpcion[] = []

    for (const contrato of contratos) {
      const qs = new URLSearchParams({
        cpDestino: p.destino_cp,
        contrato,
        cliente: cred.nro_cliente ?? '',
        sucursalOrigen: cred.nro_cliente ?? '',
        'bultos[0][valorDeclarado]': String(p.valor_declarado ?? 0),
        'bultos[0][volumen]': String(volumenCm3(p)),
        'bultos[0][kilos]': String(p.peso_kg || 1),
        'bultos[0][pesoAforado]': String(p.peso_kg || 1),
      })
      const res = await courierFetch('Andreani tarifas', `${BASE}/v1/tarifas?${qs}`, {
        headers: { 'x-authorization-token': token },
      })
      if (!res.ok) continue
      const data = await res.json().catch(() => null) as any
      if (!data) continue
      const precio = Number(data.tarifaConIva?.total ?? data.tarifaSinIva?.total ?? data.total ?? 0)
      if (precio <= 0) continue
      opciones.push({
        courier: 'Andreani',
        servicio: SERVICIOS[contrato] ?? `Contrato ${contrato}`,
        codigo_servicio: contrato,
        precio,
        plazo_dias: data.plazoEntrega ?? null,
        disponible: true,
        moneda: 'ARS',
      })
    }
    if (opciones.length === 0) throw new CourierError('Andreani: no se obtuvieron tarifas para ese destino/contrato.')
    return opciones
  },

  async generar(cred, p: GenerarParams): Promise<GenerarResult> {
    if (!cred.nro_contrato) throw new CourierError('Andreani: falta el Nº de contrato.')
    const token = await login(cred)
    const contrato = p.codigo_servicio || (cred.nro_contrato.split(',')[0] || '').trim()

    const body = {
      contrato,
      origen: {
        postal: {
          codigoPostal: p.origen.codigo_postal,
          calle: p.origen.calle ?? '',
          numero: p.origen.numero ?? '',
          localidad: p.origen.localidad ?? '',
          region: p.origen.provincia ?? '',
          pais: p.origen.pais ?? 'Argentina',
        },
      },
      destino: {
        postal: {
          codigoPostal: p.destino.codigo_postal,
          calle: p.destino.calle ?? '',
          numero: p.destino.numero ?? '',
          localidad: p.destino.localidad ?? '',
          region: p.destino.provincia ?? '',
          pais: p.destino.pais ?? 'Argentina',
        },
      },
      remitente: { nombreCompleto: 'Remitente', email: '' },
      destinatario: [{
        nombreCompleto: p.destinatario.nombre,
        email: p.destinatario.email ?? '',
        documentoTipo: 'DNI',
        documentoNumero: p.destinatario.documento ?? '',
        telefonos: p.destinatario.telefono ? [{ tipo: 1, numero: p.destinatario.telefono }] : [],
      }],
      bultos: [{
        kilos: p.bulto.peso_kg || 1,
        volumenCm: volumenCm3(p.bulto),
        valorDeclaradoConImpuestos: p.bulto.valor_declarado ?? 0,
      }],
    }

    const res = await courierFetch('Andreani alta-orden', `${BASE}/v2/ordenes-de-envio`, {
      method: 'POST',
      headers: { 'x-authorization-token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new CourierError(`Andreani: alta de orden falló (${res.status}). ${txt.slice(0, 200)}`)
    }
    const data = await res.json() as any
    const numero = data.numeroAndreani ?? data.numero ?? data.bultos?.[0]?.numeroDeEnvio ?? null
    const etiqueta = data.etiquetasPorOrden ?? data.bultos?.[0]?.linking?.find?.((l: any) => l.meta === 'etiqueta')?.contenido ?? null
    return {
      tracking_number: numero,
      tracking_url: numero ? `https://www.andreani.com/#!/informacionEnvio/${numero}` : null,
      etiqueta_url: etiqueta,
      courier_orden_id: numero,
      costo_real: null,
    }
  },

  async probar(cred): Promise<ProbarResult> {
    // El paso de auth de Andreani es el login Basic → token. Valida usuario/contraseña.
    await login(cred)
    if (!cred.nro_contrato) throw new CourierError('Andreani: login OK, pero falta el Nº de contrato para cotizar.')
    return { ok: true, detalle: 'Login correcto. El Nº de contrato se valida al cotizar.' }
  },

  async tracking(cred, trackingNumber: string): Promise<TrackingResult> {
    const token = await login(cred)
    const res = await courierFetch('Andreani trazas', `${BASE}/v2/ordenes-de-envio/${encodeURIComponent(trackingNumber)}/trazas`, {
      headers: { 'x-authorization-token': token },
    })
    if (!res.ok) throw new CourierError(`Andreani: no se pudo consultar el tracking (${res.status}).`)
    const data = await res.json().catch(() => null) as any
    const eventos = (data?.eventos ?? data ?? []).map((e: any) => ({
      fecha: e.fecha ?? e.timestamp,
      estado: e.estado ?? e.estadoId ?? 'Desconocido',
      detalle: e.descripcion ?? e.sucursal ?? '',
    }))
    return { estado: eventos[0]?.estado ?? null, eventos }
  },
}
