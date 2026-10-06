// /para/construccion — primera página por rubro (doc 04 de Fede, Landing 2.0 Fase 3). Ferreterías, corralones, casas de
// sanitarios y pinturerías. Misma lógica problema → solución que la home, con el vocabulario del rubro. Pre-renderizada
// para buscadores (src/entry-prerender.tsx). Solo funciones que la app tiene hoy; el "día típico" es un escenario, no un
// cliente (doc 04 §3.4: nada de testimonios inventados).
import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight, ChevronDown, Layers, Ruler, BadgePercent, FileText, Truck, Wallet, Receipt, PackagePlus,
  Shapes, Users, MapPinned, Coins, FileClock,
} from 'lucide-react'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '@/styles/landingHero.css'
import '@/styles/landing.css'
import { BRAND } from '@/config/brand'
import { FAQ_CONSTRUCCION } from '@/components/landing/contenido'
import { LandingNav, LandingCierre, LandingPie } from '@/components/landing/LandingMarco'
import { useRevelar } from '@/components/landing/useRevelar'

const v = (i: number) => ({ ['--i' as string]: i }) as React.CSSProperties

const DOLORES = [
  { icon: Shapes, texto: 'El mismo caño en seis diámetros y la misma pintura en ocho colores: la planilla no da abasto y el stock nunca coincide.' },
  { icon: Users, texto: 'Al contratista le cobrás un precio y al de mostrador otro, y termina dependiendo de quién atienda.' },
  { icon: MapPinned, texto: 'La entrega a obra se arregla por teléfono y nadie sabe si el camión ya salió.' },
  { icon: Coins, texto: 'Los maestros llevan a cuenta y no sabés cuánto debe cada uno ni desde cuándo.' },
  { icon: FileClock, texto: 'Los presupuestos se hacen a mano y, cuando el cliente confirma, hay que volver a cargar todo.' },
]

const SOLUCIONES: { icon: typeof Layers; titulo: string; texto: string; plan?: 'Pro' }[] = [
  { icon: Layers, titulo: 'Variantes por medida, color y presentación', texto: 'Un producto principal y una variante por cada medida o color, cada una con su stock, su código y su precio.' },
  { icon: Ruler, titulo: 'Vendé por unidad, metro o kilo', texto: 'También por metro cuadrado o cúbico, y por bolsa, caja o pallet con su propio precio. El stock se descuenta en la unidad que corresponde.' },
  { icon: BadgePercent, titulo: 'Precio para contratistas', texto: 'Categorías de clientes con su descuento por producto y precio por cantidad. En la venta se aplica solo.' },
  { icon: FileText, titulo: 'Presupuestos que pasan a venta', texto: 'Armás el presupuesto, lo mandás en PDF y, cuando confirma, se convierte en venta sin volver a cargarlo.' },
  { icon: Truck, titulo: 'Entregas a obra', texto: 'Cada entrega con su fecha y franja horaria, y la hoja de ruta del chofer con todo lo que sale ese día.', plan: 'Pro' },
  { icon: Wallet, titulo: 'Cuenta corriente con límite', texto: 'Cuánto debe cada cliente, desde cuándo y hasta cuánto le podés fiar.' },
  { icon: Receipt, titulo: 'Factura electrónica ARCA', texto: 'Factura A, B o C desde la misma venta, según tu condición y la del cliente.' },
  { icon: PackagePlus, titulo: 'Reposición sin adivinar', texto: 'Alertas de stock bajo y el pedido al proveedor armado con lo que falta.', plan: 'Pro' },
]

const DIA = [
  { hora: '8:00', titulo: 'Abrís la caja y mirás las alertas', texto: 'Tres medidas de caño están por debajo del mínimo. Armás el pedido al proveedor con lo que falta.' },
  { hora: '10:30', titulo: 'Un contratista pide presupuesto', texto: '30 bolsas de cemento, 2 bolsones de arena y 120 ladrillos. Como está en la categoría Contratistas, el presupuesto sale con su precio.' },
  { hora: '12:15', titulo: 'Lo confirma por teléfono', texto: 'El presupuesto pasa a venta, se emite la Factura A y el saldo queda en su cuenta corriente.' },
  { hora: '15:00', titulo: 'Sale la entrega a obra', texto: 'El pedido está en la hoja de ruta del chofer, con la dirección y la franja horaria acordada.' },
  { hora: '19:30', titulo: 'Cerrás el día', texto: 'Arqueo de caja, lo que se vendió, lo que quedó a cuenta y lo que hay que reponer mañana.' },
]

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

/** Pieza dibujada con datos de demo: un producto con sus variantes, el stock de cada una y el precio por tipo de cliente. */
function PiezaVariantes() {
  const filas = [
    { medida: 'Ø 40 mm', stock: 86, precio: 6900 },
    { medida: 'Ø 50 mm', stock: 54, precio: 8400 },
    { medida: 'Ø 63 mm', stock: 7, precio: 11200, bajo: true },
    { medida: 'Ø 110 mm', stock: 30, precio: 19800 },
  ]
  const pesos = (n: number) => `$${n.toLocaleString('es-AR')}`
  return (
    <div className="hero-shot rounded-3xl border border-zinc-200 bg-white p-5 sm:p-6 shadow-[0_30px_80px_-30px_rgba(60,20,120,0.28)] lp-num">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <p className="font-semibold tracking-tight">Caño PVC 3,2 mm × 4 m</p>
          <p className="text-sm text-zinc-500">4 variantes · Sanitarios</p>
        </div>
        <span className="whitespace-nowrap rounded-full bg-[#F5F0FF] px-3 py-1 text-xs font-medium text-[#6A00DD]">Contratistas −12&nbsp;%</span>
      </div>
      <div className="mt-5 overflow-hidden rounded-2xl border border-zinc-200 text-sm">
        <div className="grid grid-cols-[1fr_0.7fr_0.9fr_0.9fr] gap-3 bg-[#F7F5FB] px-4 py-2 text-xs text-zinc-500">
          <span>Medida</span><span className="text-right">Stock</span><span className="text-right">Mostrador</span><span className="text-right">Contratista</span>
        </div>
        {filas.map(f => (
          <div key={f.medida} className="grid grid-cols-[1fr_0.7fr_0.9fr_0.9fr] gap-3 border-t border-zinc-100 px-4 py-2.5">
            <span className="font-medium">{f.medida}</span>
            <span className={`text-right ${f.bajo ? 'font-medium text-amber-700' : 'text-zinc-700'}`}>{f.stock} u.</span>
            <span className="text-right text-zinc-700">{pesos(f.precio)}</span>
            <span className="text-right font-medium text-[#0D0D0D]">{pesos(Math.round(f.precio * 0.88))}</span>
          </div>
        ))}
      </div>
      <p className="mt-4 flex items-center gap-2 text-sm text-amber-800">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />Ø 63 mm por debajo del mínimo: entra en el próximo pedido al proveedor.
      </p>
    </div>
  )
}

export default function ParaConstruccionPage() {
  const refSoluciones = useRevelar<HTMLElement>(0.12)
  return (
    <div className="landing min-h-screen">
      <LandingNav />

      {/* ── Hero ── */}
      <section className="landing-hero relative overflow-hidden bg-[#FAFAFC]">
        <div className="max-w-6xl mx-auto px-4 pt-12 pb-24 md:pt-16 lg:pt-20 lg:pb-28 grid gap-12 lg:gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center">
          <div className="max-w-xl">
            <nav aria-label="Ruta" className="hero-in text-sm text-zinc-500" style={v(0)}>
              <a href="/" className="hover:text-[#0D0D0D] underline-offset-4 hover:underline">{BRAND.name}</a>
              <span className="mx-2 text-zinc-300">/</span>
              <span className="text-zinc-700">Construcción</span>
            </nav>
            <h1 className="hero-in hero-titulo mt-5 text-[2.3rem] leading-[1.06] sm:text-5xl lg:text-[3.3rem] font-semibold tracking-[-0.035em]">
              El sistema de gestión para ferreterías y corralones.
            </h1>
            <p className="hero-in mt-6 text-lg leading-relaxed text-zinc-600 max-w-[48ch]" style={v(1)}>
              Stock con medidas y colores, precio para contratistas, entregas a obra y factura electrónica, con una IA que
              te dice qué está pasando en tu negocio. También para casas de sanitarios y pinturerías.
            </p>
            <div className="hero-in mt-9 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6" style={v(2)}>
              <Link to="/onboarding" className="lp-cta hero-press inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-base font-semibold text-white">
                Probar gratis <ArrowRight size={18} className="hero-arrow" />
              </Link>
              <a href="#dia" className="hero-press inline-flex items-center justify-center rounded-xl px-2 py-3.5 text-base font-medium text-zinc-700 hover:text-[#0D0D0D] underline decoration-zinc-300 underline-offset-[6px] hover:decoration-[#0D0D0D]">
                Ver un día típico
              </a>
            </div>
          </div>
          <PiezaVariantes />
        </div>
      </section>

      {/* ── El problema, en el idioma del rubro ── */}
      <section className="lp-night">
        <div className="max-w-6xl mx-auto px-4 py-24 md:py-32 grid gap-14 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-20 items-start">
          <h2 className="text-[2.1rem] leading-[1.08] sm:text-5xl font-semibold tracking-[-0.03em] text-white max-w-[15ch]">
            Mil productos parecidos, y cada cliente con su precio.
          </h2>
          <ul className="divide-y divide-white/10 border-y border-white/10">
            {DOLORES.map(({ icon: Icon, texto }) => (
              <li key={texto} className="flex gap-5 py-6">
                <span className="mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-white/[0.06] text-[#C4A5FF]">
                  <Icon size={18} strokeWidth={1.75} />
                </span>
                <p className="text-lg leading-relaxed text-white/80">{texto}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Cómo lo resuelve ── */}
      <section ref={refSoluciones} className="bg-[#F3F1F8]">
        <div className="max-w-6xl mx-auto px-4 py-24 md:py-32">
          <h2 className="text-[2.1rem] leading-[1.08] sm:text-5xl font-semibold tracking-[-0.03em] max-w-[18ch]">
            Cómo lo resuelve {BRAND.name}.
          </h2>
          <ul className="mt-14 grid gap-x-12 sm:grid-cols-2 border-t border-zinc-200">
            {SOLUCIONES.map(({ icon: Icon, titulo, texto, plan }, i) => (
              <li key={titulo} className="lp-rev flex gap-5 border-b border-zinc-200 py-7" style={v(i)}>
                <Icon size={22} className="mt-0.5 flex-none text-[#7B00FF]" />
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
          <p className="mt-8 text-sm text-zinc-600">
            Lo marcado con su plan no está incluido en el plan Básico. <a href="/#precios" className="underline underline-offset-4 hover:text-[#0D0D0D]">Ver planes y precios</a>.
          </p>
        </div>
      </section>

      {/* ── Un día típico (escenario, no un cliente) ── */}
      <section id="dia" className="scroll-mt-20">
        <div className="max-w-6xl mx-auto px-4 py-24 md:py-32 grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div>
            <h2 className="text-[2.1rem] leading-[1.08] sm:text-5xl font-semibold tracking-[-0.03em] max-w-[14ch]">
              Así se ve un día en tu corralón.
            </h2>
            <p className="mt-6 text-lg leading-relaxed text-zinc-600 max-w-[40ch]">
              Un día cualquiera, con {BRAND.name} de punta a punta.
            </p>
          </div>
          <ol className="relative border-l-2 border-zinc-200 pl-8 space-y-10">
            {DIA.map(d => (
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

      {/* ── Preguntas del rubro (formato pregunta → respuesta, doc 03 §5) ── */}
      <section className="bg-[#F3F1F8]">
        <div className="max-w-6xl mx-auto px-4 py-24 md:py-32 grid gap-10 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
          <h2 className="text-[2.1rem] leading-[1.08] sm:text-5xl font-semibold tracking-[-0.03em]">Preguntas de ferreteros y corralones</h2>
          <div className="border-t border-zinc-200">
            {FAQ_CONSTRUCCION.map(({ q, a }) => <FAQItem key={q} q={q} a={a} />)}
          </div>
        </div>
      </section>

      <LandingCierre titulo="Probalo en tu ferretería o tu corralón." />
      <LandingPie />
    </div>
  )
}
