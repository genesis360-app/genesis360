---
title: Frontend Stack
category: architecture
tags: [react, vite, typescript, tailwind, zustand, pwa]
sources: []
updated: 2026-08-20
---

# Frontend Stack

## Tecnologías principales

| Librería | Versión | Rol |
|----------|---------|-----|
| React | 18.2.0 | UI framework |
| Vite | 5.0.12 | Build tool + dev server |
| TypeScript | 5.3.3 | Type safety (strict mode) |
| Tailwind CSS | 3.4.1 | Styling + design system |
| React Router DOM | 6.21.0 | Routing (35+ rutas, lazy-loaded) |
| Zustand | 4.4.7 | Estado global (auth, tenant) |
| TanStack React Query | 5.17.0 | Server state + caching |
| React Hot Toast | 2.4.1 | Notificaciones |
| Lucide React | 0.309.0 | Iconos |
| Recharts | 3.8.0 | Gráficos del dashboard |

## Librerías de dominio

| Librería | Propósito |
|----------|-----------|
| jsPDF + jspdf-autotable | Exportación a PDF |
| XLSX 0.18.5 | Importación/exportación Excel |
| @zxing/library, html5-qrcode | Escaneo de QR/barcode |
| @undecaf/zbar-wasm | Escaneo con WASM (más rápido) |
| qrcode | Generación de QR |
| browser-image-compression | Compresión de imágenes antes de subir |
| clsx + tailwind-merge | Clases CSS condicionales |
| date-fns | Utilidades de fechas |

> [!TIP] **Code-splitting de `xlsx`/`jspdf`/`jspdf-autotable` (2026-08-14, auditoría de performance,
> frontend #4)**: estas 3 librerías son pesadas (`xlsx` 499KB, `jspdf`+`jspdf-autotable` 386KB+31KB) y
> solo se usan dentro de handlers puntuales de exportar/importar — 19 páginas/componentes las importaban
> de forma **estática** al tope del archivo (`ClientesPage`, `CajaPage`, `CajaReportes`,
> `CierresContablesPanel`, `EnviosPage`, `ComprasReportesPanel`, `FacturacionPage`, `HistorialPage`,
> `ImportarInventarioPage`, `ImportarMasterPage`, `ImportarProductosPage`, `InventarioPage`,
> `EnviosReportesPanel`, `PedidosPage`, `ProveedoresPage`, `ReportesPage`, `RrhhPage`,
> `RepositoresReportes`, `RrhhReportesPanel`), inflando el bundle de cada una aunque el usuario nunca
> exportara nada. Migradas a `await import(...)` dentro de cada handler (~30 call sites) — verificado con
> el build de producción que las 3 libs quedan como chunks separados, y con un test Playwright ad-hoc que
> confirmó una descarga real de Excel funcionando en runtime. **A propósito NO se tocaron** los 8 módulos
> compartidos `src/lib/*PDF.ts` (facturasPDF, ocPDF, presupuestoPDF, reciboSueldoPDF, remitoPDF,
> estadoCuentaPDF, etiquetasPreciosPDF, etiquetasEnvioPDF) — tienen múltiples callers y uno genera las
> facturas fiscales reales, mayor blast radius para un beneficio de performance menor. **Estado: código
> COMMITEADO Y PUSHEADO a `origin/dev`** (commit `310d9b3b`, tag `v1.171.0`, 2026-08-18), verificado
> (build + e2e), **✅ EN PROD desde 2026-08-20** (PR #331, merge commit `4dbe7fdb`). Ver [[wiki/features/
> ventas-pos]] → "Memoización del carrito" para el otro hallazgo de performance de la misma auditoría.

> [!TIP] **Cierre del resto de la auditoría de performance/calidad (2026-08-14, COMMITEADO Y PUSHEADO a
> `origin/dev` desde el 2026-08-18, commit `310d9b3b`)**: dos fixes más de la misma auditoría, aplicados en la sesión que cerró el
> reporte completo (top5 + hallazgos menores). **1) `CajaPage.tsx`** — 6 `refetchInterval` propios
> recalibrados según qué alimentan (ninguno eliminado, criterio conservador por ser área de caja): saldo
> en vivo que usa el cajero para cobrar/arquear (`sesion-activa`, `caja-movimientos`) 10s→30s;
> indicadores de multi-dispositivo/decorativos (`caja-fuerte-movimientos`, `boveda-cuentas`,
> `cajas-abiertas-ids`, `mis-sesiones-abiertas`) 10-15s→60-120s. **2) `toLocaleString` → `formatMoneda()`**
> en 9 archivos donde el formato local era un duplicado exacto del default de `formatMoneda` ($ es-AR sin
> decimales, sin conversión de moneda): `ComprasReportesPanel.tsx`, `EnviosReportesPanel.tsx`,
> `DashClientesArea.tsx`, `DashEnviosArea.tsx`, `DashFacturacionArea.tsx`, `DashInventarioArea.tsx`,
> `DashMarketingArea.tsx`, `DashProductosArea.tsx`, `DashProveedoresArea.tsx` — el resto de los ~200 usos
> dispersos en VentasPage/GastosPage/ProveedoresPage/RrhhPage queda diferido (migración oportunista, al
> tocar cada archivo, no en pasada masiva). **3) Tipado `Database` genérico en el cliente de Supabase
> (`src/lib/supabase.ts`) — DIFERIDO, probado empíricamente, no solo evaluado en teoría**: se generaron
> los tipos y se cableó el genérico, `tsc --noEmit` pasó de 0 a **152 errores** en una docena+ de
> archivos — se revirtió todo (working tree quedó exactamente como estaba). Confirma que es alto riesgo
> real, no solo lo que decía el reporte original. **4) Extracción de secciones de `ConfigPage.tsx`
> (8206 líneas) — DIFERIDO**: a diferencia de `ApiTab`/`MarketplaceSection`/`ModoOperacionSection` (ya
> extraídos, sin props compartidos), el resto de las secciones comparte un state bag único de ~30
> `useState` y handlers de guardado compartidos — sin un límite de bajo riesgo real, mismo criterio que la
> extracción de modales de VentasPage. Verificación: `tsc --noEmit` + `npm run build` verdes tras combinar
> ambos agentes. Ver `sources/raw/project_pendientes.md` ("ARRANCÁ ACÁ", cont. 8) y `log.md` (2026-08-14,
> cierre completo de la auditoría).

## Estructura de carpetas (`src/`)

```
src/
├── components/     # 24+ componentes reutilizables
├── pages/          # 35+ páginas (una por feature)
├── hooks/          # 8 custom hooks
├── lib/            # utilidades, clientes, integraciones
├── store/          # Zustand stores
├── config/         # brand.ts, tiposComercio.ts
├── styles/         # CSS global
├── App.tsx         # Router principal (35+ rutas lazy)
└── main.tsx        # Entry point Vite
```

## Design System (Tailwind)

El archivo `tailwind.config.js` define tokens semánticos:

| Token | Uso |
|-------|-----|
| `page` | Fondo de página |
| `surface` | Tarjetas, paneles |
| `border-ds` | Bordes |
| `primary` | Color de acción principal |
| `accent` | Color de énfasis — **relleno sólido/degradé de marca** (fondo violeta + texto blanco), NO varía entre claro/oscuro a propósito |
| `accent-text` | **(2026-07-19)** Variante de `accent` para **texto/borde/ring** (`text-accent-text`/`border-accent-text`/`ring-accent-text`), NO para relleno. Mismo valor que `accent` en modo claro, pero más luminoso en `.dark` (`--color-accent-text: 139 92 246` violet-500 vs `123 0 255` en claro) — el violeta de marca (`#7B00FF`) es idéntico en los 2 modos y pierde contraste como texto/borde fino sobre fondo casi negro. Mismo criterio que ya se usaba solo para el scrollbar en dark. Migración mecánica (perl) de ~1440 usos de `text-accent`/`border-accent`/`ring-accent` en 91 archivos de `src/` — `bg-accent` no se tocó |
| `success` / `danger` / `warning` / `info` | Estados |
| `muted` | Texto secundario |

Fonts: **Inter** (sans-serif) · **JetBrains Mono** (monospace)

> [!WARNING] **Gotcha (2026-07-19):** `tailwind.config.js` **no hot-reload** en un dev server ya
> corriendo — un token de color nuevo (como `accent-text` arriba) no aparece hasta reiniciar
> (`npm run dev`). A diferencia de cambios en `.tsx`/`.css`, que sí hot-reloadean al instante.

## Configuración TypeScript

- Target: ES2020
- Module: ESNext
- Strict mode: `true`
- Path alias: `@/*` → `./src/*`

> [!TIP] Siempre usar el alias `@/` para imports internos, nunca paths relativos largos.

## PWA

Configurado con `vite-plugin-pwa`:
- Service Worker para offline
- Manifest con íconos
- Soporte WASM (necesario para el escáner de barcodes)
- Top-level await habilitado

## Estado global

Ver [[wiki/architecture/estado-global]] para el detalle de Zustand + React Query.

## Rutas (App.tsx)

35+ rutas lazy-loaded. Patrón:
- Rutas públicas: `/`, `/login`, `/onboarding`
- Rutas protegidas: todo lo demás, envuelto en `AuthGuard`
- `AuthGuard` verifica: sesión activa + suscripción válida

## Links relacionados

- [[wiki/architecture/backend-supabase]]
- [[wiki/architecture/estado-global]]
- [[wiki/architecture/pwa-config]]
- [[wiki/features/escaneo-barcode]]
