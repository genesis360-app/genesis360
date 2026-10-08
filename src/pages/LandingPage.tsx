import { Link } from 'react-router-dom'
import { BRAND, PLANES } from '@/config/brand'
import PricingConfigurator from '@/components/PricingConfigurator'
import { Check, X, ArrowRight, Star, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '@/styles/landingHero.css'
import '@/styles/landing.css'
import {
  SeccionProblema, SeccionSolucion, SeccionModulos, SeccionIA, SeccionEscalabilidad, SeccionRubros, SeccionFundadores,
  TelefonoPanel,
} from '@/components/landing/LandingSecciones'
import { FAQ } from '@/components/landing/contenido'
import { LandingNav, LandingCierre, LandingPie } from '@/components/landing/LandingMarco'

// 🛑 Testimonios: SOLO de clientes reales, con su permiso (GO 2026-10-06). Acá había 3 inventados ("Carlos M., Ferretería
// El Tornillo"…, 5 estrellas) publicados en PROD: publicidad engañosa (Ley 24.240), lo marcó el doc 00 de Fede. El slot
// queda armado y no se muestra mientras la lista esté vacía (Landing 2.0, wiki/business/plan-landing-2.md).
const TESTIMONIALS: { nombre: string; negocio: string; texto: string; estrellas: number }[] = []

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-zinc-200">
      <button onClick={() => setOpen(!open)} aria-expanded={open}
        className="w-full flex items-center justify-between py-5 text-left gap-6">
        <span className="text-lg font-medium tracking-tight">{q}</span>
        <ChevronDown size={20} className={`text-zinc-400 flex-shrink-0 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>
      <div className="lp-faq-panel" data-abierto={open}>
        <div><p className="text-zinc-600 pb-6 leading-relaxed max-w-[64ch]">{a}</p></div>
      </div>
    </div>
  )
}

export default function LandingPage() {

  return (
    <div className="landing min-h-screen">

      <LandingNav enHome />

      {/* ── HERO ── (2026-10-05) Asimétrico: mensaje a la izquierda, el producto REAL a la derecha (captura del POS de
          DEV) con el ticket de esa misma venta "imprimiéndose". Movimiento en src/styles/landingHero.css. */}
      <section className="landing-hero relative overflow-hidden bg-[#FAFAFC] text-[#0D0D0D]">
        <div className="max-w-6xl mx-auto px-4 pt-12 pb-48 md:pt-16 lg:pt-20 lg:pb-52 grid gap-12 lg:gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] items-center">

          <div className="max-w-xl">
            <h1 className="hero-in hero-titulo text-[2.6rem] leading-[1.05] sm:text-5xl lg:text-[3.6rem] font-semibold tracking-[-0.035em]" style={{ ['--i' as any]: 0 }}>
              Vendé, cobrá y sabé{' '}
              <span className="relative whitespace-nowrap">
                qué te queda.
                <span aria-hidden className="absolute left-0 right-0 -bottom-2.5 h-[5px] rounded-full bg-accent/80" />
              </span>
            </h1>
            <p className="hero-in mt-6 text-lg leading-relaxed text-zinc-600 max-w-[46ch]" style={{ ['--i' as any]: 1 }}>
              Stock, caja, facturación electrónica y pedidos en una sola cuenta. Probalo 30 días gratis, sin tarjeta.
            </p>
            <div className="hero-in mt-9 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6" style={{ ['--i' as any]: 2 }}>
              <Link to="/onboarding"
                className="hero-press inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-6 py-3.5 text-base font-semibold text-white hover:bg-[#6A00DD] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                Probar gratis <ArrowRight size={18} className="hero-arrow" />
              </Link>
              <a href="#solucion"
                className="hero-press inline-flex items-center justify-center gap-2 rounded-xl px-2 py-3.5 text-base font-medium text-zinc-700 hover:text-[#0D0D0D] underline decoration-zinc-300 underline-offset-[6px] hover:decoration-[#0D0D0D]">
                Ver cómo funciona
              </a>
            </div>
          </div>

          {/* Producto real en una tablet (captura del POS de DEV) + la impresora de tickets imprimiendo esa misma venta + un
              celular con otra función: el Panel con lo que detectó Genesis360 (pedido de GO 2026-10-07). */}
          <div className="relative lg:-mr-[4vw] xl:-mr-[7vw]">
            {/* Tablet horizontal: bisel oscuro, cámara arriba al centro; la pantalla se revela de abajo hacia arriba. */}
            <div className="hero-in relative rounded-[1.6rem] sm:rounded-[2rem] bg-gradient-to-b from-[#26262c] to-[#121216] p-[9px] sm:p-[13px] shadow-[0_40px_90px_-35px_rgba(40,10,90,0.5),inset_0_0_0_1px_rgba(255,255,255,0.07)]" style={{ ['--i' as any]: 1 }}>
              <span aria-hidden className="absolute left-1/2 top-[3px] sm:top-[5px] h-[5px] w-[5px] -translate-x-1/2 rounded-full bg-[#34343c]" />
              <div className="hero-shot overflow-hidden rounded-[0.95rem] sm:rounded-[1.15rem] bg-white">
                <picture>
                  <source srcSet="/landing/pos-venta.webp" type="image/webp" />
                  <img src="/landing/pos-venta.jpg" width={1184} height={760}
                    alt="Pantalla de Ventas de Genesis360 en una tablet, con una Coca Cola y una yerba en el carrito"
                    className="block w-full h-auto" decoding="async" {...{ fetchpriority: 'high' }} />
                </picture>
              </div>
            </div>

            {/* Impresora de tickets vista desde arriba: la ranura negra está al medio del cuerpo y el ticket sale de ahí, POR
                ENCIMA de la impresora (pedido de GO 2026-10-07). Capas: cuerpo (z-10) < papel (z-20) < labio de la ranura (z-30),
                así el papel parece salir de adentro. El contenedor del papel arranca en la ranura y recorta lo que todavía
                "está adentro" mientras se imprime (.hero-ticket en landingHero.css). */}
            <div className="hero-in absolute left-3 -bottom-1 w-[12.75rem] sm:left-6 sm:w-[14.5rem] lg:-left-14" style={{ ['--i' as any]: 7 }} aria-hidden>
              <div className="relative">
                <div className="relative z-10 h-[64px] rounded-[16px] bg-gradient-to-b from-[#34343b] to-[#16161a] shadow-[0_16px_32px_-12px_rgba(13,13,13,0.6),inset_0_1px_0_rgba(255,255,255,0.09)]">
                  <span className="absolute left-3 top-2.5 h-[6px] w-[6px] rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
                  <span className="absolute right-3 top-2.5 flex gap-1"><span className="h-[5px] w-4 rounded-full bg-white/10" /><span className="h-[5px] w-[5px] rounded-full bg-white/10" /></span>
                </div>
                {/* Ranura al medio del cuerpo */}
                <div className="absolute inset-x-2.5 top-[29px] z-30 h-[6px] rounded-full bg-[#050506] shadow-[inset_0_1px_2px_rgba(0,0,0,0.95),0_1px_0_rgba(255,255,255,0.07)]" />
                {/* El papel sale de la ranura, sobre la impresora */}
                <div className="absolute inset-x-4 top-[32px] z-20 overflow-hidden">
                  <div className="hero-ticket">
                    <div className="hero-ticket-paper hero-mono bg-white px-3.5 sm:px-4 pt-3 text-[10px] sm:text-[11px] leading-[1.55] text-zinc-800 shadow-[0_18px_40px_-18px_rgba(13,13,13,0.45)]">
                      <p className="text-center font-semibold tracking-[0.12em] text-[#0D0D0D]">TICKET</p>
                      <p className="text-center text-zinc-500">Consumidor final</p>
                      <div className="my-2 border-t border-dashed border-zinc-300" />
                      {/* La misma venta de la captura de la tablet (POS de DEV, Almacén Jorgito, 08/10): si se recaptura, actualizar acá. */}
                      <div className="flex justify-between gap-3 whitespace-nowrap"><span>1 Coca Cola 1.5L</span><span>$1.657</span></div>
                      <div className="flex justify-between gap-3 whitespace-nowrap"><span>1 Yerba Mate 500g</span><span>$2.500</span></div>
                      <div className="my-2 border-t border-dashed border-zinc-300" />
                      <div className="flex justify-between font-semibold text-[#0D0D0D] text-[12.5px]"><span>TOTAL</span><span>$4.157</span></div>
                      <div className="flex justify-between text-zinc-500"><span>Efectivo</span><span>$4.157</span></div>
                      <p className="mt-2 text-center text-zinc-500">Gracias por su compra</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Celular: el Panel, con lo que detectó Genesis360. Desde sm (en un celular real taparía la tablet). */}
            <div className="hidden sm:block absolute -right-2 -bottom-24 w-[9.35rem] lg:w-[10.625rem] lg:-bottom-28 xl:right-[4vw]">
              <div className="hero-in" style={{ ['--i' as any]: 9 }}>
                <TelefonoPanel />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 2-7 · Landing 2.0 (docs de Fede; la comparativa con otros sistemas se sacó por decisión de GO) ── */}
      <SeccionProblema />
      <SeccionSolucion />
      <SeccionModulos />
      <SeccionIA />
      <SeccionEscalabilidad />

      {/* ── PRECIOS ── */}
      <section id="precios" className="scroll-mt-20 py-24 md:py-32">
        <div className="max-w-6xl mx-auto px-4">
          <div className="mb-14 grid gap-6 lg:grid-cols-2 lg:items-end">
            <h2 className="text-[2.1rem] leading-[1.08] sm:text-5xl font-semibold tracking-[-0.03em]">Planes y precios</h2>
            <p className="text-lg text-zinc-600 max-w-[48ch]">Empezá gratis y activá lo que necesites cuando lo necesites. 30 días de prueba, sin tarjeta.</p>
          </div>
          <div className={`grid md:grid-cols-2 gap-6 ${PLANES.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4'}`}>
            {PLANES.map(plan => (
              <div key={plan.id}
                className={`rounded-3xl p-6 border flex flex-col relative lp-num
                  ${plan.destacado
                    ? 'border-[#0E0B16] bg-[#0E0B16] text-white shadow-[0_30px_60px_-30px_rgba(60,20,120,0.6)] lg:-translate-y-3'
                    : 'border-zinc-200 bg-white text-zinc-800'}`}>
                {plan.destacado && (
                  // "Recomendado", no "Más popular": sin clientes todavía, "el más elegido" sería un dato inventado (Ley 24.240).
                  <div className="absolute -top-3 left-6 bg-gradient-to-r from-[#7B00FF] to-[#06B6D4] text-white text-xs font-semibold px-3 py-1 rounded-full">
                    Recomendado
                  </div>
                )}
                <div className="mb-5">
                  <h3 className={`font-semibold text-xl tracking-tight ${plan.destacado ? 'text-white' : 'text-[#0D0D0D]'}`}>{plan.nombre}</h3>
                  <p className={`text-xs mt-0.5 ${plan.destacado ? 'text-white/60' : 'text-zinc-500'}`}>{plan.descripcion}</p>
                  <div className="mt-4">
                    {plan.precio === null ? (
                      <span className={`text-2xl font-bold ${plan.destacado ? 'text-white' : 'text-[#0D0D0D]'}`}>A consultar</span>
                    ) : plan.precio === 0 ? (
                      <span className={`text-2xl font-bold ${plan.destacado ? 'text-white' : 'text-[#0D0D0D]'}`}>Gratis</span>
                    ) : (
                      <div>
                        <span className={`text-3xl font-bold ${plan.destacado ? 'text-white' : 'text-[#0D0D0D]'}`}>
                          ${plan.precio.toLocaleString('es-AR')}
                        </span>
                        <span className={`text-sm ml-1 ${plan.destacado ? 'text-white/60' : 'text-zinc-500'}`}>/mes</span>
                        {'precioManual' in plan && (
                          <p className={`text-xs mt-1 ${plan.destacado ? 'text-white/60' : 'text-zinc-500'}`}>
                            con débito automático · ${(plan as any).precioManual.toLocaleString('es-AR')} con otros medios de pago
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <ul className="space-y-2 flex-1 mb-6">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <Check size={15} className={`flex-shrink-0 mt-0.5 ${plan.destacado ? 'text-[#22D3EE]' : 'text-[#0891B2]'}`} />
                      <span className={plan.destacado ? 'text-white/80' : 'text-zinc-600'}>{f}</span>
                    </li>
                  ))}
                  {plan.noIncluye.map(f => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <X size={15} className={`flex-shrink-0 mt-0.5 ${plan.destacado ? 'text-white/35' : 'text-zinc-300'}`} />
                      <span className={plan.destacado ? 'text-white/50' : 'text-zinc-500'}>{f}</span>
                    </li>
                  ))}
                </ul>

                {(() => {
                  const ctaClass = `block text-center font-semibold py-3 rounded-xl transition-all text-sm ${
                    plan.destacado
                      ? 'lp-cta text-white'
                      : 'bg-[#0D0D0D] text-white hover:bg-[#2a2236]'}`
                  // Enterprise (precio === null) → el contacto va por mailto y DEBE ser un
                  // <a> real: un Link de React Router con un destino mailto lo resuelve como
                  // ruta interna (navega a /mailto... → catch-all → rebota al home, no abre el correo).
                  return plan.precio === null
                    ? <a href={`mailto:${BRAND.email}`} className={ctaClass}>Contactar</a>
                    : <Link to="/onboarding" className={ctaClass}>{plan.precio === 0 ? 'Empezar gratis' : 'Probar 30 días gratis'}</Link>
                })()}
              </div>
            ))}
          </div>
        </div>

        {/* Configurador de precios (Fase 4) — estimador plan base + add-ons.
            Va FUERA del max-w-6xl de los planes para ocupar ~80% del viewport (más protagonismo). */}
        <div className="mt-14 mx-auto w-[92%] lg:w-[80%] max-w-[1600px]">
          <PricingConfigurator />
        </div>
      </section>

      {/* ── 9 · Para tu rubro ── */}
      <SeccionRubros />

      {/* ── 10 · Confianza: fundadores + testimonios reales (oculto mientras no haya ninguno) ── */}
      <SeccionFundadores />
      {/* ── TESTIMONIALS ── (solo reales; oculto mientras no haya ninguno) */}
      {TESTIMONIALS.length > 0 && <section className="py-20 bg-brand-bg">
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
      </section>}

      {/* ── 11 · FAQ ── */}
      <section id="faq" className="scroll-mt-20 bg-[#F3F1F8]">
        <div className="max-w-6xl mx-auto px-4 py-24 md:py-32 grid gap-10 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
          <h2 className="text-[2.1rem] leading-[1.08] sm:text-5xl font-semibold tracking-[-0.03em]">Preguntas frecuentes</h2>
          <div className="border-t border-zinc-200">
            {FAQ.map(({ q, a }) => <FAQItem key={q} q={q} a={a} />)}
          </div>
        </div>
      </section>

      {/* ── 12 · CTA final: el mismo del hero, con la misma fuerza ── */}
      <LandingCierre />
      <LandingPie enHome />
    </div>
  )
}
