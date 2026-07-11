import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// Dual-provider AFIP (fase 1): el transporte (AfipSDK vs WSFE propio) se elige por-tenant.
// La lógica fiscal de este archivo es compartida por ambos providers. Ver providers.ts.
import { makeAfipProvider, type AfipProviderName, type TaCache } from './providers.ts'
import type { WsaaTa } from './wsfe-core.ts'

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
      emisor_id: bodyEmisorId, // multi-CUIT (F5): override explícito del emisor (opcional)
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

    // 0. Guard de identidad (REGLA #0 — emitir un comprobante fiscal NO puede quedar
    //    abierto al anon key, que es público y viaja en el frontend). El gateway solo
    //    valida que el JWT sea válido, y el anon key ES un JWT válido → acá se exige un
    //    USUARIO real que pertenezca al tenant por el que se emite (o el service_role,
    //    para flujos internos). Corre antes que cualquier lógica fiscal.
    const authToken = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const esServiceRole = !!authToken && authToken === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!esServiceRole) {
      const { data: userData, error: userErr } = await supabase.auth.getUser(authToken)
      if (userErr || !userData?.user) {
        return new Response(JSON.stringify({ error: 'No autorizado: se requiere un usuario autenticado para emitir comprobantes.' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const { data: membership } = await supabase.from('users')
        .select('id').eq('id', userData.user.id).eq('tenant_id', tenant_id).maybeSingle()
      if (!membership) {
        return new Response(JSON.stringify({ error: 'No autorizado: el usuario no pertenece al tenant indicado.' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    // 1. Fetch config del tenant
    const { data: tenant, error: tErr } = await supabase.from('tenants')
      .select('cuit, afipsdk_token, condicion_iva_emisor, nombre, umbral_factura_b, afip_produccion, afip_provider')
      .eq('id', tenant_id).single()
    if (tErr || !tenant) throw new Error('Tenant no encontrado')
    if (!tenant.cuit) throw new Error('El tenant no tiene CUIT configurado')

    // 1b. Multi-CUIT (F5, mig 267): la identidad fiscal del comprobante es un EMISOR del
    //     tenant, no el tenant. Regla (espejo de src/lib/emisorFiscal.ts):
    //       factura → body.emisor_id ?? emisor de la sucursal de la venta ?? default
    //       NC      → SIEMPRE el emisor de la factura original (cruzar CUIT = inválido)
    //     Acá se resuelve lo PRELIMINAR (sin la venta) para que los guards fallen rápido;
    //     tras traer la venta se re-resuelve con sucursal/NC y se re-validan los guards.
    interface EmisorFiscal {
      id: string | null
      cuit: string
      condicion_iva_emisor: string | null
      umbral_factura_b: number | string | null
      afip_produccion: boolean | null
      afip_provider: string | null
      afipsdk_token: string | null
      es_default: boolean
      activo: boolean
    }
    const EMISOR_COLS = 'id, tenant_id, cuit, condicion_iva_emisor, umbral_factura_b, afip_produccion, afip_provider, afipsdk_token, es_default, activo'
    const fetchEmisor = async (id: string) => {
      const { data } = await supabase.from('emisores_fiscales').select(EMISOR_COLS).eq('id', id).maybeSingle()
      return data as (EmisorFiscal & { tenant_id: string }) | null
    }
    // Fallback legacy (tenant sin fila en emisores_fiscales, p.ej. EF deployada antes de
    // la mig en un ambiente): se emite con los campos fiscales del tenant, como siempre.
    const emisorDesdeTenant = (): EmisorFiscal => ({
      id: null, cuit: tenant.cuit, condicion_iva_emisor: tenant.condicion_iva_emisor,
      umbral_factura_b: tenant.umbral_factura_b, afip_produccion: tenant.afip_produccion,
      afip_provider: tenant.afip_provider, afipsdk_token: tenant.afipsdk_token,
      es_default: true, activo: true,
    })
    const validarEmisor = (e: (EmisorFiscal & { tenant_id?: string }) | null, origen: string): Response | null => {
      if (!e) {
        return new Response(JSON.stringify({ error: `El emisor indicado (${origen}) no existe.` }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      if (e.tenant_id && e.tenant_id !== tenant_id) {
        return new Response(JSON.stringify({ error: 'No autorizado: el emisor no pertenece al tenant indicado.' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      if (!e.activo) {
        return new Response(JSON.stringify({ error: `El emisor indicado (${origen}) está inactivo.` }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      return null
    }

    // 2. Fetch venta con ítems y cliente. `maybeSingle`: si no existe, el error se lanza
    //    RECIÉN después de los guards (los guards no deben depender de que la venta exista
    //    — permite validarlos con un venta_id dummy, ver spec 56).
    const { data: venta } = await supabase.from('ventas')
      .select(`
        id, numero, total, costo_envio, estado, medio_pago, cae, tipo_comprobante, numero_comprobante,
        sucursal_id, emisor_id,
        venta_items(cantidad, precio_unitario, subtotal, alicuota_iva, iva_monto,
          productos(nombre, sku, alicuota_iva)),
        clientes(nombre, dni, email, cuit_receptor, condicion_iva_receptor)
      `)
      .eq('id', venta_id).maybeSingle()

    // 2a. Resolución del emisor (una sola, con toda la información disponible):
    //     NC → emisor de la factura original · factura → override ?? sucursal ?? default.
    let emisor: EmisorFiscal
    if (esNC && (venta as any)?.emisor_id) {
      // 🛑 REGLA #0: la NC se emite SIEMPRE con el emisor de la factura original.
      if (bodyEmisorId && String(bodyEmisorId) !== (venta as any).emisor_id) {
        return new Response(JSON.stringify({ error: 'La Nota de Crédito debe emitirse con el mismo emisor (CUIT) que la factura original.' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const e = await fetchEmisor((venta as any).emisor_id)
      const bad = validarEmisor(e, 'de la factura original')
      if (bad) return bad
      emisor = e!
    } else if (bodyEmisorId) {
      const e = await fetchEmisor(String(bodyEmisorId))
      const bad = validarEmisor(e, 'override')
      if (bad) return bad
      emisor = e!
    } else {
      // Emisor asignado a la sucursal de la venta; si no hay, el default del tenant.
      let sucursalEmisorId: string | null = null
      if ((venta as any)?.sucursal_id) {
        const { data: suc } = await supabase.from('sucursales')
          .select('emisor_fiscal_id').eq('id', (venta as any).sucursal_id).maybeSingle()
        sucursalEmisorId = suc?.emisor_fiscal_id ?? null
      }
      if (sucursalEmisorId) {
        const e = await fetchEmisor(sucursalEmisorId)
        const bad = validarEmisor(e, 'de la sucursal')
        if (bad) return bad
        emisor = e!
      } else {
        const { data: eDef } = await supabase.from('emisores_fiscales').select(EMISOR_COLS)
          .eq('tenant_id', tenant_id).eq('es_default', true).maybeSingle()
        emisor = (eDef as EmisorFiscal | null) ?? emisorDesdeTenant()
      }
    }

    // Guard fiscal — última línea de defensa (la restricción del selector en el front es
    // solo UI y puede estar cacheada/bypasseada). Espeja tiposComprobantePermitidos() de
    // src/lib/facturacionLogic.ts: Monotributista/Exento → SOLO C (y NC-C/ND-C); cualquier
    // otra condición (RI) → A o B, nunca C. La `letra` ignora el prefijo NC-/ND-.
    // La condición es LA DEL EMISOR RESUELTO (puede variar por emisor en multi-CUIT).
    const letra = tipo_comprobante.replace(/^N[CD]-/, '')
    {
      const cond = emisor.condicion_iva_emisor
      const soloC = cond === 'Monotributista' || cond === 'Exento'
      if (soloC && letra !== 'C') {
        return new Response(JSON.stringify({ error: `Un emisor ${cond} solo puede emitir comprobantes tipo C (se intentó ${tipo_comprobante}).` }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      if (!soloC && letra === 'C') {
        return new Response(JSON.stringify({ error: `Un emisor Responsable Inscripto no puede emitir comprobantes tipo C (se intentó ${tipo_comprobante}).` }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    // 2a-bis. Los puntos de venta de AFIP son POR CUIT: si el emisor tiene PV configurados,
    // el pedido debe ser uno de ellos (evita emitir con el CUIT A usando un PV del CUIT B).
    // Sin PV configurados se permite cualquier número (comportamiento legacy, PV 1).
    {
      const { data: pvRows } = await supabase.from('puntos_venta_afip')
        .select('numero, emisor_id').eq('tenant_id', tenant_id).eq('activo', true)
      const delEmisor = (pvRows ?? []).filter((p: { numero: number | string; emisor_id: string | null }) =>
        (!!emisor.id && p.emisor_id === emisor.id) || (emisor.es_default && !p.emisor_id))
      if (delEmisor.length > 0 && !delEmisor.some((p: { numero: number | string }) => Number(p.numero) === Number(punto_venta))) {
        return new Response(JSON.stringify({ error: `El punto de venta ${punto_venta} no está configurado para este emisor (los puntos de venta de AFIP son por CUIT).` }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    // Recién acá exigimos que la venta exista (los guards de arriba no dependen de ella).
    if (!venta) throw new Error('Venta no encontrada')

    // Para facturas normales, bloquear si ya tiene CAE
    if (!esNC && venta.cae) throw new Error('Esta venta ya tiene CAE emitido: ' + venta.cae)

    // Provider por-emisor (dual-provider). El token de AfipSDK solo es requisito de ESE
    // circuito; el propio necesita cert+key (se valida más abajo).
    const providerName: AfipProviderName = emisor.afip_provider === 'propio' ? 'propio' : 'afipsdk'
    if (providerName === 'afipsdk' && !emisor.afipsdk_token) throw new Error('El emisor no tiene token de facturación configurado')

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

    // 2b. Costo de envío cobrado al cliente → DEBE ir como ítem en la factura (regla AFIP:
    //     es parte del neto total de la operación). Solo en facturas (no NC) y si se cobró
    //     (costo_envio > 0; el caso "courier paga el cliente directo" tiene costo_envio = 0).
    //     El flete sigue la alícuota del producto (en A/B); en C va a neto sin discriminar.
    //     Al ser un servicio, abajo se setea Concepto=3 + FchServ* (AFIP los exige).
    const costoEnvio = Number((venta as any).costo_envio ?? 0)
    const envioFacturado = !esNC && costoEnvio > 0
    if (envioFacturado) {
      // Alícuota predominante de los productos (la de mayor subtotal); default 21.
      const porAlic: Record<string, number> = {}
      for (const it of items) {
        const a = String(it.alicuota_iva ?? it.productos?.alicuota_iva ?? '21')
        porAlic[a] = (porAlic[a] ?? 0) + Number(it.subtotal ?? it.precio_unitario * it.cantidad ?? 0)
      }
      const alicEnvio = Object.entries(porAlic).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '21'
      items = [...items, {
        cantidad: 1,
        precio_unitario: costoEnvio,
        subtotal: costoEnvio,
        alicuota_iva: alicEnvio,
        productos: { nombre: 'Costo de Envío', sku: 'ENVIO', alicuota_iva: alicEnvio },
      }]
    }

    // 3. Determinar tipo de comprobante y datos del receptor
    const cbteTipo = TIPO_CBTE[tipo_comprobante] ?? 6
    const condicionIvaReceptor = cliente?.condicion_iva_receptor ?? 'CF'
    const condicionId = IVA_RECEPTOR_ID[condicionIvaReceptor] ?? 5

    // DocTipo/DocNro según condición
    let docTipo = 99; let docNro = 0 // Consumidor Final por defecto
    const totalVenta = Number(venta.total ?? 0) + (envioFacturado ? costoEnvio : 0)
    const umbral = Number(emisor.umbral_factura_b ?? 68305.16)

    if (tipo_comprobante === 'A') {
      docTipo = 80 // CUIT
      docNro  = parseInt((cliente?.cuit_receptor ?? '').replace(/[-\s]/g, '')) || 0
      if (!docNro) throw new Error('Para Factura A se requiere CUIT del cliente')
    } else if (totalVenta >= umbral && cliente?.dni) {
      docTipo = 96 // DNI
      docNro  = parseInt((cliente.dni ?? '').replace(/[.\s-]/g, '')) || 0
    }

    // FAC-27 — Factura B ≥ umbral sin identificar al cliente: AFIP (RG 5616) lo exige.
    // Guard server-side, espejo del bloqueo del POS (requiereIdentFacturaB): un bundle viejo
    // o una llamada directa a la API podía saltear la UI y la EF emitía con Consumidor Final
    // (DocTipo 99) → AFIP rechazaba. Falla rápido con mensaje claro (consistente con el guard de tipo).
    if (tipo_comprobante === 'B' && totalVenta >= umbral && docNro === 0) {
      return new Response(JSON.stringify({ error: `Factura B por $${Math.round(totalVenta).toLocaleString('es-AR')} o más: AFIP exige identificar al cliente con DNI o CUIT.` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
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
      const esExenta = tasaStr === 'exento' || tasaStr === 'sin_iva'
      // La alícuota viene de un numeric de Postgres → llega como "21.00" / "10.50" / "0.00".
      // Hay que normalizarla a "21" / "10.5" / "0" para que matchee ALICUOTA_ID; si no,
      // el lookup fallaba y caía al default 5 (= Id de 21%) → AFIP rechazaba (error 10051)
      // toda Factura A/B con alícuota ≠ 21 (10.5 / 27 / exento se mandaban como 21%).
      const tasaKey  = esExenta ? tasaStr : String(parseFloat(tasaStr))
      const ivaId    = ALICUOTA_ID[tasaKey] ?? 5
      const tasa     = esExenta ? 0 : parseFloat(tasaStr) / 100
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
    const cuit = parseInt(emisor.cuit.replace(/[-\s]/g, ''))
    // Homologación vs producción: decisión POR-EMISOR (emisores_fiscales.afip_produccion).
    // `AFIP_FORCE_HOMOLOGACION=true` es un freno de emergencia GLOBAL que fuerza
    // homologación para todos (nunca prende producción). Default → homologación.
    const masterKill = Deno.env.get('AFIP_FORCE_HOMOLOGACION') === 'true'
    const isProduction = !masterKill && emisor.afip_produccion === true

    // Certificado del EMISOR (subido en Config → Facturación, tabla tenant_certificates +
    // bucket certificados-afip). El cert de un emisor NUNCA firma por otro: se elige la
    // fila con emisor_id del emisor resuelto, con fallback a la fila legacy sin emisor
    // (pre-mig 267). AfipSDK acepta cert+key por constructor y hace la firma WSAA en su
    // nube → funciona en Deno. Sin cert, AfipSDK cae a modo token-only.
    let certPem: string | undefined
    let keyPem: string | undefined
    const { data: certRows } = await supabase.from('tenant_certificates')
      .select('cert_crt_path, cert_key_path, activo, emisor_id')
      .eq('tenant_id', tenant_id).eq('activo', true)
    const certRow = (certRows ?? []).find((c: { emisor_id: string | null }) => !!emisor.id && c.emisor_id === emisor.id)
      ?? (certRows ?? []).find((c: { emisor_id: string | null }) => !c.emisor_id)
      ?? null
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

    // Circuito propio: el cert es OBLIGATORIO (firma el WSAA localmente). Falla claro
    // ANTES de tocar AFIP — no hay fallback automático al otro provider (REGLA #0).
    if (providerName === 'propio' && (!certPem || !keyPem)) {
      return new Response(JSON.stringify({ error: "El emisor está en circuito WSFE propio pero no tiene certificado AFIP activo (Config → Facturación). Cargá el certificado del emisor o pasalo a afip_provider='afipsdk'." }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Cache persistente del TA de WSAA (tabla afip_wsaa_ta, service_role-only, mig 264).
    // Sin esto, la 2ª emisión dentro de las ~12h fallaría: AFIP no re-emite un TA vigente
    // (coe.alreadyAuthenticated) y las instancias de la EF son efímeras.
    const taEnvironment = isProduction ? 'produccion' : 'homologacion'
    const taCache: TaCache = {
      get: async () => {
        const { data } = await supabase.from('afip_wsaa_ta')
          .select('token, sign, expiration_time')
          .eq('cuit', cuit).eq('service', 'wsfe').eq('environment', taEnvironment)
          .maybeSingle()
        return data ? { token: data.token, sign: data.sign, expirationTime: data.expiration_time } as WsaaTa : null
      },
      set: async (ta: WsaaTa) => {
        const { error } = await supabase.from('afip_wsaa_ta').upsert({
          cuit, service: 'wsfe', environment: taEnvironment,
          token: ta.token, sign: ta.sign,
          expiration_time: ta.expirationTime,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'cuit,service,environment' })
        if (error) console.warn('[emitir-factura] no se pudo cachear el TA de WSAA:', error.message)
      },
    }

    const provider = makeAfipProvider(providerName, {
      cuit,
      production: isProduction,
      accessToken: emisor.afipsdk_token,
      certPem,
      keyPem,
      taCache,
    })
    const ultimo   = await provider.getLastVoucher(punto_venta, cbteTipo)
    const proximo  = ultimo + 1

    // 7. Payload WSFE
    const payload: Record<string, unknown> = {
      CantReg:    1,
      PtoVta:     punto_venta,
      CbteTipo:   cbteTipo,
      // 1=Productos · 3=Productos y Servicios (cuando se factura el envío como servicio).
      // Con Concepto 2/3 AFIP EXIGE FchServDesde/Hasta/VtoPago (se agregan abajo).
      Concepto:   envioFacturado ? 3 : 1,
      ...(envioFacturado ? { FchServDesde: fecha, FchServHasta: fecha, FchVtoPago: fecha } : {}),
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
    console.log(`Emitiendo ${tipo_comprobante} #${proximo} para tenant ${tenant_id} (emisor ${emisor.id ?? 'legacy'} CUIT ${cuit}) [${isProduction ? 'PRODUCCIÓN' : 'homologación'}] via ${providerName}`)
    const resultado = await provider.createVoucher(payload)

    // 9. Guardar CAE (REGLA #0). AFIP YA autorizó el comprobante: si el UPDATE falla, la venta/devolución
    //    quedaría SIN registro del CAE → re-emisión posible (DOBLE factura en AFIP). Por eso se reintenta
    //    y, si igual falla, NO se devuelve `ok` en silencio: se lanza un error que incluye el CAE para
    //    reconciliarlo a mano (y se loguea fuerte). El cliente usa service_role → no es RLS.
    const persistirCAE = async (run: () => Promise<{ error: unknown }>, intentos = 3): Promise<void> => {
      let lastErr: unknown = null
      for (let i = 0; i < intentos; i++) {
        const { error } = await run()
        if (!error) return
        lastErr = error
        await new Promise(r => setTimeout(r, 250 * (i + 1)))
      }
      const msg = (lastErr as { message?: string })?.message ?? 'error desconocido'
      console.error(`[emitir-factura] PERSISTENCIA DEL CAE FALLÓ tras autorizar en AFIP (CAE ${resultado.CAE}, N° ${proximo}, ${esNC ? `devolucion ${devolucion_id}` : `venta ${venta_id}`}): ${msg}`)
      throw new Error(`Comprobante AUTORIZADO en AFIP (CAE ${resultado.CAE}, N° ${proximo}) pero NO se pudo guardar en el sistema: ${msg}. NO reintentar la emisión — registrá el CAE manualmente o avisá a soporte.`)
    }

    if (esNC) {
      // NC: guardar en devoluciones
      await persistirCAE(() => supabase.from('devoluciones').update({
        nc_cae:               resultado.CAE,
        nc_vencimiento_cae:   resultado.CAEFchVto,
        nc_numero_comprobante: proximo,
        nc_tipo:              tipo_comprobante,
        nc_punto_venta:       punto_venta,
        // Fecha de emisión de la NC (mig 266): el Libro IVA la imputa a ESTE período,
        // no al de la devolución (created_at).
        nc_fecha:             new Date().toISOString(),
        afip_provider_usado:  providerName,
      }).eq('id', devolucion_id))
    } else {
      // Factura normal: guardar en ventas. Si estaba 'despachada', pasa a 'facturada'
      // automáticamente (antes había que marcarla a mano desde el detalle de la venta).
      const ventaUpdate: Record<string, unknown> = {
        cae:               resultado.CAE,
        vencimiento_cae:   resultado.CAEFchVto,
        tipo_comprobante:  `Factura ${tipo_comprobante}`,
        numero_comprobante: proximo,
        afip_provider_usado: providerName,
        // Multi-CUIT: con qué emisor se emitió (la NC lo hereda de acá). Null solo en el
        // fallback legacy sin fila de emisor.
        ...(emisor.id ? { emisor_id: emisor.id } : {}),
      }
      if (venta.estado === 'despachada') ventaUpdate.estado = 'facturada'
      await persistirCAE(() => supabase.from('ventas').update(ventaUpdate).eq('id', venta_id))
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
