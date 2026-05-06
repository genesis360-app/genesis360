---
title: Arquitectura y Escalabilidad
category: architecture
tags: [escalabilidad, infraestructura, cola-jobs, workers, sentry, cloud]
sources: [arquitectura_escalabilidad.md]
updated: 2026-04-30
---

# Arquitectura y Escalabilidad

> Documento de referencia para decisiones de infraestructura y proyección de crecimiento.

---

## Stack actual y costos

| Capa | Tecnología | Costo |
|------|-----------|-------|
| Frontend | React 18 + Vite + Vercel | Pro ~$20/mes |
| Base de datos | Supabase PostgreSQL + RLS | Pro $25/mes |
| Edge Functions | Deno (Supabase) | Incluido en Pro |
| Auth | Supabase Auth | Incluido |
| Storage | Supabase Storage | Incluido |
| Cron | pg_cron + pg_net | Incluido |
| Cola de jobs | `integration_job_queue` (PostgreSQL) | Incluido |
| **Total infra** | | **~$45/mes** |

**Margen de infra a 100 tenants** (plan básico ~$25/tenant/mes):
- Revenue: $2.500/mes → Infra: $45/mes → **Margen infra: 98%**

---

## Capacidad de escala sin cambiar arquitectura

| Tenants | Movimientos/día | Estado |
|---------|----------------|--------|
| 1–100 | Hasta 100K | ✅ OK hoy |
| 100–500 | Hasta 500K | ✅ OK con worker mejorado (v1.4.0) |
| 500–2.000 | Hasta 2M | ⚠️ Necesita índices + read replicas |
| 2.000–10.000 | Hasta 10M | 🔧 Supabase dedicado + queue real |
| 10.000+ | Ilimitado | 🏗️ Arquitectura nueva |

---

## Cola de jobs — arquitectura actual

**Motor:** tabla `integration_job_queue` en PostgreSQL  
**Scheduler:** `fn_tn_sync_heartbeat()` + `fn_meli_sync_heartbeat()` vía pg_cron cada 5 min  
**Workers:** EF `tn-stock-worker` / `meli-stock-worker`

### Throughput post-mejora v1.4.0
- BATCH_SIZE = 200 jobs por run
- CONCURRENCY = 20 HTTP calls en paralelo
- Pre-fetch de credenciales y estados por tenant cacheados en memoria del run
- **~2.400 jobs/minuto** por worker run
- Para 100 tenants × 30 productos = 3.000 jobs/ciclo → se procesa en ~2 ciclos de 5 min

### Cuándo migrar a queue externa (SQS/Pub-Sub)
- Cuando superes 500+ tenants con muchos productos mapeados
- Costo SQS: $0.40 por millón de mensajes
- No requiere rediseño del worker, solo cambiar el motor de cola

---

## Edge Functions vs Workers persistentes

### Edge Functions (modelo actual)
```
cron dispara → función despierta → procesa → responde → se apaga
```
- Cold start: 100–500ms
- Límite de ejecución: 150 segundos
- Ideal para: sync periódico, webhooks, operaciones request-response

### Workers persistentes (cuándo se necesitan)
```
proceso arranca → escucha cola 24/7 → procesa en milisegundos
```
- Un proceso Node.js/Python corriendo en Kubernetes o Railway
- Necesario para: sub-segundo latency, >10.000 eventos/minuto, procesos >150s
- **Genesis360 no los necesita hasta escala tipo Walmart LatAm**

---

## Observabilidad

### Ya disponible (sin costo adicional)
- **Supabase Dashboard**: query performance, conexiones, DB health, logs EF
- **Vercel Analytics**: tiempos de carga, errores HTTP, usuarios únicos
- **EF `monitoring-check`**: email diario 9 AM AR con KPIs operativos
- **`actividad_log`**: historial completo de acciones por tenant

### Sentry — pendiente implementar (gratis hasta 5K errores/mes)
```bash
npm install @sentry/react
```
```typescript
// main.tsx
import * as Sentry from '@sentry/react'
Sentry.init({
  dsn: 'DSN_DESDE_SENTRY_IO',
  environment: import.meta.env.PROD ? 'production' : 'development',
  tracesSampleRate: 0.1,
})
```
Captura errores con stack trace, usuario afectado y frecuencia. Plan gratuito suficiente.

### No necesario ahora
- **Datadog**: útil con servidores propios; con Supabase/Vercel los dashboards built-in cubren el mismo uso a $0
- Data center propio: ver sección siguiente

---

## Cloud vs Data Center propio

**Siempre cloud para Genesis360.**

1. Netflix, Coca-Cola, Unilever corren en AWS/GCP. El data center propio es legacy thinking de los 2000s.
2. Costo: un data center propio tiene sentido solo cuando la factura cloud supera ~$10M/año.
3. Argentina, Chile, Colombia no tienen restricciones relevantes para datos en la nube.
4. Elasticidad: escalar de 10 a 10.000 tenants sin comprar hardware.

**Única excepción:** cliente bancario o gubernamental que exija datos on-premise → usar **Supabase self-hosted** (mismo código, diferente host). No requiere construir infraestructura nueva.

---

## Competencia y posicionamiento

| Segmento | Descripción | Ticket anual | Oportunidad |
|----------|-------------|-------------|-------------|
| **SMB (foco actual)** | Negocios físicos 1–50 empleados | $600–$2.400 USD | Muy grande, mal servido |
| **Mid-market (próximo)** | Distribuidoras, retailers 50–500 empleados | $5K–$50K USD | Casi ningún producto moderno en LatAm |
| **Enterprise local** | Empresas grandes no Fortune 500 | $100K+ USD | Implementaciones custom |

Blue Yonder / Manhattan Associates son el mercado Fortune 500 ($5M–$50M por implementación). Genesis360 compite en SMB/Mid-market latinoamericano.

---

## Roadmap de infraestructura

### Ahora (hecho v1.4.0)
- ✅ Worker TN/MELI con paralelismo 20× (BATCH_SIZE=200, CONCURRENCY=20)
- ✅ Pre-fetch de credenciales y estados por tenant en memoria del run
- ✅ `fn_tn_sync_heartbeat()` + `fn_meli_sync_heartbeat()` proactivo cada 5 min

### Próximos 12 meses
- Sentry para error tracking (1 tarde, gratis)
- Índices compuestos cuando queries superen 100ms
- Supabase instancias dedicadas para tenants grandes

### Cuando llegue a 500+ tenants
- Queue real (AWS SQS o Google Pub-Sub) para integraciones
- Schema-per-tenant o DB-per-tenant para enterprise
- SOC 2 / ISO 27001 para contratos enterprise
- SLA contractual + soporte dedicado

---

## Links relacionados

- [[wiki/architecture/backend-supabase]]
- [[wiki/architecture/edge-functions]]
- [[wiki/development/supabase-dev-vs-prod]]
- [[wiki/integrations/tienda-nube]]
- [[wiki/integrations/mercado-libre]]
