// FilterBar — DS Sprint 3: período / moneda / IVA

export type PeriodoDash = 'hoy' | '7d' | '30d' | 'mes' | 'trimestre' | 'año'
export type Moneda = 'ARS' | 'USD'
export type IVAMode = 'incluido' | 'excluido'

// ─── Helpers de fechas ────────────────────────────────────────────────────────

export function getFechasDashboard(periodo: PeriodoDash): { desde: string; hasta: string } {
  const hoy = new Date()
  const hasta = new Date(hoy)
  hasta.setHours(23, 59, 59, 999)
  let desde = new Date(hoy)

  switch (periodo) {
    case 'hoy':
      desde.setHours(0, 0, 0, 0)
      break
    case '7d':
      desde = new Date(Date.now() - 7 * 86400000)
      desde.setHours(0, 0, 0, 0)
      break
    case '30d':
      desde = new Date(Date.now() - 30 * 86400000)
      desde.setHours(0, 0, 0, 0)
      break
    case 'mes':
      desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1)
      break
    case 'trimestre':
      desde = new Date(hoy.getFullYear(), Math.floor(hoy.getMonth() / 3) * 3, 1)
      break
    case 'año':
      desde = new Date(hoy.getFullYear(), 0, 1)
      break
  }

  return { desde: desde.toISOString(), hasta: hasta.toISOString() }
}

/** Período anterior equivalente (para comparativa de badges) */
export function getFechasAnteriores(periodo: PeriodoDash): { desde: string; hasta: string } {
  const hoy = new Date()

  switch (periodo) {
    case 'hoy': {
      const d = new Date(hoy); d.setDate(d.getDate() - 1)
      return {
        desde: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0).toISOString(),
        hasta: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59).toISOString(),
      }
    }
    case '7d': {
      return {
        desde: new Date(Date.now() - 14 * 86400000).toISOString(),
        hasta: new Date(Date.now() - 7 * 86400000).toISOString(),
      }
    }
    case '30d': {
      return {
        desde: new Date(Date.now() - 60 * 86400000).toISOString(),
        hasta: new Date(Date.now() - 30 * 86400000).toISOString(),
      }
    }
    case 'mes': {
      const d1 = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)
      const d2 = new Date(hoy.getFullYear(), hoy.getMonth(), 0, 23, 59, 59)
      return { desde: d1.toISOString(), hasta: d2.toISOString() }
    }
    case 'trimestre': {
      const t = Math.floor(hoy.getMonth() / 3)
      return {
        desde: new Date(hoy.getFullYear(), (t - 1) * 3, 1).toISOString(),
        hasta: new Date(hoy.getFullYear(), t * 3, 0, 23, 59, 59).toISOString(),
      }
    }
    case 'año': {
      return {
        desde: new Date(hoy.getFullYear() - 1, 0, 1).toISOString(),
        hasta: new Date(hoy.getFullYear() - 1, 11, 31, 23, 59, 59).toISOString(),
      }
    }
  }
}

/** Etiqueta legible para el período */
export function labelPeriodo(periodo: PeriodoDash): string {
  const map: Record<PeriodoDash, string> = {
    hoy: 'hoy',
    '7d': 'últimos 7 días',
    '30d': 'últimos 30 días',
    mes: 'este mes',
    trimestre: 'este trimestre',
    año: 'este año',
  }
  return map[periodo]
}

// ─── Componente ───────────────────────────────────────────────────────────────

interface FilterBarProps {
  periodo: PeriodoDash
  setPeriodo: (p: PeriodoDash) => void
  moneda: Moneda
  setMoneda: (m: Moneda) => void
  iva: IVAMode
  setIva: (i: IVAMode) => void
}

const PERIODOS: { key: PeriodoDash; label: string }[] = [
  { key: 'hoy',       label: 'Hoy' },
  { key: '7d',        label: '7D' },
  { key: '30d',       label: '30D' },
  { key: 'mes',       label: 'Mes' },
  { key: 'trimestre', label: 'Trim.' },
  { key: 'año',       label: 'Año' },
]

function PillGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex gap-0.5 bg-page rounded-lg p-1">
      {options.map(o => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={`px-3 py-1 rounded-md text-xs font-medium transition-colors
            ${value === o.key
              ? 'bg-accent text-white shadow-sm'
              : 'text-muted hover:text-primary dark:hover:text-white'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function FilterBar({ periodo, setPeriodo, moneda, setMoneda, iva, setIva }: FilterBarProps) {
  return (
    <div className="bg-surface border border-border-ds rounded-xl px-4 py-3 flex flex-wrap items-center gap-3">
      <PillGroup options={PERIODOS} value={periodo} onChange={setPeriodo} />
      <div className="h-5 w-px bg-border-ds hidden sm:block" />
      <PillGroup
        options={[{ key: 'ARS' as Moneda, label: 'ARS' }, { key: 'USD' as Moneda, label: 'USD' }]}
        value={moneda}
        onChange={setMoneda}
      />
      <div className="h-5 w-px bg-border-ds hidden sm:block" />
      <PillGroup
        options={[{ key: 'incluido' as IVAMode, label: 'c/IVA' }, { key: 'excluido' as IVAMode, label: 's/IVA' }]}
        value={iva}
        onChange={setIva}
      />
    </div>
  )
}
