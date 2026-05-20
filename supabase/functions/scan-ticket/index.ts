import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { image, media_type = 'image/jpeg' } = await req.json()
    if (!image) throw new Error('Falta la imagen (base64)')

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY no configurado')

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type, data: image },
            },
            {
              type: 'text',
              text: `Analizá esta imagen de un ticket de compra de supermercado o almacén.
Extraé todos los productos que aparecen listados en el ticket.

Para cada producto retorná:
- barcode: código de barras si aparece como texto numérico en el ticket (ej: "7790080019100"), o null si no está visible
- nombre: nombre del producto tal como figura en el ticket (expandí abreviaturas si podés)
- cantidad: cantidad comprada (número entero, default 1 si no se especifica)
- precio_unitario: precio por unidad en pesos sin símbolo $. Si el ticket muestra precio total y cantidad mayor a 1, calculá: precio_total / cantidad

Respondé ÚNICAMENTE con JSON válido, sin texto adicional ni bloques markdown:
{"items": [{"barcode": null, "nombre": "Leche La Serenísima 1L", "cantidad": 2, "precio_unitario": 950.00}]}

Si no podés leer el ticket, respondé: {"items": []}`,
            },
          ],
        }],
      }),
    })

    if (!claudeRes.ok) {
      const errBody = await claudeRes.text()
      console.error('Claude API error:', claudeRes.status, errBody)
      throw new Error(`Claude API ${claudeRes.status}: ${errBody.slice(0, 200)}`)
    }

    const claudeData = await claudeRes.json()
    const rawText = claudeData.content?.[0]?.text ?? ''

    let result: { items: Array<{ barcode: string | null; nombre: string; cantidad: number; precio_unitario: number }> } = { items: [] }
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/)
      if (jsonMatch) result = JSON.parse(jsonMatch[0])
    } catch {
      throw new Error('No se pudo parsear la respuesta de Claude')
    }

    // Sanitizar items
    result.items = (result.items ?? [])
      .map(item => ({
        barcode: item.barcode ? String(item.barcode).replace(/\D/g, '') || null : null,
        nombre: String(item.nombre ?? '').trim(),
        cantidad: Math.max(1, Math.round(Number(item.cantidad) || 1)),
        precio_unitario: Math.max(0, Number(item.precio_unitario) || 0),
      }))
      .filter(item => item.nombre.length > 0)

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    console.error('scan-ticket error:', err.message)
    return new Response(JSON.stringify({ error: err.message, items: [] }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
