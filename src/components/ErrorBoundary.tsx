import { Component, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  isChunkError: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, isChunkError: false }

  static getDerivedStateFromError(error: Error): State {
    const isChunkError =
      error.name === 'ChunkLoadError' ||
      error.message.includes('Failed to fetch dynamically imported module') ||
      error.message.includes('Importing a module script failed') ||
      error.message.includes('dynamically imported module')
    return { hasError: true, isChunkError }
  }

  componentDidCatch(error: Error, info: any) {
    // Loguear para diagnóstico (visible en browser console → F12)
    console.error('[ErrorBoundary] Error capturado:', error.message, error.stack, info?.componentStack)
    // Auto-reload en errores de chunk (deploy nuevo, chunk viejo)
    if (
      error.name === 'ChunkLoadError' ||
      error.message.includes('Failed to fetch dynamically imported module')
    ) {
      window.location.reload()
    }
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
      <div className="min-h-screen bg-brand-bg flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-md w-full text-center">
          <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={22} className="text-red-500" />
          </div>
          <h2 className="text-lg font-bold text-gray-800 mb-2">Algo salió mal</h2>
          <p className="text-sm text-gray-500 mb-6">
            Ocurrió un error inesperado. Recargá la página para continuar.
          </p>
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
