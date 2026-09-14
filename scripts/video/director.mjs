// Director de grabación de los videos de onboarding: cursor visible, clicks registrados y marcas
// de escena.
//
// Playwright no dibuja el puntero: en el video la pantalla cambia sola y no se entiende dónde se
// hizo click. Este módulo resuelve las dos mitades del problema:
//
//   1. **En la página** (`prepararContexto`): inyecta un cursor dibujado que sigue al mouse, con un
//      anillo que se expande en cada click. Queda grabado en el crudo.
//   2. **En el guion** (`crearDirector`): cada click se anota como `{ t, x, y, tipo }` en el momento
//      en que ocurre, para que `postproducir.mjs` le ponga encima el sticker de historieta y la
//      sacudida. La posición sale del `boundingBox()` real, no de mirar una hoja de contacto
//      (así ya se corrieron rótulos 5 s una vez).
//
// Los stickers van en POST y no en la página a propósito: volver a grabar un video escribe datos de
// nuevo en PROD (otra venta, otra caja). En post, cambiar una palabra es re-renderizar.
//
// Uso:
//   const ctx = await chromium.launchPersistentContext('', { recordVideo: … })
//   await prepararContexto(ctx)
//   const page = await ctx.newPage()
//   const dir = crearDirector(page)        // ← justo después de newPage: ahí arranca el video
//   … login fuera de cámara …
//   dir.empezar()                          // el crudo se corta desde acá
//   await dir.click(page.getByRole('button', { name: 'Abrir caja' }), { tipo: 'abrir' })
//   dir.marca('venta')
//   writeFileSync('clicks.json', JSON.stringify(dir.datos()))
//
// Tipos de click (definen palabra, color y si sacude — ver `efectos.mjs`):
//   navegar · agregar · guardar · confirmar · cobrar · abrir · cerrar · menor (sin sticker)

/** Cursor dibujado dentro de la página. Se serializa y corre en el navegador: nada de closures. */
function cursorEnPagina() {
  if (window.__g360Cursor) return
  window.__g360Cursor = true

  const CSS = `
    #g360-cursor { position: fixed; left: 0; top: 0; width: 30px; height: 30px; z-index: 2147483647;
      pointer-events: none; transform: translate(-80px, -80px); will-change: transform }
    #g360-cursor svg { width: 30px; height: 30px; transform-origin: 3px 2px; transition: transform .12s ease-out;
      filter: drop-shadow(0 0 0 #0000) }
    #g360-cursor.abajo svg { transform: scale(.78) }
    .g360-anillo { position: fixed; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%;
      border: 3px solid #7B00FF; background: rgba(123, 0, 255, .18); pointer-events: none;
      z-index: 2147483646; animation: g360-anillo .55s ease-out forwards }
    @keyframes g360-anillo { from { transform: scale(.4); opacity: 1 } to { transform: scale(3.6); opacity: 0 } }`

  const ultima = () => { try { return JSON.parse(sessionStorage.getItem('g360-pos') || 'null') } catch { return null } }
  const mover = (el, x, y) => { el.style.transform = `translate(${x}px, ${y}px)` }

  const montar = () => {
    if (document.getElementById('g360-cursor')) return
    const estilo = document.createElement('style')
    estilo.textContent = CSS
    document.documentElement.appendChild(estilo)
    const c = document.createElement('div')
    c.id = 'g360-cursor'
    c.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 2 L3 19.5 L7.6 15.1 L10.7 21.8 L13.9 20.4 L10.8 13.8 L17.2 13.8 Z" ' +
      'fill="#fff" stroke="#111" stroke-width="1.7" stroke-linejoin="round"/></svg>'
    document.documentElement.appendChild(c)
    const p = ultima()
    if (p) mover(c, p.x, p.y)
  }

  addEventListener('mousemove', (e) => {
    const c = document.getElementById('g360-cursor')
    if (!c) return
    mover(c, e.clientX, e.clientY)
    try { sessionStorage.setItem('g360-pos', JSON.stringify({ x: e.clientX, y: e.clientY })) } catch { /* sin storage */ }
  }, true)
  addEventListener('mousedown', (e) => {
    document.getElementById('g360-cursor')?.classList.add('abajo')
    const a = document.createElement('div')
    a.className = 'g360-anillo'
    a.style.left = `${e.clientX}px`
    a.style.top = `${e.clientY}px`
    document.documentElement.appendChild(a)
    setTimeout(() => a.remove(), 700)
  }, true)
  addEventListener('mouseup', () => document.getElementById('g360-cursor')?.classList.remove('abajo'), true)

  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', montar)
  else montar()
}

export async function prepararContexto(ctx) {
  await ctx.addInitScript(cursorEnPagina)
}

const suave = (u) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2)

export function crearDirector(page) {
  const t0 = Date.now()          // el video de Playwright arranca al crear la página
  let corte = 0                  // segundos del crudo que se descartan (login fuera de cámara)
  let pos = { x: 640, y: 400 }
  const clicks = []
  const marcas = []
  const ahora = () => +((Date.now() - t0) / 1000 - corte).toFixed(2)

  // Movimiento con aceleración y frenado: una línea recta a velocidad constante se ve robótica.
  const mover = async (x, y, pasos = 20) => {
    const desde = pos
    for (let i = 1; i <= pasos; i++) {
      const u = suave(i / pasos)
      await page.mouse.move(desde.x + (x - desde.x) * u, desde.y + (y - desde.y) * u)
    }
    pos = { x, y }
  }

  return {
    /** A partir de acá empieza el video: el crudo se corta en este instante. */
    empezar() {
      corte = +((Date.now() - t0) / 1000).toFixed(2)
    },
    /** Marca con nombre para ubicar rótulos sin adivinar tiempos. */
    marca(nombre) {
      marcas.push({ nombre, t: ahora() })
    },
    mover,
    /**
     * Mueve el cursor al centro del elemento, espera un instante (para que se vea llegar) y hace
     * click ahí. Anota el click para los efectos de post.
     */
    async click(locator, { tipo = 'menor', palabra, pausa = 320 } = {}) {
      const el = locator.first()
      await el.scrollIntoViewIfNeeded()
      await page.waitForTimeout(150)
      const caja = await el.boundingBox()
      if (!caja) throw new Error('director.click: el elemento no tiene caja visible')
      const x = Math.round(caja.x + caja.width / 2)
      const y = Math.round(caja.y + caja.height / 2)
      await mover(x, y)
      await page.waitForTimeout(pausa)
      clicks.push({ t: ahora(), x, y, tipo, ...(palabra ? { palabra } : {}) })
      await page.mouse.click(x, y)
    },
    datos() {
      return { corte, clicks, marcas }
    },
  }
}
