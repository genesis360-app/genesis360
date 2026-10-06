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
