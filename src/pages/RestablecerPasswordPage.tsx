// /restablecer-contrasena — adonde vuelve el link del correo de "¿Olvidaste tu contraseña?" (2026-10-05).
// Supabase deja la sesión iniciada al abrir el link (lo lee de la URL); acá se elige la contraseña nueva con el mismo
// formulario y la misma EF que el primer ingreso. Si el link venció o ya se usó, no hay sesión: se ofrece pedir otro.
// Antes no existía ningún camino para recuperar una contraseña olvidada.
import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { ElegirPasswordForm } from '@/components/ElegirPasswordForm'

export default function RestablecerPasswordPage() {
  const navigate = useNavigate()
  const [estado, setEstado] = useState<'esperando' | 'listo' | 'sin-sesion'>('esperando')

  useEffect(() => {
    let vivo = true
    // El link trae el token en la URL y supabase-js inicia la sesión al cargar. Se espera el evento; si en unos
    // segundos no hay sesión, el link venció o ya se usó.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((evento, sesion) => {
      if (!vivo) return
      if (sesion && (evento === 'PASSWORD_RECOVERY' || evento === 'SIGNED_IN' || evento === 'INITIAL_SESSION')) setEstado('listo')
    })
    supabase.auth.getSession().then(({ data }) => { if (vivo && data.session) setEstado('listo') })
    const t = setTimeout(() => { if (vivo) setEstado(e => (e === 'esperando' ? 'sin-sesion' : e)) }, 4000)
    return () => { vivo = false; clearTimeout(t); subscription.unsubscribe() }
  }, [])

  return (
    <div className="min-h-screen bg-brand-gradient-dark flex items-center justify-center p-4">
      {estado === 'esperando' && <p className="text-white/80 text-sm">Abriendo el link…</p>}

      {estado === 'listo' && (
        <ElegirPasswordForm
          titulo="Elegí una contraseña nueva"
          explicacion="La vas a usar para entrar con tu correo. Tiene que tener al menos 8 caracteres."
          textoBoton="Guardar y entrar"
          textoCancelar="Cancelar"
          onCancelar={async () => { await supabase.auth.signOut(); navigate('/login', { replace: true }) }}
          onListo={async (r) => {
            if (r === 'reingresar') {
              toast.success('Listo. Entrá con tu contraseña nueva.')
              await supabase.auth.signOut()
              navigate('/login', { replace: true })
              return
            }
            toast.success('Listo, tu contraseña quedó guardada')
            const { data } = await supabase.auth.getUser()
            if (data.user) await useAuthStore.getState().loadUserData(data.user.id)
            navigate('/dashboard', { replace: true })
          }}
        />
      )}

      {estado === 'sin-sesion' && (
        <div data-testid="restablecer-vencido" className="max-w-md w-full bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-8 text-center">
          <h1 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-2">El link ya no sirve</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            Venció o ya se usó. Pedí uno nuevo desde la pantalla de ingreso, con "¿Olvidaste tu contraseña?".
          </p>
          <Link to="/login" className="inline-block bg-accent text-white font-semibold px-5 py-2.5 rounded-xl">Ir al ingreso</Link>
        </div>
      )}
    </div>
  )
}
