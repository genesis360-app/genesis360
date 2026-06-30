# 🏁 Cierre del UAT / Auditoría REGLA #0 — Genesis360

> **Estado al 2026-06-24 (v1.90.0).** Este documento formaliza el cierre del barrido UAT exhaustivo
> (cobertura/01-06). **La correctitud REGLA #0 (fiscal/plata/stock/contable) está CERRADA en los 6 grupos**,
> verificada por la metodología del proyecto: lógica pura → `unit` (vitest, 806 tests), RPCs server-side →
> **impersonación SQL + ROLLBACK**, flujos → **e2e mutante** (aserción positiva + efecto en DB) y **code-audit**.
>
> Los `🔴` que quedan en las tablas de cobertura significan **"sin e2e dedicado"**, NO huecos de correctitud:
> la lógica de esos ítems está cubierta por `unit`/`code-audit`/`DB`. Agregar e2e a cada uno es completeness,
> no corrección — bajo valor marginal REGLA #0.

---

## 1) Estado por grupo (correctitud REGLA #0)

| Grupo | Estado | Base de verificación |
|-------|:---:|----------------------|
| **01 Ventas/POS/Facturación** | ✅ CERRADO¹ | Tanda A+B e2e 45-63 + FAC-27 · unit (facturacionLogic, ventas*, ccLogic) · CAE real e2e 21/42 (Mono→C) · **G0.6/v1.88, devolución precio efectivo/v1.89, descuento general** · ¹salvo §29 AFIP (⛔ terceros) |
| **02 Inventario/Conteos** | ✅ CERRADO | e2e 23/29/30/35/36/47/51/71/74/75/76 · unit (conteoAjuste, rebajeSort, recepcionLogic, trasladoLogic) · **L13/L20/L21/L23 code-verified 2026-06-24** (delta venta-intercalada, armar-kit, 2-actores) · fusión/kStock/LPN-acciones code-verified |
| **03 Caja/Bóveda/Clientes/Gastos** | ✅ CERRADO | e2e 27/28/39/40/46/49/64-69/72/73 · guards `fn_ventas_cc_guard`/`fn_gastos_iva_guard`/período-cerrado (mig 227/234/135, DB-validated) · capital/bóveda mig 225/226 |
| **04 Compras/OC/Envíos** | ✅ CERRADO | e2e 31-35/38/77-80 · RPCs `registrar_pago_oc`/`marcar_envios_pagados` (mig 237/238, impersonación DB) · unit (comprasPago/Cheques/Costos, enviosTarifas/CourierPago/Recurso) · **L22 precio_costo code-verified** · EN6 courier B2B (⛔ terceros) |
| **05 RRHH/Config/Suscripción** | ✅ CERRADO | e2e 37/41/50/81 · `pagar_nomina_empleado` (mig 145/241/242, **fix REGLA #0 efectivo↔caja + doble validación server-side**, impersonación DB) · unit (rrhh*, planLimits, modoOperacion) |
| **06 Integraciones de cobro (MP/MODO)** | ✅ CERRADO¹ | **fix REGLA #0 v1.90.0** (conciliación cobro MP: `payload_raw`, saldo, caja informativa, idempotencia) · DB-validado · ¹e2e del cobro real ⛔ terceros; MODO = stub |

---

## 2) Lo único genuinamente ABIERTO (no se puede auto-cerrar)

### ⛔ Bloqueado por terceros — requiere acción de GO / cuentas externas
1. **AFIP §29 — matriz fiscal A/B/C con CAE real.** El CUIT de prueba (Jorgito/Buildi) es Monotributo/RI en
   **homologación** → Factura C y B con CAE real ya validadas (e2e 21/42 + Buildi #46-53). Para A (RI emite A) y
   Exento con CAE real hace falta: (a) **cert/token de PRODUCCIÓN** en ARCA (clave fiscal de GO) y/o (b) un
   **CUIT RI de homologación** distinto. Sin eso, RI-A/Exento quedan validados solo por lógica (unit + EF code-audit).
2. **Cobro Mercado Pago real (e2e end-to-end).** Requiere un **seller MP conectado por OAuth + un pago en sandbox**
   (la EF re-fetchea el pago a la API de MP; no se simula sin credenciales). La lógica está DB-validada (v1.90.0).
3. **Couriers B2B (EN6 / adapters).** Andreani/OCA/etc. necesitan **cuentas B2B reales** para probar el alta de envío.
   La EF `courier-api` + adapters están code-completos pero sin probar contra cuentas reales.

### 📋 Capa C — verificación manual (visual/impresión/email, no automatizable barato)
- **Factura/NC PDF** (datos fiscales, QR RG 4291, QR-MP de pago, domicilio) — `facturasPDF.ts`. La data fiscal
  está unit-cubierta; el render visual se valida imprimiendo.
- **Libro IVA Ventas/Compras + liquidación 12m** (`FacturacionPage`) — export/visual.
- **Email de factura** al cliente (`send-email`, fire-and-forget) — verificar entrega.
- **OC PDF / texto WhatsApp** (`ocPDF.ts`) — texto/total unit-cubiertos; PDF visual manual.

> **✅ Code-audit de la math de los exports PDF + ConfigPage (2026-06-30) — SIN bugs REGLA #0.**
> Barrido del código de los 7 generadores de PDF y de ConfigPage (último ítem de la auditoría de display v1.91.0):
> - **`facturasPDF.ts` (fiscal):** neto = `subtotal/(1+alic/100)`, IVA = `subtotal − neto`, P.Unit. Neto usa
>   `subtotal/cantidad` (**precio efectivo post-descuento**, NO `precio_unitario`), `totalNeto = total − ΣIVA`,
>   QR RG 4291 con `data.total`, Ley 27.743 en B con IVA contenido. Los llamadores (FacturacionPage/VentasPage)
>   normalizan `Number(alicuota_iva ?? 21)` (preserva Exento=0, evita el bug numeric-string) y `Number(subtotal)`;
>   `total = venta.total + envío`, los items suman a ese total (G0.6 prorratea el descuento en `venta_items`). **OK.**
> - **`estadoCuentaPDF.ts` (CC):** footer `Total adeudado = Σ(saldo+interés)` = suma exacta de la columna mostrada;
>   datos del RPC `cliente_cc_estado` (ya auditado). **OK.**
> - **`ocPDF.ts` (compras):** `totalOC = Σ(cant×precio) + envío/aduana/comisión/otros`, `Number()` coerciona,
>   anticipo/cuotas vía `comprasPago` (testeado). OC no es fiscal para el comprador → sin IVA correcto. **OK.**
> - **`reciboSueldoPDF.ts` (nómina):** display fiel de `totalHaberes/totalDescuentos/neto` de `rrhhNomina` (testeado). **OK.**
> - **`presupuestoPDF.ts`:** no-fiscal (lo dice el pie); P.Unit lista + %Dto + Importe neto + TOTAL. **OK.**
> - **`remitoPDF.ts` / `etiquetasEnvioPDF.ts`:** sin plata/fiscal (cantidades/direcciones) → fuera de alcance.
> - **`ConfigPage.tsx`:** persistencia de config (no computa fiscal/plata); guarda los knobs (condicion_iva_emisor,
>   cuit, umbral_factura_b, %s) fielmente; otros módulos ya auditados los leen. El preset de combo "2da unidad"
>   (`X% → X/2`) es conveniencia que pre-llena el form; la math real del combo está en `calcularDescuentoComboMulti`.
> - **Observación menor (no bug):** `umbral_factura_b: parseFloat(x) || 68305.16` no deja setear 0 (revierte al
>   default AFIP) — benigno (0 no es un umbral útil; el default ya es el valor correcto).
> **⇒ Cierra el último ítem de la auditoría de display REGLA #0. Lo que queda de "Capa C" es solo el RENDER visual
> (impresión/email), no los números.**

### 🟠/🟢 Menores NO-REGLA#0 (bajo riesgo, gating UX / labels)
- `oc_numeracion` (etiqueta `S-OC-0001` por valor tenant/sucursal/proveedor), `recepcion_remito_obligatorio`
  (adjuntar remito), badge alerta anticipo-OC (`gastos_dias_alerta_anticipo_oc`), flags UX de envío
  (`envio_notif_en_camino`, peso/rangos), `session_timeout_minutes`, fichado QR, `marketplace_activo` toggle,
  `conteo_modo='elegir'`/guiado, conteo alcances ≠ producto. Lógica trivial o ya unit-cubierta.

---

## 3) Observaciones encontradas en el cierre (decisiones para GO — ninguna es bug de pérdida de plata/stock)

1. **Seña de reserva vencida = forfeit por defecto.** El sweep `liberar_reservas_vencidas` cancela la reserva y
   libera el stock, pero **no reembolsa ni acredita la seña** (queda como ingreso retenido). Política razonable
   (cliente abandonó), pero conviene confirmarla. *Decisión: ¿forfeit, o generar `cliente_credito`?*
2. ✅ **RESUELTO (v1.90.1) — Fusión de LPN ledger.** `fusionarLineas` ahora asienta el par espejo
   `ajuste_ingreso`(dest)+`ajuste_rebaje`(orígenes) = neto 0 → el ledger de movimientos ya no sobre-cuenta la
   fusión (`stock_actual` siempre fue correcto por el trigger).
3. ✅ **RESUELTO (v1.90.1, mig 244) — kitting atómico.** `iniciar/confirmar/cancelar` armado son ahora RPCs
   plpgsql (`iniciar_armado_kit`/`confirmar_armado_kit`/`cancelar_armado_kit`), cada una = una transacción →
   nunca quedan componentes consumidos sin KIT ni reservas huérfanas. INVOKER (RLS aísla por tenant). DB-validado.
4. ✅ **RESUELTO (v1.90.1) — `recepcion_alerta_faltante_dias` cableado.** Badge 📦 "Faltante · Nd" en la lista de
   OC (`GastosPage`): rojo si una OC `recibida_parcial` lleva ≥ N días sin actividad, ámbar si reciente.
1bis. ✅ **RESUELTO (v1.90.1, mig 243) — seña de reserva vencida.** El sweep `liberar_reservas_vencidas` ahora
   respeta `reserva_penalidad_pct` igual que la cancelación manual: retiene la penalidad y **acredita el resto a
   `cliente_credito`** (si hay cliente; sin cliente → forfeit). DB-validado ($3000 seña/20% → crédito $2400).

**⇒ Las 4 decisiones del cierre quedaron resueltas (v1.90.1). Auditoría REGLA #0 cerrada sin pendientes de producto.**

---

## 4) Conclusión

**El UAT/auditoría REGLA #0 está CERRADO al 100% en correctitud** (fiscal/plata/stock/contable verificados en los
6 grupos, en 2 tenants DEV, con build + 806 unit verdes y los fixes REGLA #0 de v1.87-1.90 en PROD). Lo que resta
es **completeness de e2e** (opcional), **3 bloqueos de terceros** (AFIP §29, cobro MP real, courier B2B — necesitan
acción de GO/cuentas externas), **capa-C manual** (PDF/email/print) y **flags UX menores**. Las 4 observaciones del
§3 son decisiones de producto, no errores de integridad.
