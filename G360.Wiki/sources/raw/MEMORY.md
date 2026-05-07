# Memory Index

- [project_stokio.md](project_stokio.md) — Contexto general del proyecto Genesis360 WMS SaaS (stack, módulos, patrones, seguridad)
- [feedback_coding.md](feedback_coding.md) — Preferencias de colaboración y patrones de código
- [feedback_releases.md](feedback_releases.md) — Proceso obligatorio de GitHub releases + NUNCA aplicar migrations a PROD sin consultar
- [project_pendientes.md](project_pendientes.md) — Tareas pendientes para retomar en la próxima sesión (estado: v1.3.0 DEV, pendiente PR → PROD)
- [reference_paletas.md](reference_paletas.md) — Paletas de colores de marca (Genesis360 violeta + Stokio azul como referencia)
- [reference_deploy_commands.md](reference_deploy_commands.md) — Comandos exactos de deploy: GH_TOKEN, gh CLI path, Supabase project refs, flujo completo
- [reference_seguridad.md](reference_seguridad.md) — Estado de seguridad: keys rotadas, .gitignore, JWT Supabase, repo público
- [feedback_reglas_negocio.md](feedback_reglas_negocio.md) — Documentar reglas de negocio antes de escribir tests; proponer sesión de preguntas al usuario
- [reference_overview_doc.md](reference_overview_doc.md) — Documento de producto Genesis360 en docs/genesis360_overview.html — actualizar al agregar features/reglas
- [project_wms_roadmap.md](project_wms_roadmap.md) — Visión WMS del usuario: almacenaje dirigido + picking inteligente (Fases 1–2.5 ✅, Fase 3 pendiente)
- [project_wms_asn_orders.md](project_wms_asn_orders.md) — Arquitectura futura: OC→ASN→Recepción y Orders→Picking→Despacho; OC ya en migration 049
- [project_facturacion.md](project_facturacion.md) — Módulo facturación AFIP: SDK afipsdk.js, CAE confirmado, FacturacionPage 4 tabs, EF emitir-factura, config fiscal, homologación OK
- [project_envios.md](project_envios.md) — Módulo Envíos: EnviosPage, WhatsApp Click-to-Chat, domicilios clientes, cotizador shell, remito PDF, schema migration 075
- [reference_escalabilidad.md](reference_escalabilidad.md) — Análisis de escalabilidad: cola jobs, workers, Sentry, cloud vs DC, capacidad por rango de tenants
- [project_api_plan.md](project_api_plan.md) — Plan v1.7.0: API pull (data-api EF) + exportar JSON/CSV en UI + API keys. Fase 1 aprobada, pendiente implementar
