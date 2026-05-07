import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'x-api-key, content-type',
}

// Rate limiting: Map en memoria del isolate (se resetea en cold start — suficiente para v1)
const rateLimitMap = new Map<string, { count: number; windowStart: number }>()
const RATE_LIMIT = 120       // req/min por key
const WINDOW_MS  = 60_000

function checkRateLimit(keyHash: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(keyHash)
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    rateLimitMap.set(keyHash, { count: 1, windowStart: now })
    return true
  }
  if (entry.count >= RATE_LIMIT) return false
  entry.count++
  return true
}

async function hashKey(key: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function toCsv(rows: Record<string, unknown>[], bom = true): string {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  const lines = rows.map(r =>
    headers.map(h => {
      const v = r[h]
      if (v === null || v === undefined) return ''
      const s = String(v)
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
    }).join(',')
  )
  const csv = [headers.join(','), ...lines].join('\n')
  return bom ? '﻿' + csv : csv  // BOM UTF-8 para compatibilidad con Excel argentino
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 })

  // ─── Auth via X-API-Key ────────────────────────────────────────────────────
  const apiKey = req.headers.get('x-api-key')
  if (!apiKey || !apiKey.startsWith('g360_')) {
    return new Response(JSON.stringify({ error: 'API key requerida. Incluí el header X-API-Key: g360_...' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const keyHash = await hashKey(apiKey)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: keyRow, error: keyErr } = await supabase
    .from('api_keys')
    .select('id, tenant_id, activo, permisos')
    .eq('key_hash', keyHash)
    .eq('activo', true)
    .maybeSingle()

  if (keyErr || !keyRow) {
    return new Response(JSON.stringify({ error: 'API key inválida o revocada' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // Rate limit
  if (!checkRateLimit(keyHash)) {
    return new Response(JSON.stringify({ error: 'Rate limit excedido: 120 req/min' }), {
      status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // Actualizar last_used_at (fire-and-forget)
  supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyRow.id)

  // ─── Parámetros ───────────────────────────────────────────────────────────
  const url = new URL(req.url)
  const entity       = url.searchParams.get('entity')       ?? ''
  const format       = url.searchParams.get('format')       ?? 'json'
  const limit        = Math.min(parseInt(url.searchParams.get('limit') ?? '100'), 1000)
  const offset       = parseInt(url.searchParams.get('offset') ?? '0')
  const updatedSince = url.searchParams.get('updated_since') ?? null
  const sucursalId   = url.searchParams.get('sucursal_id')   ?? null
  const tenantId     = keyRow.tenant_id

  const ENTIDADES = ['productos', 'clientes', 'proveedores', 'inventario']
  if (!ENTIDADES.includes(entity)) {
    return new Response(JSON.stringify({
      error: `Entidad '${entity}' no válida. Opciones: ${ENTIDADES.join(', ')}`,
    }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  // ─── Queries por entidad ───────────────────────────────────────────────────
  let rows: Record<string, unknown>[] = []

  if (entity === 'productos') {
    let q = supabase
      .from('productos')
      .select('id, nombre, sku, precio_venta, precio_costo, stock_actual, unidad_medida, activo, categoria:categorias(nombre)')
      .eq('tenant_id', tenantId)
      .range(offset, offset + limit - 1)
    if (updatedSince) q = q.gte('updated_at', updatedSince)
    const { data, error } = await q
    if (error) throw error
    rows = (data ?? []).map(p => ({
      id: p.id, nombre: p.nombre, sku: p.sku,
      precio_venta: p.precio_venta, precio_costo: p.precio_costo,
      stock_actual: p.stock_actual, unidad_medida: p.unidad_medida,
      activo: p.activo,
      categoria: (p.categoria as { nombre?: string } | null)?.nombre ?? null,
    }))
  }

  if (entity === 'clientes') {
    let q = supabase
      .from('clientes')
      .select('id, nombre, dni, telefono, email, direccion, cuenta_corriente_habilitada, activo')
      .eq('tenant_id', tenantId)
      .range(offset, offset + limit - 1)
    if (sucursalId) q = q.eq('sucursal_id', sucursalId)
    if (updatedSince) q = q.gte('updated_at', updatedSince)
    const { data, error } = await q
    if (error) throw error
    rows = data ?? []
  }

  if (entity === 'proveedores') {
    let q = supabase
      .from('proveedores')
      .select('id, nombre, razon_social, cuit, condicion_iva, plazo_pago_dias, banco, cbu, activo')
      .eq('tenant_id', tenantId)
      .eq('activo', true)
      .range(offset, offset + limit - 1)
    if (updatedSince) q = q.gte('updated_at', updatedSince)
    const { data, error } = await q
    if (error) throw error
    rows = data ?? []
  }

  if (entity === 'inventario') {
    let q = supabase
      .from('inventario_lineas')
      .select('lpn, cantidad, cantidad_reservada, nro_lote, fecha_vencimiento, activo, producto:productos(nombre,sku), ubicacion:ubicaciones(nombre), estado:estados_inventario(nombre)')
      .eq('tenant_id', tenantId)
      .eq('activo', true)
      .range(offset, offset + limit - 1)
    if (sucursalId) q = q.eq('sucursal_id', sucursalId)
    if (updatedSince) q = q.gte('updated_at', updatedSince)
    const { data, error } = await q
    if (error) throw error
    rows = (data ?? []).map((l: Record<string, unknown>) => ({
      lpn: l.lpn,
      producto: (l.producto as { nombre?: string } | null)?.nombre ?? null,
      sku:      (l.producto as { sku?: string } | null)?.sku ?? null,
      cantidad: l.cantidad,
      cantidad_reservada: l.cantidad_reservada,
      disponible: (l.cantidad as number) - (l.cantidad_reservada as number),
      ubicacion: (l.ubicacion as { nombre?: string } | null)?.nombre ?? null,
      estado:   (l.estado as { nombre?: string } | null)?.nombre ?? null,
      nro_lote: l.nro_lote,
      fecha_vencimiento: l.fecha_vencimiento,
    }))
  }

  // ─── Respuesta ─────────────────────────────────────────────────────────────
  if (format === 'csv') {
    const filename = `${entity}_${new Date().toISOString().slice(0, 10)}.csv`
    return new Response(toCsv(rows), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      }
    })
  }

  return new Response(JSON.stringify({ entity, total: rows.length, offset, data: rows }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
