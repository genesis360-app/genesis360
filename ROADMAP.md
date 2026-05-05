# Genesis360 — Roadmap

**Última actualización:** 5 de Mayo, 2026 · **v1.5.0 en PROD ✅ · v1.6.0 en DEV**

> Stack, arquitectura y convenciones → [CLAUDE.md](CLAUDE.md) · Workflow de deploy → [WORKFLOW.md](WORKFLOW.md)

---

## ✅ Módulo Facturación Electrónica AFIP (v1.3.0 DEV — migrations 076-077)

### Estado: DEV ✅ · PROD pendiente deploy

**SDK**: `@afipsdk/afip.js` vía `npm:` en Deno (no certificados propios por ahora)
**Acceso**: AfipSDK cloud service + access_token por tenant
**Testing homologación**: CAE 86170057489609 emitido exitosamente (Factura B)

### Edge Function `emitir-factura`
- Calcula neto/IVA por alícuota desde `venta_items`
- Determina DocTipo automático (CF/DNI/CUIT) + umbral RG 5616
- `CondicionIVAReceptorId` (RG 5616) mapeado desde `clientes.condicion_iva_receptor`
- Guarda CAE/vencimiento/numero en `ventas`

### FacturacionPage — 4 tabs
- **Panel de Control**: KPIs IVA Débito/Crédito/Posición + datos fiscales + disclaimer
- **Facturación**: borradores (ventas sin CAE) + historial + modal emitir A/B/C
- **Libros IVA**: Ventas (débito) y Compras (crédito) con filtros alícuota, exportar Excel, conciliación
- **Liquidación**: historial 12 meses, retenciones sufridas, disclaimer legal

### Config → Negocio (nuevos campos)
- Toggle `facturacion_habilitada`
- CUIT, condición IVA emisor, razón social fiscal, domicilio fiscal
- Umbral Factura B (configurable, RG 5616)
- Token AfipSDK (oculto, guardado en tenants)
- Puntos de venta AFIP: CRUD colapsable

### Clientes (nuevos campos)
- `cuit_receptor` + `condicion_iva_receptor` (CF/RI/Mono/Exento)
- Visible en card expandido, usado en emisión automática

### Schema (migrations 076-077)
```
tenants: facturacion_habilitada, cuit, condicion_iva_emisor, razon_social_fiscal,
         domicilio_fiscal, umbral_factura_b, afipsdk_token
clientes: cuit_receptor, condicion_iva_receptor
puntos_venta_afip: id, tenant_id, sucursal_id, numero, nombre, activo
retenciones_sufridas: id, tenant_id, tipo, agente, monto, fecha, periodo
gastos: conciliado_iva BOOLEAN
```

### Tipos de comprobante (RG 5616)
| Emisor | Receptor | Tipo | CbteTipo | CondicionIVAReceptorId |
|---|---|---|---|---|
| RI | RI | Factura A | 1 | 1 |
| RI | CF/Mono | Factura B | 6 | 5/4 |
| Mono | Cualquiera | Factura C | 11 | según |
| Cualquiera | — | NC-A/B/C | 3/8/13 | — |

### Pendiente Fase 2
- Integración VentasPage: prompt "¿Facturar ahora?" al despachar
- PDF factura con QR AFIP (obligatorio desde 2021)
- Envío automático por email al cliente
- Notas de Crédito en módulo devoluciones

---

## ✅ Módulo Envíos (v1.3.0 DEV — migration 075)

### Decisión estratégica
**Integración propia con AFIP WSFE** (sin intermediario). Break-even vs. servicio tercero (~$300 USD/mes a 20 tenants) en 6-8 meses. Las "grandes ligas" ARG (TiendaNube, ML) todas tienen integración propia. Librería `afip.js` (Node/Deno) wrappea el WSFE SOAP.

### Infraestructura ya implementada
- `tenant_certificates` + bucket `certificados-afip` + sección ConfigPage ✅ (migration 043)
- Columnas `cae`, `vencimiento_cae`, `tipo_comprobante`, `numero_comprobante`, `link_factura_pdf` en `ventas` ✅ (migration 060)
- `alicuota_iva` en productos + `iva_monto` en venta_items ✅

### Tipos de comprobante (validado por contador)
| Emisor | Receptor | Comprobante |
|---|---|---|
| Responsable Inscripto (RI) | Responsable Inscripto | Factura A — discrimina IVA |
| Responsable Inscripto (RI) | Consumidor Final / Monotributista | Factura B — IVA incluido |
| Monotributista | Cualquier | Factura C — sin IVA |

Tridente A/B/C cubre el 99% de los comercios de G360. NC-A/B/C para devoluciones.

### Umbral Factura B
- Venta < umbral AFIP (configurable en DB, se actualiza por inflación) → "Consumidor Final", sin datos
- Venta ≥ umbral → DNI/CUIT + nombre obligatorio. Auto-validación en checkout.

### Devoluciones con factura emitida
- **Nota de Crédito electrónica obligatoria** (no alcanza el flujo interno de stock)
- NC vinculada a factura original: `devoluciones` necesita `factura_vinculada_id FK ventas.id` + `nc_cae` + `nc_numero_comprobante`

### Descripción del ítem
`{nombre_producto} - {sku} - {unidad_medida}` · Ej: "Zapatilla Urbana X - SKU-00045 - Par"

### Schema nuevo necesario
```
tenants:      condicion_iva, razon_social, domicilio_fiscal,
              punto_venta_afip INT, facturacion_habilitada BOOL,
              umbral_factura_b DECIMAL
clientes:     cuit TEXT, condicion_iva TEXT
devoluciones: nc_cae, nc_vencimiento_cae, nc_numero_comprobante,
              factura_vinculada_id FK ventas(id)
```

### Plan de fases
- **Paso 0** — Homologación AFIP (proceso manual 1-2 semanas, iniciar ANTES del código)
- **Fase 1** — Config y datos maestros: toggle `facturacion_habilitada`, campos tenant, CUIT+condición IVA en clientes, umbral configurable
- **Fase 2** — Emisión: Edge Function `emitir-factura` → WSFE → CAE → PDF → QR AFIP (obligatorio desde 2021)
- **Fase 3** — Notas de Crédito: extensión módulo devoluciones con NC electrónica vinculada
- **Fase 4** — Reportes: libro IVA ventas, resumen comprobantes, exportar Excel para contador

### Riesgos facturación
1. Numeración correlativa AFIP — bugs de duplicados/saltos son graves
2. AFIP WSFE tiene downtime — retry robusto necesario
3. Clientes sin CUIT/condición IVA — flujo de completar datos requerido
4. CUIT inactivo del dueño → usar CUIT de empresa cuando se constituya

### Pendiente facturación
- [ ] Testear flujo completo en DEV con token AfipSDK
- [ ] Integrar VentasPage: prompt "¿Facturar ahora?" al despachar
- [ ] PDF factura con QR AFIP (obligatorio desde 2021)
- [ ] Envío automático por email al cliente
- [ ] Notas de Crédito en módulo devoluciones

---

## ✅ Módulo Envíos (v1.3.0 DEV — migration 075)

**EnviosPage** (`/envios`) — OWNER/SUPERVISOR/CAJERO.

### Funcionalidades
- Lista con filtros: estado/courier/canal/fechas/búsqueda
- Fila expandible: destinatario completo, courier+tracking, productos
- Avanzar estado (pendiente→despachado→en_camino→entregado), cancelar
- Generar remito PDF (jsPDF), ver tracking externo, ver venta asociada
- Modal nuevo/editar: vincular venta, elegir domicilio del cliente, courier/tracking/dimensiones
- Tab Cotizador: shell para rate shopping (activo cuando haya contratos con couriers)

### Prerequisito implementado
- `cliente_domicilios` (migration 074): cada cliente puede tener múltiples domicilios de entrega con alias, referencias para courier, domicilio principal marcado con ⭐

### Schema (migration 075)
```
envios: id, tenant_id, venta_id, numero AUTO, courier, servicio, tracking_number,
        estado CHECK(pendiente|despachado|en_camino|entregado|devolucion|cancelado),
        canal, destino_id FK cliente_domicilios, peso_kg, dimensiones,
        costo_cotizado, fecha_entrega_acordada, etiqueta_url, created_by
bucket: etiquetas-envios (privado, 5MB)
```

### Fase 2 pendiente (cuando haya contratos couriers)
- EF `courier-rates`: consulta APIs OCA/CorreoAR/Andreani/DHL en paralelo → tabla comparativa
- Label printing: etiqueta base64 del courier → bucket → impresión

---

## Roles RRHH

```
OWNER  → Full access (incluye RRHH)
RRHH   → Gestión de empleados, nómina, vacaciones (acceso delegado)
```
Helper: `is_rrhh()` SECURITY DEFINER — devuelve TRUE si rol = 'RRHH' o 'OWNER'.

---

## ✅ Phase 1 — RRHH Básico (v0.26.0 · PROD)

**Migration:** `014_rrhh_empleados.sql`

- Tabla `empleados` (DNI/RUT, contacto, datos personales, laboral, supervisor, salario, soft delete)
- Tabla `rrhh_puestos` (nombre, salario_base_sugerido)
- Tabla `rrhh_departamentos` (nombre, descripción)
- `RrhhPage` con 4 tabs: Empleados · Puestos · Departamentos · Cumpleaños
- Auditoría con `logActividad()` · UNIQUE(tenant_id, dni_rut)

**Decisiones:**
- Tabla `empleados` separada de `users` (users = auth; empleados = RRHH data extensible)
- Página dedicada `RrhhPage` (no tab en Config — RRHH es módulo completo)
- Soft delete `activo=false`, nunca hard delete
- Nómina semi-automática (no full-auto — cada país tiene reglas distintas)

---

## ✅ Phase 2 — Nómina + Vacaciones (PROD)

### 2A · Nómina ✅ (migration 017, v0.32.0)
- `rrhh_salarios` (periodo, basico, haberes, descuentos, neto, pagado, medio_pago, caja_movimiento_id)
- `rrhh_conceptos` catálogo de haberes/descuentos por tenant
- `rrhh_salario_items` con trigger `fn_recalcular_salario`
- `pagar_nomina_empleado(salario_id, sesion_id, medio_pago)` SECURITY DEFINER — verifica saldo caja
- UI: tab "Nómina" en RrhhPage · selector mes/año · generar nómina · expandible por empleado · selector medio pago
- Migration 026 agrega `medio_pago` TEXT CHECK IN ('efectivo','transferencia_banco','mp')

### 2B · Vacaciones ✅ (migration 018, v0.33.0)
- `rrhh_vacaciones_solicitud` (estado pendiente/aprobada/rechazada, dias_habiles, aprobado_por)
- `rrhh_vacaciones_saldo` (dias_totales, remanente_anterior, dias_usados) UNIQUE per empleado×año
- `aprobar_vacacion()` / `rechazar_vacacion()` SECURITY DEFINER
- `calcular_dias_habiles(desde, hasta)` excluye DOW 0 y 6

### 2C · Cumpleaños automáticos ✅ (migration 022, v0.34.0)
- EF `birthday-notifications` corre en GitHub Actions cron `0 8 * * *`
- Tab Cumpleaños en RrhhPage con calendario · widget próximos feriados
- Feriados AR 2026 cargables con 1 click

---

## ✅ Phase 3 — Asistencia + Dashboard RRHH (PROD)

### 3A · Asistencia ✅ (migration 019, v0.33.0)
- `rrhh_asistencia` UNIQUE(tenant+empleado+fecha) · estados: presente/ausente/tardanza/licencia
- CRUD con filtro mes+empleado · badges por estado

### 3B · Dashboard RRHH ✅ (v0.35.0)
- KPIs: empleados activos, asistencia %, vacaciones pendientes, nómina período
- Breakdown por departamento · exportar Excel (asistencia + nómina histórica)

---

## ✅ Phase 4 — Documentos + Capacitaciones (PROD)

### 4A · Documentos ✅ (migration 022, v0.34.0)
- `rrhh_documentos` + bucket privado `empleados` (10 MB). URL firmada 300s para descarga.
- Tab "Documentos" en RrhhPage: upload, lista, Ver, Eliminar

### 4B · Capacitaciones ✅ (migration 023, v0.34.0)
- `rrhh_capacitaciones` (estado planificada/en_curso/completada/cancelada, certificado_path)
- Tab "Capacitaciones" en RrhhPage: filtro por estado · badge · Ver cert · edit · delete

---

## ✅ Phase 5 — Supervisor Self-Service (PROD)

(migration 024, v0.35.0)

- `get_supervisor_team_ids()` SECURITY DEFINER · RLS SUPERVISOR en asistencia/vacaciones/empleados
- Tab "Mi Equipo" en RrhhPage: KPIs asistencia hoy · vacaciones pendientes · aprobar/rechazar
- Árbol organizacional · tabs por rol (SUPERVISOR ve subconjunto)

---

---

## WMS — Almacenaje Dirigido y Picking Inteligente

> Visión: el sistema sugiere dónde almacenar cada SKU en base a dimensiones/peso, y genera
> listas de picking con tareas dirigidas que guían al operador exactamente a qué ubicación ir
> y qué cantidad tomar, respetando FIFO/FEFO/serie/lote.

### Fase 1 — Estructura de producto ✅ (migration 031, v0.57.0)

- Tabla `producto_estructuras`: niveles unidad / caja / pallet con peso (kg) y
  dimensiones alto/ancho/largo (cm). `unidades_por_caja`, `cajas_por_pallet`.
- Mínimo 2 niveles activos al crear. Un único default por SKU (partial unique index).
- Base de datos para calcular capacidades de almacenaje y armar listas de picking.

### Fase 2 — Dimensiones en ubicaciones ✅ (migration 032, v0.59.0)

Nuevos campos en tabla `ubicaciones` (todos opcionales):
- `alto_cm`, `ancho_cm`, `largo_cm` — dimensiones físicas del hueco/posición.
- `peso_max_kg` — peso máximo soportado.
- `tipo_ubicacion` TEXT CHECK: `picking` | `bulk` | `estiba` | `camara` | `cross_dock`.
- `capacidad_pallets INT` — para ubicaciones tipo estiba.

UI: sección colapsable "Dimensiones WMS" en ConfigPage → Ubicaciones. Badge tipo + medidas en lista.

**Almacenaje dirigido (putaway)**: al ingresar stock, el sistema sugiere ubicación óptima
comparando dimensiones de la caja/pallet del producto vs disponibilidad en ubicaciones.
Prioridad: tipo adecuado → capacidad suficiente → menor prioridad ocupada. *(Pendiente: lógica de sugerencia — Fase 3)*

### Fase 3 — Tareas WMS y listas de picking (migration futura)

Nueva tabla `wms_tareas`:
- `tipo` ENUM: `putaway` | `picking` | `replenishment` | `conteo`.
- `estado` ENUM: `pendiente` | `en_curso` | `completada` | `cancelada`.
- `usuario_asignado_id`, `prioridad INT`, `fecha_limite`.
- FK a `inventario_lineas`, `ubicaciones` (origen y destino), `ventas` (para picking de pedidos).

**Listas de picking**: agrupan tareas de tipo `picking` por pedido/despacho.
- El sistema calcula la ruta óptima dentro del depósito (prioridad de ubicaciones).
- Cada tarea indica: SKU · LPN · N/S o lote · ubicación origen · cantidad · ubicación destino.
- Respeta regla de inventario del SKU (FIFO/FEFO/serie) para selección de línea exacta.
- Interface en InventarioPage o nueva página WMS dedicada.

### Fase 4 — Surtido y cross-docking (fase larga plazo)

- Reposición automática: cuando stock en zona picking < umbral → tarea `replenishment` desde bulk.
- Cross-docking: mercadería entrante → tarea putaway directo a zona despacho sin almacenar.
- KPIs WMS: tasa de error de picking, tiempo promedio por tarea, utilización de ubicaciones.

### Fase 2.5 — KITs / Kitting ✅ (migration 040+041, v0.65.0–v0.67.0)

- `kit_recetas` (kit_producto_id, comp_producto_id, cantidad) + `kitting_log` (tipo armado/desarmado)
- `productos.es_kit BOOLEAN` · tipos `kitting` / `des_kitting` en `movimientos_stock`
- Tab "Kits" en InventarioPage: CRUD recetas · preview "puede armar N" · modal ejecutar
- Desarmado inverso: valida stock KIT · rebaja KIT · ingresa componentes
- Clonar receta entre KITs · badge "KIT" naranja en dropdown ventas
- KIT como producto vendible (precio/stock se gestiona igual que cualquier SKU)

### Dependencias entre fases

```
Fase 1 ✅ (producto_estructuras) 
  → Fase 2 ✅ (ubicaciones con dimensiones)
    → Fase 2.5 ✅ (KITs / Kitting)
    → Fase 3 🔵 (tareas WMS + picking — pendiente)
      → Fase 4 🔵 (surtido + cross-docking — largo plazo)
```

> **Nota de arquitectura**: el schema actual es compatible con todas las fases.
> `inventario_lineas` ya tiene `ubicacion_id`, `lpn`, `nro_lote`, `fecha_vencimiento`, series.
> Al llegar a Fase 2, solo se agregan columnas a `ubicaciones` + nueva tabla `wms_tareas`.

---

## Orden recomendado

```
Phase 1 ✅ → Phase 2 ✅ → Phase 3 ✅
                        → Phase 4 ✅
                                  → Phase 5 ✅

Próximo RRHH: Bloque 5 — CHECK-IN/CHECK-OUT rápido (v0.76.0)
```

---

---

## Integraciones Externas

> Orden de implementación acordado: **TiendaNube → MercadoPago → MELI**

### Fase 0 — Schema fundacional ✅ (migration 060, v0.88.0)

- **pgcrypto**: habilitado en DEV + PROD (prerequisito para cifrado futuro de tokens).
- **ALTER TABLE `ventas`**: columnas `origen` (TiendaNube/MercadoPago/Manual), `tracking_id`, `tracking_url`, `costo_envio_logistica`, `marketing_metadata JSONB`, `id_pago_externo`, `money_release_date`, `cae`, `vencimiento_cae`, `tipo_comprobante`, `numero_comprobante`, `link_factura_pdf`.
- **ALTER TABLE `clientes`**: columnas `telefono_normalizado`, `marketing_optin`.
- **`integration_job_queue`**: cola async genérica para jobs de integración con retries (`max_retries=3`, `next_retry_at`, `payload JSONB`, `error TEXT`). Jobs se encolan y un worker los procesa — nunca llamadas síncronas a APIs externas.
- **`ventas_externas_logs`**: idempotencia para webhooks entrantes. UNIQUE(tenant_id, integracion, webhook_external_id). Evita duplicar ventas si el webhook se reintenta.

### Fase OAuth ✅ (migration 061, v0.89.0)

#### Credenciales
- **`tiendanube_credentials`**: tenant_id, sucursal_id, store_id BIGINT, store_name, store_url, access_token, conectado, UNIQUE(tenant_id, sucursal_id). Token permanente (TN no expira).
- **`mercadopago_credentials`**: tenant_id, sucursal_id, seller_id BIGINT, seller_email, access_token, refresh_token, public_key, expires_at, conectado, UNIQUE(tenant_id, sucursal_id). Token expira en 180 días.
- **`inventario_tn_map`**: mapeo producto Genesis360 ↔ producto TiendaNube por sucursal. sync_stock, sync_precio, ultimo_sync_at.

#### Edge Functions OAuth
- **`tn-oauth-callback`**: recibe `?code&state` → intercambia code por token en TN → obtiene store info → upsert en `tiendanube_credentials`. `user_id` (= store_id) viene del cuerpo del token response, NO de la URL.
- **`mp-oauth-callback`**: recibe `?code&state&error?` → intercambia code en MP → calcula `expires_at` → obtiene seller email → upsert en `mercadopago_credentials`.
- Ambas deployadas con `--no-verify-jwt` en DEV + PROD.

#### UI ConfigPage tab "Integraciones"
- Cards por sucursal mostrando estado de conexión (sin exponer tokens).
- Botón Conectar → OAuth redirect. Botón Desconectar → UPDATE `conectado=false`.
- Badge expiración para MP. Datos del seller/store visibles post-conexión.

#### Configuración de secretos
- `TN_CLIENT_SECRET` en Supabase EF secrets (DEV + PROD).
- `MP_CLIENT_SECRET` en Supabase EF secrets (DEV + PROD).
- `APP_URL` en Supabase EF secrets: DEV = `https://genesis360-git-dev-tongas86s-projects.vercel.app` · PROD = `https://app.genesis360.pro`.
- `VITE_TN_APP_ID=30376` · `VITE_MP_CLIENT_ID=7675256842462289` en Vercel (frontend, no secretos).

### Fase 1 — TiendaNube webhooks + sync stock (pendiente)

#### 1A — Webhook TiendaNube (EF `webhooks/tiendanube`)
- Recibe `order/created` + `order/paid` de TN.
- Verifica HMAC con `TN_CLIENT_SECRET` (seguridad).
- Inserta en `ventas_externas_logs` (idempotencia por `webhook_external_id`).
- Crea venta en Genesis360 con `origen='TiendaNube'`.
- Encola job en `integration_job_queue` para decrementar stock.

#### 1B — Sync stock → TiendaNube (EF worker)
- Trigger en `inventario_lineas` → inserta job en `integration_job_queue`.
- Worker EF procesa jobs → actualiza stock en TN via `PUT /v1/{store_id}/products/{tn_product_id}/variants/{tn_variant_id}` con `{ stock: N }`.
- Solo para productos mapeados en `inventario_tn_map`.

### Fase 2 — MercadoPago IPN webhooks (pendiente)

#### 2A — Webhook MP IPN (EF `webhooks/mp-ipn`)
- Recibe notificaciones de pagos de MP.
- Verifica con `x-signature` header (HMAC).
- Consulta `GET /v1/payments/{id}` con access_token del tenant.
- Actualiza `ventas.id_pago_externo` + `ventas.money_release_date`.
- No procesa cobros en nombre de otros — solo notificaciones de estado de pagos.

### Fase 3 — MELI (largo plazo)

- Registro como desarrollador en MELI Partners.
- OAuth similar a TiendaNube/MP.
- Webhooks de órdenes + sync stock.
- Mapeo de productos Genesis360 ↔ listings MELI.

### Notas de arquitectura

- **Nunca** llamadas síncronas a APIs externas en el flujo de venta — siempre via `integration_job_queue`.
- Tokens almacenados en texto plano en DB (pgcrypto instalado para cifrado futuro cuando el volumen lo justifique).
- Un tenant puede tener múltiples sucursales, cada una con sus propias credenciales por plataforma.
- La recepción de webhooks TN/MP no requiere JWT (`--no-verify-jwt`); la autenticidad se verifica via HMAC.

---

> Patrones de código (tabla RRHH, queries estándar) → ver [CLAUDE.md](CLAUDE.md) § Arquitectura multi-tenant.

---

## ✅ WhatsApp Click-to-Chat para Envíos (v1.3.0 DEV — migration 078/079)

- `src/lib/whatsapp.ts`: `normalizeWhatsApp()` (ARG: 549+área+num), `expandirPlantilla()` con vars `{{Nombre_Cliente}}` `{{Nombre_Negocio}}` `{{Numero_Orden}}` `{{Tracking}}` `{{Courier}}` `{{Fecha_Entrega}}`, `buildWhatsAppUrl()` con URL encoding
- EnviosPage: ícono verde WA en cada fila + botón "Coordinar entrega" en detalle expandido → abre WhatsApp Web/app en nueva pestaña con mensaje pre-escrito
- ConfigPage → Negocio: textarea plantilla personalizable + campo `$ por km` para delivery propio
- `tenants.whatsapp_plantilla TEXT` + `tenants.costo_envio_por_km DECIMAL`
- Limitación documentada: manual-asistido (1 clic = 1 mensaje = 1 pestaña)

---

## ✅ Mejoras Clientes (v1.3.0 DEV — migration 081)

- `cliente_notas`: historial append-only con texto, usuario_id, created_at — sub-tab "Notas" en ficha del cliente
- `clientes.fecha_nacimiento DATE`: badge 🎂 en card, rojo/rosa si es hoy el cumpleaños
- `clientes.etiquetas TEXT[]`: badges violeta + dropdown filtro en listado
- `clientes.codigo_fiscal TEXT` + `clientes.regimen_fiscal TEXT`
- Búsqueda por DNI además de nombre (`.or('nombre.ilike.%X%,dni.ilike.%X%')`)
- Botón ELIMINAR removido del card (función interna preservada)
- Sub-tabs en ficha: Historial · Domicilios · Notas

---

## ✅ Presupuestos Servicios mejorado (v1.3.0 DEV — migration 080)

- Edit/delete de presupuestos en estado `pendiente`
- Estados: `pendiente | aprobado | rechazado | convertido` con badge colorido
- Botón "Aprobar → Crear gasto": crea automáticamente en módulo Gastos y vincula `presupuesto.gasto_id`
- Botón "Rechazar": marca estado rechazado, queda visible como historial
- `servicio_presupuestos.estado TEXT` + `servicio_presupuestos.gasto_id FK gastos(id)`

---

## Fixes y mejoras UX (v1.3.0 DEV)

- **staleTime: 0** en QueryClient global → stale-while-revalidate: datos frescos al navegar sin spinner
- **Fix loop trial vencido**: botón "Cerrar sesión" en SuscripcionPage y OnboardingPage (cuando trial expira el usuario quedaba atrapado)
- **Eliminar cliente con ventas**: nullea FK en ventas/envíos antes de borrar (evita error de constraint)
- **Envíos**: bloqueo edición si estado='entregado' · servicio selectbox por courier · canal autocompletado desde venta
- **Proveedores servicios**: forma de pago como select en servicio_items
- **Config ubicaciones**: `flex-wrap` en fila agregar → botón siempre visible en mobile

---

## ✅ Ventas — prompt facturación al despachar (v1.3.0 DEV)

- Después de despachar una venta, si `tenant.facturacion_habilitada=true` y tiene CUIT configurado → aparece modal "¿Emitir comprobante?"
- Auto-detección del tipo: Monotributista→C · cliente RI→A · resto→B
- Selector punto de venta (desde `puntos_venta_afip` o input manual)
- Botón "Emitir Factura X" → llama EF `emitir-factura` → CAE en toast
- Botón "Saltar" → cierra sin facturar (venta ya despachada)
- Funciona tanto en venta nueva (registrarVenta) como en cambio de estado desde historial (cambiarEstado→despachada)
- `puntosVentaAfip` cargados lazy (solo cuando se abre el modal)

## ✅ Fix barra plan en Inventario/Productos (v1.3.0 DEV)

- `PlanProgressBar` retorna null cuando `max=-1` (Pro/Trial = ilimitado)
- Fix: en planes ilimitados muestra "X movimientos este mes · Sin límite en tu plan" en estilo neutro
- Aplicado en InventarioPage (tabs Agregar/Quitar) y ProductosPage
- **Cómo cuentan los movimientos**: 1 fila en `movimientos_stock` = 1 movimiento. Masivo de 10 productos = 10 movimientos. Free=200/mes · Básico=2.000/mes · Pro/Enterprise=ilimitado.

---

## ✅ Fixes críticos Inventario (2026-04-30 — migration 082)

### Bug: stock_actual incorrecto tras eliminar LPN
- Causa raíz: `lineas_recalcular_stock` solo disparaba en `AFTER INSERT`, no en UPDATE/DELETE
- Al eliminar LPN (`UPDATE activo=false, cantidad=0`) el trigger no corría → `stock_actual` quedaba con valor viejo
- Fix migration 082: trigger ahora dispara en `AFTER INSERT OR UPDATE OF cantidad,activo OR DELETE`
- También corregido `series_recalcular_stock` para INSERT OR UPDATE OR DELETE

### Bug: ingresos/rebajes no aparecían en HistorialPage
- Faltaba `logActividad` en `ingresoMutation`, `rebajeMutation` (InventarioPage) y en `MasivoModal`
- Los movimientos solo aparecían en `movimientos_stock` (InventarioPage/Historial) pero no en `actividad_log` (HistorialPage)

### Bug: rebaje masivo ignoraba regla FIFO/FEFO y LPNs
- Query del `MasivoModal` no incluía `fecha_vencimiento`, `lpn`, `nro_lote`
- No filtraba por `disponible_surtido`, `es_disponible_venta`, ni LPNs vencidos
- Fix: misma lógica que rebaje individual. Toast muestra qué LPN/lote se consumió.

### Bug: búsqueda no funcionaba en tabs Agregar/Quitar Stock
- `filteredMov` tenía `return tipo === 'ingreso'...` (early return) → `movSearch` nunca se evaluaba
- Fix: cambio a `if (...) return false` para que la búsqueda aplique a todos los tabs

---

## ✅ v1.5.0 PROD — Notificaciones, Caja Fuerte, PDF Factura QR, CC Clientes

### Notificaciones reales (migration 084)
- Tabla `notificaciones` (tenant_id, user_id, tipo, titulo, mensaje, leida, action_url). RLS user-only.
- `NotificacionesButton` reescrito con datos reales, refetch 30s, marcar leída/todas.
- Diferencia apertura caja → INSERT en `notificaciones` para OWNER/SUPERVISOR + email automático.

### Módulo Caja — 4 mejoras
- Diferencia apertura: warning inline en tiempo real + confirmación 2-paso + notificación supervisores.
- `getTipoDisplay()`: distingue "Ingreso Manual" vs "Venta" por patrón `#N` en concepto.
- Tab Caja Fuerte: historial depósitos, roles configurables (`tenants.caja_fuerte_roles`), trigger auto-creación.
- Tab Configuración (OWNER/SUPERVISOR): soft delete cajas, configurar roles.
- Historial sesiones: diferencia apertura y cierre por separado.

### PDF Factura con QR AFIP (RG 4291)
- `src/lib/facturasPDF.ts`: layout A4 completo con emisor, receptor, ítems IVA desglosado por tasa, totales.
- QR AFIP: JSON comprobante → base64 → `https://www.afip.gob.ar/fe/qr/?p=<base64>`.
- Botón en FacturacionPage (historial emitidas) y VentasPage modal detalle (`venta.cae !== null`).

### Cuenta Corriente Clientes — pago inline
- `registrarPagoCC()`: distribuye FIFO over CC ventas, actualiza `monto_pagado`, marca `despachada` al saldo=0.
- Panel inline en tab CC de ClientesPage.

---

## ✅ v1.6.0 DEV — OC Gestión de Pagos + CC Proveedores (migration 085)

### Estado: DEV ✅ · PROD pendiente deploy

### Campos de pago en ordenes_compra
- `estado_pago`: pendiente_pago / pago_parcial / pagada / cuenta_corriente
- `monto_total`, `monto_pagado`, `fecha_vencimiento_pago`, `dias_plazo_pago`, `condiciones_pago`
- OC nuevas arrancan con `estado_pago = 'pendiente_pago'` por defecto

### Tab "Órdenes de Compra" en GastosPage
- Lista filtrable por estado de pago y proveedor
- Badge visual contextual: 🔴 vencida (mora), ⏰ próxima (≤3d), estado normal
- Modal "Pagar / CC":
  - **Registrar pago**: monto + medio de pago. Si es Efectivo y hay caja abierta → egreso automático en `caja_movimientos`
  - **Cuenta Corriente**: selector 30/60/90d (o personalizado) + fecha vencimiento calculada + condiciones texto libre

### Bloqueo confirmar OC (ProveedoresPage)
- Botón "Confirmar" deshabilitado + mensaje cuando `estado_pago = 'pendiente_pago'`
- Tanto en listado de OC (card) como en modal detalle con instrucción a Gastos → OC

### Cuenta Corriente con Proveedores
- `proveedores.cuenta_corriente_habilitada` + `limite_credito_proveedor`
- Tabla `proveedor_cc_movimientos`: oc / pago / nota_credito / ajuste. RLS tenant.
- Función `fn_saldo_proveedor_cc(proveedor_id)` SECURITY DEFINER
- Botón CreditCard en card de proveedor → modal CC:
  - Saldo adeudado total (suma de `monto` en movimientos)
  - Panel "Registrar pago" con egreso automático a caja si efectivo
  - Historial cronológico de movimientos con fecha vencimiento y medio de pago

### AlertasPage + useAlertas
- Sección roja "OC vencidas sin pagar": días de mora, botón Regularizar → /gastos
- Sección ámbar "OC por vencer en 3 días": días restantes, botón Pagar ahora → /gastos
- Badge sidebar incluye conteo de ambas secciones
