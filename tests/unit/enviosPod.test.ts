import { describe, it, expect } from 'vitest'
import {
  podFaltantes, requiereOtp, geoEstado, resolverNoEntrega,
  recargoReintento, haversineKm, generarCodigoOtp,
} from '@/lib/enviosPod'

// Envíos EN2 — POD robusto

describe('podFaltantes (D1/D2)', () => {
  it('sin requeridos → nada falta', () => {
    expect(podFaltantes({}, {})).toEqual([])
  })
  it('exige fecha/receptor/dni/firma cuando están marcados', () => {
    const f = podFaltantes({}, { fecha: true, receptor: true, dni: true, firma: true })
    expect(f).toContain('Fecha de entrega')
    expect(f).toContain('Nombre del receptor')
    expect(f).toContain('DNI del receptor')
    expect(f).toContain('Firma del receptor')
  })
  it('cumplidos no aparecen', () => {
    const f = podFaltantes(
      { fecha: '2026-06-08', receptor: 'Juan', dni: '30111222', firma_url: 'http://x/f.png' },
      { fecha: true, receptor: true, dni: true, firma: true },
    )
    expect(f).toEqual([])
  })
  it('foto requerida (D1) exige al menos 1', () => {
    expect(podFaltantes({ fotos: 0 }, { foto: true })).toContain('Al menos 1 foto')
    expect(podFaltantes({ fotos: 1 }, { foto: true })).toEqual([])
  })
  it('fotoMin (D2) exige el mínimo configurado', () => {
    expect(podFaltantes({ fotos: 1 }, {}, 2)).toContain('Al menos 2 fotos')
    expect(podFaltantes({ fotos: 2 }, {}, 2)).toEqual([])
  })
})

describe('requiereOtp (D3)', () => {
  it('solo envío propio sobre umbral', () => {
    expect(requiereOtp(true, 50000, 30000)).toBe(true)
    expect(requiereOtp(true, 20000, 30000)).toBe(false)
    expect(requiereOtp(false, 50000, 30000)).toBe(false)  // courier tercero nunca
    expect(requiereOtp(true, 50000, 0)).toBe(false)        // umbral 0 = off
  })
})

describe('geoEstado (D4)', () => {
  it('sin coords → no_disponible (fallback graceful)', () => {
    expect(geoEstado(null, 5)).toBe('no_disponible')
  })
  it('dentro del radio → ok', () => {
    expect(geoEstado(2, 5)).toBe('ok')
  })
  it('fuera del radio → fuera_rango', () => {
    expect(geoEstado(8, 5)).toBe('fuera_rango')
  })
  it('alertaKm 0 con coords → ok (sin control)', () => {
    expect(geoEstado(999, 0)).toBe('ok')
  })
})

describe('resolverNoEntrega (D5/D6)', () => {
  it('ausente con intentos disponibles → reintento (en_camino)', () => {
    expect(resolverNoEntrega(0, 3, 'ausente')).toEqual({ nuevoIntentos: 1, estado: 'en_camino', reintenta: true })
  })
  it('ausente agotando intentos → devolución', () => {
    expect(resolverNoEntrega(2, 3, 'ausente')).toEqual({ nuevoIntentos: 3, estado: 'devolucion', reintenta: false })
  })
  it('rechazado → devolución directa', () => {
    expect(resolverNoEntrega(0, 3, 'rechazado')).toEqual({ nuevoIntentos: 1, estado: 'devolucion', reintenta: false })
  })
  it('direccion_incorrecta → devolución directa', () => {
    expect(resolverNoEntrega(0, 3, 'direccion_incorrecta').estado).toBe('devolucion')
  })
})

describe('recargoReintento (D6)', () => {
  it('aplica recargo al superar el máximo', () => {
    expect(recargoReintento(3, 3, 500)).toBe(500)
    expect(recargoReintento(2, 3, 500)).toBe(0)
    expect(recargoReintento(3, 3, 0)).toBe(0)
  })
})

describe('haversineKm', () => {
  it('misma coordenada → 0', () => {
    expect(haversineKm(-34.6, -58.4, -34.6, -58.4)).toBe(0)
  })
  it('distancia plausible entre dos puntos de CABA (~1-2km)', () => {
    const d = haversineKm(-34.603, -58.381, -34.615, -58.433)
    expect(d).toBeGreaterThan(3)
    expect(d).toBeLessThan(7)
  })
})

describe('generarCodigoOtp (D3)', () => {
  it('genera 6 dígitos con padding', () => {
    expect(generarCodigoOtp(() => 0)).toBe('000000')
    expect(generarCodigoOtp(() => 0.123456)).toHaveLength(6)
    expect(generarCodigoOtp(() => 0.999999)).toHaveLength(6)
  })
})
