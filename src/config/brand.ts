// ─── Configuración de marca ───────────────────────────────────────────────────
// Cambiá estos valores en un solo lugar para actualizar toda la app

export const BRAND = {
  name: 'Stokio',
  tagline: 'El inventario inteligente para tu negocio',
  description: 'Gestioná tu stock, ventas y movimientos desde cualquier dispositivo. Simple, rápido y pensado para comercios reales.',
  email: 'hola@stokio.app',
  website: 'https://stokio.app',
  color: {
    primary: '#1E3A5F',
    accent: '#2E75B6',
    bg: '#F5F7FA',
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
