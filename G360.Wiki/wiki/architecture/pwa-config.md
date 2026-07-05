---
title: PWA — Configuración
category: architecture
tags: [pwa, service-worker, wasm, manifest, offline]
sources: [CLAUDE.md]
updated: 2026-07-05
---

# PWA — Progressive Web App

Genesis360 es una PWA instalable en móvil y desktop.

**Plugin:** `vite-plugin-pwa` en `vite.config.ts`

---

## Características habilitadas

| Feature | Estado |
|---------|--------|
| Service Worker | ✅ |
| Manifest (íconos, nombre) | ✅ |
| Instalable en móvil/desktop | ✅ |
| Soporte WASM | ✅ (necesario para ZBar barcode scanner) |
| Top-level await | ✅ (necesario para módulos async) |
| Offline completo | ❌ (requiere datos en tiempo real, no viable) |

---

## Configuración `vite.config.ts`

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Genesis360',
        short_name: 'G360',
        theme_color: '#...',
        icons: [...],
      },
    }),
  ],
  // WASM support (para @undecaf/zbar-wasm)
  optimizeDeps: {
    exclude: ['@undecaf/zbar-wasm'],
  },
  // Top-level await
  build: {
    target: 'esnext',
  },
})
```

---

## Mobile — consideraciones UX

```html
<!-- index.html -->
<meta name="viewport"
  content="width=device-width, initial-scale=1.0,
           maximum-scale=1.0, viewport-fit=cover" />
```

- `maximum-scale=1.0`: previene zoom automático en iOS al enfocar inputs
- `overflow-x: hidden` en `html, body`: previene overflow horizontal

---

## SPA Routing en Vercel

```json
// vercel.json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }],
  "redirects": [
    {
      "source": "/",
      "has": [{ "type": "host", "value": "app.genesis360.pro" }],
      "destination": "/login",
      "permanent": false
    }
  ]
}
```

---

## Registro explícito del Service Worker (v1.112.0, anti-caché-vieja)

> [!WARNING] **Gotcha de PROD (caso Fede, 2026-07-04/05):** con `registerType: 'autoUpdate'` el SW se
> actualiza solo, pero **si la pestaña queda abierta mucho tiempo o el usuario no navega**, el nuevo SW
> puede tardar en tomar control → un cliente real siguió operando contra una versión vieja durante un
> deploy de billing (posible causa de que el checkout-return no invocara la EF de verificación, MP-W6).

**Fix:** registro explícito de `registerSW` en `src/main.tsx` (en vez de dejarlo 100% implícito al plugin):
chequea updates **cada 30 minutos** + **al volver el foco a la pestaña** (`visibilitychange`); con
`registerType: 'autoUpdate'` el nuevo SW se activa y recarga solo cuando encuentra una versión nueva.
`tsconfig` agrega el tipo `vite-plugin-pwa/client`. Reduce (no elimina del todo) la ventana en la que un
usuario real queda en una versión cacheada tras un deploy — ver también
[[reference_pwa_cache_post_deploy]] (memoria: "sigue fallando" puede ser caché, pedir hard-refresh antes
de re-diagnosticar).

---

## Links relacionados

- [[wiki/architecture/frontend-stack]]
- [[wiki/features/escaneo-barcode]]
- [[wiki/development/deploy]]
