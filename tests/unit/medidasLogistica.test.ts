import { describe, it, expect } from 'vitest'
import {
  sugerirBultoEnvio, avisoBultoIncompleto, estadoCapacidadUbicacion, etiquetaOcupacion,
  estadoCargaUbicacion, volumenUbicacionM3,
} from '../../src/lib/medidasLogistica'

describe('sugerirBultoEnvio', () => {
  it('💵 el PESO se suma y se multiplica por la cantidad — es aditivo y exacto', () => {
    const b = sugerirBultoEnvio([
      { cantidad: 3, peso_kg: 2 },
      { cantidad: 1, peso_kg: 0.5 },
    ])
    expect(b.peso_kg).toBe(6.5)
  })

  it('🛑 las DIMENSIONES no se suman: se toma el máximo por eje (cota inferior honesta)', () => {
    // Dos cajas de 30×20×10 no dan un bulto de 60×40×20: apilarlas solo crece en UN eje, y
    // cuál depende de cómo se armen. El máximo es lo mínimo que seguro mide.
    const b = sugerirBultoEnvio([
      { cantidad: 2, largo_cm: 30, ancho_cm: 20, alto_cm: 10 },
      { cantidad: 1, largo_cm: 15, ancho_cm: 40, alto_cm: 5 },
    ])
    expect(b.largo_cm).toBe(30)
    expect(b.ancho_cm).toBe(40)
    expect(b.alto_cm).toBe(10)
  })

  it('cuenta los ítems sin peso y sin medidas, para poder avisar que se queda corto', () => {
    const b = sugerirBultoEnvio([
      { cantidad: 1, peso_kg: 2, largo_cm: 10, ancho_cm: 10, alto_cm: 10 },
      { cantidad: 1 },
      { cantidad: 2, peso_kg: 1 },
    ])
    expect(b.sinPeso).toBe(1)
    expect(b.sinMedidas).toBe(2)
    expect(b.peso_kg).toBe(4)
  })

  it('sin ningún dato cargado devuelve null, no 0 — un 0 parecería un peso real', () => {
    const b = sugerirBultoEnvio([{ cantidad: 5 }, { cantidad: 2 }])
    expect(b.peso_kg).toBeNull()
    expect(b.largo_cm).toBeNull()
  })

  it('ignora líneas con cantidad 0 o negativa', () => {
    const b = sugerirBultoEnvio([{ cantidad: 0, peso_kg: 99 }, { cantidad: -1, peso_kg: 99 }, { cantidad: 1, peso_kg: 2 }])
    expect(b.peso_kg).toBe(2)
  })

  it('el `numeric` de Postgres llega como string y no debe romper la suma', () => {
    const b = sugerirBultoEnvio([{ cantidad: 2, peso_kg: '1.5' as any, largo_cm: '20' as any }])
    expect(b.peso_kg).toBe(3)
    expect(b.largo_cm).toBe(20)
  })

  it('sin ítems → todo null', () => {
    expect(sugerirBultoEnvio([]).peso_kg).toBeNull()
  })
})

describe('avisoBultoIncompleto', () => {
  it('todos los productos con datos → sin aviso', () => {
    const b = sugerirBultoEnvio([{ cantidad: 1, peso_kg: 1, largo_cm: 1, ancho_cm: 1, alto_cm: 1 }])
    expect(avisoBultoIncompleto(b)).toBeNull()
  })

  it('faltan algunos → avisa que el bulto real puede ser mayor', () => {
    const b = sugerirBultoEnvio([{ cantidad: 1, peso_kg: 1, largo_cm: 1 }, { cantidad: 1 }])
    expect(avisoBultoIncompleto(b)).toContain('puede ser mayor')
  })

  it('no hay ningún dato → dice que se complete a mano', () => {
    const b = sugerirBultoEnvio([{ cantidad: 1 }])
    expect(avisoBultoIncompleto(b)).toContain('a mano')
  })
})

describe('estadoCapacidadUbicacion', () => {
  it('sin capacidad configurada → no opina', () => {
    const c = estadoCapacidadUbicacion(null, 5, 1)
    expect(c.estado).toBe('sin_limite')
    expect(c.mensaje).toBeNull()
  })

  it('capacidad 0 se trata como "sin límite", no como "lleno"', () => {
    expect(estadoCapacidadUbicacion(0, 3).estado).toBe('sin_limite')
  })

  it('con lugar de sobra → ok y sin mensaje', () => {
    const c = estadoCapacidadUbicacion(4, 1, 1)
    expect(c.estado).toBe('ok')
    expect(c.restantes).toBe(2)
    expect(c.mensaje).toBeNull()
  })

  it('justo al tope → avisa que queda llena', () => {
    const c = estadoCapacidadUbicacion(4, 3, 1)
    expect(c.estado).toBe('lleno')
    expect(c.mensaje).toContain('4 de 4')
  })

  it('se pasa → avisa, pero el texto deja claro que NO bloquea', () => {
    const c = estadoCapacidadUbicacion(4, 4, 2)
    expect(c.estado).toBe('excedido')
    expect(c.restantes).toBe(-2)
    expect(c.mensaje).toContain('Se puede guardar igual')
  })

  it('la ocupación negativa no genera números raros', () => {
    expect(estadoCapacidadUbicacion(4, -3).ocupados).toBe(0)
  })

  it('el `numeric` string de Postgres se normaliza', () => {
    expect(estadoCapacidadUbicacion('4' as any, 4).estado).toBe('lleno')
  })
})

describe('etiquetaOcupacion', () => {
  it('con tope muestra "N de M"', () => {
    expect(etiquetaOcupacion(estadoCapacidadUbicacion(4, 3))).toBe('3 de 4')
  })
  it('sin tope muestra solo el ocupado', () => {
    expect(etiquetaOcupacion(estadoCapacidadUbicacion(null, 3))).toBe('3')
  })
})

describe('estadoCargaUbicacion', () => {
  it('sin peso máximo configurado → no opina', () => {
    expect(estadoCargaUbicacion(null, 300).estado).toBe('sin_limite')
  })

  it('con margen → ok y sin mensaje', () => {
    const c = estadoCargaUbicacion(500, 200, 4, 4)
    expect(c.estado).toBe('ok')
    expect(c.mensaje).toBeNull()
  })

  it('🛑 pasado del límite → avisa: sobrecargar un rack es seguridad física', () => {
    const c = estadoCargaUbicacion(500, 620, 4, 4)
    expect(c.estado).toBe('excedido')
    expect(c.mensaje).toContain('soporta 500 kg')
  })

  it('avisa ANTES del 100% (90%): con el peso subestimado, esperar al tope exacto puede no avisar nunca', () => {
    expect(estadoCargaUbicacion(500, 450, 4, 4).estado).toBe('lleno')
    expect(estadoCargaUbicacion(500, 449, 4, 4).estado).toBe('ok')
  })

  it('⚠ con pesos faltantes el total queda CORTO → devuelve cobertura y aviso', () => {
    const c = estadoCargaUbicacion(500, 200, 2, 5)
    expect(c.cobertura).toBe(40)
    expect(c.avisoCobertura).toContain('2 de 5')
    expect(c.avisoCobertura).toContain('el total real es mayor')
  })

  it('con todos los pesos cargados no hay aviso de cobertura', () => {
    expect(estadoCargaUbicacion(500, 200, 5, 5).avisoCobertura).toBeNull()
    expect(estadoCargaUbicacion(500, 200, 5, 5).cobertura).toBe(100)
  })

  it('ubicación vacía → cobertura 100, no 0 (no hay nada que le falte peso)', () => {
    expect(estadoCargaUbicacion(500, 0, 0, 0).cobertura).toBe(100)
  })

  it('el `numeric` string de Postgres se normaliza', () => {
    expect(estadoCargaUbicacion('500' as any, '620.5' as any, 1, 1).estado).toBe('excedido')
  })
})

describe('volumenUbicacionM3', () => {
  it('convierte cm³ a m³', () => {
    expect(volumenUbicacionM3(100, 100, 100)).toBe(1)
    expect(volumenUbicacionM3(120, 80, 150)).toBe(1.44)
  })

  it('si falta una dimensión no inventa un volumen', () => {
    expect(volumenUbicacionM3(120, 80, null)).toBeNull()
    expect(volumenUbicacionM3(120, 0, 150)).toBeNull()
    expect(volumenUbicacionM3(null, null, null)).toBeNull()
  })
})
