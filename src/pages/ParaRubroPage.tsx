// /para/supermercados, /para/distribuidoras, /para/dieteticas — Landing 2.0 Fase 4 (doc 04 de Fede). Una plantilla, contenido
// propio por rubro (src/components/landing/rubros.ts). El rubro sale de la URL (useLocation funciona igual en el pre-render,
// con StaticRouter). Las funciones que no están en el plan Básico llevan su etiqueta de plan.
import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ArrowRight, Check, ChevronDown, ScanLine, Truck, Scale } from 'lucide-react'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '@/styles/landingHero.css'
import '@/styles/landing.css'
import { BRAND } from '@/config/brand'
import { rubroPorRuta, RUBROS, type Rubro } from '@/components/landing/rubros'
import { LandingNav, LandingCierre, LandingPie } from '@/components/landing/LandingMarco'
import { useRevelar } from '@/components/landing/useRevelar'

const v = (i: number) => ({ ['--i' as string]: i }) as React.CSSProperties
const pesos = (n: number) => `$${n.toLocaleString('es-AR')}`

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-zinc-200">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="w-full flex items-center justify-between py-5 text-left gap-6">
        <span className="text-lg font-medium tracking-tight">{q}</span>
        <ChevronDown size={20} className={`text-zinc-400 flex-shrink-0 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>
      <div className="lp-faq-panel" data-abierto={open}>
        <div><p className="text-zinc-600 pb-6 leading-relaxed max-w-[64ch]">{a}</p></div>
      </div>
    </div>
  )
}

/* Piezas dibujadas con datos de demo, una por rubro, con el lenguaje visual de la app. */
const marcoPieza = 'hero-shot rounded-3xl border border-zinc-200 bg-white p-5 sm:p-6 shadow-[0_30px_80px_-30px_rgba(60,20,120,0.28)] lp-num'

function PiezaSuper() {
  return (
    <div className={marcoPieza}>
      <div className="flex items-center gap-2 text-sm font-medium"><ScanLine size={16} className="text-[#7B00FF]" />Caja 2 · Turno tarde</div>
      <div className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between gap-3"><span>Leche entera 1 L × 2</span><span>$2.980</span></div>
        <div className="flex justify-between gap-3"><span>Yogur bebible 1 L</span><span>$2.400</span></div>
        <div className="flex justify-between gap-3 text-emerald-700"><span className="pl-3">Próximo a vencer −20&nbsp;%</span><span>−$480</span></div>
        <div className="flex justify-between gap-3"><span>Queso cremoso 0,380 kg</span><span>$4.180</span></div>
        <div className="flex justify-between gap-3 text-emerald-700"><span className="pl-3">Promo débito −10&nbsp;%</span><span>−$908</span></div>
      </div>
      <div className="mt-4 flex items-baseline justify-between border-t border-dashed border-zinc-200 pt-3">
        <span className="text-sm text-zinc-600">Total · Débito</span><span className="text-2xl font-semibold tracking-tight">$8.172</span>
      </div>
    </div>
  )
}

function PiezaDistribuidora() {
  const pedidos = [
    { n: 'Pedido #812', cliente: 'Almacén El Puente', estado: 'En reparto', tono: 'bg-cyan-50 text-cyan-800' },
    { n: 'Pedido #813', cliente: 'Kiosco 24', estado: 'Preparado', tono: 'bg-emerald-50 text-emerald-800' },
    { n: 'Pedido #814', cliente: 'Autoservicio Norte', estado: 'En preparación', tono: 'bg-amber-50 text-amber-800' },
  ]
  return (
    <div className={marcoPieza}>
      <div className="flex items-center gap-2 text-sm font-medium"><Truck size={16} className="text-[#7B00FF]" />Reparto de hoy · Ruta 2</div>
      <ul className="mt-4 divide-y divide-zinc-100 rounded-2xl border border-zinc-200 text-sm">
        {pedidos.map(p => (
          <li key={p.n} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0"><p className="font-medium">{p.n}</p><p className="truncate text-zinc-500">{p.cliente}</p></div>
            <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${p.tono}`}>{p.estado}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-zinc-600">Lista mayorista · Cuenta corriente al día</p>
    </div>
  )
}

function PiezaDietetica() {
  const lineas = [
    { prod: 'Almendras', peso: 0.35, kilo: 18000 },
    { prod: 'Avena arrollada', peso: 0.5, kilo: 3200 },
    { prod: 'Mix de semillas', peso: 0.25, kilo: 9600 },
  ]
  const total = lineas.reduce((t, l) => t + Math.round(l.peso * l.kilo), 0)
  return (
    <div className={marcoPieza}>
      <div className="flex items-center gap-2 text-sm font-medium"><Scale size={16} className="text-[#7B00FF]" />Venta a granel</div>
      <div className="mt-4 overflow-hidden rounded-2xl border border-zinc-200 text-sm">
        <div className="grid grid-cols-[1.3fr_0.7fr_0.9fr_0.9fr] gap-3 bg-[#F7F5FB] px-4 py-2 text-xs text-zinc-500">
          <span>Producto</span><span className="text-right">Peso</span><span className="text-right">Por kilo</span><span className="text-right">Importe</span>
        </div>
        {lineas.map(l => (
          <div key={l.prod} className="grid grid-cols-[1.3fr_0.7fr_0.9fr_0.9fr] gap-3 border-t border-zinc-100 px-4 py-2.5">
            <span className="font-medium">{l.prod}</span>
            <span className="whitespace-nowrap text-right text-zinc-700">{l.peso.toLocaleString('es-AR', { minimumFractionDigits: 3 })} kg</span>
            <span className="text-right text-zinc-700">{pesos(l.kilo)}</span>
            <span className="text-right font-medium">{pesos(Math.round(l.peso * l.kilo))}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-baseline justify-between">
        <span className="text-sm text-zinc-600">Total</span><span className="text-2xl font-semibold tracking-tight">{pesos(total)}</span>
      </div>
    </div>
  )
}

const PIEZAS: Record<string, () => JSX.Element> = {
  supermercados: PiezaSuper,
  distribuidoras: PiezaDistribuidora,
  dieteticas: PiezaDietetica,
}

function Pagina({ r }: { r: Rubro }) {
  const refSoluciones = useRevelar<HTMLElement>(0.12)
  const Pieza = PIEZAS[r.slug]
  const conPlan = r.soluciones.some(s => s.plan)
  return (
    <div className="landing min-h-screen">
      <LandingNav />

      <section className="landing-hero relative overflow-hidden bg-[#FAFAFC]">
        <div className="max-w-6xl mx-auto px-4 pt-12 pb-24 md:pt-16 lg:pt-20 lg:pb-28 grid gap-12 lg:gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] items-center">
          <div className="max-w-xl">
            <nav aria-label="Ruta" className="hero-in text-sm text-zinc-500" style={v(0)}>
              <a href="/" className="hover:text-[#0D0D0D] underline-offset-4 hover:underline">{BRAND.name}</a>
              <span className="mx-2 text-zinc-300">/</span>
              <span className="text-zinc-700">{r.nombreCorto}</span>
            </nav>
            <h1 className="hero-in hero-titulo mt-5 text-[2.3rem] leading-[1.06] sm:text-5xl lg:text-[3.2rem] font-semibold tracking-[-0.035em]">{r.h1}</h1>
            <p className="hero-in mt-6 text-lg leading-relaxed text-zinc-600 max-w-[50ch]" style={v(1)}>{r.subtitulo}</p>
            <div className="hero-in mt-9 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6" style={v(2)}>
              <Link to="/onboarding" className="lp-cta hero-press inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-base font-semibold text-white">
                Probar gratis <ArrowRight size={18} className="hero-arrow" />
              </Link>
              <a href="#dia" className="hero-press inline-flex items-center justify-center rounded-xl px-2 py-3.5 text-base font-medium text-zinc-700 hover:text-[#0D0D0D] underline decoration-zinc-300 underline-offset-[6px] hover:decoration-[#0D0D0D]">
                Ver un día típico
              </a>
            </div>
          </div>
          {Pieza && <Pieza />}
        </div>
      </section>

      <section className="lp-night">
        <div className="max-w-6xl mx-auto px-4 py-24 md:py-32 grid gap-14 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-20 items-start">
          <h2 className="text-[2.1rem] leading-[1.08] sm:text-5xl font-semibold tracking-[-0.03em] text-white max-w-[16ch]">{r.tituloProblema}</h2>
          <ul className="divide-y divide-white/10 border-y border-white/10">
            {r.problemas.map(t => (
              <li key={t} className="flex gap-4 py-6">
                <span aria-hidden className="mt-3 h-1.5 w-1.5 flex-none rounded-full bg-[#C4A5FF]" />
                <p className="text-lg leading-relaxed text-white/80">{t}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section ref={refSoluciones} className="bg-[#F3F1F8]">
        <div className="max-w-6xl mx-auto px-4 py-24 md:py-32">
          <h2 className="text-[2.1rem] leading-[1.08] sm:text-5xl font-semibold tracking-[-0.03em] max-w-[18ch]">Cómo lo resuelve {BRAND.name}.</h2>
          <ul className="mt-14 grid gap-x-12 sm:grid-cols-2 border-t border-zinc-200">
            {r.soluciones.map(({ titulo, texto, plan }, i) => (
              <li key={titulo} className="lp-rev flex gap-4 border-b border-zinc-200 py-7" style={v(i)}>
                <Check size={20} className="mt-1 flex-none text-[#0891B2]" />
                <div>
                  <h3 className="text-lg font-semibold tracking-tight">
                    {titulo}
                    {plan && <span className="ml-2 align-middle whitespace-nowrap rounded-full border border-zinc-300 px-2 py-0.5 text-xs font-medium text-zinc-600">Plan {plan}</span>}
                  </h3>
                  <p className="mt-1.5 leading-relaxed text-zinc-600">{texto}</p>
                </div>
              </li>
            ))}
          </ul>
          {conPlan && (
            <p className="mt-8 text-sm text-zinc-600">
              Lo marcado con su plan no está incluido en el plan Básico. <a href="/#precios" className="underline underline-offset-4 hover:text-[#0D0D0D]">Ver planes y precios</a>.
            </p>
          )}
        </div>
      </section>

      <section id="dia" className="scroll-mt-20">
        <div className="max-w-6xl mx-auto px-4 py-24 md:py-32 grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div>
            <h2 className="text-[2.1rem] leading-[1.08] sm:text-5xl font-semibold tracking-[-0.03em] max-w-[14ch]">{r.tituloDia}</h2>
            <p className="mt-6 text-lg leading-relaxed text-zinc-600 max-w-[40ch]">Un día cualquiera, con {BRAND.name} de punta a punta.</p>
          </div>
          <ol className="relative border-l-2 border-zinc-200 pl-8 space-y-10">
            {r.dia.map(d => (
              <li key={d.hora} className="relative">
                <span aria-hidden className="absolute -left-[41px] top-1 h-4 w-4 rounded-full border-[3px] border-[#FAFAFC] bg-[#7B00FF] shadow-[0_0_0_1px_rgba(13,13,13,0.08)]" />
                <p className="text-sm font-medium text-[#6A00DD] lp-num">{d.hora}</p>
                <h3 className="mt-1 text-xl font-semibold tracking-tight">{d.titulo}</h3>
                <p className="mt-2 leading-relaxed text-zinc-600 max-w-[58ch]">{d.texto}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="bg-[#F3F1F8]">
        <div className="max-w-6xl mx-auto px-4 py-24 md:py-32 grid gap-10 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
          <h2 className="text-[2.1rem] leading-[1.08] sm:text-5xl font-semibold tracking-[-0.03em]">{r.tituloFaq}</h2>
          <div className="border-t border-zinc-200">
            {r.faq.map(({ q, a }) => <FAQItem key={q} q={q} a={a} />)}
          </div>
        </div>
      </section>

      <LandingCierre titulo={r.cierre} />
      <LandingPie />
    </div>
  )
}

export default function ParaRubroPage() {
  const { pathname } = useLocation()
  const r = rubroPorRuta(pathname) ?? RUBROS[0]
  return <Pagina r={r} />
}
