---
name: guia_fede_certificado_plataforma
description: Pasos para que Fede saque en ARCA el certificado de PLATAFORMA de Genesis360 (su CUIT) y le habilite la consulta de padrón (autocompletar clientes por CUIT) y, opcionalmente, facturación electrónica (facturación de plataforma). 2026-10-01.
type: guia
---

# Certificado de Genesis360 en ARCA — pasos para Fede

**Para qué sirve.** Con este certificado, Genesis360 consulta en ARCA los datos de un CUIT (razón social, condición IVA,
domicilio fiscal) cuando un negocio carga un cliente o un proveedor, así no los escribe a mano. El mismo certificado
sirve también para que Genesis360 emita sus propias facturas por las suscripciones.

**Qué ya está hecho.** El pedido de certificado (archivo `genesis360-plataforma-20422374168.csr`) ya está generado a tu
nombre (CUIT 20-42237416-8, alias `genesis360plataforma`). La clave privada quedó guardada en Genesis360: no hace falta
que hagas nada con ella. Lo único que tenés que hacer es subir el CSR a ARCA dos veces (pruebas y producción) y
habilitarle los servicios.

Todo se hace entrando a arca.gob.ar con tu clave fiscal. Si un servicio no te aparece, se agrega desde
**Administrador de Relaciones de Clave Fiscal → Adherir servicio**.

## 1. Certificado de pruebas (homologación)

1. Entrá al servicio **WSASS - Autogestión Certificados Homologación**.
2. **Nuevo certificado**: nombre `genesis360plataforma`, pegá todo el contenido del archivo `.csr` (desde
   `-----BEGIN CERTIFICATE REQUEST-----` hasta `-----END CERTIFICATE REQUEST-----`) y confirmá.
3. Copiá el certificado que te devuelve (el bloque `-----BEGIN CERTIFICATE-----`) y guardalo en un archivo de texto
   llamado `homologacion.crt`.
4. **Crear autorización a servicio**: elegí el certificado `genesis360plataforma`, el servicio
   **ws_sr_constancia_inscripcion** y como CUIT representada la tuya (20422374168). Si querés probar también la
   facturación de plataforma, repetí con el servicio **wsfe**.

## 2. Certificado de producción

1. Entrá a **Administración de Certificados Digitales** → **Agregar alias**: `genesis360plataforma`, subí el mismo
   archivo `.csr` y descargá el certificado (`produccion.crt`).
2. Entrá a **Administrador de Relaciones de Clave Fiscal** → **Nueva relación** → Buscar → **ARCA** → **WebServices**
   → **Consulta de Constancia de Inscripción** (`ws_sr_constancia_inscripcion`).
3. En **Representante** elegí el computador fiscal **genesis360plataforma** y confirmá.
4. (Opcional, para la facturación de plataforma) repetí el paso 2 con **Facturación Electrónica** (`wsfe`).

## 3. Enviar

Mandale a Tonga los dos archivos `homologacion.crt` y `produccion.crt`. No son secretos (no sirven sin la clave, que
está en Genesis360).

> Los nombres de los menús de ARCA pueden variar un poco; si algo no coincide, mandá una captura.
