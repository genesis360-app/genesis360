import { describe, it, expect } from 'vitest'
import { PASSWORD_MIN, problemaPassword, traducirErrorPassword, mensajeErrorEdgeFunction } from '@/lib/passwordPolicy'

// GO 06/10: el empleado eligió una contraseña de 8 caracteres, la app la aceptó (decía "mínimo 8") y Supabase la rechazó
// (exige 10 + no filtrada) con "Edge Function returned a non-2xx status code".
describe('política de contraseñas', () => {
  it('el mínimo es el de Supabase Auth (10)', () => {
    expect(PASSWORD_MIN).toBe(10)
    expect(problemaPassword('12345678')).toMatch(/al menos 10/)
    expect(problemaPassword('1234567890')).toBeNull()
    expect(problemaPassword('')).toBeNull()
  })
  it('traduce los errores de Supabase (el real del log incluido)', () => {
    expect(traducirErrorPassword('Password should be at least 10 characters. Password is known to be weak and easy to guess, please choose a different one.'))
      .toBe('La contraseña tiene que tener al menos 10 caracteres y no puede ser una contraseña conocida o fácil de adivinar')
    expect(traducirErrorPassword('Password is known to be weak and easy to guess, please choose a different one.')).toMatch(/filtraciones/)
    expect(traducirErrorPassword('New password should be different from the old password.')).toMatch(/distinta/)
    expect(traducirErrorPassword('otra cosa')).toBe('otra cosa')
  })
  it('lee el mensaje real del cuerpo de la Edge Function, no el genérico', async () => {
    const error = { message: 'Edge Function returned a non-2xx status code', context: { json: async () => ({ error: 'Password should be at least 10 characters.' }) } }
    expect(await mensajeErrorEdgeFunction(error, null)).toBe('Password should be at least 10 characters.')
    expect(await mensajeErrorEdgeFunction({ message: 'genérico' }, null)).toBe('genérico')
    expect(await mensajeErrorEdgeFunction(null, { error: 'del data' })).toBe('del data')
  })
})
