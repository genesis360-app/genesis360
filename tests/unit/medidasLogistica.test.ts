import { describe, it, expect } from 'vitest'
import {
  sugerirBultoEnvio, avisoBultoIncompleto, estadoCapacidadUbicacion, etiquetaOcupacion,
  estadoCargaUbicacion, volumenUbicacionM3, capacidadUtilM3, estadoVolumenUbicacion,
  volumenDeCantidadM3, FACTOR_APROVECHAMIENTO_DEFAULT, ubicacionSinLugar,
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

// ── Cubicaje volumétrico (mig 322 + fix 325) ────────────────────────────────────────────

describe('capacidadUtilM3', () => {
  it('aplica el factor de aprovechamiento: ninguna posición real se llena al 100% geométrico', () => {
    expect(capacidadUtilM3(1.44, 0.7)).toBe(1.008)
  })

  it('sin factor configurado usa el default 0.70', () => {
    expect(capacidadUtilM3(1, null)).toBe(FACTOR_APROVECHAMIENTO_DEFAULT)
    expect(capacidadUtilM3(1, undefined)).toBe(0.7)
  })

  it('🛑 un factor inválido cae al default, no a 0: con 0 toda ubicación diría "excedido"', () => {
    expect(capacidadUtilM3(1, 0)).toBe(0.7)
    expect(capacidadUtilM3(1, -0.5)).toBe(0.7)
    expect(capacidadUtilM3(1, 1.5)).toBe(0.7)
  })

  it('el `numeric` string de Postgres se normaliza', () => {
    expect(capacidadUtilM3('2.00' as any, '0.50' as any)).toBe(1)
  })

  it('sin dimensiones de la ubicación no hay capacidad que comparar', () => {
    expect(capacidadUtilM3(null, 0.7)).toBeNull()
    expect(capacidadUtilM3(0, 0.7)).toBeNull()
  })
})

describe('estadoVolumenUbicacion', () => {
  it('sin capacidad medida no opina', () => {
    const v = estadoVolumenUbicacion(null, 5, 3, 3)
    expect(v.estado).toBe('sin_limite')
    expect(v.mensaje).toBeNull()
  })

  it('marca excedido cuando lo guardado pasa la capacidad útil', () => {
    const v = estadoVolumenUbicacion(1, 1.2, 4, 4)
    expect(v.estado).toBe('excedido')
    expect(v.mensaje).toContain('1.2')
  })

  it('avisa al 90%, igual que el peso: con el volumen subestimado el 100% puede no llegar nunca', () => {
    expect(estadoVolumenUbicacion(1, 0.9, 4, 4).estado).toBe('lleno')
    expect(estadoVolumenUbicacion(1, 0.89, 4, 4).estado).toBe('ok')
  })

  it('⚠ con presentaciones sin medir el volumen queda CORTO → cobertura + aviso', () => {
    const v = estadoVolumenUbicacion(1, 0.4, 2, 5)
    expect(v.cobertura).toBe(40)
    expect(v.avisoCobertura).toContain('2 de 5')
    expect(v.avisoCobertura).toContain('el volumen real es mayor')
  })

  it('con todo medido no hay aviso de cobertura', () => {
    expect(estadoVolumenUbicacion(1, 0.4, 5, 5).avisoCobertura).toBeNull()
  })

  it('suma lo que está por entrar antes de decidir (aviso previo al ingreso)', () => {
    expect(estadoVolumenUbicacion(1, 0.5, 2, 2).estado).toBe('ok')
    expect(estadoVolumenUbicacion(1, 0.5, 2, 2, 0.6).estado).toBe('excedido')
  })

  it('el `numeric` string de Postgres se normaliza', () => {
    expect(estadoVolumenUbicacion('1.00' as any, '1.50' as any, 1, 1).estado).toBe('excedido')
  })
})

describe('volumenDeCantidadM3', () => {
  it('3 cajas ocupan 3 × el volumen de la CAJA, no 36 × el de la unidad suelta', () => {
    // Caja de 40×30×20 cm = 0.024 m³
    expect(volumenDeCantidadM3(3, 20, 30, 40)).toBe(0.072)
  })

  it('sin medidas devuelve null (= "no sé"), que no es lo mismo que 0', () => {
    expect(volumenDeCantidadM3(3, null, 30, 40)).toBeNull()
    expect(volumenDeCantidadM3(0, 20, 30, 40)).toBeNull()
  })
})

describe('ubicacionSinLugar (espejo de fn_wms_elegir_ubicacion_picking, mig 326)', () => {
  const topes = { capacidad_pallets: 4, peso_max_kg: 500, alto_cm: 100, ancho_cm: 100, largo_cm: 100 }

  it('🛑 sin capacidad configurada NO está llena: un tope vacío es "no sé", no "lleno"', () => {
    expect(ubicacionSinLugar({}, { lpn_activos: 999, peso_kg: 9999, volumen_m3: 999 })).toBe(false)
    expect(ubicacionSinLugar(null, { lpn_activos: 999 })).toBe(false)
    expect(ubicacionSinLugar({ capacidad_pallets: 0, peso_max_kg: 0 }, { lpn_activos: 50 })).toBe(false)
  })

  it('llena por LPN al ALCANZAR el tope, no al pasarlo', () => {
    expect(ubicacionSinLugar(topes, { lpn_activos: 3 })).toBe(false)
    expect(ubicacionSinLugar(topes, { lpn_activos: 4 })).toBe(true)
    expect(ubicacionSinLugar(topes, { lpn_activos: 5 })).toBe(true)
  })

  it('llena por peso', () => {
    expect(ubicacionSinLugar(topes, { lpn_activos: 1, peso_kg: 499 })).toBe(false)
    expect(ubicacionSinLugar(topes, { lpn_activos: 1, peso_kg: 500 })).toBe(true)
  })

  it('🛑 el volumen NO cuenta si el cubicaje está apagado', () => {
    const lleno = { lpn_activos: 1, peso_kg: 1, volumen_m3: 999 }
    expect(ubicacionSinLugar(topes, lleno)).toBe(false)
    expect(ubicacionSinLugar(topes, lleno, { habilitado: false, factor: 0.7 })).toBe(false)
    expect(ubicacionSinLugar(topes, lleno, { habilitado: true, factor: 0.7 })).toBe(true)
  })

  it('🛑 con el cubicaje activo pero la ubicación SIN MEDIR tampoco está llena (capacidad útil desconocida ≠ 0)', () => {
    const sinMedidas = { capacidad_pallets: 4, peso_max_kg: 500 }
    expect(ubicacionSinLugar(sinMedidas, { volumen_m3: 999 }, { habilitado: true, factor: 0.7 })).toBe(false)
  })

  it('el volumen se compara contra la capacidad ÚTIL (geométrico × factor), no la geométrica', () => {
    // 1 m³ geométrico × 0.7 = 0.7 m³ útiles
    const cub = { habilitado: true, factor: 0.7 }
    expect(ubicacionSinLugar(topes, { volumen_m3: 0.69 }, cub)).toBe(false)
    expect(ubicacionSinLugar(topes, { volumen_m3: 0.70 }, cub)).toBe(true)
    // Con un factor más generoso, lo mismo entra.
    expect(ubicacionSinLugar(topes, { volumen_m3: 0.70 }, { habilitado: true, factor: 0.95 })).toBe(false)
  })

  it('una ubicación vacía nunca está llena', () => {
    expect(ubicacionSinLugar(topes, null, { habilitado: true, factor: 0.7 })).toBe(false)
    expect(ubicacionSinLugar(topes, { lpn_activos: 0, peso_kg: 0, volumen_m3: 0 })).toBe(false)
  })

  it('el `numeric` string de Postgres se normaliza', () => {
    expect(ubicacionSinLugar({ peso_max_kg: '500' as any }, { peso_kg: '512.5' as any })).toBe(true)
  })
})
