// Contenido de la landing que comparten la página y el pre-render (scripts/prerender.mjs): las preguntas frecuentes se
// muestran en la página Y se publican como FAQPage en los datos estructurados, así nunca dicen cosas distintas.
// Formato pregunta → respuesta directa y autocontenida (doc 03 §5: que un buscador o una IA la pueda citar tal cual).
// Solo lo que la app hace hoy (Ley 24.240).
import { BRAND, PLANES } from '@/config/brand'

export const SITIO_URL = 'https://genesis360.pro'

export const FAQ = [
  {
    q: '¿Necesito tarjeta para probarlo?',
    a: `No. Tenés 30 días de prueba gratis sin cargar ninguna tarjeta. Al terminar elegís el plan que te sirva.`,
  },
  {
    q: '¿Puedo pasar los datos que ya tengo?',
    a: 'Sí. Desde el plan Pro importás productos, stock, clientes y proveedores desde una planilla de Excel o CSV, y antes de confirmar ves una vista previa con lo que va a entrar. En el plan Básico los cargás desde la app.',
  },
  {
    q: '¿Sirve para más de una sucursal?',
    a: 'Sí. El plan Básico incluye una sucursal, el Pro dos y el Enterprise cuatro; en cualquier plan podés sumar más. Cada sucursal tiene su stock, su caja y sus permisos.',
  },
  {
    q: '¿Qué pasa si mi negocio crece? ¿Tengo que cambiar de sistema?',
    a: `No. Subís de plan o sumás solo lo que necesitás, con los mismos datos. Las funciones avanzadas (depósito con ubicaciones, varias sucursales, varios CUIT) se activan cuando las necesitás.`,
  },
  {
    q: '¿Necesito instalar algo?',
    a: `No. ${BRAND.name} funciona desde el navegador en la computadora, la tablet o el celular, y en el celular lo podés instalar como una app.`,
  },
  {
    q: '¿Mis datos están seguros?',
    a: 'Sí. Cada negocio tiene sus datos aislados del resto, la conexión va cifrada y los permisos se controlan en la base de datos, no solo en la pantalla.',
  },
  {
    q: '¿Cómo es el soporte?',
    a: 'Básico y Pro tienen soporte por email. Enterprise tiene soporte prioritario.',
  },
]

/** Metadatos por página pública pre-renderizada. `jsonLd` va tal cual en un <script type="application/ld+json">. */
export interface MetaPagina {
  ruta: string
  titulo: string
  descripcion: string
  jsonLd?: object[]
}

const DESCRIPCION_HOME =
  `Sistema de gestión para negocios que venden productos: stock, ventas, caja, facturación electrónica ARCA y compras en un solo lugar. Probalo 30 días gratis, sin tarjeta.`

export function metaHome(): MetaPagina {
  const organizacion = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: BRAND.name,
    url: SITIO_URL,
    logo: `${SITIO_URL}/android-chrome-512x512.png`,
    email: BRAND.email,
    founder: [
      { '@type': 'Person', name: 'Gastón Otranto' },
      { '@type': 'Person', name: 'Federico Messina' },
    ],
    areaServed: 'AR',
  }
  const software = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: BRAND.name,
    url: SITIO_URL,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web, Android, iOS',
    inLanguage: 'es-AR',
    description: DESCRIPCION_HOME,
    // Precios reales de src/config/brand.ts (con débito automático). Un plan sin precio publicado (null) queda afuera.
    offers: PLANES.filter(p => typeof p.precio === 'number' && p.precio > 0).map(p => ({
      '@type': 'Offer',
      name: `Plan ${p.nombre}`,
      price: String(p.precio),
      priceCurrency: 'ARS',
      category: 'subscription',
    })),
  }
  const faq = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  }
  return {
    ruta: '/',
    titulo: `${BRAND.name} · Stock, ventas, caja y factura electrónica para tu negocio`,
    descripcion: DESCRIPCION_HOME,
    jsonLd: [organizacion, software, faq],
  }
}

export const META_LEGALES: MetaPagina[] = [
  { ruta: '/terminos', titulo: `Términos y condiciones · ${BRAND.name}`, descripcion: `Términos y condiciones de uso de ${BRAND.name}.` },
  { ruta: '/privacidad', titulo: `Política de privacidad · ${BRAND.name}`, descripcion: `Cómo ${BRAND.name} trata y protege los datos personales.` },
  { ruta: '/cookies', titulo: `Política de cookies · ${BRAND.name}`, descripcion: `Qué cookies usa ${BRAND.name} y para qué.` },
]

/* ── /para/construccion (doc 04 de Fede: primera página por rubro, la de más profundidad) ─────────────────────────────── */
// Términos objetivo (doc 04 §4, a validar con Search Console una vez publicada — Fase 5): "sistema de gestión para
// ferretería", "software para corralón", "sistema de stock para casa de sanitarios", "facturación AFIP para ferretería".

export const FAQ_CONSTRUCCION = [
  {
    q: '¿Cuál es un buen sistema de gestión para una ferretería en Argentina?',
    a: `Uno que maneje productos con medidas y colores sin duplicar el catálogo, precios distintos para el mostrador y para los contratistas, cuenta corriente con límite, entregas a obra y factura electrónica ARCA en el mismo lugar. ${BRAND.name} hace todo eso y se prueba 30 días gratis, sin tarjeta.`,
  },
  {
    q: '¿Sirve para un corralón de materiales?',
    a: 'Sí. Vendés por unidad, kilo, metro o metro cúbico, por bolsa o por pallet con su propio precio, y armás presupuestos que después pasan a venta sin volver a cargarlos. Desde el plan Pro, además, coordinás la entrega a obra con fecha, franja horaria y hoja de ruta para el chofer.',
  },
  {
    q: '¿Puedo tener precios distintos para contratistas y colocadores?',
    a: 'Sí. Creás categorías de clientes (por ejemplo Contratistas o Colocadores) con su descuento por producto y sus condiciones de cuenta corriente, y además podés cargar precios por cantidad. Al vender, el precio se aplica solo según el cliente y la cantidad.',
  },
  {
    q: '¿Cómo manejo un mismo producto en distintas medidas o colores?',
    a: 'Con variantes: un producto principal (por ejemplo, un caño o una pintura) y una variante por medida, color o presentación, cada una con su stock, su código y su precio.',
  },
  {
    q: '¿Factura electrónica ante ARCA (ex AFIP)?',
    a: 'Sí. Emitís Factura A, B o C según tu condición frente al IVA y la del cliente, directamente desde la venta, con el CAE de ARCA.',
  },
  {
    q: '¿Sirve para una casa de sanitarios o una pinturería?',
    a: 'Sí. Las mismas herramientas resuelven los problemas típicos del rubro: muchas medidas y presentaciones del mismo producto, precios para profesionales, presupuestos y cuenta corriente.',
  },
]

export function metaConstruccion(): MetaPagina {
  const url = `${SITIO_URL}/para/construccion`
  return {
    ruta: '/para/construccion',
    titulo: `Sistema de gestión para ferreterías y corralones · ${BRAND.name}`,
    descripcion: 'Stock con medidas y colores, precio para contratistas, presupuestos, entregas a obra y factura electrónica ARCA para ferreterías, corralones, sanitarios y pinturerías.',
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: BRAND.name, item: `${SITIO_URL}/` },
          { '@type': 'ListItem', position: 2, name: 'Construcción', item: url },
        ],
      },
      {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: FAQ_CONSTRUCCION.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
      },
    ],
  }
}
