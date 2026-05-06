---
title: Modelo de Negocio
category: business
tags: [modelo-negocio, saas, argentina, segmento, propuesta-valor]
sources: []
updated: 2026-04-30
---

# Modelo de Negocio

---

## Segmento de clientes

Pequeños comercios físicos de Argentina:
- Almacenes / despensas
- Ferreterías
- Kioscos y minimercados
- Cualquier negocio con stock físico y caja

---

## Propuesta de valor

**"El cerebro del negocio físico"**

No solo mostrar datos — **recomendar acciones**. El sistema observa el negocio y sugiere qué hacer: qué reponer, qué no está vendiendo, qué está a punto de vencer.

Diferencial respecto a RAG/sistemas convencionales:
- El conocimiento se acumula (wiki de la app = estado persistente)
- Cross-references entre datos de inventario, ventas, caja, RRHH

---

## Canales

- Marketing digital (SEO, redes sociales)
- Landing page: `www.genesis360.pro`
- Trial gratuito de 14 días (sin tarjeta)
- Onboarding auto-guiado (Walkthrough component)

---

## Modelo de revenue

| Fuente | Detalle |
|--------|---------|
| Suscripciones mensuales | Free / Basic / Pro / Enterprise |
| Pagos vía Mercado Pago | ARS, renovación mensual automática |

---

## Tipos de comercio soportados

Definidos en `src/config/tiposComercio.ts`. La app adapta el onboarding y las sugerencias según el tipo de negocio registrado.

---

## Links relacionados

- [[wiki/business/planes-pricing]]
- [[wiki/business/roadmap]]
- [[wiki/features/suscripciones-planes]]
- [[wiki/overview/genesis360-overview]]
