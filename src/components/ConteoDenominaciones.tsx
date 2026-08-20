import { useState } from 'react'
import { DENOMINACIONES_USD, sumaDenominaciones } from '@/lib/cajaArqueo'

// G5 Fase 3 (E2) — conteo de Caja USD por denominación de billete (1/5/10/20/50/100), en vez de
// tipear un monto total a mano. J2: solo billetes enteros (US$1 como unidad mínima, sin centavos).
// `onChange` recibe el total como string, igual que el <input type="number"> que reemplaza — el
// resto del código de arqueo/cierre (diferencia, guardado) sigue leyendo esa misma prop sin cambios.
interface ConteoDenominacionesProps {
  total: string
  onChange: (total: string) => void
}

export function ConteoDenominaciones({ total: _total, onChange }: ConteoDenominacionesProps) {
  const [cantidades, setCantidades] = useState<Record<number, string>>({})

  const actualizar = (denom: number, valor: string) => {
    const siguiente = { ...cantidades, [denom]: valor }
    setCantidades(siguiente)
    onChange(String(sumaDenominaciones(siguiente)))
  }

  const suma = sumaDenominaciones(cantidades)

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        {DENOMINACIONES_USD.map(denom => (
          <div key={denom}>
            <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-0.5">US$ {denom}</label>
            <input type="number" onWheel={e => e.currentTarget.blur()} min="0" step="1"
              value={cantidades[denom] ?? ''}
              onChange={e => actualizar(denom, e.target.value)}
              placeholder="0"
              className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent-text" />
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500">Total contado: <span className="font-semibold text-gray-700 dark:text-gray-300">US$ {suma.toLocaleString('es-AR')}</span></p>
    </div>
  )
}
