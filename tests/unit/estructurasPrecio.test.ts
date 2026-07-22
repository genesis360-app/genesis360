import { describe, it, expect } from 'vitest'
import { ordenAnclaEfectivo, precioEfectivoNivel, nivelesAPayload, validarNiveles, type NivelForm } from '@/lib/estructuras'

// Punto 4/6/7 backlog Fede/GO — precio de venta/costo por Unidad de Medida en la estructura

const niveles = [
  { orden: 1, unidades_base: 1, precio_venta: null, precio_costo: null },   // Unidad
  { orden: 2, unidades_base: 12, precio_venta: null, precio_costo: null },  // Caja ×12
  { orden: 3, unidades_base: 480, precio_venta: null, precio_costo: null }, // Pallet ×40 cajas
]

describe('ordenAnclaEfectivo', () => {
  it('sin ancla configurada → nivel base (primer orden)', () => {
    expect(ordenAnclaEfectivo(niveles, null)).toBe(1)
    expect(ordenAnclaEfectivo(niveles, undefined)).toBe(1)
  })
  it('ancla válida → la respeta', () => {
    expect(ordenAnclaEfectivo(niveles, 2)).toBe(2)
  })
  it('ancla que ya no existe (estructura se achicó) → cae al nivel base, no explota', () => {
    expect(ordenAnclaEfectivo(niveles, 99)).toBe(1)
  })
  it('sin niveles → 1 por default', () => {
    expect(ordenAnclaEfectivo([], 2)).toBe(1)
  })
})

describe('precioEfectivoNivel', () => {
  it('nivel con precio propio → se usa tal cual, sin importar la ancla', () => {
    const conPropio = [...niveles]
    conPropio[1] = { ...conPropio[1], precio_venta: 1080 }
    expect(precioEfectivoNivel(conPropio, 2, 1, 100, 'precio_venta')).toBe(1080)
  })

  it('ancla en el nivel base (orden 1): niveles superiores heredan por unidades_base', () => {
    // Ancla = Unidad ($100). Caja (12 unidades_base) → 100 × 12 = 1200. Pallet (480) → 48000.
    expect(precioEfectivoNivel(niveles, 2, 1, 100, 'precio_venta')).toBe(1200)
    expect(precioEfectivoNivel(niveles, 3, 1, 100, 'precio_venta')).toBe(48000)
  })

  it('ancla en un nivel superior (Caja): otros niveles se escalan proporcional, no en cadena', () => {
    // Ancla = Caja ($1080, unidades_base=12). Unidad → 1080 × (1/12) = 90.
    // Pallet → 1080 × (480/12) = 43200. Da igual si Caja tiene precio propio o no: el cálculo
    // usa la relación de unidades_base contra la ancla, nunca "factor × nivel anterior".
    expect(precioEfectivoNivel(niveles, 1, 2, 1080, 'precio_venta')).toBe(90)
    expect(precioEfectivoNivel(niveles, 3, 2, 1080, 'precio_venta')).toBe(43200)
  })

  it('un precio "raro" a mitad de camino NO afecta el cálculo de otros niveles (sin cadena)', () => {
    const conPropioEnMedio = [...niveles]
    conPropioEnMedio[1] = { ...conPropioEnMedio[1], precio_venta: 5000 } // Caja carísima a mano
    // Pallet sigue calculándose desde la ANCLA (Unidad, orden 1), no desde Caja:
    // 100 × (480/1) = 48000, IGUAL que si Caja no tuviera precio propio.
    expect(precioEfectivoNivel(conPropioEnMedio, 3, 1, 100, 'precio_venta')).toBe(48000)
  })

  it('nivel o ancla inexistente → null, no explota', () => {
    expect(precioEfectivoNivel(niveles, 99, 1, 100, 'precio_venta')).toBeNull()
    expect(precioEfectivoNivel(niveles, 2, 99, 100, 'precio_venta')).toBeNull()
  })

  it('precio de ancla inválido (0, negativo, null) → null', () => {
    expect(precioEfectivoNivel(niveles, 2, 1, 0, 'precio_venta')).toBeNull()
    expect(precioEfectivoNivel(niveles, 2, 1, null, 'precio_venta')).toBeNull()
  })

  it('funciona igual para precio_costo', () => {
    expect(precioEfectivoNivel(niveles, 2, 1, 60, 'precio_costo')).toBe(720)
  })
})

describe('nivelesAPayload — precio_venta/precio_costo', () => {
  const base: NivelForm = { unidad_medida_id: 'u1', factor: '1', peso: '', alto: '', ancho: '', largo: '', precioVenta: '', precioCosto: '' }

  it('vacío → null (hereda)', () => {
    const [p] = nivelesAPayload([base])
    expect(p.precio_venta).toBeNull()
    expect(p.precio_costo).toBeNull()
  })
  it('con valor → se manda como number', () => {
    const [p] = nivelesAPayload([{ ...base, precioVenta: '1080', precioCosto: '650' }])
    expect(p.precio_venta).toBe(1080)
    expect(p.precio_costo).toBe(650)
  })
})

describe('validarNiveles — precio_venta/precio_costo negativos', () => {
  const base: NivelForm = { unidad_medida_id: 'u1', factor: '1', peso: '', alto: '', ancho: '', largo: '', precioVenta: '', precioCosto: '' }

  it('precio negativo rechaza', () => {
    expect(validarNiveles([{ ...base, precioVenta: '-10' }])).toMatch(/precio de venta/)
  })
  it('costo negativo rechaza', () => {
    expect(validarNiveles([{ ...base, precioCosto: '-1' }])).toMatch(/costo/)
  })
  it('0 es válido (no negativo)', () => {
    expect(validarNiveles([{ ...base, precioVenta: '0', precioCosto: '0' }])).toBeNull()
  })
})
