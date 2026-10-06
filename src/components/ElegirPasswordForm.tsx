// Formulario "Elegí tu contraseña" — lo usan:
//  · AuthGuard (`debe_cambiar_password`): el empleado sin correo con la contraseña de un solo uso del dueño (mig 434)
//    y, desde 2026-10-05, quien entró por el link de una INVITACIÓN por correo (antes nunca se le pedía contraseña:
//    entraba una sola vez con el link y después no tenía cómo volver — caso El Tilo con Hotmail).
//  · /restablecer-contrasena: quien volvió del correo de "¿Olvidaste tu contraseña?".
//
// 🛑 El cambio y la baja de la bandera los hace la EF `usuarios-sin-correo` (acción `cambiar-password-propia`) en UNA
// llamada con service_role: si fueran dos pasos, alcanzaba con llamar al segundo y quedarse con la contraseña vieja.
// Esa acción sirve para cualquier usuario con sesión, no solo para los sin correo.
import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { BTN } from '@/config/brand'

import { PASSWORD_MIN, traducirErrorPassword, mensajeErrorEdgeFunction } from '@/lib/passwordPolicy'
// La política (mínimo 10, como Supabase Auth) y la traducción viven en src/lib/passwordPolicy.ts (con test).
export { PASSWORD_MIN, traducirErrorPassword }

/** Cambia la contraseña del usuario de la sesión y vuelve a entrar con la nueva (la Admin API revoca las sesiones). */
export async function guardarPasswordPropia(nueva: string): Promise<'ok' | 'reingresar'> {
  // La dirección se lee ANTES del cambio, mientras la sesión todavía vale.
  const { data: authData } = await supabase.auth.getUser()
  const email = authData?.user?.email

  const { data, error } = await supabase.functions.invoke('usuarios-sin-correo', {
    body: { accion: 'cambiar-password-propia', password: nueva },
  })
  // El mensaje real está en el cuerpo de la respuesta: sin leerlo, el usuario veía "Edge Function returned a non-2xx".
  if (error || data?.error) throw new Error(traducirErrorPassword(await mensajeErrorEdgeFunction(error, data)))

  // 🛑 Cambiar la contraseña con la Admin API revoca TODAS las sesiones del usuario, incluida esta. Sin volver a
  // entrar, la app lo saca al login sin explicación (spec 159). La contraseña nueva la tenemos en la mano.
  if (email) {
    const { error: reErr } = await supabase.auth.signInWithPassword({ email, password: nueva })
    if (reErr) return 'reingresar'
  }
  return 'ok'
}

export function ElegirPasswordForm({ titulo, explicacion, textoBoton = 'Guardar y entrar', onListo, onCancelar, textoCancelar }: {
  titulo: string
  explicacion: string
  textoBoton?: string
  onListo: (resultado: 'ok' | 'reingresar') => void | Promise<void>
  onCancelar?: () => void
  textoCancelar?: string
}) {
  const [nueva, setNueva] = useState('')
  const [repetir, setRepetir] = useState('')
  const [guardando, setGuardando] = useState(false)

  const problema =
    nueva.length > 0 && nueva.length < PASSWORD_MIN ? `Tiene que tener al menos ${PASSWORD_MIN} caracteres`
    : repetir.length > 0 && nueva !== repetir ? 'Las dos contraseñas no coinciden'
    : null
  const puedeGuardar = nueva.length >= PASSWORD_MIN && nueva === repetir && !guardando

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!puedeGuardar) return
    setGuardando(true)
    try {
      await onListo(await guardarPasswordPropia(nueva))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo cambiar la contraseña')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={guardar} data-testid="elegir-password"
      className="max-w-md w-full bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-8">
      <div className="w-14 h-14 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-5">
        <KeyRound size={26} className="text-accent-text" />
      </div>
      <h1 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-2 text-center">{titulo}</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 text-center">{explicacion}</p>

      <label htmlFor="pass-nueva" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Contraseña nueva</label>
      <input id="pass-nueva" type="password" autoFocus autoComplete="new-password" value={nueva}
        onChange={e => setNueva(e.target.value)}
        className="w-full px-3 py-2.5 mb-3 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 focus:outline-none focus:border-accent-text" />

      <label htmlFor="pass-repetir" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Repetila</label>
      <input id="pass-repetir" type="password" autoComplete="new-password" value={repetir}
        onChange={e => setRepetir(e.target.value)}
        className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 focus:outline-none focus:border-accent-text" />

      {problema && <p className="text-xs text-red-500 mt-2">{problema}</p>}

      <button type="submit" disabled={!puedeGuardar} className={`w-full mt-5 ${BTN.primary} ${BTN.md}`}>
        {guardando ? 'Guardando…' : textoBoton}
      </button>
      {onCancelar && (
        <button type="button" onClick={onCancelar}
          className="w-full mt-2 py-2 text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition">
          {textoCancelar ?? 'Cerrar sesión'}
        </button>
      )}
    </form>
  )
}
