# Genesis360 — Arquitectura y Escalabilidad

> Documento de referencia para decisiones de infraestructura y proyección de crecimiento.
> Última actualización: 30 de Abril, 2026

---

## Stack actual

| Capa | Tecnología | Plan actual |
|---|---|---|
| Frontend | React 18 + Vite + Vercel | Pro ($20/mes) |
| Base de datos | Supabase PostgreSQL + RLS | Pro ($25/mes) |
| Edge Functions | Deno (Supabase) | Incluido en Pro |
| Auth | Supabase Auth | Incluido |
| Storage | Supabase Storage | Incluido |
| Cron | pg_cron + pg_net | Incluido |
| Cola de jobs | `integration_job_queue` (PostgreSQL) | Incluido |
| **Total infra** | | **~$45/mes** |

---

## Capacidad de escala sin cambios de arquitectura

| Tenants | Movimientos/día | Estado |
|---|---|---|
| 1–100 | Hasta 100K | ✅ OK hoy |
| 100–500 | Hasta 500K | ✅ OK con worker mejorado (mayo 2026) |
| 500–2.000 | Hasta 2M | ⚠️ Necesita índices + Supabase Pro read replicas |
| 2.000–10.000 | Hasta 10M | 🔧 Supabase dedicado por tenant grande + queue real |
| 10.000+ | Ilimitado | 🏗️ Arquitectura nueva (igual en cloud) |

**Margen de infra a 100 tenants (plan básico $25/tenant/mes):**
- Revenue: $2.500/mes
- Infra: $45/mes
- Margen de infra: **98%**

---

## Cola de jobs — estado actual y límites

### Arquitectura actual
- Motor: tabla `integration_job_queue` en PostgreSQL
- Scheduler: `fn_tn_sync_heartbeat()` + `fn_meli_sync_heartbeat()` vía pg_cron cada 5 min
- Worker: Edge Function `tn-stock-worker` / `meli-stock-worker`
- Batch size: 200 jobs por run (mejorado mayo 2026)
- Concurrencia: 20 HTTP calls en paralelo (mejorado mayo 2026)
- Pre-fetch: credenciales y estados por tenant cacheados en memoria del run

### Throughput actual (post-mejora mayo 2026)
- 200 jobs × 20 paralelos × ~300ms/call HTTP = ~3 segundos para vaciar batch
- Capacidad: **~2.400 jobs/minuto** por worker run
- Para 100 tenants × 30 productos = 3.000 jobs/ciclo → se procesa en ~2 ciclos de 5 min

### Cuándo migrar a queue externa (SQS/Pub-Sub)
- Cuando superes 500+ tenants con muchos productos mapeados
- Costo SQS: $0.40 por millón de mensajes (prácticamente gratis)
- No requiere rediseño del worker, solo cambiar el motor de cola

---

## Workers persistentes vs Edge Functions

### Edge Functions (modelo actual)
```
cron dispara → función despierta → procesa → responde → se apaga
```
- Cold start: 100–500ms
- Límite ejecución: 150 segundos
- Ideal para: sync periódico, webhooks, operaciones request-response

### Workers persistentes (cuándo se necesitan)
```
proceso arranca → escucha cola 24/7 → procesa en milisegundos
```
- Un proceso Node.js/Python corriendo en Kubernetes o Railway
- Necesario para: sub-segundo latency, >10.000 eventos/minuto, procesos >150s
- **Genesis360 no los necesita hasta llegar a un cliente tipo Walmart nivel LatAm**

---

## Observabilidad — qué tenemos y qué agregar

### Ya disponible (sin costo adicional)
- **Supabase Dashboard**: query performance, conexiones, DB health, logs EF
- **Vercel Analytics**: tiempos de carga, errores HTTP, usuarios únicos
- **`monitoring-check` EF**: email diario 9 AM AR con reservas viejas >5d, stock crítico, cajas abiertas >16h, ventas del día
- **`actividad_log` tabla**: historial completo de acciones por tenant

### Agregar: Sentry (gratis hasta 5.000 errores/mes)
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
- Captura errores no manejados con stack trace, usuario afectado, frecuencia
- Plan gratuito suficiente para la etapa actual
- **Pendiente implementar**

### No necesario ahora
- **Datadog**: $15–30/host/mes. Útil con servidores propios; con Supabase/Vercel los dashboards built-in cubren el mismo uso a costo $0.
- Data center propio: ver sección siguiente.

---

## Cloud vs Data Center propio

**Siempre cloud para Genesis360.** Las razones:

1. **Netflix, Coca-Cola, Unilever corren en AWS/Azure/GCP.** El data center propio es legacy thinking de los 2000s.
2. **Costo**: un data center propio tiene sentido solo cuando la factura de cloud supera ~$10M/año.
3. **Regulación LatAm**: Argentina, Chile, Colombia no tienen restricciones relevantes para datos en la nube.
4. **Elasticidad**: escalar de 10 a 10.000 tenants no requiere comprar hardware.

### Única excepción contractual
Si un cliente bancario o gubernamental exige datos on-premise: usar **Supabase self-hosted** (open source, mismo código, diferente dónde corre). No requiere construir infraestructura nueva.

---

## Competencia: Blue Yonder / Manhattan Associates

**No son el mercado objetivo.** Son plataformas de $5M–$50M de implementación para Fortune 500, con 18 meses de puesta en marcha y equipos de 50 consultores. Genesis360 compite en:

| Segmento | Descripción | Ticket anual | Oportunidad |
|---|---|---|---|
| **SMB** (foco actual) | Negocios físicos 1–50 empleados | $600–$2.400 USD | Muy grande, mal servido |
| **Mid-market** (próximo) | Distribuidoras, retailers 50–500 empleados | $5K–$50K USD | Casi ningún producto moderno en LatAm |
| **Enterprise local** | Empresas grandes no Fortune 500 | $100K+ USD | Implementaciones custom caras |

El mid-market latinoamericano es el sweet spot: grande, mal servido, y accesible con el stack actual.

---

## Roadmap de infraestructura

### Ahora (hecho)
- ✅ Worker TN/MELI con paralelismo 20× (BATCH_SIZE=200, CONCURRENCY=20)
- ✅ Pre-fetch de credenciales y estados por tenant en memoria
- ✅ `fn_tn_sync_heartbeat()` + `fn_meli_sync_heartbeat()` para sync proactivo cada 5 min

### Próximos 12 meses (cuando llegue el momento)
- Agregar Sentry para error tracking (1 tarde de trabajo, gratis)
- Índices compuestos en tablas de alto volumen cuando queries superen 100ms
- Supabase instancias dedicadas para tenants grandes (disponible en plan Enterprise)
- Read replicas para queries de reportes pesados

### Cuando crezcas a 500+ tenants
- Queue real (AWS SQS o Google Pub-Sub) para integraciones
- Schema-per-tenant o DB-per-tenant para clientes enterprise
- Certificaciones SOC 2 / ISO 27001 para contratos enterprise
- SLA contractual + soporte dedicado

### Nunca (a menos que surja razón contractual específica)
- Data center propio
- Salir de la nube
