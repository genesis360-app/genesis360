// ─── Configuración de marca ───────────────────────────────────────────────────
// Para rebrandear la app:
//   1. Cambiar name/tagline/etc. aquí
//   2. Cambiar los colores TANTO aquí (hex) como en src/index.css (:root, formato RGB sin comas)
//
// ─── Paletas de referencia ────────────────────────────────────────────────────
// Stokio (azul marino):
//   primary: '#1E3A5F'  →  index.css: 30 58 95
//   accent:  '#2E75B6'  →  index.css: 46 117 182
//   bg:      '#F5F7FA'  →  index.css: 245 247 250
//
// Genesis360 (violeta eléctrico):
//   primary: '#0D0D0D'  →  index.css: 13 13 13
//   accent:  '#7B00FF'  →  index.css: 123 0 255
//   bg:      '#F5F0FF'  →  index.css: 245 240 255
// ─────────────────────────────────────────────────────────────────────────────

export const BRAND = {
  name: 'Genesis360',
  tagline: 'El inventario inteligente para tu negocio',
  description: 'Gestioná tu stock, ventas y movimientos desde cualquier dispositivo. Simple, rápido y pensado para comercios reales.',
  email: 'hola@genesis360.app',
  website: 'https://genesis360.app',
  color: {
    primary: '#0D0D0D',
    accent: '#7B00FF',
    bg: '#F5F0FF',
  },
  social: {
    instagram: '',
    twitter: '',
    linkedin: '',
  },
}

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
    },
    features: [
      '1 usuario',
      'Hasta 50 productos',
      'Gestión de inventario',
      'Movimientos de stock',
      'Alertas de stock mínimo',
    ],
    noIncluye: [
      'Módulo de ventas',
      'Reportes',
      'Soporte prioritario',
    ],
  },
  {
    id: 'basico',
    nombre: 'Básico',
    precio: 4900,
    descripcion: 'Para pequeños comercios',
    destacado: false,
    limites: {
      usuarios: 2,
      productos: 500,
    },
    features: [
      '2 usuarios',
      'Hasta 500 productos',
      'Todo lo del plan Free',
      'Módulo de ventas',
      'Reportes básicos',
      'Soporte por email',
    ],
    noIncluye: [
      'Usuarios ilimitados',
      'Importación masiva',
    ],
  },
  {
    id: 'pro',
    nombre: 'Pro',
    precio: 9900,
    descripcion: 'Para negocios en crecimiento',
    destacado: true,
    limites: {
      usuarios: 10,
      productos: 5000,
    },
    features: [
      'Hasta 10 usuarios',
      'Hasta 5.000 productos',
      'Todo lo del plan Básico',
      'Importación masiva (CSV/Excel)',
      'Trazabilidad por serie y lote',
      'Grupos de estados personalizados',
      'Reportes avanzados',
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
    },
    features: [
      'Usuarios ilimitados',
      'Productos ilimitados',
      'Todo lo del plan Pro',
      'Onboarding personalizado',
      'SLA garantizado',
      'Integraciones a medida',
      'Soporte 24/7',
    ],
    noIncluye: [],
  },
]
