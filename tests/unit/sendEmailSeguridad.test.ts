import { describe, it, expect } from 'vitest'
import {
  esc, textoPlano, rutaInterna, normalizarDestinatarios, destinatariosSegunTipo, validarAdjuntos, SOPORTE,
} from '../../supabase/functions/send-email/seguridad'

describe('esc', () => {
  it('🔴 CLAVE: el HTML que manda quien llama sale como texto', () => {
    expect(esc('<a href="https://evil.com">Pagá acá</a>')).toBe('&lt;a href=&quot;https://evil.com&quot;&gt;Pagá acá&lt;/a&gt;')
    expect(esc("O'Higgins & Cía")).toBe('O&#39;Higgins &amp; Cía')
    expect(esc(null)).toBe('')
  })
})

describe('textoPlano (asuntos)', () => {
  it('saca saltos de línea y recorta', () => {
    expect(textoPlano('Hola\r\nBcc: alguien')).toBe('Hola Bcc: alguien')
    expect(textoPlano('x'.repeat(300), 10)).toHaveLength(10)
  })

  it('🔴 CLAVE: no toca el texto normal (un regex roto llegó a borrar todas las "s")', () => {
    expect(textoPlano('Consultas sobre suscripciones y pagos')).toBe('Consultas sobre suscripciones y pagos')
    expect(textoPlano(`Aviso${String.fromCharCode(7)}importante${String.fromCharCode(0)}ya`)).toBe('Aviso importante ya')
  })
})

describe('rutaInterna', () => {
  it('acepta rutas de la app', () => {
    expect(rutaInterna('/caja?tab=historial')).toBe('/caja?tab=historial')
    expect(rutaInterna('/ayuda/consultas?ticket=1#fin')).toBe('/ayuda/consultas?ticket=1#fin')
  })

  it('🔴 CLAVE: rechaza lo que convierte el botón en un link a otro sitio', () => {
    expect(rutaInterna('//evil.com')).toBeNull()
    expect(rutaInterna('@evil.com')).toBeNull()
    expect(rutaInterna('https://evil.com')).toBeNull()
    expect(rutaInterna('/\\evil.com')).toBeNull()
    expect(rutaInterna('/ruta con espacios')).toBeNull()
    expect(rutaInterna(undefined)).toBeNull()
  })
})

describe('normalizarDestinatarios', () => {
  it('acepta un mail o una lista y valida el formato y el tope', () => {
    expect(normalizarDestinatarios('cliente@correo.com', 5)).toEqual({ ok: true, valor: ['cliente@correo.com'] })
    expect(normalizarDestinatarios(['a@b.com', 'c@d.com'], 5).ok).toBe(true)
    expect(normalizarDestinatarios('no-es-mail', 5).ok).toBe(false)
    expect(normalizarDestinatarios('a@b.com, c@d.com', 5).ok).toBe(false)
    expect(normalizarDestinatarios(Array(6).fill('a@b.com'), 5).ok).toBe(false)
    expect(normalizarDestinatarios('', 5).ok).toBe(false)
  })
})

describe('destinatariosSegunTipo', () => {
  it('🔴 CLAVE: los reportes van siempre a soporte, digan lo que digan', () => {
    expect(destinatariosSegunTipo('bug_report', 'usuario', 'victima@correo.com', 'yo@correo.com')).toEqual({ ok: true, valor: [SOPORTE] })
    expect(destinatariosSegunTipo('soporte_consulta', 'usuario', ['x@y.com'], 'yo@correo.com')).toEqual({ ok: true, valor: [SOPORTE] })
  })

  it('🔴 CLAVE: la bienvenida pedida desde la app solo va al propio usuario', () => {
    expect(destinatariosSegunTipo('welcome', 'usuario', 'victima@correo.com', 'yo@correo.com')).toEqual({ ok: true, valor: ['yo@correo.com'] })
  })

  it('un usuario no puede pedir tipos reservados al servidor', () => {
    const r = destinatariosSegunTipo('invitacion_proveedor', 'usuario', 'p@correo.com', 'yo@correo.com')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(403)
    expect(destinatariosSegunTipo('invitacion_proveedor', 'servicio', 'p@correo.com', null).ok).toBe(true)
  })

  it('los mails a clientes y proveedores siguen yendo al destinatario pedido', () => {
    expect(destinatariosSegunTipo('factura_emitida', 'usuario', 'cliente@correo.com', 'yo@correo.com'))
      .toEqual({ ok: true, valor: ['cliente@correo.com'] })
    expect(destinatariosSegunTipo('oc', 'usuario', 'no-es-mail', 'yo@correo.com').ok).toBe(false)
  })
})

describe('validarAdjuntos', () => {
  it('acepta PDF en base64 y rechaza lo que no lo es', () => {
    expect(validarAdjuntos([{ filename: 'OC-12.pdf', content: 'JVBERi0xLjQ=' }], 'usuario').ok).toBe(true)
    expect(validarAdjuntos([{ filename: 'x.pdf', content: '<script>' }], 'usuario').ok).toBe(false)
    expect(validarAdjuntos(undefined, 'usuario')).toEqual({ ok: true, valor: [] })
  })

  it('tope de cantidad para usuarios', () => {
    const cuatro = Array(4).fill({ filename: 'a.pdf', content: 'QQ==' })
    expect(validarAdjuntos(cuatro, 'usuario').ok).toBe(false)
    expect(validarAdjuntos(cuatro, 'servicio').ok).toBe(true)
  })
})
