import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useModalKeyboard } from '@/hooks/useModalKeyboard'

const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
const enter = (target?: HTMLElement) => {
  const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
  ;(target ?? document.body).dispatchEvent(ev)
}

describe('useModalKeyboard — stack (ESC cierra de arriba hacia abajo)', () => {
  afterEach(() => { /* renderHook cleanup desmonta y limpia el stack */ })

  it('MK-01 con un solo modal, ESC lo cierra', () => {
    const onClose = vi.fn()
    const { unmount } = renderHook(() => useModalKeyboard({ isOpen: true, onClose }))
    esc()
    expect(onClose).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('MK-02 con dos modales, ESC cierra SOLO el último abierto (el de arriba)', () => {
    const aClose = vi.fn(); const bClose = vi.fn()
    const a = renderHook(() => useModalKeyboard({ isOpen: true, onClose: aClose }))
    const b = renderHook(() => useModalKeyboard({ isOpen: true, onClose: bClose })) // abierto después → arriba
    esc()
    expect(bClose).toHaveBeenCalledTimes(1)
    expect(aClose).not.toHaveBeenCalled()
    a.unmount(); b.unmount()
  })

  it('MK-03 al cerrar el de arriba, el EST siguiente cierra el de abajo', () => {
    const aClose = vi.fn(); const bClose = vi.fn()
    const a = renderHook(() => useModalKeyboard({ isOpen: true, onClose: aClose }))
    const b = renderHook(() => useModalKeyboard({ isOpen: true, onClose: bClose }))
    esc()                       // cierra b (arriba)
    b.unmount()                 // b se desmonta → a queda arriba
    esc()                       // ahora cierra a
    expect(aClose).toHaveBeenCalledTimes(1)
    a.unmount()
  })

  it('MK-04 isOpen=false no registra el modal en el stack', () => {
    const onClose = vi.fn()
    const { unmount } = renderHook(() => useModalKeyboard({ isOpen: false, onClose }))
    esc()
    expect(onClose).not.toHaveBeenCalled()
    unmount()
  })

  it('MK-05 Enter dispara onConfirm del modal de arriba (no en botón/textarea)', () => {
    const onConfirm = vi.fn()
    const { unmount } = renderHook(() => useModalKeyboard({ isOpen: true, onClose: vi.fn(), onConfirm }))
    enter(document.body)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    const btn = document.createElement('button'); document.body.appendChild(btn)
    enter(btn)                  // en un botón NO confirma
    expect(onConfirm).toHaveBeenCalledTimes(1)
    btn.remove(); unmount()
  })
})
