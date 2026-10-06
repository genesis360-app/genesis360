import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { BRAND } from '@/config/brand'
import { fmtPesos } from '@/lib/formato'
import { Package, Building2, LogOut, Lock, AlertTriangle, CheckCircle2, Send } from 'lucide-react'
import toast, { Toaster } from 'react-hot-toast'
import { PASSWORD_MIN, traducirErrorPassword } from '@/lib/passwordPolicy'

// Portal de Proveedores (Fede, sección H — ver mig 387/390). Página PÚBLICA autocontenida (fuera
// de AppLayout/AuthGuard a propósito): la identidad de una cuenta de proveedor (`proveedor_accounts`)
// es un auth.users SEPARADO de `users` — no tiene fila en `users`, así que el resto de la app
// (useAuthStore/AuthGuard) no la reconocería. Todo el acceso a datos va por 4 RPC SECURITY DEFINER
// (fn_portal_proveedor_*, mig 390) — nunca RLS directa sobre tenants/ordenes_compra/productos.
//
// Llega acá por 3 caminos: (1) link mágico del email de invitación (la sesión ya queda activa
// sola al cargar, Supabase la detecta del fragmento de la URL), (2) login manual con email+
// contraseña si ya la configuró antes, (3) directo sin sesión → login.
// Desde 2026-10-06 (GO): (4) "¿Primera vez u olvidaste tu contraseña?" le manda al proveedor un link a SU correo para
// crear/recuperar la contraseña (antes solo podía pedirle al negocio que lo invitara de nuevo), y quien entra sin
// contraseña definida (por el link de la invitación) ve el panel para crearla.

type Negocio = { tenant_id: string; negocio_nombre: string; proveedor_id: string; proveedor_nombre: string }
type OC = { id: string; numero: number; estado: string; fecha_esperada: string | null; notas: string | null; created_at: string; monto_total: number | null; condiciones_pago: string | null; etiqueta?: string | null }
type OCItem = { id: string; producto_id: string; producto_nombre: string; producto_sku: string | null; cantidad: number; precio_unitario: number | null; precio_propuesto_proveedor: number | null; respondido_at: string | null; oc_estado: string }

const ESTADO_LABEL: Record<string, { label: string; color: string }> = {
  enviada: { label: 'Esperando tu respuesta', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  confirmada: { label: 'Confirmada', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  cancelada: { label: 'Cancelada', color: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400' },
  recibida_parcial: { label: 'Recibida (parcial)', color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400' },
  recibida: { label: 'Recibida', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
}

export default function PortalProveedoresPage() {
  const [checking, setChecking] = useState(true)
  const [logueado, setLogueado] = useState(false)
  const [nombreCuenta, setNombreCuenta] = useState('')

  // Login manual
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPass, setLoginPass] = useState('')
  const [loginSaving, setLoginSaving] = useState(false)
  const [loginError, setLoginError] = useState('')

  // Negocios / OC
  const [negocios, setNegocios] = useState<Negocio[]>([])
  const [tenantActivo, setTenantActivo] = useState<string | null>(null)
  const [ocs, setOcs] = useState<OC[]>([])
  const [loadingOcs, setLoadingOcs] = useState(false)
  const [ocAbierta, setOcAbierta] = useState<string | null>(null)
  const [items, setItems] = useState<OCItem[]>([])
  const [precios, setPrecios] = useState<Record<string, string>>({})
  const [enviandoItem, setEnviandoItem] = useState<string | null>(null)

  // Configurar contraseña
  const [passPanelOpen, setPassPanelOpen] = useState(false)
  // Viene del link de "recuperar" o nunca definió una: el panel se abre solo y explica por qué.
  const [debeCrearPass, setDebeCrearPass] = useState(false)
  // "¿Primera vez u olvidaste tu contraseña?"
  const [modoRecuperar, setModoRecuperar] = useState(false)
  const [recuperarEnviado, setRecuperarEnviado] = useState(false)
  const [nuevaPass, setNuevaPass] = useState('')
  const [passSaving, setPassSaving] = useState(false)

  const cargarSesion = async () => {
    const { data } = await supabase.auth.getUser()
    if (!data?.user) { setLogueado(false); setChecking(false); return }
    const { data: cuenta } = await supabase.from('proveedor_accounts')
      .select('nombre, email').eq('id', data.user.id).maybeSingle()
    if (!cuenta) {
      // Sesión válida pero no es una cuenta de proveedor (ej. quedó una sesión de staff en este
      // navegador) — cerrar y mostrar el login del portal, no mezclar identidades.
      await supabase.auth.signOut()
      setLogueado(false); setChecking(false); return
    }
    setNombreCuenta(cuenta.nombre || cuenta.email || '')
    // Entró por un link (invitación o recuperar) y todavía no eligió contraseña: se le pide crearla, así la próxima vez
    // entra con email + contraseña sin depender de un link.
    if (data.user.user_metadata?.portal_password_definida !== true) { setDebeCrearPass(true); setPassPanelOpen(true) }
    setLogueado(true)
    setChecking(false)
    void cargarNegocios()
  }

  // Chequeo de sesión único al montar el portal — `cargarSesion` no está memoizada.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void cargarSesion() }, [])
  // El link de "recuperar" abre una sesión de recuperación: el panel de contraseña se abre de una.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((evento) => {
      if (evento === 'PASSWORD_RECOVERY') { setDebeCrearPass(true); setPassPanelOpen(true) }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const cargarNegocios = async () => {
    const { data, error } = await supabase.rpc('fn_portal_proveedor_negocios')
    if (error) { toast.error('No se pudieron cargar tus negocios vinculados'); return }
    const lista = (data ?? []) as Negocio[]
    setNegocios(lista)
    if (lista.length === 1) setTenantActivo(lista[0].tenant_id)
  }

  useEffect(() => {
    if (!tenantActivo) return
    setLoadingOcs(true)
    setOcAbierta(null); setItems([])
    supabase.rpc('fn_portal_proveedor_ocs', { p_tenant_id: tenantActivo }).then(({ data, error }) => {
      if (error) toast.error('No se pudieron cargar las órdenes de compra')
      setOcs((data ?? []) as OC[])
      setLoadingOcs(false)
    })
  }, [tenantActivo])

  const abrirOC = async (ocId: string) => {
    if (ocAbierta === ocId) { setOcAbierta(null); return }
    setOcAbierta(ocId)
    const { data, error } = await supabase.rpc('fn_portal_proveedor_oc_items', { p_oc_id: ocId })
    if (error) { toast.error('No se pudieron cargar los ítems de esta orden'); return }
    const lista = (data ?? []) as OCItem[]
    setItems(lista)
    const pre: Record<string, string> = {}
    for (const it of lista) pre[it.id] = it.precio_propuesto_proveedor != null ? String(it.precio_propuesto_proveedor) : ''
    setPrecios(pre)
  }

  const enviarPrecio = async (itemId: string) => {
    const precio = parseFloat(precios[itemId] ?? '')
    if (!precio || precio <= 0) { toast.error('Ingresá un precio válido'); return }
    setEnviandoItem(itemId)
    try {
      const { error } = await supabase.rpc('fn_portal_proveedor_responder_item', { p_item_id: itemId, p_precio: precio })
      if (error) throw error
      toast.success('Precio enviado')
      setItems(prev => prev.map(it => it.id === itemId ? { ...it, precio_propuesto_proveedor: precio, respondido_at: new Date().toISOString() } : it))
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudo enviar el precio')
    } finally {
      setEnviandoItem(null)
    }
  }

  const login = async () => {
    setLoginError('')
    if (!loginEmail.trim() || !loginPass) { setLoginError('Completá email y contraseña'); return }
    setLoginSaving(true)
    const { error } = await supabase.auth.signInWithPassword({ email: loginEmail.trim(), password: loginPass })
    setLoginSaving(false)
    if (error) { setLoginError('Email o contraseña incorrectos'); return }
    void cargarSesion()
  }

  const logout = async () => {
    await supabase.auth.signOut()
    setLogueado(false); setNegocios([]); setTenantActivo(null); setOcs([]); setItems([]); setOcAbierta(null)
  }

  const guardarPassword = async () => {
    if (nuevaPass.length < PASSWORD_MIN) { toast.error(`La contraseña debe tener al menos ${PASSWORD_MIN} caracteres`); return }
    setPassSaving(true)
    const { error } = await supabase.auth.updateUser({ password: nuevaPass, data: { portal_password_definida: true } })
    setPassSaving(false)
    if (error) { toast.error(traducirErrorPassword(error.message)); return }
    toast.success(debeCrearPass ? 'Listo: la próxima vez entrá con tu email y esta contraseña' : 'Contraseña actualizada')
    setNuevaPass(''); setPassPanelOpen(false); setDebeCrearPass(false)
  }

  // Link a SU correo para crear o recuperar la contraseña. El mensaje es el mismo exista o no la cuenta (no se revela
  // qué correos son proveedores).
  const pedirLink = async () => {
    setLoginError('')
    const email = loginEmail.trim()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setLoginError('Ingresá tu email'); return }
    setLoginSaving(true)
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/portal-proveedores` })
    setLoginSaving(false)
    setRecuperarEnviado(true)
  }

  if (checking) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">Cargando…</div>
  }

  if (!logueado) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
        <Toaster position="top-center" />
        <div className="w-full max-w-sm bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6">
          <div className="text-center mb-5">
            <Package size={32} className="mx-auto text-accent-text mb-2" />
            <h1 className="text-lg font-bold text-primary">Portal de Proveedores</h1>
            <p className="text-xs text-gray-400 mt-1">{BRAND.name}</p>
          </div>
          {modoRecuperar ? (
            <div className="space-y-3" data-testid="portal-recuperar">
              {recuperarEnviado ? (
                <p className="text-sm text-gray-600 dark:text-gray-300 text-center">
                  Si <strong>{loginEmail.trim()}</strong> es un proveedor registrado, te llega un correo con un link para crear tu
                  contraseña. Sirve una vez y vence en 24 horas. Revisá también el correo no deseado.
                </p>
              ) : (
                <>
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    Escribí el email con el que te invitó el negocio y te mandamos un link para crear (o cambiar) tu contraseña.
                  </p>
                  <input type="email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)}
                    placeholder="Tu email" autoComplete="email" aria-label="Tu email"
                    onKeyDown={e => { if (e.key === 'Enter') void pedirLink() }}
                    className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-900 focus:outline-none focus:border-accent-text" />
                  {loginError && <p className="text-xs text-red-500">{loginError}</p>}
                  <button onClick={pedirLink} disabled={loginSaving}
                    className="w-full bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50">
                    {loginSaving ? 'Enviando…' : 'Enviarme el link'}
                  </button>
                </>
              )}
              <button onClick={() => { setModoRecuperar(false); setRecuperarEnviado(false); setLoginError('') }}
                className="w-full text-xs text-accent-text hover:underline pt-1">Volver a ingresar con contraseña</button>
            </div>
          ) : (
          <div className="space-y-3">
            <input type="email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)}
              placeholder="Tu email" autoComplete="email"
              className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-900 focus:outline-none focus:border-accent-text" />
            <input type="password" value={loginPass} onChange={e => setLoginPass(e.target.value)}
              placeholder="Contraseña" autoComplete="current-password"
              onKeyDown={e => { if (e.key === 'Enter') void login() }}
              className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-900 focus:outline-none focus:border-accent-text" />
            {loginError && <p className="text-xs text-red-500">{loginError}</p>}
            <button onClick={login} disabled={loginSaving}
              className="w-full bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50">
              {loginSaving ? 'Ingresando…' : 'Ingresar'}
            </button>
            <button onClick={() => { setModoRecuperar(true); setLoginError('') }}
              className="w-full text-sm text-accent-text hover:underline pt-1">
              ¿Primera vez u olvidaste tu contraseña?
            </button>
          </div>
          )}
        </div>
      </div>
    )
  }

  const negocioActivo = negocios.find(n => n.tenant_id === tenantActivo)

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Toaster position="top-center" />
      <div className="bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package size={20} className="text-accent-text" />
          <div>
            <p className="text-sm font-semibold text-primary leading-tight">Portal de Proveedores</p>
            <p className="text-xs text-gray-400 leading-tight">{nombreCuenta}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setPassPanelOpen(o => !o)} title="Configurar contraseña"
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><Lock size={16} /></button>
          <button onClick={logout} title="Cerrar sesión"
            className="p-2 text-gray-400 hover:text-red-500"><LogOut size={16} /></button>
        </div>
      </div>

      {passPanelOpen && (
        <div className="max-w-xl mx-auto mt-4 px-4">
          <div className={`bg-white dark:bg-gray-800 rounded-xl border p-4 flex items-center gap-2 flex-wrap ${debeCrearPass ? 'border-accent-text/40' : 'border-gray-100 dark:border-gray-700'}`}
            data-testid="portal-crear-password">
            {debeCrearPass && (
              <div className="w-full mb-1">
                <p className="text-sm font-semibold text-primary">Creá tu contraseña</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Así la próxima vez entrás con tu email y contraseña, sin esperar un link.</p>
              </div>
            )}
            <input type="password" value={nuevaPass} onChange={e => setNuevaPass(e.target.value)} autoComplete="new-password"
              aria-label="Nueva contraseña"
              placeholder={`Nueva contraseña (mín. ${PASSWORD_MIN} caracteres)`}
              className="flex-1 min-w-[200px] border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 focus:outline-none focus:border-accent-text" />
            <button onClick={guardarPassword} disabled={passSaving}
              className="bg-accent hover:bg-accent/90 text-white text-sm font-medium px-3 py-2 rounded-lg disabled:opacity-50">
              {passSaving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      )}

      <div className="max-w-xl mx-auto p-4 space-y-4">
        {negocios.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-8 text-center text-gray-400">
            <AlertTriangle size={28} className="mx-auto mb-2 opacity-40" />
            <p className="text-sm">Todavía no estás vinculado a ningún negocio.</p>
          </div>
        ) : (
          <>
            {negocios.length > 1 && (
              <div className="flex items-center gap-2">
                <Building2 size={16} className="text-gray-400" />
                <select value={tenantActivo ?? ''} onChange={e => setTenantActivo(e.target.value || null)}
                  className="flex-1 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-800">
                  <option value="">Elegí un negocio…</option>
                  {negocios.map(n => <option key={n.tenant_id} value={n.tenant_id}>{n.negocio_nombre}</option>)}
                </select>
              </div>
            )}
            {negocios.length === 1 && (
              <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1.5"><Building2 size={14} /> {negocios[0].negocio_nombre}</p>
            )}

            {tenantActivo && (
              loadingOcs ? (
                <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" /></div>
              ) : ocs.length === 0 ? (
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-8 text-center text-gray-400 text-sm">
                  No tenés órdenes de compra de {negocioActivo?.negocio_nombre} todavía.
                </div>
              ) : (
                <div className="space-y-2">
                  {ocs.map(oc => {
                    const est = ESTADO_LABEL[oc.estado] ?? { label: oc.estado, color: 'bg-gray-100 text-gray-600' }
                    return (
                      <div key={oc.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
                        <button onClick={() => void abrirOC(oc.id)} className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/40">
                          <div>
                            <p className="text-sm font-semibold text-primary">{oc.etiqueta ?? `OC #${oc.numero}`}</p>
                            <p className="text-xs text-gray-400">{new Date(oc.created_at).toLocaleDateString('es-AR')}{oc.monto_total ? ` · ${fmtPesos(oc.monto_total)}` : ''}</p>
                          </div>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${est.color}`}>{est.label}</span>
                        </button>
                        {ocAbierta === oc.id && (
                          <div className="border-t border-gray-100 dark:border-gray-700 p-4 space-y-3">
                            {oc.notas && <p className="text-xs text-gray-500 dark:text-gray-400">Notas: {oc.notas}</p>}
                            {items.map(it => (
                              <div key={it.id} className="flex items-center justify-between gap-3 bg-gray-50 dark:bg-gray-900/40 rounded-lg px-3 py-2">
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm text-gray-800 dark:text-gray-100 truncate">{it.producto_nombre}</p>
                                  <p className="text-xs text-gray-400">{it.producto_sku ? `${it.producto_sku} · ` : ''}Cant. {it.cantidad}</p>
                                </div>
                                {oc.estado === 'enviada' ? (
                                  <div className="flex items-center gap-1.5 flex-shrink-0">
                                    <input type="number" min="0" step="0.01"
                                      value={precios[it.id] ?? ''}
                                      onChange={e => setPrecios(p => ({ ...p, [it.id]: e.target.value }))}
                                      placeholder="Precio"
                                      className="w-24 px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-right bg-white dark:bg-gray-800 focus:outline-none focus:border-accent-text" />
                                    <button onClick={() => void enviarPrecio(it.id)} disabled={enviandoItem === it.id}
                                      title="Enviar precio"
                                      className="p-1.5 bg-accent hover:bg-accent/90 text-white rounded-lg disabled:opacity-50">
                                      {it.respondido_at ? <CheckCircle2 size={15} /> : <Send size={15} />}
                                    </button>
                                  </div>
                                ) : (
                                  <p className="text-sm font-medium text-gray-600 dark:text-gray-300 flex-shrink-0">
                                    {it.precio_unitario != null ? fmtPesos(it.precio_unitario) : '—'}
                                  </p>
                                )}
                              </div>
                            ))}
                            {oc.estado === 'enviada' && (
                              <p className="text-xs text-gray-400">Cargá el precio real por ítem — el negocio lo revisa antes de confirmar la orden.</p>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            )}
          </>
        )}
      </div>
    </div>
  )
}
