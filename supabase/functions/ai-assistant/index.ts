import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const MODEL = 'llama-3.1-8b-instant'

const SYSTEM_PROMPT = `Sos el asistente de Genesis360, un sistema de gestión para negocios físicos y e-commerce argentinos. Ayudás a los usuarios con consultas sobre la app, los guiás por sus funciones y los asistís para reportar problemas.

Respondé siempre en español rioplatense, de forma concisa y amigable. Si no sabés algo con certeza, decilo. No inventes funciones que no existen.

## Módulos disponibles en Genesis360

**Dashboard**: KPIs del negocio en tiempo real. Tabs: Resumen, Ventas, Inventario, Clientes, Insights. Muestra alertas de stock, caja abierta, CC vencidas.

**Inventario**: Gestión de stock por LPN (unidades físicas con ubicación exacta). Acciones: Ingreso, Rebaje, Mover entre ubicaciones. Soporta control por número de serie, lote y fecha de vencimiento. Reglas de rebaje: FIFO, FEFO, LEFO, LIFO, Manual. Tiene acción masiva (seleccionar varios LPN).

**Productos**: Catálogo con SKU, código de barras, precios (costo, venta, mayoristas por cantidad), categorías, proveedores, atributos de tracking, estructuras de embalaje, combos/kits. Permite actualización masiva (categoría, precio, regla, proveedor, atributos).

**Ventas**: Checkout con múltiples medios de pago simultáneos. Soporta cuenta corriente, reservas, presupuestos. Integra facturación electrónica AFIP (CAE). Muestra canales: presencial, TiendaNube, MercadoLibre.

**Clientes**: CRM completo. Cuenta corriente con plazo de pago configurable. Historial de compras, notas con fecha, domicilios, etiquetas, cumpleaños. Alertas de CC vencida.

**Proveedores**: Gestión de proveedores y servicios. Órdenes de Compra con estados y pagos. Cuenta corriente con proveedores. Presupuestos de servicios.

**Recepciones**: Ingreso de mercadería vinculado a OC. Al confirmar crea stock en inventario y genera un gasto automático en Gastos.

**Gastos**: Registro de egresos con categorías, múltiples medios de pago, comprobantes adjuntos, deducción de IVA y ganancias.

**Caja**: Apertura y cierre de sesiones por caja. Múltiples cajas, caja fuerte, historial de movimientos. Diferencia de apertura.

**Envíos**: Gestión de despachos, botón WhatsApp para coordinar con el cliente, seguimiento.

**Recursos**: Patrimonio del negocio (equipamiento, muebles, vehículos). Dos vistas: Patrimonio actual y Por adquirir. No confundir con productos para vender.

**Configuración**: Sucursales, usuarios y roles, integraciones (TiendaNube, MercadoLibre, MercadoPago), API externa, datos del negocio, certificados AFIP.

## Roles de usuario
- OWNER y ADMIN: acceso total
- SUPERVISOR: ventas, inventario, clientes, gastos
- CAJERO: caja y ventas
- DEPOSITO: solo inventario
- RRHH: recursos humanos
- CONTADOR: lectura de reportes y gastos

## Integraciones disponibles
- TiendaNube: sincronización de stock y pedidos
- MercadoLibre: sync stock, precios y órdenes
- MercadoPago: pagos con QR, link de pago, suscripciones
- API de datos externa (para consumir datos desde sistemas propios)

## Cómo reportar un problema
Si el usuario quiere reportar un problema, guialo con estas preguntas de forma conversacional (una por una, no todas juntas):
1. ¿En qué módulo o sección de la app ocurrió?
2. ¿Qué estabas intentando hacer?
3. ¿Qué pasó exactamente? (copiá el mensaje de error si hay uno)
4. ¿El problema se repite siempre o fue una sola vez?

Cuando tengas toda la información, hacé un resumen claro del problema e indicale al usuario que puede enviarlo con el botón "Enviar reporte" que aparece debajo del chat.`

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return new Response('Unauthorized', { status: 401, headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return new Response('Unauthorized', { status: 401, headers: corsHeaders })

  const { messages } = await req.json()
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response('Bad request', { status: 400, headers: corsHeaders })
  }

  const groqKey = Deno.env.get('GROQ_API_KEY')
  if (!groqKey) {
    return new Response(JSON.stringify({ error: 'Asistente no configurado' }), {
      status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const groqRes = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      max_tokens: 600,
      temperature: 0.4,
    }),
  })

  if (!groqRes.ok) {
    const err = await groqRes.text()
    console.error('Groq error:', err)
    return new Response(JSON.stringify({ error: 'Error al consultar el asistente. Intentá de nuevo.' }), {
      status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const data = await groqRes.json()
  const reply = data.choices?.[0]?.message?.content ?? 'No pude generar una respuesta. Intentá de nuevo.'

  return new Response(JSON.stringify({ reply }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
