// Selector de permisos con dos pestañas: por ROL (incluye los roles personalizados del negocio) y por USUARIO (permiso
// directo). El valor es una lista de claves: 'SUPERVISOR', 'custom:<id>', 'user:<id>' (mig 472). No guarda nada: el
// que lo usa decide cuándo (Configuración guarda con su botón). El DUEÑO siempre puede y se muestra fijo.
import { useMemo, useState } from 'react'
import { ChevronDown, ShieldCheck } from 'lucide-react'

export interface OpcionPermiso { clave: string; nombre: string; detalle?: string }

export function SelectorPermisos({ titulo, descripcion, valor, onChange, roles, usuarios, disabled, testid }: {
  titulo: string
  descripcion?: string
  valor: string[]
  onChange: (v: string[]) => void
  roles: OpcionPermiso[]
  usuarios: OpcionPermiso[]
  disabled?: boolean
  testid?: string
}) {
  const [abierto, setAbierto] = useState(false)
  const [pestana, setPestana] = useState<'roles' | 'usuarios'>('roles')
  const marcados = useMemo(() => new Set(valor), [valor])
  const nRoles = roles.filter(r => marcados.has(r.clave)).length
  const nUsuarios = usuarios.filter(u => marcados.has(u.clave)).length

  const alternar = (clave: string) => {
    if (disabled) return
    onChange(marcados.has(clave) ? valor.filter(v => v !== clave) : [...valor, clave])
  }
  const resumen = [
    nRoles ? `${nRoles} rol${nRoles === 1 ? '' : 'es'}` : null,
    nUsuarios ? `${nUsuarios} usuario${nUsuarios === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' y ') || 'Solo el dueño'

  const lista = pestana === 'roles' ? roles : usuarios
  return (
    <div data-testid={testid} className="rounded-xl border border-gray-200 dark:border-gray-700">
      <button type="button" onClick={() => setAbierto(a => !a)} aria-expanded={abierto}
        className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <ShieldCheck size={16} className="text-accent-text flex-shrink-0" />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-gray-700 dark:text-gray-200">{titulo}</span>
          <span className="block text-xs text-gray-500 dark:text-gray-400">{resumen}</span>
        </span>
        <ChevronDown size={16} className={`text-gray-400 transition-transform ${abierto ? 'rotate-180' : ''}`} />
      </button>

      {abierto && (
        <div className="border-t border-gray-100 dark:border-gray-700 px-4 pb-4 pt-3 space-y-3">
          {descripcion && <p className="text-xs text-gray-500 dark:text-gray-400">{descripcion}</p>}
          <div role="tablist" className="inline-flex rounded-lg bg-gray-100 dark:bg-gray-700 p-0.5 text-xs font-medium">
            {(['roles', 'usuarios'] as const).map(p => (
              <button key={p} type="button" role="tab" aria-selected={pestana === p} onClick={() => setPestana(p)}
                className={`px-3 py-1.5 rounded-md ${pestana === p ? 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}>
                {p === 'roles' ? `Roles${nRoles ? ` (${nRoles})` : ''}` : `Usuarios${nUsuarios ? ` (${nUsuarios})` : ''}`}
              </button>
            ))}
          </div>

          <ul className="max-h-64 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700">
            <li className="flex items-center gap-3 py-2 opacity-70">
              <input type="checkbox" checked disabled className="accent-accent" aria-label="Dueño" />
              <span className="text-sm text-gray-700 dark:text-gray-200">Dueño</span>
              <span className="text-xs text-gray-400">siempre</span>
            </li>
            {lista.length === 0 && (
              <li className="py-3 text-xs text-gray-400">
                {pestana === 'roles' ? 'No hay otros roles.' : 'No hay otros usuarios activos en el negocio.'}
              </li>
            )}
            {lista.map(o => (
              <li key={o.clave}>
                <label className="flex items-center gap-3 py-2 cursor-pointer">
                  <input type="checkbox" checked={marcados.has(o.clave)} disabled={disabled} onChange={() => alternar(o.clave)}
                    className="accent-accent" />
                  <span className="text-sm text-gray-700 dark:text-gray-200">{o.nombre}</span>
                  {o.detalle && <span className="text-xs text-gray-400">{o.detalle}</span>}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
