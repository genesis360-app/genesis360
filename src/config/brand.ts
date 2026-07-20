// ─── Configuración de marca ───────────────────────────────────────────────────
// Para rebrandear la app:
//   1. Cambiar name/tagline/etc. aquí
//   2. Cambiar los colores TANTO aquí (hex) como en src/index.css (:root, formato RGB sin comas)
//
// ─── Paletas de referencia ────────────────────────────────────────────────────
// Stokio / azul marino (paleta de referencia alternativa):
//   primary: '#1E3A5F'  →  index.css: 30 58 95
//   accent:  '#2E75B6'  →  index.css: 46 117 182
//   bg:      '#F5F7FA'  →  index.css: 245 247 250
//
// Genesis360 (violeta eléctrico):
//   primary: '#0D0D0D'  →  index.css: 13 13 13
//   accent:  '#7B00FF'  →  index.css: 123 0 255
//   bg:      '#F5F0FF'  →  index.css: 245 240 255
// ─────────────────────────────────────────────────────────────────────────────

// ─── Estilos de botones centralizados ────────────────────────────────────────
// Cambiar acá afecta todos los botones de acción de la app.
export const BTN = {
  primary:   'bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl transition-all disabled:opacity-50',
  secondary: 'border-2 border-gray-200 text-gray-600 font-semibold rounded-xl hover:bg-gray-50 transition-all disabled:opacity-50',
  danger:    'bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl transition-all disabled:opacity-50',
  outline:   'border border-accent-text text-accent-text font-medium rounded-xl hover:bg-accent/10 transition-all',
  ghost:     'hover:bg-gray-100 text-gray-600 rounded-lg transition-colors',
  sm:        'px-3 py-1.5 text-sm',
  md:        'px-4 py-2.5 text-sm',
  lg:        'px-6 py-3 text-base',
}

export const APP_VERSION = 'v1.137.0'

// Versión del texto legal (Términos y Condiciones + Política de Privacidad + Cookies).
// Se guarda en tenants.terminos_version al aceptar en el alta (mig 249). Si el texto
// cambia de forma sustancial, bumpear esta fecha para poder detectar quién aceptó qué
// versión (y eventualmente re-pedir aceptación). Formato ISO YYYY-MM-DD.
export const LEGAL_VERSION = '2026-07-13'

// ⚖️ IDENTIDAD LEGAL DEL TITULAR — fuente ÚNICA (la usan T&C, Privacidad, Cookies y el pie).
// Persona física / Monotributo (decisión GO 2026-07-13). La ley de e-commerce AR (Resol.
// 424/2020 + Ley 24.240) OBLIGA a exhibir la identidad del vendedor, y estos datos deben
// figurar en T&C/Privacidad para su validez.
// Titular real (persona física / monotributo — Federico E. Messina, GO 2026-07-14). Si cambia
// la figura (p. ej. se constituye una SRL/SA), actualizar acá. `legalCompleto` pasa a true al
// no quedar ningún 'PENDIENTE' → las páginas muestran la identidad real en vez de "en definición".
export const LEGAL_TITULAR = {
  nombre: 'Federico Ezequiel Messina',
  cuit: '20-42237416-8',
  condicion: 'Responsable Monotributo',
  domicilio: 'Cnel. Ramón L. Falcón 2387, C1406, Ciudad Autónoma de Buenos Aires',
  jurisdiccion: 'la Ciudad Autónoma de Buenos Aires',
  email: 'hola@genesis360.pro',   // Contacto legal / ejercicio de derechos
}

/** true cuando ya se cargaron los datos reales del titular (no quedan PENDIENTE). */
export const legalCompleto =
  !Object.values(LEGAL_TITULAR).some((v) => v === 'PENDIENTE')

// Kill-switch del modo de operación Básico/Avanzado: en false, TODOS los tenants
// operan en avanzado (la app completa, como antes de v1.55) sin importar
// tenants.modo_operacion ni el plan, y el toggle desaparece de Configuración.
export const MODO_BASICO_ENABLED = true

// 🛑 Kill-switch del configurador de add-ons FIJOS in-app (SKU/sucursales/usuarios).
// Agregar/quitar un add-on fijo dispara un PUT /preapproval que CAMBIA EL MONTO RECURRENTE
// que MP le cobra al cliente (mp-addon-fijo). PRENDIDO el 2026-07-05 (decisión GO) para la
// validación e2e del runbook (tests/specs/mp-suscripciones-pagos.plan.md §11 paso 2) con la
// suscripción real de Fede: alta de Usuarios+1 → monto $1.000→$6.000 en MP → baja → $1.000.
// Exposición acotada: el configurador solo lo ven tenants `active` CON `mp_subscription_id`
// real (hoy en PROD: solo Fede). Si la validación falla → volver a false y redeployar.
// El estimador PÚBLICO del Landing (PricingConfigurator) NO depende de esto (solo estima),
// y el add-on TEMPORAL de movimientos tampoco (pago único ya validado).
export const ADDON_FIJO_ENABLED = true

// Planes de la cuenta MP nueva (collector 478332282, app 2672033309404649) — 2026-07-07.
// Precio con el −10% de débito automático incluido ($54k/$90k); el pago manual (lista)
// no usa planes de MP. Los planes viejos murieron con la cuenta anterior.
export const MP_PLAN_IDS: Record<string, string> = {
  basico: '142aefe11ad64fb887b5949db005f8f8',
  pro:    'f06b269057254b9da0e4a60cb89d1544',
}

// Precio de LISTA (sin el -10% de débito automático) — lo paga quien elige billing_mode
// 'manual' (transferencia/efectivo/MP pago único, sin compromiso de auto-débito). Fuente de
// verdad del monto a cobrar en modo manual (tenants.manual_monto_mensual se congela con
// este valor al pasar a manual) — independiente de PLANES[].precio, que es el número que se
// MUESTRA como destacado (con el -10%) y podría cambiar de criterio sin afectar lo ya cobrado.
export const PRECIO_LISTA: Record<string, number> = {
  basico: 60000,
  pro:    100000,
}

// Datos de transferencia para pago manual (plan aprobado 2026-07-08 — facturación de Fede).
// Se muestran en Mi Cuenta a los tenants en billing_mode='manual'.
export const DATOS_TRANSFERENCIA = {
  alias:   'DIA.SIGNO.CHASIS',
  cbu:     '0070235730004033466939',
  titular: 'Federico Ezequiel Messina',
  banco:   'Banco Galicia',
}

export const BRAND = {
  name: 'Genesis360',
  tagline: 'El inventario inteligente para tu negocio',
  description: 'Gestioná tu stock, ventas y movimientos desde cualquier dispositivo. Simple, rápido y pensado para comercios reales.',
  email: 'hola@genesis360.pro',
  website: 'https://genesis360.pro',
  // 🎯 LOGO — fuente ÚNICA del ícono in-app (sidebar, login, landing, suscripción, onboarding).
  // Apunta a un archivo generado por `scripts/gen-brand-icons.mjs` desde `brand/logo-source.png`.
  // Para cambiar el ícono EN TODOS LADOS: reemplazar `brand/logo-source.png` por el nuevo PNG
  // y correr `node scripts/gen-brand-icons.mjs` (regenera favicon + PWA + este). Cambiar la ruta
  // acá lo cambia en toda la app (el favicon del navegador sale de index.html + manifest, también
  // generados del mismo source).
  logo: '/android-chrome-192x192.png',
  // Espejo de las vars de src/index.css (:root). El color de marca se cambia en UN
  // solo lugar (esas vars); el degradé violeta→cian sale de accent + accent2.
  color: {
    primary: '#0D0D0D',
    accent: '#7B00FF',   // violeta — principal
    accent2: '#06B6D4',  // cian — fin del degradé
    bg: '#F5F0FF',
  },
  social: {
    instagram: '',
    twitter: '',
    linkedin: '',
  },
}

// ⚠ Límites/precios 2026 (propuesta GO, ver G360.Wiki/wiki/business/planes-pricing.md).
// Los límites BASE viven también en SQL (fn_plan_base_limite, mig 251) → mantener en sync con PLAN_BASE_LIMITS.
export const PLANES = [
  {
    id: 'free',
    nombre: 'Free',
    precio: 0,
    descripcion: 'Para empezar sin costo',
    destacado: false,
    limites: {
      usuarios: 1,
      productos: 50,
      comprobantes_mes: 200,
      sucursales: 1,
    },
    features: [
      '1 usuario',
      'Hasta 50 productos',
      '200 comprobantes/mes',
      '1 sucursal',
      'Gestión de inventario · Ventas · Caja',
      'Facturación electrónica AFIP',
      'Alertas de stock mínimo',
    ],
    noIncluye: [
      'Reportes',
      'Métricas avanzadas',
      'Importación masiva',
      'RRHH',
      'Modo avanzado (WMS)',
    ],
  },
  {
    id: 'basico',
    nombre: 'Básico',
    precio: 54000,        // con -10% de débito automático (destacado)
    precioManual: 60000,  // precio de lista — otros medios de pago (transferencia/efectivo/MP sin auto-débito)
    descripcion: 'Para comercios en marcha',
    destacado: false,
    limites: {
      usuarios: 5,
      productos: 2000,
      comprobantes_mes: 6000,
      sucursales: 1,
    },
    features: [
      '5 usuarios',
      'Hasta 2.000 productos',
      '6.000 comprobantes/mes',
      '1 sucursal',
      'Todo lo del plan Free',
      'Facturación electrónica AFIP',
      'Reportes · Historial · Métricas',
      'Soporte por email',
    ],
    noIncluye: [
      'Modo avanzado (WMS)',
      'RRHH',
      'Compras (OC + Recepciones) y Envíos',
      'Importación masiva',
      'Marketplace',
    ],
  },
  {
    id: 'pro',
    nombre: 'Pro',
    precio: 90000,         // con -10% de débito automático (destacado)
    precioManual: 100000,  // precio de lista — otros medios de pago
    descripcion: 'Para negocios en crecimiento',
    destacado: true,
    limites: {
      usuarios: 15,
      productos: 8000,
      comprobantes_mes: 14000,
      sucursales: 4,
    },
    features: [
      '15 usuarios',
      'Hasta 8.000 productos',
      '14.000 comprobantes/mes',
      '4 sucursales',
      'Todo lo del plan Básico',
      'Modo avanzado (WMS): lotes, series, vencimientos, FIFO/FEFO',
      'Compras (OC + Recepciones) y Envíos',
      'RRHH completo',
      'Importación masiva (CSV/Excel) · Marketplace',
      'Soporte prioritario',
    ],
    noIncluye: [],
  },
  {
    id: 'enterprise',
    nombre: 'Enterprise',
    precio: null, // precio a consultar
    descripcion: 'Para grandes operaciones',
    destacado: false,
    limites: {
      usuarios: -1, // ilimitado
      productos: -1,
      comprobantes_mes: -1, // ilimitado
      sucursales: -1,
    },
    features: [
      'Usuarios ilimitados',
      'Productos ilimitados',
      'Comprobantes y sucursales ilimitados',
      'Multi-CUIT / multi-razón social',
      'Todo lo del plan Pro',
      'Onboarding personalizado · SLA',
      'Integraciones a medida',
      'Soporte 24/7',
    ],
    noIncluye: [],
  },
]

// Límites BASE por tier (espejo de fn_plan_base_limite en SQL, mig 251). -1 = ilimitado.
// El límite EFECTIVO = base + Σ add-ons activos (ver ADDON_PACKS + tabla tenant_addons).
// ⚠ Pricing v2 (GO 2026-07-05): la dimensión metered de FLUJO es COMPROBANTES (toda venta
// finalizada del mes; presupuestos y canceladas no cuentan; enforcement SOFT — nunca se
// bloquea una venta). Movimientos dejó de ser límite (-1 = free, queda como telemetría).
// `cuits` (multi-CUIT F5/F6): 1 incluido en TODOS los planes (el CUIT del negocio); los
// emisores fiscales ADICIONALES activos se suman con el add-on "CUIT adicional". Espejo de
// fn_plan_base_limite (mig 269) — mantener en sync.
export const PLAN_BASE_LIMITS: Record<string, { sku: number; movimientos: number; comprobantes: number; sucursales: number; usuarios: number; cuits: number }> = {
  free:       { sku: 50,   movimientos: -1, comprobantes: 200,   sucursales: 1,  usuarios: 1,  cuits: 1 },
  basico:     { sku: 2000, movimientos: -1, comprobantes: 6000,  sucursales: 1,  usuarios: 5,  cuits: 1 },
  pro:        { sku: 8000, movimientos: -1, comprobantes: 14000, sucursales: 4,  usuarios: 15, cuits: 1 },
  enterprise: { sku: -1,   movimientos: -1, comprobantes: -1,    sucursales: -1, usuarios: -1, cuits: -1 },
}

// Packs de add-on por dimensión (ARS, precio de lista sin descuentos). Se suman al límite base.
// SKU / sucursales / usuarios = SOLO 'fijo' (recurrente, UN pack por dimensión — el batch lo
// reemplaza, no se acumulan). Comprobantes = 'fijo' o 'temporal' (pago único, vence 30d, para
// picos puntuales; los temporales SÍ se acumulan). Los packs de movimientos se eliminaron
// (pricing v2) — las filas históricas `dimension='movimientos'` en tenant_addons no se tocan.
// ⚠ Los precios de `cuits` son PROVISORIOS (GO define el precio final del add-on premium —
// referencia de competencia: solo se ofrece en planes de ~$150-300k). SOLO 'fijo' (recurrente,
// una razón social extra es un costo permanente). Precio a confirmar antes de exponer el pack.
export const ADDON_PACKS: Record<string, { tipos: Array<'fijo' | 'temporal'>; packs: Array<{ cantidad: number; precio: number }> }> = {
  sku:          { tipos: ['fijo'],             packs: [{ cantidad: 500, precio: 5000 }, { cantidad: 2000, precio: 10000 }, { cantidad: 8000, precio: 25000 }] },
  sucursales:   { tipos: ['fijo'],             packs: [{ cantidad: 1, precio: 15000 }, { cantidad: 3, precio: 35000 }, { cantidad: 5, precio: 55000 }] },
  usuarios:     { tipos: ['fijo'],             packs: [{ cantidad: 1, precio: 5000 }, { cantidad: 3, precio: 10000 }, { cantidad: 5, precio: 15000 }] },
  comprobantes: { tipos: ['fijo', 'temporal'], packs: [{ cantidad: 1000, precio: 10000 }, { cantidad: 5000, precio: 30000 }, { cantidad: 10000, precio: 50000 }] },
  cuits:        { tipos: ['fijo'],             packs: [{ cantidad: 1, precio: 20000 }, { cantidad: 2, precio: 35000 }, { cantidad: 3, precio: 45000 }] },
}

// Descuentos sobre el precio del plan base (propuesta GO). Definir si se acumulan.
export const PLAN_DESCUENTOS = { debito_automatico: 0.10, anual: 0.30 }

// Features habilitadas por plan (para usePlanLimits y UpgradePrompt)
// Cada plan incluye todas las features del anterior.
export const FEATURES_POR_PLAN: Record<string, string[]> = {
  free:       ['ventas', 'caja', 'gastos', 'clientes', 'inventario', 'movimientos', 'alertas'],
  basico:     ['ventas', 'caja', 'gastos', 'clientes', 'inventario', 'movimientos', 'alertas', 'reportes', 'historial', 'metricas'],
  pro:        ['ventas', 'caja', 'gastos', 'clientes', 'inventario', 'movimientos', 'alertas', 'reportes', 'historial', 'metricas', 'importar', 'rrhh', 'aging', 'marketplace', 'wms'],
  enterprise: ['ventas', 'caja', 'gastos', 'clientes', 'inventario', 'movimientos', 'alertas', 'reportes', 'historial', 'metricas', 'importar', 'rrhh', 'aging', 'marketplace', 'wms'],
}

// Plan mínimo requerido por feature (para mensajes de upgrade)
export const PLAN_REQUERIDO: Record<string, string> = {
  reportes: 'basico', historial: 'basico', metricas: 'basico',
  importar: 'pro', rrhh: 'pro', aging: 'pro', marketplace: 'pro', wms: 'pro',
}

// (MAX_MOVIMIENTOS_POR_PLAN eliminado en pricing v2 — movimientos ya no es límite; el
//  metering de flujo es PLAN_BASE_LIMITS.comprobantes.)

// NOTA: el add-on de movimientos ya NO es un pack único fijo. Los packs viven en
// ADDON_PACKS.movimientos (1.000/5.000/20.000) y se compran como add-on TEMPORAL
// (pago único, vence a 30d) vía la EF mp-addon → tenant_addons (Pricing 2026, Fase 2).
