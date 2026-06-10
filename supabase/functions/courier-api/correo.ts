// ISS-174 — Adapter Correo Argentino (Mi Correo Empresas / Paq.ar, API REST).
//
// ⚠ Implementado según la documentación pública de "Mi Correo Empresas".
// PENDIENTE de validar contra una cuenta real: endpoints/campos pueden cambiar.
//
// Flujo: POST /token (Basic usuario/password) → token →
//        POST /rates (cotización) · POST /register (alta de envío) · GET tracking.
//
// Credenciales esperadas: usuario, password, nro_cliente (customerId)

import {
  CourierAdapter, CourierCred, CotizarParams, CotizacionOpcion,
  GenerarParams, GenerarResult, TrackingResult, ProbarResult, CourierError,
  courierFetch,
} from './types.ts'

const BASE = 'https://api.correoargentino.com.ar/micorreo/v1'

const DELIVERED: Record<string, string> = { D: 'A domicilio', S: 'A sucursal' }

async function getToken(cred: CourierCred): Promise<string> {
  if (!cred.usuario || !cred.password) throw new CourierError('Correo Argentino: falta usuario/contraseña.')
  const basic = btoa(`${cred.usuario}:${cred.password}`)
  const res = await courierFetch('Correo token', `${BASE}/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new CourierError(`Correo Argentino: token falló (${res.status}). Verificá credenciales.`)
  const data = await res.json() as any
  if (!data.token) throw new CourierError('Correo Argentino: no se obtuvo token.')
  return data.token
}

export const correo: CourierAdapter = {
  async cotizar(cred, p: CotizarParams): Promise<CotizacionOpcion[]> {
    if (!cred.nro_cliente) throw new CourierError('Correo Argentino: falta el Nº de cliente.')
    const token = await getToken(cred)
    const opciones: CotizacionOpcion[] = []

    for (const deliveredType of ['D', 'S']) {
      const body = {
        customerId: cred.nro_cliente,
        postalCodeOrigin: p.origen_cp,
        postalCodeDestination: p.destino_cp,
        deliveredType,
        dimensions: [{
          weight: Math.round((p.peso_kg || 1) * 1000),  // gramos
          height: p.alto_cm ?? 10,
          width: p.ancho_cm ?? 10,
          length: p.largo_cm ?? 10,
        }],
      }
      const res = await courierFetch('Correo rates', `${BASE}/rates`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) continue
      const data = await res.json().catch(() => null) as any
      const rates = data?.rates ?? (Array.isArray(data) ? data : [])
      for (const r of rates) {
        const precio = Number(r.price ?? r.totalPrice ?? 0)
        if (precio <= 0) continue
        opciones.push({
          courier: 'Correo Argentino',
          servicio: `${r.productName ?? r.deliveryTypeName ?? 'Paquete'} (${DELIVERED[deliveredType]})`,
          codigo_servicio: `${r.productType ?? r.deliveryType ?? ''}|${deliveredType}`,
          precio,
          plazo_dias: r.deliveryTimeMax ?? r.deliveryTime ?? null,
          disponible: true,
          moneda: 'ARS',
        })
      }
    }
    if (opciones.length === 0) throw new CourierError('Correo Argentino: sin tarifas para ese destino.')
    return opciones
  },

  async generar(cred, p: GenerarParams): Promise<GenerarResult> {
    if (!cred.nro_cliente) throw new CourierError('Correo Argentino: falta el Nº de cliente.')
    const token = await getToken(cred)
    const [, deliveredType = 'D'] = (p.codigo_servicio ?? '').split('|')

    const body = {
      customerId: cred.nro_cliente,
      extName: 'Genesis360',
      sender: { postalCode: p.origen.codigo_postal },
      recipient: {
        name: p.destinatario.nombre,
        email: p.destinatario.email ?? '',
        cellPhone: p.destinatario.telefono ?? '',
        address: {
          streetName: p.destino.calle ?? '',
          streetNumber: p.destino.numero ?? '',
          locality: p.destino.localidad ?? '',
          province: p.destino.provincia ?? '',
          postalCode: p.destino.codigo_postal,
        },
      },
      deliveredType,
      shipment: {
        weight: Math.round((p.bulto.peso_kg || 1) * 1000),
        declaredValue: p.bulto.valor_declarado ?? 0,
        dimensions: { height: p.bulto.alto_cm ?? 10, width: p.bulto.ancho_cm ?? 10, length: p.bulto.largo_cm ?? 10 },
      },
    }

    const res = await courierFetch('Correo register', `${BASE}/register`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new CourierError(`Correo Argentino: alta de envío falló (${res.status}). ${txt.slice(0, 200)}`)
    }
    const data = await res.json() as any
    const numero = data.trackingNumber ?? data.shipmentId ?? data.id ?? null
    return {
      tracking_number: numero,
      tracking_url: numero ? `https://www.correoargentino.com.ar/formularios/e-commerce?id=${numero}` : null,
      etiqueta_url: data.labelUrl ?? data.label ?? null,
      courier_orden_id: data.shipmentId ?? numero,
      costo_real: data.price != null ? Number(data.price) : null,
    }
  },

  async probar(cred): Promise<ProbarResult> {
    // El paso de auth de Correo es POST /token (Basic). Valida usuario/contraseña.
    await getToken(cred)
    if (!cred.nro_cliente) throw new CourierError('Correo Argentino: token OK, pero falta el Nº de cliente para cotizar.')
    return { ok: true, detalle: 'Token obtenido. El Nº de cliente se valida al cotizar.' }
  },

  async tracking(cred, trackingNumber: string): Promise<TrackingResult> {
    const token = await getToken(cred)
    const res = await courierFetch('Correo tracking', `${BASE}/tracking/${encodeURIComponent(trackingNumber)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new CourierError(`Correo Argentino: tracking falló (${res.status}).`)
    const data = await res.json().catch(() => null) as any
    const eventos = (data?.events ?? data?.tracking ?? []).map((e: any) => ({
      fecha: e.date ?? e.timestamp,
      estado: e.status ?? e.statusName ?? 'Desconocido',
      detalle: e.description ?? e.location ?? '',
    }))
    return { estado: eventos[0]?.estado ?? null, eventos }
  },
}
