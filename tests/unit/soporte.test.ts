import { describe, it, expect } from 'vitest'
import {
  validarNuevaConsulta, validarRespuesta, validarAdjunto, rutaAdjunto, estadoParaCliente, puedeResponder,
  MAX_BYTES_ADJUNTO,
} from '../../src/lib/soporte'

const TENANT = '3769b1db-10f4-46a6-bc7f-eb669307730d'
const USER = '0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b'

describe('validarNuevaConsulta (espejo de fn_soporte_crear_consulta)', () => {
  it('pide asunto de 3 a 120 caracteres y un mensaje', () => {
    expect(validarNuevaConsulta({ asunto: 'No imprime', cuerpo: 'Desde ayer' })).toBeNull()
    expect(validarNuevaConsulta({ asunto: 'ok', cuerpo: 'x' })).toMatch(/3 letras/)
    expect(validarNuevaConsulta({ asunto: 'x'.repeat(121), cuerpo: 'x' })).toMatch(/120/)
    expect(validarNuevaConsulta({ asunto: 'Asunto', cuerpo: '   ' })).toMatch(/qué pasa/)
    expect(validarNuevaConsulta({ asunto: 'Asunto', cuerpo: 'x'.repeat(4001) })).toMatch(/4000/)
  })

  it('respuesta: vacía o larga no', () => {
    expect(validarRespuesta('Gracias')).toBeNull()
    expect(validarRespuesta('  ')).not.toBeNull()
    expect(validarRespuesta('x'.repeat(4001))).not.toBeNull()
  })
})

describe('validarAdjunto', () => {
  it('imágenes y PDF de hasta 5 MB', () => {
    expect(validarAdjunto({ name: 'captura.png', size: 1000, type: 'image/png' })).toBeNull()
    expect(validarAdjunto({ name: 'factura.pdf', size: MAX_BYTES_ADJUNTO, type: 'application/pdf' })).toBeNull()
    expect(validarAdjunto({ name: 'video.mp4', size: 1000, type: 'video/mp4' })).toMatch(/solo imágenes/)
    expect(validarAdjunto({ name: 'enorme.jpg', size: MAX_BYTES_ADJUNTO + 1, type: 'image/jpeg' })).toMatch(/5 MB/)
  })
})

describe('rutaAdjunto', () => {
  it('🔴 CLAVE: arranca con negocio/usuario, que es lo que exige la política de Storage', () => {
    const ruta = rutaAdjunto(TENANT, USER, 'Captura.png', 'abc')
    expect(ruta.startsWith(`${TENANT}/${USER}/`)).toBe(true)
    expect(ruta).toBe(`${TENANT}/${USER}/abc-captura.png`)
  })

  it('limpia tildes, espacios y caracteres que romperían la ruta', () => {
    expect(rutaAdjunto(TENANT, USER, 'Pantalla de Facturación (2).JPG', 'id1')).toBe(`${TENANT}/${USER}/id1-pantalla-de-facturacion-2.jpg`)
    // 🔴 un nombre con `..` no puede generar una ruta que la base rechace (ni salir de la carpeta)
    const ruta = rutaAdjunto(TENANT, USER, '../../otro-negocio/x.pdf', 'id2')
    expect(ruta).toBe(`${TENANT}/${USER}/id2-otro-negocio-x.pdf`)
    expect(ruta.includes('..')).toBe(false)
    expect(rutaAdjunto(TENANT, USER, '', 'id3')).toBe(`${TENANT}/${USER}/id3-archivo`)
  })
})

describe('estadoParaCliente / puedeResponder', () => {
  it('traduce el estado del panel a lo que entiende el cliente', () => {
    expect(estadoParaCliente('abierto', 'cliente').etiqueta).toBe('En revisión')
    expect(estadoParaCliente('en_progreso', 'agente').etiqueta).toBe('Te respondimos')
    expect(estadoParaCliente('resuelto', 'agente').etiqueta).toBe('Resuelta')
    expect(estadoParaCliente('cerrado', 'cliente').etiqueta).toBe('Cerrada')
  })

  it('una consulta cerrada no se responde', () => {
    expect(puedeResponder('cerrado')).toBe(false)
    expect(puedeResponder('resuelto')).toBe(true)
  })
})
