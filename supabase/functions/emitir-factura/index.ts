import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore — npm: import para Deno
import Afip from 'npm:@afipsdk/afip.js'

// Mapeo condicion_iva → CondicionIVAReceptorId (RG 5616)
const IVA_RECEPTOR_ID: Record<string, number> = {
  'RI':            1,  // Responsable Inscripto
  'Exento':        2,
  'No Responsable':3,
  'Monotributista':4,
  'CF':            5,  // Consumidor Final
  'consumidor_final': 5,
}

// Mapeo alicuota_iva → Id para array Iva
const ALICUOTA_ID: Record<string, number> = {
  '0':     3,
  '10.5':  4,
  '21':    5,
  '27':    6,
  'exento':3,
  'sin_iva':3,
}

// Mapeo tipo_comprobante → CbteTipo
const TIPO_CBTE: Record<string, number> = {
  'A': 1, 'B': 6, 'C': 11,
  'NC-A': 3, 'NC-B': 8, 'NC-C': 13,
  'ND-A': 2, 'ND-B': 7, 'ND-C': 12,
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const {
      venta_id,
      tenant_id,
      tipo_comprobante = 'B', // 'A' | 'B' | 'C'
      punto_venta = 1,
    } = await req.json()

    if (!venta_id || !tenant_id) {
      return new Response(JSON.stringify({ error: 'venta_id y tenant_id son requeridos' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // 1. Fetch config del tenant
    const { data: tenant, error: tErr } = await supabase.from('tenants')
      .select('cuit, afipsdk_token, condicion_iva_emisor, nombre, umbral_factura_b')
      .eq('id', tenant_id).single()
    if (tErr || !tenant) throw new Error('Tenant no encontrado')
    if (!tenant.cuit) throw new Error('El tenant no tiene CUIT configurado')
    if (!tenant.afipsdk_token) throw new Error('El tenant no tiene token de facturación configurado')

    // 2. Fetch venta con ítems y cliente
    const { data: venta, error: vErr } = await supabase.from('ventas')
      .select(`
        id, numero, total, estado, medio_pago,
        venta_items(cantidad, precio_unitario, subtotal, alicuota_iva, iva_monto,
          productos(nombre, sku, alicuota_iva)),
        clientes(nombre, dni, cuit_receptor, condicion_iva_receptor)
      `)
      .eq('id', venta_id).single()
    if (vErr || !venta) throw new Error('Venta no encontrada')
    if (venta.cae) throw new Error('Esta venta ya tiene CAE emitido: ' + venta.cae)

    const cliente = (venta as any).clientes
    const items   = (venta as any).venta_items ?? []

    // 3. Determinar tipo de comprobante y datos del receptor
    const cbteTipo = TIPO_CBTE[tipo_comprobante] ?? 6
    const condicionIvaReceptor = cliente?.condicion_iva_receptor ?? 'CF'
    const condicionId = IVA_RECEPTOR_ID[condicionIvaReceptor] ?? 5

    // DocTipo/DocNro según condición
    let docTipo = 99; let docNro = 0 // Consumidor Final por defecto
    const totalVenta = Number(venta.total ?? 0)
    const umbral = Number(tenant.umbral_factura_b ?? 68305.16)

    if (tipo_comprobante === 'A') {
      docTipo = 80 // CUIT
      docNro  = parseInt((cliente?.cuit_receptor ?? '').replace(/[-\s]/g, '')) || 0
      if (!docNro) throw new Error('Para Factura A se requiere CUIT del cliente')
    } else if (totalVenta >= umbral && cliente?.dni) {
      docTipo = 96 // DNI
      docNro  = parseInt((cliente.dni ?? '').replace(/[.\s-]/g, '')) || 0
    }

    // 4. Agrupar IVA por alícuota
    const ivaMap: Record<number, { base: number; importe: number }> = {}
    let totalNeto = 0; let totalIVA = 0

    for (const it of items) {
      const qty      = Number(it.cantidad)
      const precio   = Number(it.precio_unitario)
      const subTotal = Number(it.subtotal ?? precio * qty)
      const tasaStr  = String(it.alicuota_iva ?? it.productos?.alicuota_iva ?? '21')
      const ivaId    = ALICUOTA_ID[tasaStr] ?? 5
      const tasa     = tasaStr === 'exento' || tasaStr === 'sin_iva' ? 0 : parseFloat(tasaStr) / 100
      const ivaItem  = tasa > 0 ? parseFloat((subTotal - subTotal / (1 + tasa)).toFixed(2)) : 0
      const netoItem = parseFloat((subTotal - ivaItem).toFixed(2))

      totalNeto += netoItem
      totalIVA  += ivaItem
      if (!ivaMap[ivaId]) ivaMap[ivaId] = { base: 0, importe: 0 }
      ivaMap[ivaId].base    += netoItem
      ivaMap[ivaId].importe += ivaItem
    }

    totalNeto = parseFloat(totalNeto.toFixed(2))
    totalIVA  = parseFloat(totalIVA.toFixed(2))

    // 5. Fecha de hoy
    const hoy = new Date()
    const fecha = parseInt(
      `${hoy.getFullYear()}${String(hoy.getMonth()+1).padStart(2,'0')}${String(hoy.getDate()).padStart(2,'0')}`
    )

    // 6. Obtener próximo número
    const cuit = parseInt(tenant.cuit.replace(/[-\s]/g, ''))
    const isProduction = Deno.env.get('AFIP_PRODUCTION') === 'true'

    const afip = new Afip({
      CUIT: cuit,
      production: isProduction,
      access_token: tenant.afipsdk_token,
    })

    const eb = afip.ElectronicBilling
    const ultimo   = await eb.getLastVoucher(punto_venta, cbteTipo)
    const proximo  = ultimo + 1

    // 7. Payload WSFE
    const payload: Record<string, unknown> = {
      CantReg:    1,
      PtoVta:     punto_venta,
      CbteTipo:   cbteTipo,
      Concepto:   1, // 1=Productos 2=Servicios 3=Ambos
      DocTipo:    docTipo,
      DocNro:     docNro,
      CbteDesde:  proximo,
      CbteHasta:  proximo,
      CbteFch:    fecha,
      ImpTotal:   totalVenta,
      ImpTotConc: 0,
      ImpNeto:    totalNeto,
      ImpOpEx:    0,
      ImpIVA:     totalIVA,
      ImpTrib:    0,
      MonId:      'PES',
      MonCotiz:   1,
      CondicionIVAReceptorId: condicionId,
      Iva: Object.entries(ivaMap).map(([id, v]) => ({
        Id:      parseInt(id),
        BaseImp: parseFloat(v.base.toFixed(2)),
        Importe: parseFloat(v.importe.toFixed(2)),
      })),
    }

    // 8. Emitir
    console.log(`Emitiendo ${tipo_comprobante} #${proximo} para tenant ${tenant_id}`)
    const resultado = await eb.createVoucher(payload)

    // 9. Guardar CAE en la venta
    await supabase.from('ventas').update({
      cae:               resultado.CAE,
      vencimiento_cae:   resultado.CAEFchVto,
      tipo_comprobante:  `Factura ${tipo_comprobante}`,
      numero_comprobante: proximo,
    }).eq('id', venta_id)

    console.log(`CAE emitido: ${resultado.CAE} — Venta ${venta_id}`)

    return new Response(JSON.stringify({
      ok:           true,
      cae:          resultado.CAE,
      vencimiento:  resultado.CAEFchVto,
      numero:       proximo,
      tipo:         `Factura ${tipo_comprobante}`,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('Error emitir-factura:', msg)
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
