---
name: reference_escalabilidad
description: Análisis de escalabilidad, límites del stack actual, decisiones de infra y observabilidad
type: reference
originSessionId: 7ac12f69-1217-41e2-b6e5-3547bd561e43
---
## Capacidad por rango de tenants

| Tenants | Estado | Acción necesaria |
|---|---|---|
| 1–100 | ✅ OK hoy | Nada |
| 100–500 | ✅ OK con worker mejorado (mayo 2026) | Nada |
| 500–2.000 | ⚠️ Monitorear | Índices + Supabase Pro read replicas |
| 2.000+ | 🔧 Requiere trabajo | Queue real (SQS) + DB dedicada por tenant grande |

## Cola de jobs — post-mejora mayo 2026

- Motor: PostgreSQL `integration_job_queue` (suficiente hasta 500 tenants)
- Worker TN: BATCH_SIZE=200, CONCURRENCY=20, ~15× más rápido que original
- Sync proactivo: `fn_tn_sync_heartbeat()` encola todos los productos mapeados cada 5 min
- Queue externa (SQS ~$0.40/millón): solo necesaria a 500+ tenants con muchos mapeos

## Workers persistentes — cuándo se necesitan

Edge Functions actuales (serverless) son correctas para Genesis360 hasta escala muy grande.
Workers persistentes (proceso Node.js 24/7 en Kubernetes) solo para >10.000 eventos/minuto o latencia sub-segundo.
No están en el roadmap actual.

## Observabilidad

- **Supabase Dashboard**: query performance, conexiones, DB health — ya disponible gratis
- **Vercel Analytics**: tiempos de carga, errores HTTP — ya disponible gratis
- **monitoring-check EF**: email diario 9 AM AR con alertas operativas — ya deployado
- **Sentry**: PENDIENTE agregar. Gratis hasta 5.000 errores/mes. 30 min de setup.
  ```bash
  npm install @sentry/react
  # En main.tsx: Sentry.init({ dsn: 'DSN_DE_SENTRY', environment: ... })
  ```
- **Datadog**: innecesario ahora. Con Supabase/Vercel los dashboards built-in cubren el mismo uso gratis.

## Cloud vs Data Center propio

Cloud siempre correcto para Genesis360:
- Netflix/Coca-Cola/Unilever corren en AWS/Azure/GCP
- Data center propio solo tiene sentido cuando factura cloud >$10M/año
- Única excepción: cliente que exija on-premise por regulación → usar Supabase self-hosted (open source, mismo código)
- Regulación LatAm (AR/CL/CO): sin restricciones relevantes para datos en cloud

## Posicionamiento competitivo

No competir con Blue Yonder/Manhattan Associates (Fortune 500, $5M–$50M implementación).
Sweet spot Genesis360: **SMB + Mid-market LatAm** — grande, mal servido, sin productos modernos locales.

## Referencia completa

Ver `docs/arquitectura_escalabilidad.md` en el repo para análisis detallado.
