---
title: PWA — Configuración
category: architecture
tags: [pwa, service-worker, wasm, manifest, offline]
sources: [CLAUDE.md]
updated: 2026-04-30
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

## Links relacionados

- [[wiki/architecture/frontend-stack]]
- [[wiki/features/escaneo-barcode]]
- [[wiki/development/deploy]]
