---
name: facturacion_electronica
description: Diseño completo del módulo de facturación electrónica AFIP — decisiones, arquitectura, reglas de negocio, plan de implementación
type: project
originSessionId: 7ac12f69-1217-41e2-b6e5-3547bd561e43
---
## Decisión estratégica

**Integración propia directa con AFIP WSFE** usando la librería `@afipsdk/afip.js` como wrapper.
- SDK: `@afipsdk/afip.js` v1.1.x instalado y funcionando
- Acceso: vía AfipSDK cloud service con access_token (cuenta gratuita en afipsdk.com)
- CUIT de prueba para homologación: `20409378472` (provisto por AfipSDK, compartido por devs)
- Testing confirmado: servidor AFIP homologación OK, último comprobante B leído correctamente

**Por qué propio (no intermediario como Comprobantes.cloud):**
- Break-even vs. intermediario (~$300 USD/mes a 20 tenants) en 6-8 meses
- La "gran liga" ARG (TiendaNube, ML) todas tienen integración propia
- Ya existe infraestructura en G360: certificados, columnas CAE, bucket

## SDK — @afipsdk/afip.js

**Instalación:**
```bash
npm install @afipsdk/afip.js
```

**Constructor:**
```javascript
import Afip from '@afipsdk/afip.js'
const afip = new Afip({
  CUIT: 20409378472,      // CUIT del tenant (o CUIT de prueba)
  production: false,       // false = homologación
  access_token: 'TOKEN'   // token de afipsdk.com
})
const eb = afip.ElectronicBilling  // ← los métodos están ACÁ, no en afip directamente
```

**Métodos principales (afip.ElectronicBilling):**
| Método SDK | WSFE original | Descripción |
|---|---|---|
| `eb.getServerStatus()` | FEDummy | Verificar que AFIP responde |
| `eb.getLastVoucher(pventa, tipo)` | FECompUltimoAutorizado | Último número emitido |
| `eb.createVoucher(data)` | FECAESolicitar | Emitir comprobante → CAE |
| `eb.getVoucherInfo(num, pventa, tipo)` | FECompConsultar | Consultar comprobante emitido |
| `eb.getSalesPoints()` | FEParamGetPtosVenta | Puntos de venta habilitados |

**Tipos de comprobante (CbteTipo):**
- `1` = Factura A
- `6` = Factura B
- `11` = Factura C
- `3` = NC-A | `8` = NC-B | `13` = NC-C

**IDs de IVA (en array Iva):**
- `3` = 0% | `4` = 10.5% | `5` = 21% | `6` = 27%

**Payload createVoucher (Factura B Consumidor Final):**
```javascript
{
  CantReg: 1, PtoVta: 1, CbteTipo: 6,
  Concepto: 1,           // 1=Productos 2=Servicios 3=Ambos
  DocTipo: 99, DocNro: 0, // 99+0 = Consumidor Final
  CbteDesde: proximo, CbteHasta: proximo,
  CbteFch: 20260428,     // YYYYMMDD como entero
  ImpTotal: 1210, ImpNeto: 1000, ImpIVA: 210,
  ImpTotConc: 0, ImpOpEx: 0, ImpTrib: 0,
  MonId: 'PES', MonCotiz: 1,
  Iva: [{ Id: 5, BaseImp: 1000, Importe: 210 }]
}
```

**Respuesta createVoucher:**
```javascript
{ CAE: '12345678901234', CAEFchVto: '20260508', CbteDesde: 24945, CbteTipo: 6 }
```

**CUIT del receptor según tipo:**
- Factura B Consumidor Final: `DocTipo: 99, DocNro: 0`
- Factura B con identificación: `DocTipo: 96, DocNro: DNI_SIN_PUNTOS`
- Factura A (RI): `DocTipo: 80, DocNro: CUIT_SIN_GUIONES`

## Estructura del módulo FacturacionPage (4 tabs)

### Tab 1 — Panel de Control
- IVA Débito (ventas): `SUM(venta_items.iva_monto)` del período
- IVA Crédito (compras): `SUM(gastos.iva_monto WHERE iva_deducible=true)` del período
- Posición mensual: Débito − Crédito
- Calendario de vencimientos de declaraciones juradas

### Tab 2 — Facturación Electrónica (Emitir)
- Borradores automáticos: cuando venta es `despachada` y `facturacion_habilitada=true` → aparece borrador listo para autorizar CAE
- Multi-punto de venta: tabla `puntos_venta_afip` (nueva, vinculada a sucursales)
- Flujo: seleccionar borrador/venta → validar datos cliente → tipo comprobante auto → emitir → guardar CAE + enviar PDF por email → guardar en Biblioteca de Archivos
- Selector tipo A/B/C automático según condición IVA emisor + receptor

### Tab 3 — Libros IVA
- Libro IVA Ventas: filtros por alícuota (21%/10.5%/0%), exportar Excel/PDF para contador
- Libro IVA Compras: gastos con `iva_deducible=true`, conciliación (marcar cuáles ya fueron presentados)
- Integración RRHH: honorarios/servicios profesionales con crédito fiscal

### Tab 4 — Liquidación y Saldos
- Historial últimos 12 meses (IVA Débito/Crédito/Posición)
- Saldo técnico a favor acumulado entre meses
- Retenciones y percepciones sufridas (nueva tabla)

## Tipos de comprobante — reglas de negocio (validadas por contador)

| Emisor (tenant) | Receptor (cliente) | Comprobante |
|---|---|---|
| RI | Responsable Inscripto | **Factura A** — discrimina IVA |
| RI | Consumidor Final / Monotributista | **Factura B** — IVA incluido |
| Monotributista | Cualquier | **Factura C** — sin IVA |

## Umbral Factura B

- Venta < umbral: `DocTipo=99, DocNro=0` (Consumidor Final, sin datos)
- Venta ≥ umbral: DNI/CUIT + nombre obligatorio
- El umbral se ajusta por inflación → guardarlo en DB como `tenants.umbral_factura_b DECIMAL`

## Devoluciones

- NC electrónica OBLIGATORIA si hay factura emitida
- `devoluciones` necesita: `factura_vinculada_id`, `nc_cae`, `nc_vencimiento_cae`, `nc_numero_comprobante`

## Schema pendiente en DB

```
tenants (agregar):
  condicion_iva, razon_social, domicilio_fiscal,
  punto_venta_afip INT, facturacion_habilitada BOOL,
  umbral_factura_b DECIMAL, afipsdk_access_token TEXT (encriptado)

puntos_venta_afip (nueva tabla):
  id, tenant_id, sucursal_id, numero INT, nombre, activo

clientes (agregar):
  cuit TEXT, condicion_iva TEXT

devoluciones (agregar):
  nc_cae, nc_vencimiento_cae, nc_numero_comprobante,
  factura_vinculada_id FK ventas(id)

retenciones_sufridas (nueva tabla):
  id, tenant_id, tipo, agente, monto, fecha, certificado_url, periodo
```

## Infraestructura ya existente en G360

- `tenant_certificates` + bucket `certificados-afip` + sección ConfigPage ✅ (migration 043)
- Columnas `cae`, `vencimiento_cae`, `tipo_comprobante`, `numero_comprobante`, `link_factura_pdf` en `ventas` ✅ (migration 060)
- `alicuota_iva` en productos + `iva_monto` en venta_items ✅ (migration 042)
- `iva_monto` + `iva_deducible` + `tipo_iva` en gastos ✅ (migration 072)
- Biblioteca de Archivos (`archivos_biblioteca`) para indexar facturas emitidas ✅

## Integración con otros módulos

- **Ventas**: al despachar → si `facturacion_habilitada` → prompt "¿Facturar ahora?" → crea borrador en Tab 2
- **Gastos**: `iva_deducible=true` → inyecta automáticamente en Libro IVA Compras (datos ya existen)
- **Biblioteca de Archivos**: toda factura emitida se indexa con tags `Factura_Emitida`, `CUIT_Cliente`, `Mes_XXXX`
- **RRHH**: honorarios/liquidaciones con crédito fiscal → Tab 3 Libro IVA Compras

## Disclaimers legales (obligatorios en pie de reportes)

1. Valores estimados — no reemplazan labor de contador matriculado
2. No constituyen representación contable legal ante ARCA/AFIP
3. Genesis360 no se responsabiliza por errores en categorización impositiva del usuario
4. Dependencia de disponibilidad de ARCA y del SDK — no garantiza operatividad ininterrumpida

## Estado del testing

- ✅ SDK instalado: `@afipsdk/afip.js` (24 paquetes)
- ✅ Cuenta AfipSDK: registrada, access_token obtenido
- ✅ Conexión homologación: AppServer/DbServer/AuthServer = OK
- ✅ getLastVoucher: funciona
- ✅ createVoucher (Factura B): **CAE 86170057489609 emitido** — vto 2026-05-08
- ✅ RG 5616: campo `CondicionIVAReceptorId` requerido (5=CF, 1=RI, 4=Mono)
- ✅ Flujo completo Node.js confirmado

## Lo que está implementado en Genesis360 (v1.3.0 DEV)

### Edge Function `emitir-factura` (supabase/functions/emitir-factura/index.ts)
- `npm:@afipsdk/afip.js` en Deno ✅
- Input: `{ venta_id, tenant_id, tipo_comprobante, punto_venta }`
- Calcula neto/IVA por alícuota desde `venta_items`
- Agrupa IVA en array por alícuota para el payload WSFE
- DocTipo automático: 99(CF) / 96(DNI) / 80(CUIT-RI) según condición + umbral
- Guarda en `ventas`: cae, vencimiento_cae, tipo_comprobante, numero_comprobante
- Lee `tenants.afipsdk_token` y `tenants.cuit` para instanciar Afip()

### FacturacionPage (`/facturacion`, ownerOnly)
- **Tab Panel**: KPIs IVA Débito/Crédito/Posición + datos fiscales del tenant + disclaimer
- **Tab Facturación**: borradores (ventas despachadas sin CAE) + historial emitidas + modal emitir
- **Tab Libros IVA**: ventas (débito) y compras (crédito) con filtros alícuota, exportar Excel, conciliación checkbox
- **Tab Liquidación**: historial 12 meses, retenciones sufridas, disclaimer legal

### Config → Negocio (nuevas secciones)
- "Facturación Electrónica": toggle habilitada, CUIT, condición IVA, razón social, domicilio, umbral, token AfipSDK
- "Puntos de venta AFIP": CRUD colapsable (numero + nombre) → tabla `puntos_venta_afip`

### Clientes (nuevos campos en modal y card)
- `cuit_receptor` + `condicion_iva_receptor` — opcionales, para emisión de Facturas A/B

### Ruta en App.tsx
- `/facturacion` → `FacturacionPage` (lazy)
- Nav sidebar: Receipt icon, ownerOnly: true

## Riesgos

1. Numeración correlativa AFIP — bugs de duplicados/saltos son graves
2. Multi-tenant: cada tenant tiene su propio access_token y punto de venta
3. AFIP WSFE tiene downtime → retry robusto necesario
4. Clientes sin CUIT/condición IVA → flujo de completar datos antes de emitir
5. Certificados propios por tenant (cuando tengan CUIT activo): .crt + .key en bucket certificados-afip

## Archivos de test (en C:\Users\gasto\afip-test\)

- `test.mjs` — verifica conexión + último comprobante
- `test_emitir.mjs` — emite Factura B de prueba y obtiene CAE real de homologación
