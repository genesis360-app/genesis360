/**
 * mpAddonFijo.test.ts — UAT MP-AD2/AD3/AD4/AD6/AD7 (REGLA #0, plata)
 * Fija el contrato del EF `mp-addon-fijo`: alta/baja de add-ons FIJOS con PUT delta sobre el
 * preapproval MP. Fail-closed en alta (PUT falla → no otorgar), revert si el insert falla tras
 * el PUT, precio SIEMPRE del catálogo, baja bloqueada por downgrade guiado.
 * Espejo: src/lib/mpAddonFijo.ts — si cambia el EF, actualizar espejo + estos tests.
 */
import { describe, test, expect } from 'vitest'
import { evaluarAltaAddonFijo, evaluarBajaAddonFijo } from '@/lib/mpAddonFijo'

// Base feliz: sub activa con preapproval, monto actual $60.000 (plan Básico), pack usuarios+1 $5.000.
const ALTA_OK = {
  subscriptionActiva: true,
  tienePreapproval: true,
  dimension: 'usuarios',
  cantidad: 1,
  montoActual: 60000,
  putOk: true,
  insertOk: true,
}

describe('evaluarAltaAddonFijo — alta fail-closed (MP-AD3)', () => {
  test('camino feliz: PUT + insert OK → otorgado con delta correcto (60000+5000)', () => {
    const r = evaluarAltaAddonFijo(ALTA_OK)
    expect(r).toEqual({ otorgado: true, nuevoMonto: 65000, revertirMontoEnMP: false, error: null })
  })

  test('el delta preserva el descuento: opera sobre el monto ACTUAL de MP, no el de lista', () => {
    // Plan con descuento ($50.000 en vez de $60.000): el add-on suma sobre lo que MP cobra HOY.
    const r = evaluarAltaAddonFijo({ ...ALTA_OK, montoActual: 50000 })
    expect(r.nuevoMonto).toBe(55000)
  })

  test('🛑 PUT a MP FALLA → NO se otorga, sin revert (el monto nunca cambió) — MP-AD3', () => {
    const r = evaluarAltaAddonFijo({ ...ALTA_OK, putOk: false, insertOk: false })
    expect(r.otorgado).toBe(false)
    expect(r.revertirMontoEnMP).toBe(false)
    expect(r.error).toBe('mp_put_fallo')
  })

  test('🛑 insert FALLA tras PUT exitoso → NO otorgado + REVERTIR el monto en MP — MP-AD4', () => {
    const r = evaluarAltaAddonFijo({ ...ALTA_OK, insertOk: false })
    expect(r.otorgado).toBe(false)
    expect(r.revertirMontoEnMP).toBe(true)     // sin esto el cliente paga $65.000 sin add-on
    expect(r.nuevoMonto).toBe(60000)           // el monto al que hay que VOLVER
    expect(r.error).toBe('insert_fallo')
  })

  test('sin suscripción activa (o sin mp_subscription_id) → rechazo temprano, nada se cobra', () => {
    expect(evaluarAltaAddonFijo({ ...ALTA_OK, subscriptionActiva: false }).error).toBe('sin_suscripcion_activa')
    expect(evaluarAltaAddonFijo({ ...ALTA_OK, tienePreapproval: false }).error).toBe('sin_suscripcion_activa')
  })

  test('monto actual inválido (GET de MP roto: 0 o NaN) → rechazo, no se opera a ciegas', () => {
    expect(evaluarAltaAddonFijo({ ...ALTA_OK, montoActual: 0 }).error).toBe('monto_invalido')
    expect(evaluarAltaAddonFijo({ ...ALTA_OK, montoActual: NaN }).error).toBe('monto_invalido')
  })

  test('🛑 pack fuera del catálogo → rechazo (precio NUNCA del cliente) — MP-AD2', () => {
    // cantidad inventada
    expect(evaluarAltaAddonFijo({ ...ALTA_OK, cantidad: 999999 }).error).toBe('pack_invalido')
    // dimensión inexistente
    expect(evaluarAltaAddonFijo({ ...ALTA_OK, dimension: 'gerentes' }).error).toBe('pack_invalido')
  })

  test('📋 MP-AD7 (documenta el race SIN guard server-side): dos altas concurrentes con la misma base → el monto final NO refleja los dos add-ons', () => {
    // Ambas requests leen montoActual=60000 ANTES de que la otra haga su PUT (read-then-write
    // sin lock). Cada una calcula su nuevoMonto desde la MISMA base:
    const a = evaluarAltaAddonFijo({ ...ALTA_OK, dimension: 'usuarios', cantidad: 1 })   // $5.000
    const b = evaluarAltaAddonFijo({ ...ALTA_OK, dimension: 'sucursales', cantidad: 1 }) // $15.000
    // El último PUT pisa al primero: MP queda cobrando el monto de b (75000), NO 60000+5000+15000.
    const montoFinalReal = b.nuevoMonto!            // last-write-wins
    const montoCorrecto = 60000 + 5000 + 15000
    expect(montoFinalReal).not.toBe(montoCorrecto)  // ← drift real: 2 add-ons otorgados, 1 cobrado
    expect(a.otorgado && b.otorgado).toBe(true)
    // Guard actual: SOLO `addonBusy` en el cliente (+ configurador oculto por ADDON_FIJO_ENABLED).
    // Si se agrega lock server-side (advisory lock / versión), actualizar este test.
  })
})

describe('evaluarBajaAddonFijo — baja con downgrade guiado (MP-AD5/AD6)', () => {
  // Base feliz: Básico $60k + add-on sucursales+1 $15k = $75.000; quitar el add-on.
  const BAJA_OK = {
    subscriptionActiva: true,
    tienePreapproval: true,
    addonEncontrado: true,
    addonTipo: 'fijo',
    dimension: 'sucursales',
    cantidad: 1,
    limiteEfectivo: 2,   // 1 base + 1 del add-on
    uso: 1,
    montoActual: 75000,
    putOk: true,
    deleteOk: true,
  }

  test('camino feliz: monto baja por delta (75000−15000) y se quita — MP-AD6', () => {
    const r = evaluarBajaAddonFijo(BAJA_OK)
    expect(r).toEqual({ quitado: true, nuevoMonto: 60000, blocked: null, error: null })
  })

  test('🛑 downgrade guiado: uso excede el límite SIN el add-on → blocked, NADA se toca — MP-AD5', () => {
    const r = evaluarBajaAddonFijo({ ...BAJA_OK, uso: 2 }) // usa las 2 sucursales
    expect(r.quitado).toBe(false)
    expect(r.error).toBeNull() // no es error de servidor: es la señal del downgrade guiado
    expect(r.blocked).toEqual({ excedente: 1, nuevoLimite: 1, uso: 2 })
    expect(r.nuevoMonto).toBeNull() // ni el monto de MP ni tenant_addons se tocan
  })

  test('límite ilimitado (-1) NO bloquea la baja', () => {
    const r = evaluarBajaAddonFijo({ ...BAJA_OK, limiteEfectivo: -1, uso: 999 })
    expect(r.quitado).toBe(true)
  })

  test('dimensión sin guard de estado (movimientos, límite null) NO bloquea la baja', () => {
    const r = evaluarBajaAddonFijo({
      ...BAJA_OK, dimension: 'movimientos', cantidad: 1000, limiteEfectivo: null, uso: 99999,
      montoActual: 65000,
    })
    expect(r.quitado).toBe(true)
    expect(r.nuevoMonto).toBe(60000) // pack movimientos 1000 = $5.000
  })

  test('🛑 PUT a MP FALLA → NO se quita el add-on (el monto no bajó) — fail-closed', () => {
    const r = evaluarBajaAddonFijo({ ...BAJA_OK, putOk: false, deleteOk: false })
    expect(r.quitado).toBe(false)
    expect(r.error).toBe('mp_put_fallo')
  })

  test('delete FALLA tras PUT exitoso → drift favorable al cliente, reportar a soporte', () => {
    const r = evaluarBajaAddonFijo({ ...BAJA_OK, deleteOk: false })
    expect(r.quitado).toBe(false)
    expect(r.error).toBe('delete_fallo')
    expect(r.nuevoMonto).toBe(60000) // MP ya cobra menos; la fila quedó → conciliar (DRIFT 4)
  })

  test('add-on inexistente o no-fijo → 404, nada se toca', () => {
    expect(evaluarBajaAddonFijo({ ...BAJA_OK, addonEncontrado: false }).error).toBe('addon_no_encontrado')
    expect(evaluarBajaAddonFijo({ ...BAJA_OK, addonTipo: 'temporal' }).error).toBe('addon_no_encontrado')
  })

  test('monto nunca queda negativo (Math.max(0, …))', () => {
    const r = evaluarBajaAddonFijo({ ...BAJA_OK, montoActual: 10000 }) // menor que el pack $15.000
    expect(r.nuevoMonto).toBe(0)
  })

  test('pack ya no está en el catálogo (cambió el pricing) → se quita SIN bajar el monto (precio 0)', () => {
    // Con guard de estado, una cantidad huérfana además achica el límite de más (nuevoLimite
    // negativo → blocked); el caso "se quita con precio 0" solo se alcanza sin guard que bloquee:
    const r = evaluarBajaAddonFijo({ ...BAJA_OK, cantidad: 7, limiteEfectivo: -1 }) // sucursales+7 no existe
    // ⚠ comportamiento actual del EF (`pack?.precio ?? 0`): favorable a la plataforma, el
    // cliente sigue pagando el monto viejo — si se cambia el catálogo con add-ons vivos, migrar.
    expect(r.quitado).toBe(true)
    expect(r.nuevoMonto).toBe(75000)
  })

  test('cantidad huérfana CON guard de estado → blocked (nuevoLimite queda negativo)', () => {
    const r = evaluarBajaAddonFijo({ ...BAJA_OK, cantidad: 7 })
    expect(r.quitado).toBe(false)
    expect(r.blocked).not.toBeNull()
  })
})
