---
title: Frontend Stack
category: architecture
tags: [react, vite, typescript, tailwind, zustand, pwa]
sources: []
updated: 2026-07-19
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
