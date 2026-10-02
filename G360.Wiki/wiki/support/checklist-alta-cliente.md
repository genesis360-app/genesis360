---
title: Checklist de alta de un cliente nuevo
category: support
tags: [soporte, onboarding, alta, facturacion, arca, modo-avanzado, empleados]
sources: [incidentes del 2º cliente real 2026-09-28/29, reference_soporte_activar_facturacion_arca, reference_avanzado_pos_exige_ubicacion]
updated: 2026-10-01
---

# Checklist de alta de un cliente nuevo

Para quien acompaña el alta (GO / Fede / soporte). Sale de lo que trabó al 2º cliente real en sus primeros dos días
(28-29/09): **cada punto es un error que ya pasó de verdad**. Recorrerlo en la primera reunión, antes de que el cliente
cargue stock o intente facturar.

---

## 1 · Modo básico o avanzado (decidirlo ANTES de cargar stock)

| | Básico | Avanzado |
|---|---|---|
| Para quién | Negocio que vende de lo que tiene, sin depósito organizado | Depósito con ubicaciones (estanterías, racks), lotes, picking |
| Stock | Sin ubicación ni estado | **Cada línea de stock necesita una ubicación** |
| POS | Vende todo el stock | 🛑 **Solo vende el stock UBICADO** |

- [ ] Explicarle la diferencia y elegir con él. **Si no tiene depósito, básico.** Se puede cambiar después.
- [ ] Si elige avanzado: crear las ubicaciones primero (Configuración → Inventario → Ubicaciones).
- [ ] Si elige avanzado: al ingresar stock, **asignarle ubicación a cada línea**. El ingreso hoy deja la ubicación vacía
      y el POS después dice "Este producto no tiene stock disponible" aunque Inventario lo muestre.
      Arreglo: Inventario → LPN → Editar → Ubicación → Guardar (o pasar a básico).
      Diagnóstico: [[reference_avanzado_pos_exige_ubicacion]] (memoria) · pendiente de producto (aviso en el POS).

## 2 · Productos

- [ ] Que el producto esté **activo** (uno desactivado no aparece en el POS).
- [ ] Precio de venta cargado (un producto en $0 se vende en $0).
- [ ] Si es carga masiva: usar los importadores (todo o nada, muestran el motivo de cada error). Categorías y
      proveedores tienen que existir antes.

## 3 · Facturación electrónica (ARCA)

Guía para el cliente: artifact `WYpzGUG42wPBCv74ya5Jmg` (⚠️ pendiente de corregir los pasos 7 y 9 — espera OK de GO).

- [ ] **Condición frente al IVA** del emisor bien cargada (RI → Facturas A/B; Monotributo/Exento → solo C).
- [ ] El **CSR se genera en la app** y se descarga como `<CUIT>.csr`. El cliente solo sube el `.crt` que le da ARCA.
      **No regenerar el CSR** después de pedir el certificado: invalida el que ya emitió ARCA.
- [ ] **Paso 7 (Administrador de Relaciones):** elegir el computador fiscal del desplegable y CONFIRMAR. El campo
      "CUIT/CUIL/CDI Usuario" + BUSCAR **va vacío** (es para delegar a un tercero).
- [ ] Error `coe.notAuthorized` al facturar = **falta la relación del paso 7** (o todavía no se tomó: puede tardar
      unos minutos).
- [ ] El **punto de venta** de la app tiene que ser **el mismo número** que el dado de alta en ARCA para web services
      (no el de "Comprobantes en línea"). No asumir que es el 1 (el 2º cliente usa el 5).
- [ ] 🛑 El certificado que da ARCA es de **PRODUCCIÓN**: **no funciona en "Modo PRUEBA"** de la app (que va a
      homologación). Con ese certificado se pasa directo a producción y se valida con **una factura real chica**.
- [ ] Antes de esa primera factura: probar ventas **sin facturar** y anularlas. Nunca "probar" facturando con el
      certificado real: cada factura de producción es un comprobante fiscal que queda.
- [ ] **Factura A**: el cliente receptor necesita **CUIT, condición IVA y domicilio fiscal** cargados en su ficha (sin
      domicilio la app no deja emitir la A). Avisarlo si factura a RI.

## 4 · Usuarios y empleados

- [ ] Empleados **sin correo**: se crean con usuario y contraseña. Entran con el **código del negocio + usuario**
      y una contraseña de un solo uso que cambian al primer ingreso.
- [ ] Rol de cada uno (Cajero, Supervisor, Depósito…). Desactivar a alguien corta su acceso; se puede reactivar.

## 5 · Caja

- [ ] Abrir la caja antes de la primera venta en efectivo (el efectivo siempre se asienta en una caja abierta).
- [ ] Una caja = una sesión abierta a la vez.

## 6 · Antes de "operar en serio"

- [ ] Las ventas, ingresos y movimientos de la etapa de prueba **quedan**. Hasta que exista "Empezar de cero"
      (plan aprobado 30/09, en desarrollo), lo único que hay es anular venta por venta.
- [ ] Confirmar con el cliente que ya vio: una venta completa, un cobro, un cierre de caja, y (si factura) una factura
      real con su CAE.

---

**Relacionado:** [[wiki/support/plataforma-soporte]] · [[wiki/features/configuracion]] · plan "Empezar de cero"
(`sources/raw/plan_empezar_de_cero.md`).
