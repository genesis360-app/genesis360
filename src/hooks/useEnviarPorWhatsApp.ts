// Enviar un ticket / factura / NC por WhatsApp (pedido de GO 2026-10-01, mig 451). Compartido por el POS y Facturación.
// La API oficial espera la aprobación de Meta: se guarda una foto del comprobante con un código y se abre el chat del
// cliente con el mensaje y el link a /c/<código> (página pública que muestra el comprobante y baja el PDF).
import { useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import {
  abrirPestanaParaWhatsApp, crearLinkCompartido, mensajeComprobante, navegarPestana, urlWhatsApp, type TipoCompartido,
} from '@/lib/compartirComprobante'
import type { FacturaPDFData } from '@/lib/facturasPDF'

export type ArmadoWhatsApp = {
  tipo: TipoCompartido
  ventaId?: string | null
  devolucionId?: string | null
  datos: unknown
  etiqueta: string
  total: number | null
  /** Si no viene, se toma el cliente de la venta. */
  clienteId?: string | null
}

/** "Factura B 0001-00000023" / "Nota de crédito B 0001-00000004". */
export function etiquetaFiscal(d: Pick<FacturaPDFData, 'tipo_comprobante' | 'punto_venta' | 'numero_comprobante'>): string {
  const tipo = String(d.tipo_comprobante ?? '')
  return `${tipo.startsWith('NC') ? 'Nota de crédito' : 'Factura'} ${tipo.replace(/^NC-/, '')} ` +
    `${String(d.punto_venta ?? '').padStart(4, '0')}-${String(d.numero_comprobante ?? '').padStart(8, '0')}`
}

export function useEnviarPorWhatsApp() {
  const { tenant } = useAuthStore()
  const [enviando, setEnviando] = useState(false)

  const enviar = async (armar: () => Promise<ArmadoWhatsApp | null>) => {
    // La pestaña se abre YA, dentro del click: abrirla después de los await la bloquea el navegador.
    const pestana = abrirPestanaParaWhatsApp()
    setEnviando(true)
    try {
      const a = await armar()
      if (!a) { pestana?.close(); return }
      const link = await crearLinkCompartido({
        tenantId: tenant!.id, tipo: a.tipo, ventaId: a.ventaId, devolucionId: a.devolucionId, datos: a.datos,
      })
      let clienteId = a.clienteId ?? null
      if (!clienteId && a.ventaId) {
        const { data } = await supabase.from('ventas').select('cliente_id').eq('id', a.ventaId).single()
        clienteId = data?.cliente_id ?? null
      }
      let cliente: { nombre: string | null; telefono: string | null } = { nombre: null, telefono: null }
      if (clienteId) {
        const { data } = await supabase.from('clientes').select('nombre, telefono').eq('id', clienteId).single()
        cliente = { nombre: data?.nombre ?? null, telefono: data?.telefono ?? null }
      }
      const mensaje = mensajeComprobante({
        tipo: a.tipo, negocio: tenant!.nombre, cliente: cliente.nombre, etiqueta: a.etiqueta, total: a.total, url: link,
      })
      navegarPestana(pestana, urlWhatsApp(cliente.telefono, mensaje))
      if (!cliente.telefono) toast('El cliente no tiene teléfono cargado: elegí el contacto en WhatsApp.', { icon: 'ℹ️' })
    } catch (e: any) {
      pestana?.close()
      toast.error(e?.message ?? 'No se pudo preparar el envío por WhatsApp')
    } finally {
      setEnviando(false)
    }
  }

  return { enviar, enviando }
}
