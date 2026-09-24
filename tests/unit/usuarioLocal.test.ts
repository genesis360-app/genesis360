import { describe, it, expect } from 'vitest'
import {
  DOMINIO_USUARIOS_INTERNOS,
  normalizarUsuario,
  normalizarCodigoNegocio,
  validarUsuario,
  validarCodigoNegocio,
  emailInterno,
  esEmail,
  esUsuarioSinCorreo,
  credencialesParaMostrar,
} from '@/lib/usuarioLocal'

// Espejo EXACTO de los CHECK de la mig 434. Si el front deja pasar algo que estas expresiones
// rechazan, el INSERT muere en la base con un error de constraint que el dueño no puede interpretar.
const CHECK_USUARIO_DB = /^[a-z0-9][a-z0-9_-]{2,29}$/
const CHECK_CODIGO_DB = /^[a-z0-9]{3,20}$/

describe('normalizarUsuario', () => {
  it('baja a minúsculas y saca las tildes', () => {
    expect(normalizarUsuario('Martín')).toBe('martin')
    expect(normalizarUsuario('ÑANDÚ')).toBe('nandu')
    expect(normalizarUsuario('José María')).toBe('josemaria')
  })

  it('saca espacios y símbolos, y conserva guion y guion bajo', () => {
    expect(normalizarUsuario('juan perez')).toBe('juanperez')
    expect(normalizarUsuario('juan.perez')).toBe('juanperez')     // el punto separa usuario de código
    expect(normalizarUsuario('juan@perez')).toBe('juanperez')
    expect(normalizarUsuario('juan-perez')).toBe('juan-perez')
    expect(normalizarUsuario('juan_perez')).toBe('juan_perez')
  })

  it('recorta a 30 caracteres', () => {
    expect(normalizarUsuario('a'.repeat(50))).toHaveLength(30)
  })

  it('no explota con vacío ni con basura pura', () => {
    expect(normalizarUsuario('')).toBe('')
    expect(normalizarUsuario('!!!')).toBe('')
    expect(normalizarUsuario('日本語')).toBe('')
  })
})

describe('validarUsuario', () => {
  it('acepta los usuarios razonables', () => {
    expect(validarUsuario('juan')).toBeNull()
    expect(validarUsuario('juan-perez')).toBeNull()
    expect(validarUsuario('caja_2')).toBeNull()
    expect(validarUsuario('2deposito')).toBeNull()
  })

  it('rechaza lo que la base rechazaría', () => {
    expect(validarUsuario('')).toBeTruthy()
    expect(validarUsuario('ab')).toBeTruthy()             // menos de 3
    expect(validarUsuario('a'.repeat(31))).toBeTruthy()   // más de 30
    expect(validarUsuario('Juan')).toBeTruthy()           // mayúscula
    expect(validarUsuario('juan perez')).toBeTruthy()     // espacio
    expect(validarUsuario('juan.perez')).toBeTruthy()     // punto: rompería la dirección interna
    expect(validarUsuario('-juan')).toBeTruthy()          // no puede arrancar con guion
    expect(validarUsuario('_juan')).toBeTruthy()
    expect(validarUsuario('martín')).toBeTruthy()         // tilde
  })

  // 🛑 La que importa de verdad: que el front NUNCA le mande a la base algo que el CHECK rechaza.
  it('todo lo que normaliza y pasa la validación también pasa el CHECK de la base', () => {
    const entradas = [
      'Juan', 'Martín', 'José María', 'juan perez', 'JUAN-PEREZ', 'caja_2', '2deposito',
      'ÑANDÚ', 'a'.repeat(50), 'jua', 'Depósito Central', 'x-_-x', '007',
    ]
    for (const entrada of entradas) {
      const normalizado = normalizarUsuario(entrada)
      if (validarUsuario(normalizado) === null) {
        expect(CHECK_USUARIO_DB.test(normalizado), `"${entrada}" → "${normalizado}"`).toBe(true)
      }
    }
  })
})

describe('normalizarCodigoNegocio / validarCodigoNegocio', () => {
  it('deja solo letras y números', () => {
    expect(normalizarCodigoNegocio('Almacén Jorgito')).toBe('almacenjorgito')
    expect(normalizarCodigoNegocio('ALMACEN-27')).toBe('almacen27')
  })

  it('recorta a 20 y valida contra el mismo formato que la base', () => {
    const largo = normalizarCodigoNegocio('a'.repeat(40))
    expect(largo).toHaveLength(20)
    expect(validarCodigoNegocio(largo)).toBeNull()
    expect(CHECK_CODIGO_DB.test(largo)).toBe(true)
  })

  it('rechaza lo que no sirve', () => {
    expect(validarCodigoNegocio('')).toBeTruthy()
    expect(validarCodigoNegocio('ab')).toBeTruthy()
    expect(validarCodigoNegocio('almacen_27')).toBeTruthy()  // el guion bajo no entra en el código
  })
})

describe('emailInterno', () => {
  it('compone <usuario>.<codigo>@dominio', () => {
    expect(emailInterno('juan', 'almacen27')).toBe(`juan.almacen27@${DOMINIO_USUARIOS_INTERNOS}`)
  })

  // Si el empleado escribe "Juan" con mayúscula y la app no normaliza, la dirección no coincide con
  // la creada y el ingreso falla con "usuario o contraseña incorrectos", que no explica nada.
  it('normaliza las dos partes antes de componer', () => {
    expect(emailInterno('Juan', 'ALMACEN27')).toBe(emailInterno('juan', 'almacen27'))
    expect(emailInterno(' Martín ', 'Almacén 27')).toBe(`martin.almacen27@${DOMINIO_USUARIOS_INTERNOS}`)
  })

  it('el guion bajo del usuario no se confunde con el separador', () => {
    expect(emailInterno('caja_2', 'kiosco9')).toBe(`caja_2.kiosco9@${DOMINIO_USUARIOS_INTERNOS}`)
  })
})

describe('esEmail / esUsuarioSinCorreo', () => {
  it('distingue una dirección de un usuario', () => {
    expect(esEmail('juan@gmail.com')).toBe(true)
    expect(esEmail('juan')).toBe(false)
  })

  it('reconoce las cuentas sin correo por su dominio interno', () => {
    expect(esUsuarioSinCorreo(`juan.almacen27@${DOMINIO_USUARIOS_INTERNOS}`)).toBe(true)
    expect(esUsuarioSinCorreo(`JUAN.ALMACEN27@${DOMINIO_USUARIOS_INTERNOS.toUpperCase()}`)).toBe(true)
    expect(esUsuarioSinCorreo('juan@gmail.com')).toBe(false)
    expect(esUsuarioSinCorreo(null)).toBe(false)
    expect(esUsuarioSinCorreo(undefined)).toBe(false)
    // Un dominio que solo TERMINA parecido no alcanza.
    expect(esUsuarioSinCorreo('juan@fake-u.genesis360.pro.attacker.com')).toBe(false)
  })
})

describe('credencialesParaMostrar', () => {
  it('devuelve lo que el empleado tiene que escribir, nunca la dirección interna', () => {
    const cred = credencialesParaMostrar('Juan', 'Almacén 27')
    expect(cred).toEqual({ negocio: 'almacen27', usuario: 'juan' })
    expect(JSON.stringify(cred)).not.toContain('@')
  })
})
