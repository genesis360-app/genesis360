import { supabase } from '@/lib/supabase'

// Cancela una baja programada (mig 358) — reusado por el banner global (AppLayout.tsx) y por
// MiCuentaPage.tsx para no duplicar la lógica de update + email de confirmación.
export async function cancelarBajaProgramada(tenantId: string, email: string, tenantNombre: string): Promise<void> {
  const { error } = await supabase.from('tenants').update({ delete_scheduled_at: null }).eq('id', tenantId)
  if (error) throw error

  void supabase.functions.invoke('send-email', {
    body: {
      type: 'notificacion',
      to: email,
      data: {
        titulo: `Cancelamos la eliminación de "${tenantNombre}"`,
        mensaje: `Tu negocio ya no está programado para eliminarse. Todos tus datos siguen intactos.`,
        action_url: '/dashboard',
      },
    },
  })
}
