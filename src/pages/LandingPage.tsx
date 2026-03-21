import { Link } from 'react-router-dom'
import { BRAND, PLANES } from '@/config/brand'
import {
  Package, BarChart2, ShoppingCart, Users, Shield, Zap,
  Check, X, ArrowRight, Star, ChevronDown, Menu
} from 'lucide-react'
import { useState } from 'react'

const FEATURES = [
  {
    icon: Package,
    title: 'Inventario inteligente',
    desc: 'Controlá cada unidad con trazabilidad por serie, lote y vencimiento. Sabés exactamente qué tenés y dónde está.',
  },
  {
    icon: ShoppingCart,
    title: 'Ventas con reserva de stock',
    desc: 'Registrá ventas, reservá stock automáticamente y despachá cuando corresponda. Sin errores ni doble venta.',
  },
  {
    icon: BarChart2,
    title: 'Movimientos y alertas',
    desc: 'Histórico completo de ingresos y rebajes. Alertas automáticas cuando el stock baja del mínimo.',
  },
  {
    icon: Users,
    title: 'Multi-usuario con roles',
    desc: 'Asigná roles a tu equipo: dueño, supervisor o cajero. Cada uno ve y hace solo lo que le corresponde.',
  },
  {
    icon: Shield,
    title: 'Datos 100% seguros',
    desc: 'Cada negocio tiene sus propios datos completamente aislados. Seguridad a nivel de base de datos.',
  },
  {
    icon: Zap,
    title: 'Funciona en cualquier dispositivo',
    desc: 'PWA optimizada para celular y desktop. Instalable en tu teléfono sin bajar nada de la tienda.',
  },
]

const TESTIMONIALS = [
  {
    nombre: 'Carlos M.',
    negocio: 'Ferretería El Tornillo',
    texto: 'Antes perdía horas contando stock. Ahora sé en tiempo real qué tengo y qué me falta pedir.',
    estrellas: 5,
  },
  {
    nombre: 'Laura P.',
    negocio: 'Despensa La Esquina',
    texto: 'La función de venta directa es increíble. Registro la venta y el stock se descuenta solo.',
    estrellas: 5,
  },
  {
    nombre: 'Martín R.',
    negocio: 'Kiosco Central',
    texto: 'Muy fácil de usar. Lo aprendí en un día y ya no puedo trabajar sin él.',
    estrellas: 5,
  },
]

const FAQ = [
  {
    q: '¿Necesito instalar algo?',
    a: `No. ${BRAND.name} funciona desde el navegador en cualquier dispositivo. También podés instalarlo como app en tu celular con un click.`,
  },
  {
    q: '¿Puedo probar antes de pagar?',
    a: 'Sí, todos los planes tienen 7 días de prueba gratuita sin necesidad de tarjeta de crédito.',
  },
  {
    q: '¿Mis datos están seguros?',
    a: 'Totalmente. Cada negocio tiene sus datos completamente aislados. Usamos cifrado SSL y base de datos con seguridad a nivel de fila.',
  },
  {
    q: '¿Puedo cambiar de plan después?',
    a: 'Sí, podés subir o bajar de plan en cualquier momento desde tu cuenta.',
  },
  {
    q: '¿Funciona para cualquier tipo de comercio?',
    a: `${BRAND.name} está pensado para ferreterías, kioscos, despensas, mini-mercados y cualquier negocio que necesite controlar su inventario.`,
  },
  {
    q: '¿Cómo es el soporte?',
    a: 'Plan Free tiene soporte por comunidad. Básico y Pro tienen soporte por email. Enterprise tiene soporte prioritario 24/7.',
  },
]

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-gray-100 last:border-0">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-4 text-left gap-4">
        <span className="font-medium text-gray-800">{q}</span>
        <ChevronDown size={18} className={`text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <p className="text-gray-500 text-sm pb-4 leading-relaxed">{a}</p>}
    </div>
  )
}

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="min-h-screen bg-white font-sans">

      {/* ── NAV ── */}
      <nav className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <Package size={16} className="text-white" />
            </div>
            <span className="font-bold text-xl text-primary">{BRAND.name}</span>
          </div>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-6 text-sm text-gray-600">
            <a href="#features" className="hover:text-primary transition-colors">Funciones</a>
            <a href="#precios" className="hover:text-primary transition-colors">Precios</a>
            <a href="#faq" className="hover:text-primary transition-colors">FAQ</a>
          </div>

          <div className="hidden md:flex items-center gap-3">
            <Link to="/login" className="text-sm font-medium text-gray-600 hover:text-primary transition-colors px-4 py-2">
              Ingresar
            </Link>
            <Link to="/onboarding"
              className="text-sm font-semibold bg-primary hover:bg-accent text-white px-5 py-2.5 rounded-xl transition-all">
              Empezar gratis
            </Link>
          </div>

          <button onClick={() => setMenuOpen(!menuOpen)} className="md:hidden text-gray-600">
            <Menu size={22} />
          </button>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="md:hidden border-t border-gray-100 bg-white px-4 py-4 space-y-3">
            <a href="#features" className="block text-gray-600 py-1">Funciones</a>
            <a href="#precios" className="block text-gray-600 py-1">Precios</a>
            <a href="#faq" className="block text-gray-600 py-1">FAQ</a>
            <hr className="border-gray-100" />
            <Link to="/login" className="block text-gray-600 py-1">Ingresar</Link>
            <Link to="/onboarding" className="block w-full text-center bg-primary text-white font-semibold py-2.5 rounded-xl">
              Empezar gratis
            </Link>
          </div>
        )}
      </nav>

      {/* ── HERO ── */}
      <section className="bg-gradient-to-br from-primary via-primary to-accent text-white">
        <div className="max-w-6xl mx-auto px-4 py-20 md:py-28 text-center">
          <div className="inline-flex items-center gap-2 bg-white/10 border border-white/20 rounded-full px-4 py-1.5 text-sm mb-6">
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            7 días gratis · Sin tarjeta de crédito
          </div>
          <h1 className="text-4xl md:text-6xl font-bold leading-tight mb-6">
            El inventario que<br />
            <span className="text-[#7DB9E8]">tu negocio necesita</span>
          </h1>
          <p className="text-lg md:text-xl text-blue-100 max-w-2xl mx-auto mb-10 leading-relaxed">
            {BRAND.description}
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/onboarding"
              className="flex items-center justify-center gap-2 bg-white text-primary font-bold px-8 py-4 rounded-xl hover:bg-blue-50 transition-all text-lg shadow-lg">
              Empezar gratis <ArrowRight size={20} />
            </Link>
            <a href="#features"
              className="flex items-center justify-center gap-2 border-2 border-white/30 text-white font-semibold px-8 py-4 rounded-xl hover:bg-white/10 transition-all text-lg">
              Ver funciones
            </a>
          </div>
          <p className="text-blue-200 text-sm mt-6">
            Más de <strong className="text-white">500 comercios</strong> ya controlan su stock con {BRAND.name}
          </p>
        </div>
      </section>

      {/* ── LOGOS / TIPOS DE COMERCIO ── */}
      <section className="border-b border-gray-100 py-8">
        <div className="max-w-6xl mx-auto px-4">
          <p className="text-center text-sm text-gray-400 mb-6">Pensado para todo tipo de comercio</p>
          <div className="flex flex-wrap justify-center gap-6 md:gap-10 text-gray-400 text-sm font-medium">
            {['Ferreterías', 'Kioscos', 'Despensas', 'Mini-mercados', 'Farmacias', 'Librerías', 'Almacenes'].map(t => (
              <span key={t} className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-accent rounded-full" />{t}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section id="features" className="py-20 bg-brand-bg">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-primary mb-4">
              Todo lo que necesitás en un solo lugar
            </h2>
            <p className="text-gray-500 text-lg max-w-xl mx-auto">
              Sin complicaciones, sin Excel, sin hojas de papel.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                <div className="w-11 h-11 bg-primary/10 rounded-xl flex items-center justify-center mb-4">
                  <Icon size={22} className="text-primary" />
                </div>
                <h3 className="font-bold text-gray-800 mb-2">{title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SCREENSHOT / DEMO ── */}
      <section className="py-20">
        <div className="max-w-6xl mx-auto px-4">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <span className="text-accent font-semibold text-sm uppercase tracking-wider">Trazabilidad completa</span>
              <h2 className="text-3xl md:text-4xl font-bold text-primary mt-2 mb-4">
                Sabés exactamente qué tenés y dónde está
              </h2>
              <p className="text-gray-500 leading-relaxed mb-6">
                Cada ingreso genera una línea de inventario con su propio código LPN, estado, ubicación y trazabilidad por número de serie o lote. Nunca más "creo que tengo" — ahora sabés.
              </p>
              <ul className="space-y-3">
                {[
                  'Control por número de serie, lote y vencimiento',
                  'Ubicaciones físicas dentro del negocio',
                  'Estados configurables (Disponible, Dañado, Reservado...)',
                  'Historial completo de cada movimiento',
                ].map(item => (
                  <li key={item} className="flex items-start gap-3 text-sm text-gray-700">
                    <div className="w-5 h-5 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Check size={12} className="text-green-600" />
                    </div>
                    {item}
                  </li>
                ))}
              </ul>
              <Link to="/onboarding"
                className="inline-flex items-center gap-2 mt-8 bg-primary hover:bg-accent text-white font-semibold px-6 py-3 rounded-xl transition-all">
                Probalo gratis <ArrowRight size={16} />
              </Link>
            </div>
            <div className="bg-gradient-to-br from-primary to-accent rounded-2xl p-6 shadow-xl">
              <div className="bg-white/10 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between text-white text-sm">
                  <span className="font-semibold">Inventario</span>
                  <span className="text-blue-200 text-xs">3 productos</span>
                </div>
                {[
                  { nombre: 'Tornillo hex 1/4"', stock: 142, estado: 'Disponible', color: '#22c55e' },
                  { nombre: 'Pintura blanca 4L', stock: 8, estado: 'Stock bajo', color: '#eab308' },
                  { nombre: 'Llave inglesa 12"', stock: 23, estado: 'Disponible', color: '#22c55e' },
                ].map(p => (
                  <div key={p.nombre} className="bg-white/10 rounded-lg px-3 py-2.5 flex items-center justify-between">
                    <div>
                      <p className="text-white text-sm font-medium">{p.nombre}</p>
                      <span className="text-xs font-medium px-1.5 py-0.5 rounded-full" style={{ backgroundColor: p.color + '30', color: p.color }}>
                        {p.estado}
                      </span>
                    </div>
                    <span className="text-white font-bold">{p.stock}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ── */}
      <section className="py-20 bg-brand-bg">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-3xl font-bold text-primary text-center mb-12">
            Lo que dicen nuestros clientes
          </h2>
          <div className="grid md:grid-cols-3 gap-6">
            {TESTIMONIALS.map(({ nombre, negocio, texto, estrellas }) => (
              <div key={nombre} className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
                <div className="flex gap-0.5 mb-4">
                  {Array.from({ length: estrellas }).map((_, i) => (
                    <Star key={i} size={16} className="text-yellow-400 fill-yellow-400" />
                  ))}
                </div>
                <p className="text-gray-600 text-sm leading-relaxed mb-4">"{texto}"</p>
                <div>
                  <p className="font-semibold text-gray-800 text-sm">{nombre}</p>
                  <p className="text-gray-400 text-xs">{negocio}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRECIOS ── */}
      <section id="precios" className="py-20">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-primary mb-4">Planes y precios</h2>
            <p className="text-gray-500">Empezá gratis. Crecé cuando lo necesites.</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {PLANES.map(plan => (
              <div key={plan.id}
                className={`rounded-2xl p-6 border-2 flex flex-col relative
                  ${plan.destacado
                    ? 'border-accent bg-primary text-white shadow-xl scale-105'
                    : 'border-gray-200 bg-white text-gray-800'}`}>
                {plan.destacado && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-accent text-white text-xs font-bold px-3 py-1 rounded-full">
                    MÁS POPULAR
                  </div>
                )}
                <div className="mb-5">
                  <h3 className={`font-bold text-lg ${plan.destacado ? 'text-white' : 'text-primary'}`}>{plan.nombre}</h3>
                  <p className={`text-xs mt-0.5 ${plan.destacado ? 'text-blue-200' : 'text-gray-400'}`}>{plan.descripcion}</p>
                  <div className="mt-4">
                    {plan.precio === null ? (
                      <span className={`text-2xl font-bold ${plan.destacado ? 'text-white' : 'text-primary'}`}>A consultar</span>
                    ) : plan.precio === 0 ? (
                      <span className={`text-2xl font-bold ${plan.destacado ? 'text-white' : 'text-primary'}`}>Gratis</span>
                    ) : (
                      <div>
                        <span className={`text-3xl font-bold ${plan.destacado ? 'text-white' : 'text-primary'}`}>
                          ${plan.precio.toLocaleString('es-AR')}
                        </span>
                        <span className={`text-sm ml-1 ${plan.destacado ? 'text-blue-200' : 'text-gray-400'}`}>/mes</span>
                      </div>
                    )}
                  </div>
                </div>

                <ul className="space-y-2 flex-1 mb-6">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <Check size={15} className={`flex-shrink-0 mt-0.5 ${plan.destacado ? 'text-green-400' : 'text-green-500'}`} />
                      <span className={plan.destacado ? 'text-blue-100' : 'text-gray-600'}>{f}</span>
                    </li>
                  ))}
                  {plan.noIncluye.map(f => (
                    <li key={f} className="flex items-start gap-2 text-sm opacity-50">
                      <X size={15} className="flex-shrink-0 mt-0.5 text-gray-400" />
                      <span className={plan.destacado ? 'text-blue-200' : 'text-gray-400'}>{f}</span>
                    </li>
                  ))}
                </ul>

                <Link to={plan.precio === null ? `mailto:${BRAND.email}` : '/onboarding'}
                  className={`block text-center font-semibold py-3 rounded-xl transition-all text-sm
                    ${plan.destacado
                      ? 'bg-white text-primary hover:bg-blue-50'
                      : 'bg-primary text-white hover:bg-accent'}`}>
                  {plan.precio === null ? 'Contactar' : plan.precio === 0 ? 'Empezar gratis' : 'Probar 7 días gratis'}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="py-20 bg-brand-bg">
        <div className="max-w-2xl mx-auto px-4">
          <h2 className="text-3xl font-bold text-primary text-center mb-12">Preguntas frecuentes</h2>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-6">
            {FAQ.map(({ q, a }) => <FAQItem key={q} q={q} a={a} />)}
          </div>
        </div>
      </section>

      {/* ── CTA FINAL ── */}
      <section className="py-20 bg-gradient-to-r from-primary to-accent">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            ¿Listo para tomar el control de tu inventario?
          </h2>
          <p className="text-blue-100 text-lg mb-8">
            Empezá hoy. 7 días gratis, sin tarjeta de crédito.
          </p>
          <Link to="/onboarding"
            className="inline-flex items-center gap-2 bg-white text-primary font-bold px-10 py-4 rounded-xl hover:bg-blue-50 transition-all text-lg shadow-lg">
            Crear cuenta gratis <ArrowRight size={20} />
          </Link>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="bg-primary text-blue-200 py-10">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-white/10 rounded-lg flex items-center justify-center">
                <Package size={14} className="text-white" />
              </div>
              <span className="font-bold text-white">{BRAND.name}</span>
            </div>
            <div className="flex gap-6 text-sm">
              <a href="#features" className="hover:text-white transition-colors">Funciones</a>
              <a href="#precios" className="hover:text-white transition-colors">Precios</a>
              <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
              <a href={`mailto:${BRAND.email}`} className="hover:text-white transition-colors">Contacto</a>
            </div>
            <p className="text-xs text-blue-300">© {new Date().getFullYear()} {BRAND.name}. Todos los derechos reservados.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
