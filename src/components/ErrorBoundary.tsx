import { Component, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw, Copy } from 'lucide-react'
import * as Sentry from '@sentry/react'

interface Props {
  children: ReactNode
  /** Fallback compacto (no full-screen) para envolver solo el área de contenido y conservar el menú */
  inline?: boolean
}

interface State {
  hasError: boolean
  isChunkError: boolean
  errorMsg: string
  componentStack: string
  eventId: string | null
}

// Mismo flag que usa main.tsx para no recargar en bucle (se limpia al cargar OK).
const CHUNK_RELOAD_KEY = 'chunk-reload-attempt'

// Detecta fallos de carga de chunk lazy tras un deploy nuevo. Incluye el caso en que el
// import dinámico resuelve a `undefined` y React.lazy lanza "reading 'default'".
function looksLikeChunkError(error: Error): boolean {
  const m = error?.message ?? ''
  return (
    error?.name === 'ChunkLoadError' ||
    m.includes('Failed to fetch dynamically imported module') ||
    m.includes('Importing a module script failed') ||
    m.includes('dynamically imported module') ||
    m.includes("reading 'default'")
  )
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, isChunkError: false, errorMsg: '', componentStack: '', eventId: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, isChunkError: looksLikeChunkError(error), errorMsg: error.message }
  }

  componentDidCatch(error: Error, info: any) {
    // Loguear para diagnóstico (visible en browser console → F12)
    console.error('[ErrorBoundary] Error capturado:', error.message, error.stack, info?.componentStack)

    // Auto-reload UNA vez en errores de chunk (deploy nuevo → chunk viejo en la pestaña).
    // Guarda en sessionStorage para no entrar en bucle si el fallo es real/persistente.
    if (looksLikeChunkError(error)) {
      if (!sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, '1')
        window.location.reload()
        return
      }
      // Ya recargamos y sigue fallando → no es un chunk viejo: mostrar el error real.
      this.setState({ isChunkError: false })
    }

    // Reportar a Sentry con contexto del componente que crasheó
    const eventId = Sentry.captureException(error, {
      contexts: { react: { componentStack: info?.componentStack } },
      tags: { boundary: 'app-root' },
    })
    this.setState({ eventId, componentStack: info?.componentStack ?? '' })
  }

  copiarDetalle = () => {
    const detalle = [
      `Error: ${this.state.errorMsg}`,
      this.state.eventId ? `Sentry ID: ${this.state.eventId}` : '',
      `URL: ${window.location.href}`,
      this.state.componentStack ? `Componente:${this.state.componentStack}` : '',
    ].filter(Boolean).join('\n')
    navigator.clipboard?.writeText(detalle).catch(() => {})
  }

  render() {
    if (!this.state.hasError) return this.props.children

    if (this.state.isChunkError) {
      return (
        <div className="min-h-screen bg-brand-bg flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      )
    }

    return (
      <div className={this.props.inline ? 'flex items-center justify-center p-6 min-h-[60vh]' : 'min-h-screen bg-brand-bg flex items-center justify-center p-6'}>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-md w-full text-center">
          <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={22} className="text-red-500" />
          </div>
          <h2 className="text-lg font-bold text-gray-800 mb-2">Algo salió mal</h2>
          <p className="text-sm text-gray-500 mb-5">
            Ocurrió un error inesperado. Recargá la página para continuar.
          </p>

          {this.state.errorMsg && (
            <div className="mb-5 text-left bg-gray-50 border border-gray-100 rounded-lg p-3">
              <p className="text-xs font-mono text-gray-600 break-words max-h-32 overflow-y-auto">
                {this.state.errorMsg}
              </p>
              {this.state.eventId && (
                <p className="text-[10px] text-gray-400 mt-2">Ref: {this.state.eventId}</p>
              )}
              <button
                onClick={this.copiarDetalle}
                className="mt-2 inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-700"
              >
                <Copy size={11} /> Copiar detalle
              </button>
            </div>
          )}

          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 bg-primary text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-accent transition-colors"
          >
            <RefreshCw size={15} /> Recargar página
          </button>
        </div>
      </div>
    )
  }
}
