---
title: Mercado Objetivo
category: business
tags: [mercado, segmento, argentina, smb, comercios]
sources: [CLAUDE.md, arquitectura_escalabilidad.md]
updated: 2026-04-30
---

# Mercado Objetivo

---

## Segmento principal (foco actual)

**Pequeños comercios físicos de Argentina:**
- Almacenes / despensas
- Ferreterías
- Kioscos y minimercados
- Cualquier negocio con stock físico, caja y empleados

**Perfil:** 1–50 empleados · Ticket anual $600–$2.400 USD · Mal servido por soluciones actuales

---

## Tipos de comercio soportados

Definidos en `src/config/tiposComercio.ts`. La app adapta el onboarding y las sugerencias según el tipo seleccionado al registrar el negocio.

---

## Segmento próximo — Mid-market

**Distribuidoras, retailers 50–500 empleados**
- Ticket anual: $5K–$50K USD
- Casi ningún producto moderno en LatAm que los sirva bien
- Sweet spot real: grande, mal servido, accesible con el stack actual

---

## Posicionamiento competitivo

| Competidor | Segmento | Por qué no compite con G360 |
|-----------|---------|----------------------------|
| Blue Yonder / Manhattan | Fortune 500 | $5M–$50M por implementación, 18 meses, 50 consultores |
| Gestión local (Argentina) | Pymes | Sistemas legacy, sin integraciones modernas, sin PWA |
| Excel / Cuaderno | Micronegocios | Sin datos, sin alertas, sin métricas |

Genesis360 llena el vacío entre "cuaderno y Excel" y "ERP enterprise".

---

## Propuesta de valor diferencial

1. **Todo en uno** — no hay que integrar 5 sistemas distintos
2. **Recomienda acciones** — no solo muestra datos
3. **Argentina-native** — Mercado Pago, AFIP, MP QR, feriados AR, precios en ARS
4. **Marketplace-ready** — sincroniza stock con MeLi y TiendaNube automáticamente
5. **PWA instalable** — funciona como app en móvil sin App Store

---

## Canales de adquisición

- Marketing digital (SEO, redes sociales)
- Landing page: `www.genesis360.pro`
- Trial gratuito 14 días sin tarjeta de crédito
- Onboarding auto-guiado (Walkthrough component)

---

## Escalabilidad del modelo

| Tenants | Infra | Revenue (Básico $25/tenant) | Margen |
|---------|-------|---------------------------|--------|
| 10 | $45/mes | $250/mes | 82% |
| 100 | $45/mes | $2.500/mes | 98% |
| 500 | ~$150/mes | $12.500/mes | 99% |

El modelo SaaS escala con margen de infraestructura cercano al 99% en volumen.

---

## Links relacionados

- [[wiki/business/modelo-negocio]]
- [[wiki/business/planes-pricing]]
- [[wiki/architecture/escalabilidad]]
