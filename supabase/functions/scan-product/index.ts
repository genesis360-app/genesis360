import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const UNIDADES_VALIDAS = ['unidad', 'kg', 'g', 'litro', 'ml', 'metro', 'cm', 'caja', 'pack', 'docena']

async function lookupBarcode(barcode: string): Promise<{ nombre?: string; descripcion?: string } | null> {
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`)
    if (!res.ok) return null
    const data = await res.json()
    if (data.status !== 1 || !data.product) return null
    const p = data.product
    const nombre = p.product_name_es || p.product_name || p.generic_name_es || p.generic_name || null
    const descripcion = p.brands ? `${p.brands}${p.quantity ? ' · ' + p.quantity : ''}` : null
    return nombre ? { nombre, descripcion: descripcion ?? undefined } : null
  } catch {
    return null
  }
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

    // 1. Llamar a Claude Haiku con la imagen
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type, data: image },
            },
            {
              type: 'text',
              text: `Analizá esta imagen de un producto de comercio/tienda. Extraé la información y respondé SOLO con un JSON válido, sin texto adicional:
{
  "nombre": "nombre del producto (conciso, sin marca si es genérico)",
  "descripcion": "descripción breve en 1 oración (marca, variante, contenido)",
  "unidad_medida": "una de: unidad|kg|g|litro|ml|metro|cm|caja|pack|docena",
  "codigo_barras": "código de barras numérico si es visible en la imagen, null si no"
}
Si no podés determinar un campo con certeza, usá null.`,
            },
          ],
        }],
      }),
    })

    if (!claudeRes.ok) {
      const err = await claudeRes.json()
      throw new Error(err.error?.message ?? 'Error en Claude API')
    }

    const claudeData = await claudeRes.json()
    const rawText = claudeData.content?.[0]?.text ?? ''

    // Parsear JSON de la respuesta de Claude
    let extracted: {
      nombre?: string | null
      descripcion?: string | null
      unidad_medida?: string | null
      codigo_barras?: string | null
    } = {}

    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/)
      if (jsonMatch) extracted = JSON.parse(jsonMatch[0])
    } catch {
      throw new Error('Claude no devolvió JSON válido')
    }

    // 2. Si hay código de barras, buscar en Open Food Facts
    let offData: { nombre?: string; descripcion?: string } | null = null
    const barcode = extracted.codigo_barras?.replace(/\D/g, '') ?? null
    if (barcode && barcode.length >= 8) {
      offData = await lookupBarcode(barcode)
    }

    // 3. Armar respuesta (Open Food Facts tiene prioridad para nombre si encontró)
    const result = {
      nombre:        offData?.nombre     ?? extracted.nombre     ?? null,
      descripcion:   offData?.descripcion ?? extracted.descripcion ?? null,
      unidad_medida: UNIDADES_VALIDAS.includes(extracted.unidad_medida ?? '')
                       ? extracted.unidad_medida
                       : 'unidad',
      codigo_barras: barcode,
      fuente:        offData ? 'open_food_facts' : 'claude_vision',
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    console.error('scan-product error:', err.message)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
