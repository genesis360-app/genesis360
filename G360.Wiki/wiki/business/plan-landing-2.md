---
title: Plan de implementación — Landing 2.0 (docs de Fede)
category: business
tags: [landing, marketing, seo, geo, nichos, diseño, plan]
sources: [Drive 1YeQWbLVSLXs--JKD8daiR4uOv_cUtAwb (00-04, Fede, 2026-09-05), src/pages/LandingPage.tsx, planes-pricing.md]
updated: 2026-10-06
---

# Plan de implementación — Landing 2.0

> Pedido de GO (2026-10-06): mejorar la landing siguiendo los **5 documentos de Fede** de la carpeta de Drive
> `1YeQWbLVSLXs--JKD8daiR4uOv_cUtAwb` (`00` Estrategia y Narrativa · `01` Estructura y Copy · `02` Especificación Visual ·
> `03` SEO y GEO · `04` Subpáginas por Nicho), aplicando las skills **design-taste-frontend** (Taste), **emil-design-eng**
> (Emil Kowalski) e **impeccable**. Este plan se armó leyendo los 5 documentos completos y cruzándolos con la landing
> actual. **Nada se toca hasta que GO responda las decisiones de la sección 2.**

## 1. Diagnóstico de la landing actual (`src/pages/LandingPage.tsx`, 473 líneas, en PROD v1.239.0)

| Hoy | Lo que piden los docs | Brecha |
|---|---|---|
| Hero nuevo "Vendé, cobrá y sabé qué te queda" (aprobado por GO, PROD 06/10) con captura del POS + ticket | Titular "El sistema operativo para tu negocio…", subtítulo con la IA, imagen = **Dashboard con una recomendación de IA** escribiéndose | Mensaje y foco visual distintos (IA vs venta) |
| Secciones: nav · hero · tipos de comercio · features · screenshot · **testimonios** · precios · FAQ · CTA · footer | 12 secciones: hero · problema · solución · módulos · **IA (sección propia)** · por qué G360 · escalabilidad · precios · nichos · confianza · FAQ · CTA | Faltan problema, IA, comparativa, escalabilidad, nichos, confianza honesta |
| 🛑 **3 testimonios INVENTADOS** ("Carlos M., Ferretería El Tornillo", "Laura P.", "Martín R.", 5 estrellas) | Doc 00 §7: no inventar testimonios (Ley 24.240, publicidad engañosa); slot preparado y oculto hasta el primero real | **Riesgo legal hoy en PROD** |
| SPA de Vite: el HTML que recibe un buscador/IA es casi vacío; `<title>Genesis360</title>`, sin meta description, sin `robots.txt`, sin `sitemap.xml`, sin schema | Doc 03: SSR/SSG (no negociable), robots que no bloquee GPTBot/ClaudeBot/etc., schema básico, velocidad | Base técnica SEO/GEO inexistente |
| Prueba **15 días** (Pricing v7) | Docs: **30 días** | Inconsistencia a decidir |
| Sin sub-páginas por rubro | `/para/construccion` (profunda) + resto | Todo por hacer |

## 2. Decisiones que necesito de GO antes de empezar

1. **P0 — Testimonios inventados en PROD:** ¿los saco YA (hotfix chico, independiente de todo lo demás)? Recomiendo sí.
2. **Prueba gratis: 15 días (lo real hoy, Pricing v7) o 30 (lo que dicen los docs)?** La landing no puede prometer algo
   distinto de lo que da la app.
3. **Hero:** ¿mantener el actual (aprobado 06/10) y sumarle el mensaje de IA, o pasar al titular de Fede ("El sistema
   operativo para tu negocio…") con el Dashboard + IA como imagen? Recomiendo el de Fede para el mensaje, conservando el
   trabajo visual del hero actual (layout asimétrico, tipografía, captura real).
4. **Tema:** doc 02 pide base OSCURA (violeta casi negro); el hero actual es claro. Opciones: (a) oscuro como pide el doc,
   (b) claro con secciones oscuras alternadas (IA y CTA final oscuras). Recomiendo (b): más legible para capturas de la app
   (que es clara) y conserva lo aprobado.
5. **🛑 WhatsApp IA:** doc 00 §6 pide presentarlo "con toda la confianza, sin 'próximamente'". Hoy el asistente de
   WhatsApp **está pendiente del App Review de Meta**. Si un cliente no puede usarlo, anunciarlo como disponible es
   publicidad engañosa (la misma Ley 24.240 que el doc 00 cita). ¿Ya está disponible para clientes? Si no: se muestra con
   "en lanzamiento" o se deja para cuando esté.
6. **Arquitectura SEO (doc 03):** (a) **pre-renderizar** las páginas públicas en el mismo repo (Vite + prerender/SSG: `/`,
   `/para/<rubro>`), o (b) proyecto aparte (Astro/Next) en `genesis360.pro`. Recomiendo (a): reusa componentes y marca,
   un solo deploy, cumple "rastreable sin JavaScript". Fede deja la decisión técnica en manos de GO.
7. **Programa "primeros socios" (doc 00 §7):** ¿condiciones? (descuento, precio congelado, cupos, plazo).
8. **Sección equipo fundador:** ¿qué se publica? (nombres, fotos, experiencia WMS/growth).
9. **Comparativa "por qué Genesis360" (doc 01 §6):** ¿contra qué competidores y con qué datos? La wiki tiene
   [[wiki/business/planes-pricing]] (Xubio, Contabilium, Netegia…) — confirmar que siguen vigentes.
10. **Nichos además de Construcción:** ¿supermercados, distribuidoras, dietéticas, indumentaria…? ¿cuáles en la 1ª tanda?

### ✅ Respuestas de GO (2026-10-06)

| # | Decisión | Qué implica |
|---|---|---|
| 1 | **Sí**, sacar los testimonios inventados | ✅ HECHO en v1.239.2 (slot oculto hasta el primer testimonio real; e2e 186) |
| 2 | **30 días** de prueba | ✅ HECHO en v1.239.3 (mig 476: default de `trial_ends_at` = 30 días para altas nuevas; las pruebas en curso conservan su fecha) + todos los textos (landing, alta, planes) |
| 3 | **Hero actual** | Se conserva "Vendé, cobrá y sabé qué te queda"; el mensaje de IA va en su propia sección |
| 4 | **Claro con secciones oscuras** | Base clara; IA y CTA final (y quizás "Problema") en oscuro |
| 5 | WhatsApp | ✅ Confirmado por GO: **no se menciona** hasta que Meta lo apruebe |
| 6 | **En este proyecto** | Pre-render de las rutas públicas en el mismo repo (Fase 1) |
| 7 | Primeros socios | **Pendiente** — GO pasa las condiciones después |
| 8 | Equipo: **Gastón Otranto y Federico Messina**, con fotos | Faltan las fotos (las pasa GO en breve) |
| 9 | **Sin comparativa** | Se elimina la sección 6 del doc 01 |
| 10 | **Todos los rubros, cualquier pyme** | Landing general para cualquier pyme; sub-páginas por rubro (Construcción primero) |

## 3. Dirección de diseño (las 3 skills aplicadas)

- **Design read (Taste §0.B):** *landing de SaaS (modo Persuade de impeccable) para dueños de negocios argentinos que venden
  productos físicos, de chicos a grandes; lenguaje directo y confiable, ambicioso pero concreto; se apoya en la marca ya
  implementada (violeta→cian, Geist) y en capturas reales del producto.*
- **Dials (Taste §1):** VARIANCE 6 · MOTION 5 · DENSITY 4 — landing SaaS con componente de confianza (comercio, plata,
  AFIP): asimetría sí, efectos llamativos no.
- **Marca:** tokens reales de la app (doc 02 lo pide explícito): gradiente `brand-gradient` violeta→cian para CTA, cian para
  checks/beneficios, Geist ya self-hosted. Un solo acento por sección (Taste §4.2); nada de violeta "AI glow" genérico.
- **impeccable (craft floor):** sin eyebrow/kicker sobre los títulos; la grilla de módulos NO como 8 tarjetas iguales de
  ícono+texto (el patrón más trillado): bento asimétrico con **capturas reales** (doc 01 §4), 2-3 piezas grandes y el resto
  compactas; contraste ≥ 4,5:1; estados de foco/hover; tabular-nums en precios; selección y caret con color de marca.
- **Movimiento (Emil):**
  - Hero: la recomendación de IA "se escribe" **una vez** (1-2 s, `steps`/clip-path), no en loop infinito (doc 02 dice loop
    suave: proponer loop largo con pausa ≥ 6 s o una sola vez; decidir viéndolo).
  - Módulos: fade + translateY(8px) escalonado 40-60 ms, `cubic-bezier(0.23,1,0.32,1)`, 300-400 ms (marketing permite más
    que UI), con `IntersectionObserver` y `once`.
  - WhatsApp: mensajes que aparecen en secuencia con indicador "escribiendo…" — la pieza a pulir más (doc 02).
  - Escalabilidad: progreso en la línea de tiempo con **scroll-driven animations de CSS** (sin JS pesado).
  - CTA: `:active scale(.97)` + brillo sutil en hover. Todo con `prefers-reduced-motion` (estado final sin animar).
  - Solo `transform`/`opacity`/`clip-path` (Lighthouse/LCP del doc 03).
- **Mobile primero** para IA/WhatsApp (doc 02 §5): la demo de WhatsApp se ve dentro de un marco de celular.

## 4. Fases

### Fase 0 — Hotfix legal (si GO dice sí): sacar los testimonios inventados
Reemplazar la sección por el slot oculto (doc 01 §10) — sin contenido hasta el primer cliente real. 1 commit, deploy chico.

### Fase 1 — Base técnica SEO/GEO (doc 03) — invisible pero primero
1. Pre-render de las rutas públicas (decisión 6) → HTML completo sin JS. Verificar con `curl` que el texto del hero está en
   la respuesta.
2. `public/robots.txt` permitiendo buscadores y GPTBot, ClaudeBot, Google-Extended, PerplexityBot; bloquear `/app` interno.
3. `sitemap.xml` generado con las rutas públicas.
4. `<title>`, meta description, canonical y Open Graph por página (hoy solo "Genesis360").
5. Schema.org JSON-LD: Organization, SoftwareApplication (con offers del pricing real), FAQPage.
6. Presupuesto de performance: LCP < 2,5 s en 4G, imágenes AVIF/WebP con `srcset`, fuentes `preload` (subset latin),
   cero JS de animación en el camino crítico. Medir con Lighthouse antes/después.
7. Terminología única (doc 03 §5): glosario corto (presupuesto, comprobante, cuenta corriente…) y aplicarlo.

### Fase 2 — Landing principal, 12 secciones (docs 00, 01, 02)
Hero → Problema → Solución (video 15-20 s) → Módulos (bento) → **IA** (sección propia, 3 sub-bloques) → Por qué G360
(comparativa) → Escalabilidad ("Empezá simple. Crecé sin límites.", línea de tiempo) → Precios (datos reales de
`src/config/brand.ts`/planes) → Para tu rubro → Confianza (equipo + primeros socios; slots ocultos de logos/testimonios) →
FAQ (formato pregunta→respuesta citable, doc 03 §5) → CTA final. Copy de Fede como base, ajustado a lo REAL del producto
(nunca prometer algo que la app no hace).

**Assets a producir (con el pipeline de video/capturas que ya tenemos, negocio demo "Almacén La Esquina" en DEV o el
tenant de onboarding en PROD):** captura del Dashboard con un insight real (`InsightCard`), video 15-20 s
venta→stock→alerta (`scripts/video/`), 6-8 capturas de módulos, mock de WhatsApp (componente propio, no imagen),
línea de tiempo. Nada de fotos de stock.

### Fase 3 — Sub-página Construcción (`/para/construccion`, doc 04)
Hero específico, problema con vocabulario del rubro (materiales con medidas/colores → variantes; precio mayorista para
maestros/contratistas → tiers; entrega a obra → envíos), "un día típico en tu ferretería" (sin cliente inventado), CTA.
Investigación de palabras clave real antes de escribir (ferretería, corralón, sanitarios, pinturería, "facturación AFIP para
ferretería"). URL propia, contenido único, en el sitemap.

### Fase 4 — Resto de nichos (decisión 10)
Misma estructura, contenido propio por rubro (nunca la misma página con el nombre cambiado — doc 04 §4).

### Fase 5 — Medición y autoridad
Eventos de conversión (CTA hero, registro iniciado/completado), Search Console + Bing, monitorear Lighthouse. Lo de
autoridad (doc 03 §4: Capterra/G2, prensa, reseñas) queda listado para cuando haya clientes — no es código.

## 5. Cómo se trabaja (reglas)

- **Propuesta antes de tocar** (como con el hero): por cada fase, captura/maqueta en DEV local y OK de GO.
- Cada fase: typecheck + build + Lighthouse + capturas desktop/mobile/oscuro (ronda acotada de impeccable).
- e2e mínimo de la landing: hero visible, CTA lleva a `/onboarding`, sin testimonios inventados, HTML pre-renderizado con
  el titular.
- Nada que la app no haga se anuncia como disponible (Ley 24.240; ver decisión 5).

## 6. Estado al 2026-10-06 — Fase 2 hecha en local, aprobada por GO, SIN commitear

GO la vio en `localhost:5173` y la aprobó tal como está ("me gustó esta como está"). Todavía no está commiteada ni en PROD.

**Qué se hizo:** las 12 secciones de los docs 00-02, con el hero de PROD sin tocar (decisión 3). Nuevos:
`src/components/landing/LandingSecciones.tsx` (Problema, Solución, Módulos, IA, Escalabilidad, Rubros, Fundadores),
`src/components/landing/useRevelar.ts` (revelado al entrar en pantalla, una sola vez; sin JS todo queda visible),
`src/styles/landing.css`, fotos `public/landing/fundadores/{gaston-otranto,federico-messina}.webp` (720 px, 4:5). Cambiado:
`src/pages/LandingPage.tsx` (nav con Funciones / Inteligencia artificial / Precios / Preguntas, precios con 3 columnas, FAQ
nueva en formato pregunta → respuesta, CTA final = mensaje del hero). Verificado: typecheck, lint, e2e 186 2/2, capturas en
1440 px y 390 px sin desborde horizontal.

**Decisiones tomadas al construirla:**
- La "IA" que se muestra es SOLO la que existe hoy: Motor de Recomendaciones (`useRecomendaciones`, por reglas), Asistente IA
  del encabezado (Groq; explica y propone cambios de configuración que el usuario confirma) y Alertas. Los textos de ejemplo
  calcan los títulos reales del motor ("N productos con menos de 3 días de stock", "margen menor al 15%"…).
- WhatsApp aparece solo como herramienta suelta del "problema", nunca como función (decisión 5).
- El cartel "MÁS POPULAR" del plan Pro pasó a **"Recomendado"**: sin clientes, "el más elegido" sería un dato inventado.
- Fundadores: solo nombre + "Fundador" (GO: "después vemos si ponemos más texto de cada uno").

**Respaldo de la landing anterior:** tag de git `landing-v1-respaldo` (apunta a `main` con la landing vieja, publicado en
GitHub). Restaurar: `git checkout landing-v1-respaldo -- src/pages/LandingPage.tsx` (y borrar `src/components/landing/` y
`src/styles/landing.css` si ya no se usan). GO confirma más adelante si se elimina del todo.

**Pendientes que quedaron (para GO):**
1. 🛑 **El plan Enterprise lista "Agente de WhatsApp"** (`PLANES` en `src/config/brand.ts`, ya en PROD, se ve en la tabla de
   precios de la landing y en Suscripción). Contradice la decisión 5. No se tocó: espera OK de GO para sacarlo o
   reformularlo.
2. **Las "pantallas" son piezas dibujadas en código con datos de demo**, no capturas. Las capturas de DEV (Almacén Jorgito)
   no sirven: datos de prueba ("Cliente Test 1", "PortalAplicar 178…", ganancia negativa). Para reemplazarlas por capturas
   reales (doc 02 §2) hace falta un negocio demo prolijo.
3. **Sin `PRODUCT.md` de impeccable**: se salteó la entrevista de `/impeccable init`; la fuente fueron los docs 00-04 y las
   10 decisiones. Ofrecer `/impeccable init` si se quiere dejarlo formalizado.
4. **Rubros sin link**: las sub-páginas son Fase 3 (`/para/construccion` primero). **Primeros socios** afuera hasta que GO pase
   las condiciones (decisión 7). **Sin video** de la sección Solución (se reemplazó por la animación venta → stock → aviso).
5. Aviso preexistente en consola: React no reconoce `fetchPriority` en el `<img>` del hero (React 18). Inofensivo.
6. **Fase 1 (SEO/GEO)** sin empezar: hoy un buscador recibe el HTML casi vacío de la SPA.

## 7. Fase 1 (SEO/GEO) y Fase 3 (Construcción) — hechas en local el 2026-10-06, SIN commitear

GO: "antes de subir a PRD arrancá con las fases de la landing". También sacó "Agente de WhatsApp" del plan Enterprise
(`src/config/brand.ts`, comentado para volver a listarlo cuando Meta apruebe la app).

**Fase 1 — pre-render sin cambiar de framework** (decisión 6):
- `npm run build` = `tsc && vite build && node scripts/prerender.mjs`. El script renderiza las páginas públicas con
  `src/entry-prerender.tsx` (build SSR de Vite, sin el plugin PWA) y escribe `dist/index.html`, `dist/para/construccion/`,
  `dist/terminos|privacidad|cookies/` con título, descripción, canonical, Open Graph (`public/og-genesis360.jpg`, captura del
  hero 1200×630) y JSON-LD (Organization + SoftwareApplication con los precios reales + FAQPage; Construcción:
  BreadcrumbList + FAQPage). También genera `sitemap.xml`. `public/robots.txt` deja entrar a buscadores y bots de IA.
- 🛑 **Cambio de infraestructura:** el armazón de la SPA pasa a `dist/app.html` (con `noindex`). `vercel.json` reescribe todo a
  `/app.html` y fija `buildCommand: npm run build` (si Vercel corriera solo `vite build`, no existiría `app.html` y la app no
  cargaría). El service worker usa `/app.html` como fallback de navegación (`vite.config.ts`: `navigateFallback`,
  `globIgnores: ['index.html']`, `additionalManifestEntries` con revisión por build).
- **Hidratación, no reemplazo:** `src/lib/hidratarPublica.tsx` hidrata solo la página pública en `#prerender` (mismo árbol que
  el pre-render: router + página). App se monta aparte en `#root`, escondida (`#prerender + #root {display:none}`), y no
  redibuja esa ruta mientras exista `#prerender` (`SinPrerender` en `App.tsx`). Al salir de la página pública (Link) primero
  se saca `#prerender` y después se avisa a App con un `popstate` (`SalidaHaciaApp`). Con sesión iniciada o en
  `app.genesis360.pro`, App la saca (`quitarPrerender`). Se probó: sin JS, con JS, FAQ, CTA → onboarding → atrás, home →
  Construcción → atrás, Construcción → Términos, usuario logueado en `/` → Panel, 0 errores de hidratación.
- Por qué no se hidrata App: muestra un spinner mientras valida la sesión, su primer render nunca coincide con el HTML.
- Performance: el CSS de cada página se enlaza en el `<head>` (manifest de Vite), precarga de la imagen del hero (ahora WebP,
  −53 %) y de Geist; Inter de Google Fonts no bloquea en las páginas públicas; zoom permitido en las páginas públicas (la app
  sigue con `maximum-scale=1`); el titular del hero entra sin fundido (Chrome no cuenta un elemento en opacidad 0 como LCP).
- **Lighthouse (build local con gzip):** celular rendimiento 55 → 65, LCP 10,1 s → 4,0-4,8 s, accesibilidad 89 → 95, SEO 100;
  escritorio rendimiento 97-99, LCP 1,1 s. Lo que queda en celular es el JavaScript principal de la app (~700 KB, TBT ~500 ms)
  y el Meta Pixel (~400 ms de CPU). Opciones NO aplicadas (decisión de GO): diferir el Pixel hasta `load` (afecta el
  seguimiento de marketing) o separar App del bundle de entrada (afecta el arranque de toda la app).
- Test: `tests/unit/prerender.test.tsx` (6): rutas = `RUTAS_PRERENDER`, contenido real sin JS, títulos/descripciones únicos,
  JSON-LD válido y FAQ = la de la página, Construcción con su contenido propio, sin "agente de WhatsApp".

**Fase 3 — `/para/construccion`** (`src/pages/ParaConstruccionPage.tsx`, doc 04): hero "El sistema de gestión para ferreterías
y corralones" con una pieza dibujada (caño PVC en 4 diámetros, stock y precio mostrador/contratista), el problema en el idioma
del rubro, 8 soluciones (todas verificadas en la app: variantes madre/hijo, unidades Metro/Kilogramo del preset Ferretería,
presentaciones con precio, categorías de clientes + precio por cantidad, presupuesto PDF → venta, envío con fecha/franja +
hoja de ruta, CC con límite, Factura A/B/C, alertas + pedido al proveedor), "un día en tu corralón" (escenario, sin cliente
inventado), 6 preguntas en formato pregunta → respuesta y el cierre. Menú, cierre y pie compartidos
(`src/components/landing/LandingMarco.tsx`); la tarjeta Construcción de la home y el pie linkean a la página.
Términos objetivo (los del doc 04): validar con Search Console después de publicar (Fase 5); la búsqueda web disponible no da
volúmenes de búsqueda.

**Pendiente:** Fase 4 (resto de rubros: cada uno con contenido propio, doc 04 §4), Fase 5 (Search Console + Bing con la cuenta
de GO/Fede, eventos de conversión), probar el deploy en el preview de Vercel (`dev`) antes de PROD: que `app.genesis360.pro`
cargue el login, que `genesis360.pro/` y `/para/construccion` lleguen armados (`curl -s … | grep "Vendé, cobrá"`), y que una
PWA ya instalada siga abriendo la app.

## 8. Fase 4 (resto de rubros) — hecha y en `dev` el 2026-10-06 (pre-release `v1.240.0-rc.2`)

- **Preview de `dev` verificado en Vercel** (v1.240.0-rc.1): `/` y `/para/construccion` llegan armados, `/login`, `/dashboard` y
  `/app.html` reciben el armazón con `noindex`, `robots.txt`/`sitemap.xml`/imagen OG responden; en el navegador, CON service
  worker activo, la navegación a `/login` la sirve el SW con la app (no la landing), la home se hidrata y "Probar gratis" lleva
  a `/onboarding`, sin errores.
- **Páginas nuevas:** `/para/supermercados`, `/para/distribuidoras`, `/para/dieteticas` — una plantilla
  (`src/pages/ParaRubroPage.tsx`, el rubro sale de la URL) y contenido PROPIO de cada rubro en
  `src/components/landing/rubros.ts` (problema, soluciones, día típico, preguntas, metadatos, términos objetivo). Cada una con
  una pieza dibujada propia (caja con promo y descuento por vencimiento; reparto con estados de pedidos; venta a granel).
  Linkeadas desde la tarjeta "Y también" de la home y desde el pie. Test: ninguna página contiene el titular de otro rubro.
- 🛑 **Honestidad de planes (Ley 24.240), corregido en la home también:** la FAQ decía que se importa desde Excel sin aclarar
  que la importación masiva es del plan Pro; Módulos mostraba Compras/Envíos/RRHH sin plan. Ahora: la FAQ dice "desde el plan
  Pro", Módulos aclara "Compras y Envíos desde Pro, RRHH en Enterprise", y en las páginas por rubro (Construcción incluida) cada
  función que no está en Básico lleva la etiqueta "Plan Pro" + aviso con link a precios. Test: la FAQ de importación nombra el
  plan Pro.
- Verificado en el código antes de escribir: cantidades con decimales para unidades de peso/volumen (`esDecimal`), presets de
  unidades por rubro (`PRESETS_RUBRO`: corralón con m²/m³), lector de código de barras (`BarcodeScanner` en el POS), precios
  programados, descuento automático por estado de inventario (`descuentoEstado.ts`, modo avanzado → Pro), cupones,
  Pedidos/picking y hoja de ruta (Pro).
- **Queda:** más rubros (indumentaria con talle/color, kioscos, librerías…) cuando se definan; validar los términos con Search
  Console (Fase 5, necesita la cuenta de GO/Fede).

## 9. Hero con dispositivos (v1.240.2, EN PROD 2026-10-07) y estado al cierre

- **Hero** (pedido de GO): captura de Ventas dentro de una **tablet** (bisel oscuro + cámara; la pantalla se revela de abajo hacia
  arriba); **impresora de tickets** vista desde arriba montada sobre la esquina inferior izquierda de la tablet, con la ranura al
  medio y el ticket saliendo POR ENCIMA de la impresora (capas: cuerpo z-10 < papel z-20 < ranura z-30); **celular** con una
  captura REAL del Panel → Ventas en vista móvil (`public/landing/panel-celular.webp`, 600×1298, componente `TelefonoPanel` en
  `LandingSecciones.tsx`), 15 % más chico que la primera versión para no tapar la tablet. En celular (< `sm`) el teléfono no se
  muestra: taparía la tablet. El hero ganó espacio abajo (`pb-48`/`lg:pb-52`) para que el ticket entre completo (medido en 6 anchos).
- ✅ **2026-10-08 (🟡 DEV, va en v1.240.5): capturas REALES** de Almacén Jorgito (decisión de GO) en el hero (POS, ticket con la
  misma venta, Panel → Insights) y en el bento de Módulos (LPN, Caja1, Factura C con CAE sin CUIT ni QR, cobro mixto). Herramienta
  `tests/e2e/990_capturas_landing.spec.ts`. Lo de abajo queda como historia.
- 🛑 **Pendiente (pedido de GO, "más adelante"):** usar **imágenes reales** de la app en toda la landing (hoy las piezas de las
  secciones son dibujos con datos de demo) y reemplazar las dos capturas del hero (Ventas en la tablet y Panel en el celular),
  que salen del negocio de prueba de DEV ("Almacén Jorgito", "Presupuestado 308 op. $0"). Hace falta un **negocio demo con datos
  prolijos** antes de capturar. Las pestañas Insights/Métricas del Panel tienen datos de prueba impublicables (−1615 %, estados "E2E…").
- **Otros pendientes:** Fase 5 (Search Console + Bing con la cuenta de GO/Fede, eventos de conversión), decidir si el Meta Pixel
  se carga diferido (rendimiento en celular 65/100), más rubros (indumentaria, kioscos, librerías), programa "primeros socios".
