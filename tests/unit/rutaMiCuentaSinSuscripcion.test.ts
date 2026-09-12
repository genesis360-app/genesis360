import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// 🔴 Regresión de producto CON ARISTA LEGAL (2026-09-12): `/mi-cuenta` estaba DENTRO del
// `SubscriptionGuard`, así que el dueño con la prueba vencida era redirigido a /suscripcion antes
// de poder abrirla — y ahí adentro viven sus tres únicas salidas: pagar, avisar un pago ya hecho y
// eliminar la cuenta. Quedaba atrapado: no podía usar la app ni irse (derecho de supresión, AAIP).
//
// Test estático sobre el árbol de rutas (mismo patrón que landingLinks.test.ts): el árbol de
// <Route> no se puede testear sin montar toda la app, pero el ORDEN en el archivo sí expresa el
// anidamiento — todo lo que está después de `<Route element={<SubscriptionGuard />}>` cuelga de él.

const app = readFileSync(resolve('src/App.tsx'), 'utf8')

const MARCA_GUARD = '<Route element={<SubscriptionGuard />}>'

describe('Rutas — la salida del usuario sin suscripción vigente', () => {
  const iGuard = app.indexOf(MARCA_GUARD)

  it('el SubscriptionGuard sigue existiendo y envuelve un solo bloque', () => {
    expect(iGuard, 'no se encontró el SubscriptionGuard en App.tsx').toBeGreaterThan(0)
    expect(app.split(MARCA_GUARD).length - 1).toBe(1)
  })

  it('/mi-cuenta queda FUERA del SubscriptionGuard', () => {
    const ocurrencias = [...app.matchAll(/path="\/mi-cuenta"/g)]
    expect(ocurrencias.length, '/mi-cuenta debe estar declarada una sola vez').toBe(1)
    expect(
      ocurrencias[0].index!,
      '/mi-cuenta volvió a quedar dentro del SubscriptionGuard: con el trial vencido el dueño no ' +
      'puede pagar ni darse de baja',
    ).toBeLessThan(iGuard)
  })

  it('el resto de la app SÍ sigue detrás del SubscriptionGuard', () => {
    // Control anti-vacío: sin esto, mover TODAS las rutas afuera también haría pasar el test de
    // arriba. Estas son las que tienen que quedar cerradas sin suscripción vigente.
    const cerradas = ['/dashboard', '/ventas', '/inventario', '/caja', '/facturacion']
    const filtradas = cerradas.filter(r => {
      const i = app.indexOf(`path="${r}"`)
      return i === -1 || i < iGuard
    })
    expect(filtradas, `rutas que quedaron accesibles sin suscripción: ${filtradas.join(', ')}`).toEqual([])
  })
})
