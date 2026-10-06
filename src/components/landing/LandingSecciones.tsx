// Landing 2.0 — secciones 2 a 10 (docs 00-02 de Fede, wiki/business/plan-landing-2.md). Reglas que cuidan todo el archivo:
//  · Nada que la app no haga se anuncia (Ley 24.240). El asistente de WhatsApp NO se menciona hasta que Meta lo apruebe
//    (decisión 5 de GO); la "IA" que se muestra es la que existe hoy: el Motor de Recomendaciones del Panel, el Asistente
//    IA del encabezado y las Alertas.
//  · Las "pantallas" son piezas dibujadas con datos de demo (un almacén cualquiera), copiando el lenguaje visual de la
//    app. Cuando exista un negocio demo prolijo se reemplazan por capturas reales (doc 02 §2).
import { Link } from 'react-router-dom'
import {
  ArrowRight, Boxes, ShoppingCart, Receipt, Wallet, PackageCheck, Users, Send, Contact,
  EyeOff, AlarmClock, Hourglass, Unplug, AlertTriangle, TrendingUp, Percent, Sparkles,
  CalendarClock, CircleDollarSign, ClipboardList, PackageMinus, Check, HardHat,
} from 'lucide-react'
import { BRAND } from '@/config/brand'
import { useRevelar } from './useRevelar'

const v = (i: number) => ({ ['--i' as string]: i }) as React.CSSProperties

/* ── 2 · El problema ─────────────────────────────────────────────────────────────────────────────────────────────── */

const DOLORES = [
  { icon: EyeOff, texto: 'No sabés con certeza qué está pasando hoy en tu negocio sin preguntarle a alguien de tu equipo.' },
  { icon: AlarmClock, texto: 'Te enterás de un problema de stock o de plata cuando ya es tarde para evitarlo.' },
  { icon: Hourglass, texto: 'Tu tiempo se va en supervisar, no en hacer crecer el negocio.' },
  { icon: Unplug, texto: 'Usás WhatsApp, una planilla y un facturador aparte que no se hablan entre sí.' },
]

export function SeccionProblema() {
  const ref = useRevelar<HTMLElement>(0.2)
  return (
    <section ref={ref} className="lp-night">
      <div className="max-w-6xl mx-auto px-4 py-24 md:py-32 grid gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-20 items-start">
        <div>
          <h2 className="text-[2.1rem] leading-[1.08] sm:text-5xl font-semibold tracking-[-0.03em] text-white max-w-[16ch]">
            Tu negocio crece, pero vos seguís corriendo de atrás.
          </h2>

          {/* Las herramientas sueltas: tres piezas que no se conectan. */}
          <div className="mt-12 flex flex-wrap items-center gap-x-3 gap-y-4" aria-label="Herramientas desconectadas: WhatsApp, una planilla y un facturador aparte">
            {['WhatsApp', 'Planilla', 'Facturador aparte'].map((h, i) => (
              <div key={h} className="flex items-center gap-3">
                {i > 0 && (
                  <svg width="44" height="12" viewBox="0 0 44 12" aria-hidden className="hidden sm:block text-white/25">
                    <path d="M0 6h16M28 6h16" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 4" />
                    <path d="M19 2l6 8M25 2l-6 8" stroke="rgb(248 113 113 / 0.75)" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                )}
                <span className="rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-sm text-white/80">{h}</span>
              </div>
            ))}
          </div>
        </div>

        <ul className="divide-y divide-white/10 border-y border-white/10">
          {DOLORES.map(({ icon: Icon, texto }, i) => (
            <li key={texto} className="lp-rev flex gap-5 py-6" style={v(i)}>
              <span className="mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-white/[0.06] text-[#C4A5FF]">
                <Icon size={18} strokeWidth={1.75} />
              </span>
              <p className="text-lg leading-relaxed text-white/80">{texto}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/* ── 3 · La solución, en una frase ───────────────────────────────────────────────────────────────────────────────── */

function Conector({ i }: { i: number }) {
  return (
    <div aria-hidden className="flex items-center justify-center lg:px-1">
      <div className="lp-flujo-linea h-8 w-px bg-gradient-to-b from-[#7B00FF] to-[#06B6D4] lg:h-px lg:w-full lg:bg-gradient-to-r" style={v(i)} />
    </div>
  )
}

export function SeccionSolucion() {
  const ref = useRevelar<HTMLElement>(0.3)
  return (
    <section id="solucion" ref={ref} className="scroll-mt-20">
      <div className="max-w-6xl mx-auto px-4 py-24 md:py-32">
        <div className="max-w-3xl">
          <h2 className="text-[2.1rem] leading-[1.08] sm:text-5xl font-semibold tracking-[-0.03em]">
            Un solo sistema. Toda la información. Vos decidís, tu equipo ejecuta.
          </h2>
          <p className="mt-6 text-lg leading-relaxed text-zinc-600 max-w-[60ch]">
            {BRAND.name} centraliza cada parte de tu operación y te dice qué está pasando y qué conviene hacer, sin que
            tengas que ir a buscarlo. Una venta en el mostrador ya mueve todo lo demás:
          </p>
        </div>

        <div className="mt-14 grid gap-3 lg:grid-cols-[minmax(0,1fr)_56px_minmax(0,1fr)_56px_minmax(0,1fr)] items-stretch">
          {/* Venta */}
          <article className="lp-rev rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_18px_40px_-28px_rgba(40,10,90,0.35)]" style={v(0)}>
            <header className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 font-medium"><ShoppingCart size={16} className="text-[#7B00FF]" />Venta #1521</span>
              <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">Cobrada</span>
            </header>
            <div className="mt-4 space-y-1.5 text-sm lp-num">
              <div className="flex justify-between gap-3"><span className="text-zinc-600">2 × Yerba mate 1 kg</span><span>$9.800</span></div>
              <div className="flex justify-between gap-3"><span className="text-zinc-600">1 × Azúcar 1 kg</span><span>$1.450</span></div>
              <div className="flex justify-between gap-3 border-t border-dashed border-zinc-200 pt-2 font-semibold"><span>Total · Efectivo</span><span>$11.250</span></div>
            </div>
          </article>

          <Conector i={1} />

          {/* Stock */}
          <article className="lp-rev rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_18px_40px_-28px_rgba(40,10,90,0.35)]" style={v(2)}>
            <header className="flex items-center gap-2 text-sm font-medium"><Boxes size={16} className="text-[#7B00FF]" />Stock, al instante</header>
            <div className="mt-4 flex items-end justify-between gap-3">
              <span className="text-sm text-zinc-600">Yerba mate 1 kg</span>
              <span className="text-3xl font-semibold tracking-tight lp-num">
                <span className="lp-tick"><span className="lp-tick-antes">8</span><span className="lp-tick-despues">6</span></span>
                <span className="ml-1 text-sm font-normal text-zinc-500">u.</span>
              </span>
            </div>
            <p className="mt-3 text-sm text-zinc-500">Se descontó solo con la venta. Nadie tuvo que anotarlo.</p>
          </article>

          <Conector i={3} />

          {/* Aviso */}
          <article className="lp-rev rounded-2xl border border-amber-200 bg-amber-50/60 p-5" style={v(4)}>
            <header className="flex items-center gap-2 text-sm font-medium text-amber-900"><AlertTriangle size={16} className="text-amber-600" />Aviso</header>
            <p className="mt-4 font-medium text-zinc-900">Yerba mate 1 kg: quedan 2 días de stock.</p>
            <p className="mt-2 text-sm text-zinc-600">Armá el pedido al proveedor con lo que falta en un par de clics.</p>
          </article>
        </div>
      </div>
    </section>
  )
}

/* ── 4 · Módulos (bento con piezas de la app, no 8 tarjetas iguales) ──────────────────────────────────────────────── */

const MODULOS_COMPACTOS = [
  { icon: PackageCheck, titulo: 'Compras', texto: 'Pedile a tus proveedores y pagales, con todo el historial.' },
  { icon: Users, titulo: 'Clientes', texto: 'Cuenta corriente, historial y contacto de cada cliente, a mano.' },
  { icon: Send, titulo: 'Envíos', texto: 'Coordiná entregas y seguilas sin depender de otro sistema.' },
  { icon: Contact, titulo: 'RRHH', texto: 'Fichado, asistencia y sueldos, conectados con el resto.' },
]

export function SeccionModulos() {
  const ref = useRevelar<HTMLElement>(0.12)
  const tile = 'lp-rev flex flex-col rounded-3xl border border-zinc-200 bg-white p-6 sm:p-7'
  const pieza = 'mt-6 rounded-2xl bg-[#F5F3FA] p-4 sm:p-5'
  return (
    <section id="funciones" ref={ref} className="scroll-mt-20 bg-[#F3F1F8]">
      <div className="max-w-6xl mx-auto px-4 py-24 md:py-32">
        <h2 className="text-[2.1rem] leading-[1.08] sm:text-5xl font-semibold tracking-[-0.03em] max-w-[18ch]">
          Todo lo que tu negocio necesita, en un solo lugar.
        </h2>

        <div className="mt-14 grid gap-4 lg:grid-cols-6">
          {/* Inventario */}
          <article className={`${tile} lg:col-span-4`} style={v(0)}>
            <div className="flex items-center gap-2.5"><Boxes size={20} className="text-[#7B00FF]" /><h3 className="text-xl font-semibold tracking-tight">Inventario y depósito</h3></div>
            <p className="mt-2 text-zinc-600 max-w-[52ch]">Sabé qué tenés, dónde está y cuándo se vence, sin planillas.</p>
            <div className={pieza}>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Yerba mate 1 kg</span>
                <span className="lp-num text-zinc-600">84 disponibles · 6 reservadas</span>
              </div>
              <div className="mt-3 overflow-hidden rounded-xl border border-zinc-200 bg-white text-[13px] lp-num">
                <div className="hidden sm:grid grid-cols-[1.1fr_0.8fr_1fr_1fr_0.5fr] gap-3 border-b border-zinc-100 px-4 py-2 text-xs text-zinc-500">
                  <span>Línea</span><span>Lote</span><span>Vence</span><span>Ubicación</span><span className="text-right">Cant.</span>
                </div>
                {[
                  ['LPN-000214', '2405', '12/03/2027', 'Góndola A-3', '24'],
                  ['LPN-000231', '2411', '02/05/2027', 'Depósito B-1', '60'],
                ].map(f => (
                  <div key={f[0]} className="grid grid-cols-2 sm:grid-cols-[1.1fr_0.8fr_1fr_1fr_0.5fr] gap-x-3 gap-y-1 px-4 py-2.5 border-b border-zinc-100 last:border-0">
                    <span className="lp-mono text-zinc-800">{f[0]}</span>
                    <span className="text-zinc-600"><span className="sm:hidden text-zinc-400">Lote </span>{f[1]}</span>
                    <span className="text-zinc-600"><span className="sm:hidden text-zinc-400">Vence </span>{f[2]}</span>
                    <span className="text-zinc-600">{f[3]}</span>
                    <span className="sm:text-right font-medium">{f[4]} u.</span>
                  </div>
                ))}
              </div>
            </div>
          </article>

          {/* Caja */}
          <article className={`${tile} lg:col-span-2`} style={v(1)}>
            <div className="flex items-center gap-2.5"><Wallet size={20} className="text-[#7B00FF]" /><h3 className="text-xl font-semibold tracking-tight">Caja</h3></div>
            <p className="mt-2 text-zinc-600">Cada caja, cada turno, cada diferencia.</p>
            <div className="mt-6 flex-1 rounded-2xl bg-[#0E0B16] p-4 text-white lp-num">
              <p className="text-sm font-medium">Caja 1</p>
              <p className="text-xs text-white/55">Abierta 08:02 · Turno mañana</p>
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-white/60">Apertura</span><span>$20.000</span></div>
                <div className="flex justify-between"><span className="text-white/60">Ingresos</span><span className="text-emerald-300">+$184.350</span></div>
                <div className="flex justify-between"><span className="text-white/60">Egresos</span><span className="text-rose-300">−$12.000</span></div>
              </div>
              <div className="mt-4 flex items-baseline justify-between rounded-xl bg-white px-3 py-2.5 text-[#0D0D0D]">
                <span className="text-xs text-[#5B2BFF]">Saldo actual</span><span className="text-lg font-semibold">$192.350</span>
              </div>
            </div>
          </article>

          {/* Facturación */}
          <article className={`${tile} lg:col-span-3`} style={v(2)}>
            <div className="flex items-center gap-2.5"><Receipt size={20} className="text-[#7B00FF]" /><h3 className="text-xl font-semibold tracking-tight">Facturación electrónica</h3></div>
            <p className="mt-2 text-zinc-600">Facturá en segundos ante ARCA (ex AFIP), sin salir del sistema.</p>
            <div className={`${pieza} lp-num`}>
              <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">Factura B</p>
                    <p className="lp-mono text-xs text-zinc-500">0003-00000412</p>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700"><Check size={12} />CAE otorgado</span>
                </div>
                <div className="mt-3 flex justify-between border-t border-zinc-100 pt-3"><span className="text-zinc-600">Consumidor final</span><span className="font-semibold">$11.250</span></div>
              </div>
            </div>
          </article>

          {/* Ventas */}
          <article className={`${tile} lg:col-span-3`} style={v(3)}>
            <div className="flex items-center gap-2.5"><ShoppingCart size={20} className="text-[#7B00FF]" /><h3 className="text-xl font-semibold tracking-tight">Ventas y punto de venta</h3></div>
            <p className="mt-2 text-zinc-600">Cobrá con cualquier medio de pago, en el momento, desde cualquier sucursal.</p>
            <div className={`${pieza} flex flex-wrap gap-2`}>
              {['Efectivo', 'Débito', 'Crédito', 'Transferencia', 'QR', 'Cuenta corriente'].map(m => (
                <span key={m} className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700">{m}</span>
              ))}
            </div>
          </article>

          {/* El resto, compacto */}
          <div className="lp-rev lg:col-span-6 grid rounded-3xl border border-zinc-200 bg-white sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 divide-zinc-100" style={v(4)}>
            {MODULOS_COMPACTOS.map(({ icon: Icon, titulo, texto }, i) => (
              <div key={titulo} className={`p-6 ${i > 0 ? 'lg:border-l lg:border-zinc-100' : ''} ${i % 2 === 1 ? 'sm:border-l sm:border-zinc-100 lg:border-l' : ''} ${i >= 2 ? 'sm:border-t sm:border-zinc-100 lg:border-t-0' : ''}`}>
                <Icon size={20} className="text-[#7B00FF]" />
                <h3 className="mt-4 font-semibold">{titulo}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-zinc-600">{texto}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="mt-10 text-lg text-zinc-700 max-w-[62ch]">
          <strong className="font-semibold text-[#0D0D0D]">Cada módulo se configura a tu manera.</strong> Activá lo que tu
          negocio necesita hoy y sumá más a medida que crecés.
        </p>
      </div>
    </section>
  )
}

/* ── 5 · Inteligencia artificial (sección propia, oscura, la de más jerarquía después del hero) ───────────────────── */

const DETECTADO = [
  { icon: AlertTriangle, tono: 'text-amber-300 bg-amber-400/10', titulo: '4 productos con menos de 3 días de stock', texto: 'Yerba mate 1 kg, Azúcar 1 kg y 2 más. Conviene pedirlos esta semana.', escribe: true },
  { icon: TrendingUp, tono: 'text-emerald-300 bg-emerald-400/10', titulo: 'Las ventas crecieron 18% contra el mes pasado', texto: 'Tu producto estrella del mes: Yerba mate 1 kg.' },
  { icon: Percent, tono: 'text-rose-300 bg-rose-400/10', titulo: '6 productos con margen menor al 15%', texto: 'Revisá su precio de venta antes de volver a comprarlos.' },
]

const ALERTAS = [
  { icon: PackageMinus, texto: 'Stock por debajo del mínimo' },
  { icon: CalendarClock, texto: 'Vencimientos próximos' },
  { icon: CircleDollarSign, texto: 'Cuentas corrientes vencidas' },
  { icon: ClipboardList, texto: 'Pedidos a proveedores atrasados' },
]

export function SeccionIA() {
  const refDetectado = useRevelar<HTMLDivElement>(0.35)
  const refChat = useRevelar<HTMLDivElement>(0.45)
  return (
    <section id="ia" className="lp-night scroll-mt-20 overflow-hidden">
      <div className="max-w-6xl mx-auto px-4 py-24 md:py-36">
        <h2 className="text-[2.4rem] leading-[1.04] sm:text-6xl font-semibold tracking-[-0.035em] text-white max-w-[15ch]">
          Una IA que trabaja para vos, no al revés.
        </h2>

        <div className="mt-16 grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-14">
          {/* Lo que el sistema detecta */}
          <div ref={refDetectado}>
            <h3 className="text-2xl font-semibold tracking-tight text-white">Tu negocio, explicado en criollo.</h3>
            <p className="mt-3 text-white/70 max-w-[52ch] leading-relaxed">
              {BRAND.name} lee tus ventas, tu stock y tus márgenes y te dice qué mirar primero, con palabras, no con un
              gráfico para interpretar.
            </p>
            <div className="mt-8 rounded-3xl border border-white/10 bg-white/[0.035] p-3 sm:p-4 shadow-[0_40px_80px_-40px_rgba(0,0,0,0.8)]">
              <p className="flex items-center gap-2 px-2 pt-1 pb-3 text-sm text-white/60"><Sparkles size={15} className="text-[#06B6D4]" />Lo que {BRAND.name} detectó en tu negocio</p>
              <ul className="space-y-2">
                {DETECTADO.map(({ icon: Icon, tono, titulo, texto, escribe }, i) => (
                  <li key={titulo} className="lp-rev flex gap-4 rounded-2xl bg-[#1B1430] p-4" style={v(i)}>
                    <span className={`flex h-9 w-9 flex-none items-center justify-center rounded-xl ${tono}`}><Icon size={17} /></span>
                    <div className="min-w-0">
                      <p className="font-medium text-white">{titulo}</p>
                      <p className={`mt-1 text-sm leading-relaxed text-white/65 ${escribe ? 'lp-escribe' : ''}`}>{texto}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* El Asistente IA */}
          <div ref={refChat} className="lg:pt-24">
            <h3 className="text-2xl font-semibold tracking-tight text-white">Preguntale como le preguntarías a alguien que sabe.</h3>
            <p className="mt-3 text-white/70 max-w-[46ch] leading-relaxed">
              El asistente conoce el sistema y tu forma de trabajar. Te explica cómo hacer cada cosa y, cuando hace falta
              cambiar una configuración, te la propone para que vos la confirmes.
            </p>
            <div className="mt-8 rounded-3xl bg-[#F7F5FB] p-4 text-[#0D0D0D] text-[15px] shadow-[0_40px_80px_-40px_rgba(0,0,0,0.9)]">
              <div className="flex items-center gap-2 border-b border-zinc-200 pb-3 text-sm font-medium">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-[#7B00FF] to-[#06B6D4] text-white"><Sparkles size={14} /></span>
                Asistente {BRAND.name}
              </div>
              <div className="space-y-3 pt-4">
                <p className="lp-msj ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-[#7B00FF] px-4 py-2.5 text-white" style={{ ['--t' as string]: '0ms' } as React.CSSProperties}>
                  ¿Cómo le cobro más barato al que compra por cantidad?
                </p>
                <div className="grid">
                  <span className="lp-tipeando-caja [grid-area:1/1] w-fit rounded-2xl rounded-bl-md bg-white px-4 py-3 text-zinc-500" style={{ ['--t' as string]: '450ms' } as React.CSSProperties} aria-hidden>
                    <span className="lp-tipeando"><i /><i /><i /></span>
                  </span>
                  <p className="lp-msj [grid-area:1/1] w-fit max-w-[90%] rounded-2xl rounded-bl-md bg-white px-4 py-2.5 leading-relaxed" style={{ ['--t' as string]: '1500ms' } as React.CSSProperties}>
                    Cargale un precio por cantidad al producto. Por ejemplo: desde 10 unidades, cada una sale $80 en vez de $100.
                    En la venta se aplica solo.
                  </p>
                </div>
                <p className="lp-msj ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-[#7B00FF] px-4 py-2.5 text-white" style={{ ['--t' as string]: '2500ms' } as React.CSSProperties}>
                  ¿Y dónde veo lo que se está por vencer?
                </p>
                <div className="grid">
                  <span className="lp-tipeando-caja [grid-area:1/1] w-fit rounded-2xl rounded-bl-md bg-white px-4 py-3 text-zinc-500" style={{ ['--t' as string]: '2950ms' } as React.CSSProperties} aria-hidden>
                    <span className="lp-tipeando"><i /><i /><i /></span>
                  </span>
                  <p className="lp-msj [grid-area:1/1] w-fit max-w-[90%] rounded-2xl rounded-bl-md bg-white px-4 py-2.5 leading-relaxed" style={{ ['--t' as string]: '4000ms' } as React.CSSProperties}>
                    En Alertas tenés los vencimientos próximos, con cada lote y dónde está guardado.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Alertas */}
        <div className="mt-20 grid gap-8 border-t border-white/10 pt-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-center">
          <div>
            <h3 className="text-2xl font-semibold tracking-tight text-white">Alertas que te avisan antes de que sea tarde.</h3>
            <p className="mt-3 text-white/70 leading-relaxed max-w-[44ch]">Las ves apenas entrás, sin pedirle un informe a nadie.</p>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {ALERTAS.map(({ icon: Icon, texto }) => (
              <li key={texto} className="flex items-center gap-3 rounded-2xl border border-white/10 px-4 py-3.5 text-white/85">
                <Icon size={18} className="text-[#06B6D4] flex-none" />{texto}
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-20 text-[1.7rem] leading-[1.15] sm:text-4xl font-semibold tracking-[-0.025em] text-white max-w-[24ch]">
          Más tiempo para hacer crecer tu negocio. <span className="text-white/45">Menos tiempo preguntando cómo está.</span>
        </p>
      </div>
    </section>
  )
}

/* ── 7 · Escalabilidad ────────────────────────────────────────────────────────────────────────────────────────────── */

const ETAPAS = [
  { cuando: 'Hoy', titulo: 'Un mostrador', items: ['Ventas y caja', 'Stock sin planillas', 'Factura electrónica'] },
  { cuando: 'Cuando crecés', titulo: 'Más gente, más locales', items: ['Permisos por rol para tu equipo', 'Varias sucursales', 'Compras y cuentas corrientes'] },
  { cuando: 'Operación grande', titulo: 'Depósito propio', items: ['Ubicaciones, lotes y vencimientos', 'Preparación de pedidos', 'Varios CUIT en la misma cuenta'] },
]

export function SeccionEscalabilidad() {
  return (
    <section className="overflow-hidden">
      <div className="max-w-6xl mx-auto px-4 pt-24 pb-6 md:pt-32 md:pb-10">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
          <h2 className="text-[2.1rem] leading-[1.08] sm:text-5xl font-semibold tracking-[-0.03em]">
            Empezá simple. Crecé sin límites.
          </h2>
          <p className="text-lg leading-relaxed text-zinc-600 max-w-[52ch]">
            Del mostrador chico a una operación con varias sucursales y depósito propio, sin cambiar de sistema. Las
            funciones avanzadas están ahí para cuando las necesites, no te las imponemos desde el primer día.
          </p>
        </div>

        <div className="relative mt-16">
          <div aria-hidden className="absolute left-0 right-0 top-[7px] hidden h-[3px] rounded-full bg-zinc-200 md:block">
            <div className="lp-progreso h-full rounded-full bg-gradient-to-r from-[#7B00FF] to-[#06B6D4]" />
          </div>
          <ol className="grid gap-10 md:grid-cols-3 md:gap-8">
            {ETAPAS.map((e, i) => (
              <li key={e.titulo} className="relative">
                <span aria-hidden className={`hidden md:block h-[17px] w-[17px] rounded-full border-[3px] border-[#FAFAFC] ${i === 0 ? 'bg-[#7B00FF]' : i === 1 ? 'bg-[#4F46E5]' : 'bg-[#06B6D4]'} shadow-[0_0_0_1px_rgba(13,13,13,0.08)]`} />
                <p className="md:mt-6 text-sm font-medium text-[#6A00DD]">{e.cuando}</p>
                <h3 className="mt-1 text-2xl font-semibold tracking-tight">{e.titulo}</h3>
                <ul className="mt-4 space-y-2">
                  {e.items.map(it => (
                    <li key={it} className="flex items-start gap-2.5 text-zinc-700">
                      <Check size={16} className="mt-1 flex-none text-[#0891B2]" />{it}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </div>
        <p className="mt-14 text-lg text-zinc-700">
          <strong className="font-semibold text-[#0D0D0D]">Mismo sistema, mismos datos.</strong> Vas activando funciones; nunca migrás.
        </p>
      </div>
    </section>
  )
}

/* ── 9 · Para tu rubro ───────────────────────────────────────────────────────────────────────────────────────────── */

const OTROS_RUBROS = ['Almacenes y autoservicios', 'Distribuidoras', 'Dietéticas', 'Indumentaria', 'Kioscos', 'Librerías', 'Bazares', 'Casas de repuestos']

export function SeccionRubros() {
  return (
    <section className="bg-[#F3F1F8]">
      <div className="max-w-6xl mx-auto px-4 py-24 md:py-28">
        <h2 className="text-[2.1rem] leading-[1.08] sm:text-5xl font-semibold tracking-[-0.03em] max-w-[18ch]">
          Pensado para negocios que venden productos.
        </h2>
        <div className="mt-12 grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
          <article className="rounded-3xl bg-[#0E0B16] p-7 sm:p-9 text-white">
            <HardHat size={26} className="text-[#06B6D4]" />
            <h3 className="mt-5 text-3xl font-semibold tracking-tight">Construcción</h3>
            <p className="mt-2 text-white/65">Ferreterías, corralones, casas de sanitarios y pinturerías.</p>
            <ul className="mt-7 grid gap-3 sm:grid-cols-2">
              {[
                'Medidas, colores y presentaciones como variantes del mismo producto',
                'Precio mayorista para contratistas y colocadores',
                'Entregas a obra con seguimiento',
                'Cuenta corriente para los clientes de confianza',
              ].map(t => (
                <li key={t} className="flex items-start gap-2.5 text-white/85"><Check size={16} className="mt-1 flex-none text-[#06B6D4]" />{t}</li>
              ))}
            </ul>
            <Link to="/para/construccion" className="mt-8 inline-flex items-center gap-2 font-medium text-white underline decoration-white/30 underline-offset-[6px] hover:decoration-white">
              Cómo funciona en construcción <ArrowRight size={16} />
            </Link>
          </article>
          <div className="rounded-3xl border border-zinc-200 bg-white p-7 sm:p-9">
            <h3 className="text-xl font-semibold tracking-tight">Y también</h3>
            <ul className="mt-5 flex flex-wrap gap-2">
              {OTROS_RUBROS.map(r => (
                <li key={r} className="rounded-full border border-zinc-200 px-3.5 py-1.5 text-sm text-zinc-700">{r}</li>
              ))}
            </ul>
            <p className="mt-6 text-sm leading-relaxed text-zinc-500">Cada negocio lo configura a su manera: no hay una única forma correcta de usarlo.</p>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ── 10 · Confianza: los fundadores (mientras no haya testimonios reales, doc 00 §7) ──────────────────────────────── */

const FUNDADORES = [
  { nombre: 'Gastón Otranto', foto: '/landing/fundadores/gaston-otranto.webp' },
  { nombre: 'Federico Messina', foto: '/landing/fundadores/federico-messina.webp' },
]

export function SeccionFundadores() {
  return (
    <section>
      <div className="max-w-6xl mx-auto px-4 py-24 md:py-32 grid gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center">
        <div>
          <h2 className="text-[2.1rem] leading-[1.08] sm:text-5xl font-semibold tracking-[-0.03em] max-w-[14ch]">
            Las personas detrás de {BRAND.name}.
          </h2>
          <p className="mt-6 text-lg leading-relaxed text-zinc-600 max-w-[44ch]">
            Probalo 30 días gratis, sin tarjeta. Es la mejor forma de saber si te sirve.
          </p>
          <Link to="/onboarding" className="lp-cta mt-8 inline-flex items-center gap-2 rounded-xl px-6 py-3.5 font-semibold text-white">
            Probar gratis <ArrowRight size={18} />
          </Link>
        </div>
        <ul className="grid grid-cols-2 gap-4 sm:gap-6">
          {FUNDADORES.map((f, i) => (
            <li key={f.nombre} className={i === 1 ? 'mt-10 sm:mt-16' : ''}>
              <figure>
                <div className="lp-foto overflow-hidden rounded-3xl bg-zinc-100 aspect-[5/6]">
                  <img src={f.foto} alt={`${f.nombre}, fundador de ${BRAND.name}`} width={720} height={864}
                    loading="lazy" decoding="async" className="h-full w-full object-cover" />
                </div>
                <figcaption className="mt-4">
                  <p className="font-semibold text-lg tracking-tight">{f.nombre}</p>
                  <p className="text-sm text-zinc-500">Fundador</p>
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
