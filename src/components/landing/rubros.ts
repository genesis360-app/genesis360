// Páginas por rubro de la Fase 4 (doc 04 de Fede): misma estructura que /para/construccion, contenido PROPIO de cada rubro
// (doc 04 §4: nunca la misma página con el nombre cambiado). Cada función mencionada se verificó contra la app; las que no
// están en el plan Básico llevan `plan` y se aclaran en la página (Ley 24.240: no anunciar como incluido lo que no lo está).
// Construcción tiene su propia página, más profunda (src/pages/ParaConstruccionPage.tsx).
import { BRAND } from '@/config/brand'
import { SITIO_URL, type MetaPagina } from './contenido'

export type PlanMinimo = 'Pro' | 'Enterprise'

export interface Rubro {
  slug: string
  nombreCorto: string           // migas de pan y BreadcrumbList
  h1: string
  subtitulo: string
  tituloProblema: string
  problemas: string[]
  soluciones: { titulo: string; texto: string; plan?: PlanMinimo }[]
  tituloDia: string
  dia: { hora: string; titulo: string; texto: string }[]
  tituloFaq: string
  faq: { q: string; a: string }[]
  cierre: string
  meta: { titulo: string; descripcion: string }
  // Términos de búsqueda objetivo (doc 04 §4). A validar con Search Console después de publicar (Fase 5).
  terminos: string[]
}

export const RUBROS: Rubro[] = [
  {
    slug: 'supermercados',
    nombreCorto: 'Supermercados y almacenes',
    h1: 'El sistema de gestión para supermercados, autoservicios y almacenes.',
    subtitulo: 'Cobrá rápido con lector de código de barras, controlá lo que se vence, cambiá precios sin parar la caja y sabé qué te deja cada góndola, con una IA que te avisa lo que tenés que mirar.',
    tituloProblema: 'La fila no espera y el margen se va en lo que nadie ve.',
    problemas: [
      'Los aumentos llegan todas las semanas y cambiar cientos de precios a mano te lleva la tarde.',
      'Lo que se vence aparece cuando ya no se puede vender, y se tira.',
      'Varias cajas, varios turnos y al cierre no sabés de dónde salió la diferencia.',
      'No sabés qué productos te dejan plata y cuáles solo ocupan lugar en la góndola.',
    ],
    soluciones: [
      { titulo: 'Caja rápida con lector', texto: 'Escaneás el código con un lector o con la cámara, y cobrás con efectivo, tarjeta, transferencia o QR.' },
      { titulo: 'Venta por peso', texto: 'Fiambres, verdura o productos sueltos por gramo o kilo, con su precio por kilo.' },
      { titulo: 'Precios programados', texto: 'Cargás el aumento con la fecha en que entra en vigencia y el precio cambia solo ese día.' },
      { titulo: 'Promociones y cupones', texto: 'Descuentos por medio de pago, combos y cupones, aplicados en la caja sin que el cajero tenga que acordarse.' },
      { titulo: 'Lo que está por vencer, con descuento', texto: 'Lotes con fecha de vencimiento y un estado "próximo a vencer" que sale solo con su descuento.', plan: 'Pro' },
      { titulo: 'Cajas y turnos con arqueo', texto: 'Cada caja abre y cierra su turno, con el arqueo y las diferencias de cada cajero.' },
      { titulo: 'Reposición de góndola', texto: 'Alertas de stock bajo y el pedido al proveedor con lo que falta.', plan: 'Pro' },
      { titulo: 'Rentabilidad por producto', texto: 'Qué productos te dejan margen, cuáles no rotan y cuánta plata tenés parada en stock.' },
    ],
    tituloDia: 'Así se ve un día en tu súper.',
    dia: [
      { hora: '7:30', titulo: 'Abrís las cajas', texto: 'Cada cajero abre su turno con el efectivo inicial. Las alertas te muestran lo que quedó bajo el mínimo ayer.' },
      { hora: '9:00', titulo: 'Entra el aumento de lácteos', texto: 'El proveedor mandó la lista nueva el viernes y la cargaste programada: hoy los precios ya están cambiados.' },
      { hora: '13:00', titulo: 'Hora pico', texto: 'Las cajas cobran con lector y las promociones con tarjeta se aplican solas.' },
      { hora: '17:00', titulo: 'Revisás lo que se vence', texto: 'Los yogures que vencen esta semana ya salen con su descuento en la caja, sin reetiquetar.' },
      { hora: '21:30', titulo: 'Cierre', texto: 'Arqueo de cada caja, ventas del día por medio de pago y lo que hay que pedir mañana.' },
    ],
    tituloFaq: 'Preguntas de supermercados y almacenes',
    faq: [
      { q: '¿Cuál es un buen sistema de gestión para un supermercado o autoservicio en Argentina?', a: `Uno que cobre rápido con lector de código de barras, maneje varias cajas y turnos con arqueo, cambie precios por fecha sin parar la venta, controle vencimientos y emita factura electrónica ARCA. ${BRAND.name} hace todo eso y se prueba 30 días gratis, sin tarjeta.` },
      { q: '¿Funciona con lector de código de barras?', a: 'Sí. Funciona con cualquier lector USB o Bluetooth que escriba el código, y también con la cámara del celular o la tablet.' },
      { q: '¿Puedo vender productos por peso?', a: 'Sí. Cargás el producto en gramos o kilos con su precio por kilo y en la venta ingresás el peso, con decimales.' },
      { q: '¿Cómo manejo los aumentos de precios?', a: 'Con precios programados: cargás el precio nuevo y la fecha desde la que rige, y ese día cambia solo, sin tocar la caja.' },
      { q: '¿Controla vencimientos?', a: 'Sí, desde el plan Pro: cada ingreso puede llevar lote y fecha de vencimiento, y el stock próximo a vencer puede salir con un descuento automático.' },
    ],
    cierre: 'Probalo en tu súper o tu almacén.',
    meta: {
      titulo: `Sistema de gestión para supermercados y almacenes · ${BRAND.name}`,
      descripcion: 'Caja rápida con lector, precios programados, promociones, vencimientos, turnos con arqueo y factura electrónica ARCA para supermercados, autoservicios y almacenes.',
    },
    terminos: ['sistema para supermercado', 'sistema de caja para autoservicio', 'software para almacén con lector de código de barras', 'control de vencimientos supermercado'],
  },
  {
    slug: 'distribuidoras',
    nombreCorto: 'Distribuidoras',
    h1: 'El sistema de gestión para distribuidoras mayoristas.',
    subtitulo: 'Pedidos, preparación, reparto con hoja de ruta, precios por lista y por cantidad y cuenta corriente de cada cliente, con una IA que te dice qué está pasando en tu negocio.',
    tituloProblema: 'Muchos pedidos, muchos clientes y cada uno con sus condiciones.',
    problemas: [
      'Los pedidos llegan por teléfono y por mensaje, y alguno siempre se pierde.',
      'Cada cliente tiene su precio y su descuento, y el preparador no sabe cuál aplicar.',
      'El camión sale sin un orden claro y a la vuelta nadie sabe qué se entregó.',
      'La cuenta corriente vive en un cuaderno y los vencidos se descubren tarde.',
    ],
    soluciones: [
      { titulo: 'Pedidos con su preparación', texto: 'Cada pedido pasa por preparación con su lista de picking, y sabés en qué estado está cada uno.', plan: 'Pro' },
      { titulo: 'Reparto con hoja de ruta', texto: 'Asignás los envíos al chofer con fecha y franja horaria, y él tiene su hoja de ruta con lo que entrega ese día.', plan: 'Pro' },
      { titulo: 'Listas de precios por cliente', texto: 'Categorías de clientes (mayorista, minorista, revendedor) con su descuento por producto, y precio por cantidad.' },
      { titulo: 'Venta por bulto, caja o pallet', texto: 'Cada presentación con su precio, y el stock se descuenta en unidades.' },
      { titulo: 'Cuenta corriente con límite y vencimiento', texto: 'Cuánto debe cada cliente, qué está vencido y hasta cuánto le podés vender a cuenta.' },
      { titulo: 'Depósito ordenado', texto: 'Ubicaciones, lotes y vencimientos, para que el preparador sepa de dónde sacar cada cosa.', plan: 'Pro' },
      { titulo: 'Compras a proveedores', texto: 'Órdenes de compra, recepción contra lo pedido y la cuenta corriente de cada proveedor.', plan: 'Pro' },
      { titulo: 'Varias sucursales o depósitos', texto: 'Stock por sucursal y traslados entre depósitos, con el historial de cada movimiento. El plan Básico trae una sucursal y podés sumar más.' },
    ],
    tituloDia: 'Así se ve un día en tu distribuidora.',
    dia: [
      { hora: '7:00', titulo: 'Entran los pedidos', texto: 'Los pedidos del día quedan cargados con el precio de la lista de cada cliente.' },
      { hora: '8:30', titulo: 'Se preparan', texto: 'El depósito arma cada pedido con su lista de picking, sabiendo de qué ubicación sacar cada producto.' },
      { hora: '11:00', titulo: 'Sale el reparto', texto: 'Cada chofer tiene su hoja de ruta con las entregas, las direcciones y las franjas horarias.' },
      { hora: '16:00', titulo: 'Cobranzas', texto: 'Ves qué clientes tienen saldo vencido antes de mandarles el próximo pedido.' },
      { hora: '19:00', titulo: 'Cierre', texto: 'Lo que se vendió, lo que se cobró, lo que quedó a cuenta y la orden de compra para reponer.' },
    ],
    tituloFaq: 'Preguntas de distribuidoras',
    faq: [
      { q: '¿Cuál es un buen sistema de gestión para una distribuidora mayorista en Argentina?', a: `Uno que maneje pedidos con su preparación, reparto con hoja de ruta, listas de precios por cliente, venta por bulto y cuenta corriente con límite, con factura electrónica ARCA. ${BRAND.name} hace todo eso y se prueba 30 días gratis, sin tarjeta.` },
      { q: '¿Puedo tener una lista de precios para cada tipo de cliente?', a: 'Sí. Creás categorías de clientes con su descuento por producto y, además, precios por cantidad. Al vender, el precio se aplica solo.' },
      { q: '¿Sirve para organizar el reparto?', a: 'Sí, desde el plan Pro: cada envío lleva fecha y franja horaria, se asigna a un chofer y el chofer tiene su hoja de ruta.' },
      { q: '¿Puedo vender por caja o por bulto?', a: 'Sí. Cada producto puede tener presentaciones (caja, bulto, pallet) con su propio precio, y el stock se lleva en unidades.' },
      { q: '¿Controla la cuenta corriente de los clientes?', a: 'Sí. Cada cliente tiene su límite y su plazo, ves qué está vencido y podés frenar la venta a cuenta cuando se pasa del límite.' },
    ],
    cierre: 'Probalo en tu distribuidora.',
    meta: {
      titulo: `Sistema de gestión para distribuidoras mayoristas · ${BRAND.name}`,
      descripcion: 'Pedidos con preparación, reparto con hoja de ruta, listas de precios por cliente, venta por bulto, cuenta corriente y factura electrónica ARCA para distribuidoras.',
    },
    terminos: ['sistema para distribuidora', 'software de gestión para distribuidora mayorista', 'sistema de pedidos y reparto', 'cuenta corriente clientes distribuidora'],
  },
  {
    slug: 'dieteticas',
    nombreCorto: 'Dietéticas',
    h1: 'El sistema de gestión para dietéticas y almacenes naturales.',
    subtitulo: 'Venta a granel por gramo, productos envasados con su vencimiento, precios que se actualizan por fecha y clientes frecuentes con su historial, con una IA que te avisa lo que tenés que mirar.',
    tituloProblema: 'Mucho producto suelto, mucho producto que se vence.',
    problemas: [
      'Vendés por gramo lo que comprás por bolsa de 25 kilos, y el stock nunca da.',
      'Las semillas, harinas y frutos secos se vencen y te enterás cuando el cliente se queja.',
      'Los precios cambian seguido y el cartel de la góndola queda viejo.',
      'Tenés clientes que vuelven todas las semanas y no sabés qué compran.',
    ],
    soluciones: [
      { titulo: 'Granel por gramo o kilo', texto: 'Cargás el producto suelto con su precio por kilo y vendés el peso exacto, con decimales.' },
      { titulo: 'Compra por bolsa, venta por gramo', texto: 'La bolsa del proveedor entra como presentación y el stock se lleva en kilos.' },
      { titulo: 'Lotes y vencimientos', texto: 'Cada ingreso con su lote y fecha, y lo próximo a vencer puede salir con su descuento.', plan: 'Pro' },
      { titulo: 'Precios programados', texto: 'El precio nuevo entra solo el día que corresponde.' },
      { titulo: 'Clientes frecuentes', texto: 'Historial de compras de cada cliente, categorías con su descuento y cuenta corriente si la usás.' },
      { titulo: 'Rentabilidad por producto', texto: 'Qué te deja margen, qué no rota y cuánta plata tenés en mercadería.' },
    ],
    tituloDia: 'Así se ve un día en tu dietética.',
    dia: [
      { hora: '9:00', titulo: 'Abrís y mirás las alertas', texto: 'La harina de almendras está por debajo del mínimo y hay dos lotes de semillas que vencen este mes.' },
      { hora: '11:00', titulo: 'Llega la mercadería', texto: 'Entran tres bolsas de 25 kg de avena: el stock se suma en kilos.' },
      { hora: '15:00', titulo: 'Una clienta de siempre', texto: 'Le vendés 350 g de almendras y medio kilo de avena; queda en su historial con el descuento de su categoría.' },
      { hora: '20:00', titulo: 'Cierre', texto: 'Arqueo de la caja, lo vendido por medio de pago y qué pedir esta semana.' },
    ],
    tituloFaq: 'Preguntas de dietéticas',
    faq: [
      { q: '¿Cuál es un buen sistema de gestión para una dietética en Argentina?', a: `Uno que venda a granel por gramo, controle lotes y vencimientos, actualice precios por fecha y guarde el historial de los clientes frecuentes, con factura electrónica ARCA. ${BRAND.name} hace todo eso y se prueba 30 días gratis, sin tarjeta.` },
      { q: '¿Puedo vender a granel por gramo?', a: 'Sí. El producto se carga con su precio por kilo y en la venta ingresás el peso exacto, con decimales.' },
      { q: '¿Compro en bolsas grandes y vendo suelto: cómo queda el stock?', a: 'La bolsa del proveedor se carga como presentación del producto y el stock se lleva en kilos, así compras y ventas usan la misma cuenta.' },
      { q: '¿Avisa cuando algo está por vencer?', a: 'Sí, desde el plan Pro: cada ingreso lleva lote y fecha de vencimiento, y el sistema te muestra lo próximo a vencer.' },
    ],
    cierre: 'Probalo en tu dietética.',
    meta: {
      titulo: `Sistema de gestión para dietéticas · ${BRAND.name}`,
      descripcion: 'Venta a granel por gramo, lotes y vencimientos, precios programados, clientes frecuentes y factura electrónica ARCA para dietéticas y almacenes naturales.',
    },
    terminos: ['sistema para dietética', 'software para dietética venta a granel', 'control de vencimientos dietética'],
  },
]

export function rubroPorRuta(ruta: string): Rubro | undefined {
  return RUBROS.find(r => `/para/${r.slug}` === ruta)
}

export function metaRubro(r: Rubro): MetaPagina {
  const url = `${SITIO_URL}/para/${r.slug}`
  return {
    ruta: `/para/${r.slug}`,
    titulo: r.meta.titulo,
    descripcion: r.meta.descripcion,
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: BRAND.name, item: `${SITIO_URL}/` },
          { '@type': 'ListItem', position: 2, name: r.nombreCorto, item: url },
        ],
      },
      {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: r.faq.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
      },
    ],
  }
}
