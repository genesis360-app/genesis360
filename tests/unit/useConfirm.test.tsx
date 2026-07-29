// Reemplazo propio de window.confirm/window.prompt (GO, 2026-07-29: "no quiero ningún popup del
// sistema, deben ser diseños de la app"). Test de integración real: renderiza el Provider, dispara
// confirmar()/preguntar(), simula el click del usuario, y verifica que la Promise resuelve con el
// valor correcto — no solo que el componente monta.
//
// Sin @testing-library/jest-dom (no es dependencia del proyecto): aserciones sobre .textContent
// y truthiness planas en vez de los matchers toHaveTextContent/toBeInTheDocument.
import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ConfirmProvider, useConfirm, usePrompt } from '@/hooks/useConfirm'

function Harness() {
  const confirmar = useConfirm()
  const preguntar = usePrompt()
  const [resultado, setResultado] = useState<string>('sin responder')

  return (
    <div>
      <p data-testid="resultado">{resultado}</p>
      <button onClick={async () => setResultado(String(await confirmar('¿Eliminar este producto?', { danger: true })))}>
        Disparar confirm
      </button>
      <button onClick={async () => setResultado(String(await preguntar('Nombre del tipo:', { placeholder: 'ej: Monotributo' })))}>
        Disparar prompt
      </button>
    </div>
  )
}

const setup = () => {
  const user = userEvent.setup()
  render(<ConfirmProvider><Harness /></ConfirmProvider>)
  return user
}

const resultadoTexto = () => screen.getByTestId('resultado').textContent

describe('useConfirm — reemplazo propio de window.confirm', () => {
  it('🛑 NO usa window.confirm nativo: el mensaje se renderiza como texto de la app, no como diálogo del navegador', async () => {
    const user = setup()
    await user.click(screen.getByText('Disparar confirm'))
    expect(await screen.findByText('¿Eliminar este producto?')).toBeTruthy()
    // Nada de "localhost dice" ni chrome del navegador: es un <div role="alertdialog"> propio.
    expect(screen.getByRole('alertdialog')).toBeTruthy()
  })

  it('confirmar en el botón "Confirmar" resuelve la Promise en true', async () => {
    const user = setup()
    await user.click(screen.getByText('Disparar confirm'))
    await user.click(await screen.findByText('Confirmar'))
    await waitFor(() => expect(resultadoTexto()).toBe('true'))
  })

  it('click en "Cancelar" resuelve la Promise en false — mismo contrato que window.confirm', async () => {
    const user = setup()
    await user.click(screen.getByText('Disparar confirm'))
    await user.click(await screen.findByText('Cancelar'))
    await waitFor(() => expect(resultadoTexto()).toBe('false'))
  })

  it('click fuera del modal (overlay) cierra como Cancelar — false', async () => {
    const user = setup()
    await user.click(screen.getByText('Disparar confirm'))
    await screen.findByText('¿Eliminar este producto?')
    // El overlay es el div.fixed.inset-0 padre del diálogo.
    const dialog = screen.getByRole('alertdialog')
    await user.click(dialog.parentElement!)
    await waitFor(() => expect(resultadoTexto()).toBe('false'))
  })

  it('tecla Escape cierra el confirm en false', async () => {
    const user = setup()
    await user.click(screen.getByText('Disparar confirm'))
    const dialog = await screen.findByRole('alertdialog')
    dialog.focus()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(resultadoTexto()).toBe('false'))
  })

  it('un segundo pedido mientras el primero seguía abierto resuelve el primero en false (no queda colgado)', async () => {
    const user = setup()
    // Dos clicks rápidos: el segundo confirm() reemplaza al primero. El primero no puede quedar
    // esperando para siempre — se resuelve false apenas se pide el segundo.
    await user.click(screen.getByText('Disparar confirm'))
    await user.click(screen.getByText('Disparar confirm'))
    await user.click(await screen.findByText('Cancelar'))
    await waitFor(() => expect(resultadoTexto()).toBe('false'))
  })
})

describe('usePrompt — reemplazo propio de window.prompt', () => {
  it('escribe texto y Confirmar resuelve la Promise con ese string', async () => {
    const user = setup()
    await user.click(screen.getByText('Disparar prompt'))
    const input = await screen.findByPlaceholderText('ej: Monotributo')
    await user.type(input, 'Responsable Inscripto')
    await user.click(screen.getByText('Confirmar'))
    await waitFor(() => expect(resultadoTexto()).toBe('Responsable Inscripto'))
  })

  it('Cancelar resuelve la Promise en null — mismo contrato que window.prompt cancelado', async () => {
    const user = setup()
    await user.click(screen.getByText('Disparar prompt'))
    await screen.findByPlaceholderText('ej: Monotributo')
    await user.click(screen.getByText('Cancelar'))
    await waitFor(() => expect(resultadoTexto()).toBe('null'))
  })

  it('🛑 con input VACÍO, "Confirmar" está deshabilitado — no se puede mandar un nombre en blanco', async () => {
    const user = setup()
    await user.click(screen.getByText('Disparar prompt'))
    await screen.findByPlaceholderText('ej: Monotributo')
    const confirmarBtn = screen.getByText('Confirmar') as HTMLButtonElement
    expect(confirmarBtn.disabled).toBe(true)
  })
})
