# Diagramas de flujo — Genesis360

Idea de GO (2026-08-07, ver `project_diagramas_flujo_procesos_app` en memoria de sesión): diagramar
los procesos de la app para poder verlos y editarlos visualmente. Arrancado 2026-08-13 con un
**subconjunto priorizado** (no todos los módulos — decisión explícita de GO para no desproporcionar
el esfuerzo), en 2 tandas la misma sesión: 5 procesos iniciales + 5 más ("los siguientes flujos").

## Formato

Cada proceso tiene **dos versiones equivalentes**:

1. **`.drawio`** — editable con mouse en [draw.io](https://app.diagrams.net) (web o desktop), o la
   extensión de VS Code. Es el formato principal pedido por GO ("más dinámico y fácil de
   visualizar").
2. **Mermaid embebido** en la página de wiki correspondiente (`wiki/features/*.md` /
   `wiki/integrations/*.md`) — se renderiza solo en GitHub/Artifacts, versionado como texto plano
   junto con el resto de la documentación.

Los dos se generaron a partir de los mismos datos (estados, ramas condicionales, tablas/funciones
involucradas) extraídos del wiki real de cada módulo — no son ilustrativos, reflejan el
comportamiento real de la app a la fecha de creación (2026-08-13).

## Los 10 procesos

| Archivo | Proceso | Página de wiki con el Mermaid embebido |
|---|---|---|
| `01-venta-completa.drawio` | Venta (POS → Picking → Entrega → Facturación) | [[wiki/features/ventas-pos]] |
| `02-compra-recepcion-stock.drawio` | Compra → Recepción → Stock | [[wiki/features/clientes-proveedores]] |
| `03-devolucion-nc.drawio` | Devolución → Nota de Crédito | [[wiki/features/devoluciones]] |
| `04-caja-ciclo.drawio` | Caja: apertura → movimientos → cierre | [[wiki/features/caja]] |
| `05-pedido-reserva-despacho.drawio` | Pedido → Reserva → Despacho | [[wiki/features/pedidos]] |
| `06-facturacion-afip.drawio` | Facturación AFIP — emisión de Factura | [[wiki/features/facturacion-afip]] |
| `07-rrhh-alta-liquidacion.drawio` | RRHH — Alta de empleado → Liquidación → Baja | [[wiki/features/rrhh]] |
| `08-envios-tracking-entrega.drawio` | Envíos — Creación → Tracking → Entrega | [[wiki/features/envios]] |
| `09-wms-reabastecimiento-umbral.drawio` | WMS — Reabastecimiento por umbral | [[wiki/features/wms]] |
| `10-integraciones-ml-tn.drawio` | Integraciones ML/TN — Webhook → Venta → Sync stock | [[wiki/integrations/tienda-nube]] (+ pointer en [[wiki/integrations/mercado-libre]]) |

## Mantenimiento

Estos diagramas **no se actualizan solos** cuando cambia el código — a diferencia del resto del
wiki, no hay una regla de oro que obligue a tocarlos en cada sesión. Si un cambio grande altera el
flujo de alguno de estos 10 procesos, vale la pena avisar y regenerar el diagrama afectado (a mano en
draw.io, o pidiéndole a Claude Code que lo actualice).

## Próximos procesos (si GO los pide)

No construidos todavía — quedan como candidatos para una próxima ronda si se quiere ampliar la
cobertura: NC electrónica AFIP automática en detalle (el flujo de fondo ya está en el diagrama de
Devolución), Compras 2.0 — devolución a proveedor (CO4), Conteos 2.0, Cheques diferidos (cartera →
cobro), onboarding/alta de tenant.
