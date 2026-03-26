/**
 * 12_navegacion_sidebar.spec.ts
 * Valida que todos los links del sidebar navegan sin errores (smoke test).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const RUTAS = [
  { path: '/dashboard',      nombre: 'Dashboard' },
  { path: '/ventas',         nombre: 'Ventas' },
  { path: '/caja',           nombre: 'Caja' },
  { path: '/inventario',     nombre: 'Inventario' },
  { path: '/movimientos',    nombre: 'Movimientos' },
  { path: '/alertas',        nombre: 'Alertas' },
  { path: '/gastos',         nombre: 'Gastos' },
  { path: '/clientes',       nombre: 'Clientes' },
  { path: '/reportes',       nombre: 'Reportes' },
  { path: '/historial',      nombre: 'Historial' },
  { path: '/recomendaciones',nombre: 'Recomendaciones' },
  { path: '/suscripcion',    nombre: 'Suscripción' },
  { path: '/configuracion',  nombre: 'Configuración' },
]

test.describe('Smoke: todas las rutas responden', () => {
  for (const ruta of RUTAS) {
    test(`${ruta.nombre} (${ruta.path}) carga sin error 500`, async ({ page }) => {
      // Capturar errores de red graves
      const errores: string[] = []
      page.on('response', res => {
        if (res.status() >= 500) errores.push(`${res.status()} ${res.url()}`)
      })

      await goto(page, ruta.path)
      await waitForApp(page)

      // No debe redirigir a /login (estaría autenticado)
      await expect(page).not.toHaveURL(/login/)
      // No debe haber errores HTTP 500
      expect(errores).toHaveLength(0)
    })
  }
})
