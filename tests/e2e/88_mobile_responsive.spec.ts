/**
 * 88_mobile_responsive.spec.ts
 * Barrido responsive: recorre las pantallas principales en 2 viewports de celular y assertea que
 * la PÁGINA no scrollee horizontalmente (el síntoma que reportó GO: "se sale contenido del marco").
 * Cada ruta es un test independiente → una corrida devuelve la lista completa de ofensores por
 * pantalla (los que se pasan del ancho, ignorando el scroll intencional de tablas). Corre en el
 * project `chromium-mobile` (viewport de celular + sesión del owner).
 *
 * Este spec es DIAGNÓSTICO: los fixes CSS vienen después, en base a los ofensores que reporte.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp, detectarOverflowHorizontal } from './helpers/navigation'

const VIEWPORTS = [
  { label: 'iPhone SE', width: 375, height: 667 },
  { label: 'Android chico', width: 360, height: 640 },
]

// Pantallas principales navegables por el owner (rutas reales de App.tsx).
const RUTAS = [
  { path: '/dashboard', nombre: 'Dashboard' },
  { path: '/ventas', nombre: 'Ventas (POS)' },
  { path: '/caja', nombre: 'Caja' },
  { path: '/facturacion', nombre: 'Facturación' },
  { path: '/clientes', nombre: 'Clientes' },
  { path: '/productos', nombre: 'Productos' },
  { path: '/inventario', nombre: 'Inventario' },
  { path: '/gastos', nombre: 'Gastos' },
  { path: '/metricas', nombre: 'Métricas' },
  { path: '/configuracion', nombre: 'Configuración' },
]

test.describe('Mobile responsive — sin overflow horizontal', () => {
  for (const ruta of RUTAS) {
    test(`${ruta.nombre} (${ruta.path})`, async ({ page }) => {
      const fallas: string[] = []
      for (const vp of VIEWPORTS) {
        await page.setViewportSize({ width: vp.width, height: vp.height })
        await goto(page, ruta.path)
        await waitForApp(page)
        // Dar tiempo a que rendericen números/gráficos async (KPIs, charts).
        await page.waitForTimeout(600)

        const r = await detectarOverflowHorizontal(page)
        if (r.scrolls) {
          const detalle = r.offenders.slice(0, 6).map((o) =>
            `      · <${o.tag}${o.id ? '#' + o.id : ''}> "${o.text}" right=${o.right}px w=${o.width} cls="${o.cls}"`,
          ).join('\n')
          fallas.push(
            `  [${vp.label} ${vp.width}px] scrollWidth=${r.scrollWidth} > viewport=${r.clientWidth}\n` +
            (detalle || '      (sin ofensor puntual identificado — revisar layout general del contenedor)'),
          )
        }
      }
      if (fallas.length) {
        // Queda en el output de la corrida para armar la lista de fixes.
        console.log(`\n🔴 OVERFLOW — ${ruta.nombre} (${ruta.path}):\n${fallas.join('\n')}\n`)
      }
      expect(fallas, `Overflow horizontal en ${ruta.nombre} (${ruta.path}):\n${fallas.join('\n')}`).toHaveLength(0)
    })
  }
})
