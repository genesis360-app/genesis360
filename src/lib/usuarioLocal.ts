/**
 * usuarioLocal.ts — usuarios que entran con NOMBRE y CONTRASEÑA, sin correo (mig 434).
 *
 * En un negocio chico los empleados no tienen mail propio. El dueño les crea un usuario acá y por
 * dentro la app arma una dirección que NUNCA recibe correo, que es la identidad de Supabase Auth:
 *
 *     <usuario>.<codigo del negocio>@u.genesis360.pro
 *
 * El empleado no la ve ni la escribe: al ingresar pone el código del negocio y su usuario, y la app
 * compone la dirección de este lado. Por eso la composición es DETERMINÍSTICA — no hay que
 * preguntarle nada al servidor antes de autenticar, así que tampoco hay una tabla que alguien
 * pueda barrer desde afuera para enumerar los usuarios de un negocio.
 *
 * 🛑 Esta lógica decide con qué identidad entra una persona, así que vive acá (en `src/lib`, con
 * tests) y no adentro de un `.tsx`. Es la regla que salió del UAT §68: lo que vive en un componente
 * no está testeado por más verde que esté la suite.
 *
 * ⚠️ El dominio y las reglas de formato están DUPLICADOS en la Edge Function `usuarios-sin-correo`
 * (Deno no puede importar de `src/`). Si cambian acá, cambian allá — y al revés. El servidor es el
 * que manda: la EF compone la dirección con el `codigo` que lee de la base, nunca con uno que le
 * mande el cliente.
 */

/** Subdominio que no tiene MX ni casilla: nada enviado ahí llega a ninguna parte, a propósito. */
export const DOMINIO_USUARIOS_INTERNOS = 'u.genesis360.pro'

export const USUARIO_LARGO_MIN = 3
export const USUARIO_LARGO_MAX = 30

/** Espejo de `users_usuario_formato` (mig 434). */
const RE_USUARIO = /^[a-z0-9][a-z0-9_-]{2,29}$/
/** Espejo de `tenants_codigo_formato` (mig 434). */
const RE_CODIGO = /^[a-z0-9]{3,20}$/

/**
 * Saca tildes y ñ. `normalize('NFD')` parte la letra acentuada en letra + acento suelto, y el
 * reemplazo borra los acentos sueltos: "Martín" → "Martin", "Ñandú" → "Nandu".
 */
function sinAcentos(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * Lleva lo que escribió el dueño a un usuario válido: minúsculas, sin tildes, sin espacios ni
 * símbolos. "Juan Pérez" → "juanperez". No valida el largo (para eso está `validarUsuario`), así
 * que sirve para ir normalizando mientras se tipea.
 */
export function normalizarUsuario(raw: string): string {
  return sinAcentos(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, USUARIO_LARGO_MAX)
}

/** Igual que el usuario pero sin `_` ni `-`: el código es la parte que separa el punto. */
export function normalizarCodigoNegocio(raw: string): string {
  return sinAcentos(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 20)
}

/** Devuelve el motivo por el que NO sirve, o `null` si está bien. */
export function validarUsuario(usuario: string): string | null {
  const u = usuario ?? ''
  if (u.length === 0) return 'Escribí un nombre de usuario'
  if (u.length < USUARIO_LARGO_MIN) return `El usuario necesita al menos ${USUARIO_LARGO_MIN} caracteres`
  if (u.length > USUARIO_LARGO_MAX) return `El usuario no puede superar los ${USUARIO_LARGO_MAX} caracteres`
  if (!RE_USUARIO.test(u)) {
    return 'El usuario solo puede tener letras sin tilde, números, guion y guion bajo, y tiene que empezar con letra o número'
  }
  return null
}

export function validarCodigoNegocio(codigo: string): string | null {
  const c = codigo ?? ''
  if (c.length === 0) return 'Escribí el código del negocio'
  if (!RE_CODIGO.test(c)) return 'El código del negocio tiene entre 3 y 20 letras o números, sin espacios'
  return null
}

/**
 * La dirección interna de Auth. Normaliza las dos partes antes de componer: si llegaran con
 * mayúsculas o tildes, la dirección no coincidiría con la que se creó y el ingreso fallaría con un
 * "usuario o contraseña incorrectos" que no explica nada.
 */
export function emailInterno(usuario: string, codigoNegocio: string): string {
  const u = normalizarUsuario(usuario)
  const c = normalizarCodigoNegocio(codigoNegocio)
  return `${u}.${c}@${DOMINIO_USUARIOS_INTERNOS}`
}

/** true si lo que escribieron es una dirección de correo y no un nombre de usuario. */
export function esEmail(texto: string): boolean {
  return (texto ?? '').includes('@')
}

/**
 * true si la cuenta entra sin correo. Se decide por la dirección —no por `users.usuario`— para
 * poder responder también donde solo se tiene la sesión de Auth, como en la pantalla de ingreso.
 */
export function esUsuarioSinCorreo(email: string | null | undefined): boolean {
  return (email ?? '').toLowerCase().endsWith(`@${DOMINIO_USUARIOS_INTERNOS}`)
}

/**
 * Lo que se le muestra al empleado para que sepa qué escribir al ingresar. La dirección interna no
 * se muestra nunca: no es una casilla y mostrarla invita a escribirla o a esperar un mail ahí.
 */
export function credencialesParaMostrar(usuario: string, codigoNegocio: string): { negocio: string; usuario: string } {
  return { negocio: normalizarCodigoNegocio(codigoNegocio), usuario: normalizarUsuario(usuario) }
}
