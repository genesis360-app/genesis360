import { RotateCw } from 'lucide-react'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

interface RefreshButtonProps {
  className?: string
}

export function RefreshButton({ className = '' }: RefreshButtonProps) {
  const queryClient = useQueryClient()
  const [spinning, setSpinning] = useState(false)

  const handleRefresh = async () => {
    if (spinning) return
    setSpinning(true)
    await queryClient.invalidateQueries()
    setTimeout(() => setSpinning(false), 800)
  }

  return (
    <button
      onClick={handleRefresh}
      title="Actualizar datos"
      disabled={spinning}
      className={className}
    >
      <RotateCw size={18} className={spinning ? 'animate-spin' : ''} />
    </button>
  )
}
