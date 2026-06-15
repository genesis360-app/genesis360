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
      tipo_comprobante = 'B', // 'A' | 'B' | 'C' | 'NC-A' | 'NC-B' | 'NC-C'
      punto_venta = 1,
      devolucion_id,           // presente solo al emitir NC
    } = await req.json()

    const esNC = tipo_comprobante.startsWith('NC-')

    if (!venta_id || !tenant_id) {
      return new Response(JSON.stringify({ error: 'venta_id y tenant_id son requeridos' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (esNC && !devolucion_id) {
      return new Response(JSON.stringify({ error: 'devolucion_id es requerido para Notas de Crédito' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // 1. Fetch config del tenant
    const { data: tenant, error: tErr } = await supabase.from('tenants')
      .select('cuit, afipsdk_token, condicion_iva_emisor, nombre, umbral_factura_b, afip_produccion')
      .eq('id', tenant_id).single()
    if (tErr || !tenant) throw new Error('Tenant no encontrado')
    if (!tenant.cuit) throw new Error('El tenant no tiene CUIT configurado')
    if (!tenant.afipsdk_token) throw new Error('El tenant no tiene token de facturación configurado')

    // 2. Fetch venta con ítems y cliente
    const { data: venta, error: vErr } = await supabase.from('ventas')
      .select(`
        id, numero, total, estado, medio_pago, cae, tipo_comprobante, numero_comprobante,
        venta_items(cantidad, precio_unitario, subtotal, alicuota_iva, iva_monto,
          productos(nombre, sku, alicuota_iva)),
        clientes(nombre, dni, email, cuit_receptor, condicion_iva_receptor)
      `)
      .eq('id', venta_id).single()
    if (vErr || !venta) throw new Error('Venta no encontrada')

    // Para facturas normales, bloquear si ya tiene CAE
    if (!esNC && venta.cae) throw new Error('Esta venta ya tiene CAE emitido: ' + venta.cae)

    const cliente = (venta as any).clientes

    // Para NC, usar los ítems de la devolución; para facturas, los ítems de la venta
    let items: any[] = (venta as any).venta_items ?? []

    if (esNC) {
      // Verificar que la venta tiene CAE (requisito para emitir NC)
      if (!venta.cae) throw new Error('La venta no tiene factura emitida. No se puede emitir NC sin CAE original.')

      // Obtener ítems de la devolución
      const { data: devolucion, error: devErr } = await supabase
        .from('devoluciones')
        .select('id, nc_cae, devolucion_items(cantidad, precio_unitario, productos(nombre, sku, alicuota_iva))')
        .eq('id', devolucion_id)
        .eq('tenant_id', tenant_id)
        .single()

      if (devErr || !devolucion) throw new Error('Devolución no encontrada')
      if (devolucion.nc_cae) throw new Error('Esta devolución ya tiene NC emitida: ' + devolucion.nc_cae)

      // Mapear ítems de devolución al mismo formato que venta_items
      items = ((devolucion as any).devolucion_items ?? []).map((di: any) => ({
        cantidad: di.cantidad,
        precio_unitario: di.precio_unitario,
        subtotal: di.precio_unitario * di.cantidad,
        alicuota_iva: di.productos?.alicuota_iva ?? 21,
        productos: di.productos,
      }))

      if (!items.length) throw new Error('La devolución no tiene ítems')
    }

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

    // 4. Importes. Factura C / NC-C (Monotributista) NO discrimina IVA: ImpNeto =
    //    ImpTotal, ImpIVA = 0 y SIN array Iva (AFIP rechaza una C con IVA/alícuotas).
    const sinIVA = tipo_comprobante === 'C' || tipo_comprobante === 'NC-C'
    const ivaMap: Record<number, { base: number; importe: number }> = {}
    let totalNeto = 0; let totalIVA = 0

    for (const it of items) {
      const qty      = Number(it.cantidad)
      const precio   = Number(it.precio_unitario)
      const subTotal = Number(it.subtotal ?? precio * qty)

      if (sinIVA) {
        // Comprobante C: el total va entero a neto, sin discriminar IVA.
        totalNeto += subTotal
        continue
      }

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

    // ImpTotal DEBE ser ImpNeto + ImpIVA (+ Trib/OpEx/TotConc = 0) o AFIP rechaza
    // (error 10048: "el campo ImpTotal no es igual a la suma de los campos..."). No
    // confiar en venta.total, que puede diferir por redondeo de centavos o por
    // descuentos/recargos globales no prorrateados en los ítems.
    const impTotal = parseFloat((totalNeto + totalIVA).toFixed(2))
    if (Math.abs(impTotal - totalVenta) > 0.5) {
      console.warn(`ImpTotal calculado (${impTotal}) difiere de venta.total (${totalVenta}) — revisar descuento/recargo global no reflejado en ítems`)
    }

    // 5. Fecha de hoy
    const hoy = new Date()
    const fecha = parseInt(
      `${hoy.getFullYear()}${String(hoy.getMonth()+1).padStart(2,'0')}${String(hoy.getDate()).padStart(2,'0')}`
    )

    // 6. Obtener próximo número
    const cuit = parseInt(tenant.cuit.replace(/[-\s]/g, ''))
    // Homologación vs producción: decisión POR-TENANT (tenants.afip_produccion).
    // `AFIP_FORCE_HOMOLOGACION=true` es un freno de emergencia GLOBAL que fuerza
    // homologación para todos (nunca prende producción). Default → homologación.
    const masterKill = Deno.env.get('AFIP_FORCE_HOMOLOGACION') === 'true'
    const isProduction = !masterKill && tenant.afip_produccion === true

    // Certificado propio del tenant (subido en Config → Facturación, tabla
    // tenant_certificates + bucket certificados-afip). AfipSDK acepta cert+key por
    // constructor y hace la firma WSAA en su nube → funciona en Deno. Si el tenant no
    // cargó cert, cae a modo token-only (sirve para el CUIT de prueba compartido).
    let certPem: string | undefined
    let keyPem: string | undefined
    const { data: certRow } = await supabase.from('tenant_certificates')
      .select('cert_crt_path, cert_key_path, activo')
      .eq('tenant_id', tenant_id).eq('activo', true).maybeSingle()
    if (certRow?.cert_crt_path && certRow?.cert_key_path) {
      const [crtDl, keyDl] = await Promise.all([
        supabase.storage.from('certificados-afip').download(certRow.cert_crt_path),
        supabase.storage.from('certificados-afip').download(certRow.cert_key_path),
      ])
      if (crtDl.data && keyDl.data) {
        certPem = await crtDl.data.text()
        keyPem = await keyDl.data.text()
      } else {
        console.warn('tenant_certificates apunta a archivos que no se pudieron bajar del bucket — usando modo token-only')
      }
    }

    const afip = new Afip({
      CUIT: cuit,
      production: isProduction,
      access_token: tenant.afipsdk_token,
      ...(certPem && keyPem ? { cert: certPem, key: keyPem } : {}),
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
      ImpTotal:   impTotal,
      ImpTotConc: 0,
      ImpNeto:    totalNeto,
      ImpOpEx:    0,
      ImpIVA:     totalIVA,
      ImpTrib:    0,
      MonId:      'PES',
      MonCotiz:   1,
      CondicionIVAReceptorId: condicionId,
      // AFIP exige CbtesAsoc en NC/ND (error 10197 si falta). Referencia la factura
      // original: Tipo (de venta.tipo_comprobante, guardado como "Factura X"), el mismo
      // punto de venta y su número. (Asumimos mismo PV que la NC — el caso single-PV.)
      ...(esNC ? {
        CbtesAsoc: [{
          Tipo:   TIPO_CBTE[String(venta.tipo_comprobante ?? '').replace('Factura ', '').trim()] ?? 6,
          PtoVta: punto_venta,
          Nro:    Number(venta.numero_comprobante) || 0,
        }],
      } : {}),
      // Factura C: sin array Iva (AFIP lo rechaza si se envía).
      ...(sinIVA ? {} : {
        Iva: Object.entries(ivaMap).map(([id, v]) => ({
          Id:      parseInt(id),
          BaseImp: parseFloat(v.base.toFixed(2)),
          Importe: parseFloat(v.importe.toFixed(2)),
        })),
      }),
    }

    // 8. Emitir
    console.log(`Emitiendo ${tipo_comprobante} #${proximo} para tenant ${tenant_id} [${isProduction ? 'PRODUCCIÓN' : 'homologación'}]`)
    const resultado = await eb.createVoucher(payload)

    // 9. Guardar CAE
    if (esNC) {
      // NC: guardar en devoluciones
      await supabase.from('devoluciones').update({
        nc_cae:               resultado.CAE,
        nc_vencimiento_cae:   resultado.CAEFchVto,
        nc_numero_comprobante: proximo,
        nc_tipo:              tipo_comprobante,
        nc_punto_venta:       punto_venta,
      }).eq('id', devolucion_id)
    } else {
      // Factura normal: guardar en ventas. Si estaba 'despachada', pasa a 'facturada'
      // automáticamente (antes había que marcarla a mano desde el detalle de la venta).
      const ventaUpdate: Record<string, unknown> = {
        cae:               resultado.CAE,
        vencimiento_cae:   resultado.CAEFchVto,
        tipo_comprobante:  `Factura ${tipo_comprobante}`,
        numero_comprobante: proximo,
      }
      if (venta.estado === 'despachada') ventaUpdate.estado = 'facturada'
      await supabase.from('ventas').update(ventaUpdate).eq('id', venta_id)
    }

    console.log(`CAE emitido: ${resultado.CAE} — ${esNC ? `NC devolucion ${devolucion_id}` : `Venta ${venta_id}`}`)

    // 10. Email al cliente (fire-and-forget — solo para facturas, no NC)
    const emailCliente = cliente?.email
    if (emailCliente && !esNC) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!
      fetch(`${supabaseUrl}/functions/v1/send-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!}`,
        },
        body: JSON.stringify({
          type: 'factura_emitida',
          to: emailCliente,
          data: {
            cliente_nombre: cliente.nombre ?? 'Cliente',
            negocio: tenant.nombre ?? 'Tu negocio',
            tipo_comprobante: `Factura ${tipo_comprobante}`,
            numero_comprobante: proximo,
            cae: resultado.CAE,
            vencimiento_cae: resultado.CAEFchVto,
            items: items.map((it: any) => ({
              nombre: it.productos?.nombre ?? 'Producto',
              cantidad: Number(it.cantidad),
              precio_unitario: Number(it.precio_unitario),
              subtotal: Number(it.subtotal ?? it.precio_unitario * it.cantidad),
            })),
            total: totalVenta,
          },
        }),
      }).catch(e => console.warn('send-email fire-and-forget failed:', e.message))
    }

    const tipoLabel = esNC ? tipo_comprobante : `Factura ${tipo_comprobante}`
    return new Response(JSON.stringify({
      ok:           true,
      cae:          resultado.CAE,
      vencimiento:  resultado.CAEFchVto,
      numero:       proximo,
      tipo:         tipoLabel,
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
