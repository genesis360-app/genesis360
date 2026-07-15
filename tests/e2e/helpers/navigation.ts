/**
 * Helpers de navegación y utilidades comunes para los tests E2E.
 */
import { Page, expect } from '@playwright/test'

/** Navega a una ruta y espera que el contenido principal cargue */
export async function goto(page: Page, path: string) {
  await page.goto(path)
  // Esperar que no haya spinner de carga
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
}

/** Espera que el layout esté listo. En páginas con sidebar espera el aside; en otras espera networkidle. */
export async function waitForApp(page: Page) {
  const aside = page.locator('aside').first()
  const hasAside = await aside.isVisible().catch(() => false)
  if (hasAside) {
    await expect(aside).toBeVisible({ timeout: 10000 })
  } else {
    // Páginas sin AppLayout (ej: /suscripcion): esperar que haya contenido visible
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
  }
}

/** Genera un string único para nombres de test (evita colisiones entre corridas) */
export function uniqueName(prefix: string) {
  return `${prefix}_test_${Date.now()}`
}

// ─── Detección de overflow horizontal (responsive / mobile) ──────────────────────────────
// El síntoma que reporta GO: en el celular "se sale contenido del marco". La señal dura es
// que la PÁGINA scrollea de costado (`scrollWidth > clientWidth`). Además juntamos la lista de
// elementos que se pasan del ancho del viewport para diagnóstico, IGNORANDO los que viven dentro
// de un contenedor con `overflow-x: auto|scroll|hidden` (scroll/clip intencional de tablas, chips,
// carruseles) — esos no rompen el layout de la página.

export interface OverflowOffender {
  tag: string
  id: string
  cls: string
  text: string
  right: number
  width: number
}

export interface OverflowReport {
  /** El contenido es más ancho que su marco (`scrollWidth > clientWidth`) → se corta/scrollea. */
  scrolls: boolean
  clientWidth: number
  scrollWidth: number
  /** Contenedor medido (tag + clases), para saber contra qué marco se comparó. */
  container: string
  /** Hasta 15 elementos que exceden el borde derecho del contenido, sin contar scroll intencional. */
  offenders: OverflowOffender[]
}

export interface OverflowOpts {
  /** Selector del contenedor a medir. Default: `<main>` (con fallbacks). Ej: `'header'`. */
  selector?: string
  tolerancePx?: number
}

/**
 * Mide el overflow horizontal en el viewport vigente. ⚠ NO mide el documento: el layout raíz
 * (`AppLayout`) tiene `overflow-hidden`, así que el overflow NO scrollea la página — se CLIPPEA
 * (el síntoma "se sale del marco" = contenido cortado). Por eso se mide dentro de un contenedor
 * (`<main>` por default; pasar `selector` para medir otro, p.ej. `'header'`). Se ignora el scroll
 * horizontal INTENCIONAL (ancestros con `overflow-x: auto|scroll` — tablas, tabs, chips), pero NO
 * el `overflow-hidden` (ese es el clip que enmascara el bug). `tolerancePx` absorbe redondeos.
 */
export async function detectarOverflowHorizontal(page: Page, opts: OverflowOpts = {}): Promise<OverflowReport> {
  const { selector, tolerancePx = 2 } = opts
  return await page.evaluate(({ tol, sel }) => {
    const container = sel
      ? ((document.querySelector(sel) as HTMLElement | null) ?? document.body)
      : ((document.querySelector('main') as HTMLElement | null) ||
         (document.querySelector('.flex-1.min-w-0') as HTMLElement | null) ||
         document.body)
    const cRect = container.getBoundingClientRect()
    const clientWidth = container.clientWidth
    const scrollWidth = container.scrollWidth
    const scrolls = scrollWidth > clientWidth + tol
    const rightBoundary = cRect.left + clientWidth

    // Scroll horizontal intencional (auto|scroll) = OK; overflow-hidden NO se ignora (es el clip).
    const ancestroScrollX = (el: Element): boolean => {
      let p = el.parentElement
      while (p && p !== container) {
        const ox = getComputedStyle(p).overflowX
        if (ox === 'auto' || ox === 'scroll') return true
        p = p.parentElement
      }
      return false
    }

    const offenders: OverflowOffender[] = []
    for (const el of Array.from(container.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      const st = getComputedStyle(el)
      if (st.visibility === 'hidden' || st.display === 'none' || st.opacity === '0') continue
      if (ancestroScrollX(el)) continue
      // Dos clases de ofensor: (1) el ELEMENTO se pasa del borde derecho del contenido;
      // (2) el elemento no se pasa pero su CONTENIDO desborda su caja (texto/número que no
      // encoge — no lo captura el rect porque el texto no es un elemento). El (2) solo cuenta
      // si el propio elemento NO es un scroller intencional (overflow-x visible).
      const rectOverflow = r.right > rightBoundary + tol
      const ownOx = st.overflowX
      const contentOverflow = ownOx === 'visible' && (el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth + tol
      if (!rectOverflow && !contentOverflow) continue
      const cn = typeof el.className === 'string' ? el.className : ''
      offenders.push({
        tag: el.tagName.toLowerCase(),
        id: (el as HTMLElement).id || '',
        cls: cn.slice(0, 90),
        text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 45),
        right: Math.round(rectOverflow ? r.right : rightBoundary + ((el as HTMLElement).scrollWidth - (el as HTMLElement).clientWidth)),
        width: Math.round(r.width),
      })
    }
    offenders.sort((a, b) => b.right - a.right)
    const ccn = typeof container.className === 'string' ? container.className : ''
    return {
      scrolls, clientWidth, scrollWidth,
      container: `${container.tagName.toLowerCase()}.${ccn.split(' ').slice(0, 2).join('.')}`,
      offenders: offenders.slice(0, 15),
    }
  }, { tol: tolerancePx, sel: selector ?? null })
}
