import { Settings } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

interface ConfigButtonProps {
  className?: string
}

export function ConfigButton({ className = '' }: ConfigButtonProps) {
  const navigate = useNavigate()
  return (
    <button
      onClick={() => navigate('/configuracion')}
      title="Configuración"
      className={className}
    >
      <Settings size={18} />
    </button>
  )
}
