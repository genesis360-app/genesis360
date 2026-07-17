// 🛑 REGLA #0 — Identidad del emisor para los PDFs, desde la FUENTE ÚNICA (`emisores_fiscales`,
// cutover mig 271 / v1.133.0). Reemplaza a los 5 selects copy-pasteados sobre `tenants`
// (VentasPage ×4 + FacturacionPage) — la duplicación que causó DOS bugs fiscales reales:
//   1. (v1.62.0→v1.131.0, un mes EN PROD) la select pedía columnas inexistentes → 400 → el
//      error se descartaba → CUIT vacío y un Monotributista declarándose RI en el papel.
//   2. (expuesto al arreglar el anterior) el PDF leía la identidad del TENANT: con multi-CUIT,
//      el CAE sale con el CUIT del EMISOR de la venta pero el papel imprimía el del tenant →
//      un comprobante que NO coincide con lo registrado en AFIP.
//
// Reglas:
//  - La identidad sale del emisor de la VENTA (`ventas.emisor_id`, lo escribe la EF al emitir)
//    ?? el de la sucursal ?? el default — la MISMA cadena que resuelve la EF (emisorFiscal.ts).
//  - `fiscal: true` (factura/NC): identidad OBLIGATORIA y completa. Si falta, se LANZA — un
//    default sobre un dato fiscal no es una comodidad, es una mentira con formato de PDF.
//  - `fiscal: false` (presupuesto/remito): sin emisor (tenant sin CUIT) cae al nombre/logo del
//    negocio, como siempre — esos documentos no declaran identidad fiscal.
import { supabase } from '@/lib/supabase'
import {
  elegirIdentidadEmisor, IDENTIDAD_EMISOR_COLS, type IdentidadEmisor,
} from '@/lib/emisorFiscal'

export interface CamposEmisorPDF {
  emisor_razon_social: string
  emisor_cuit: string
  emisor_domicilio: string | undefined
  emisor_condicion_iva: string
  emisor_logo_url: string | null
  emisor_ingresos_brutos: string | null
  emisor_inicio_actividades: string | null
  emisor_sitio_web: string | null
  emisor_banco: string | null
  emisor_cbu: string | null
  emisor_alias: string | null
  emisor_leyenda: string | null
}

export async function camposEmisorPDF(
  tenantRow: any,
  opts: { ventaEmisorId?: string | null; sucursalEmisorId?: string | null; fiscal: boolean },
): Promise<{ emisor: IdentidadEmisor | null; campos: CamposEmisorPDF }> {
  const { data, error } = await supabase.from('emisores_fiscales')
    .select(IDENTIDAD_EMISOR_COLS).eq('tenant_id', tenantRow.id)
  if (error) {
    throw new Error(
      `No se pudo leer la identidad fiscal del emisor: ${error.message}. ` +
        `No se genera el documento para no imprimir un CUIT o una condición de IVA incorrectos.`,
    )
  }
  // supabase-js no infiere el shape con un select dinámico (constante) → cast controlado:
  // IDENTIDAD_EMISOR_COLS y la interfaz IdentidadEmisor viven juntas en emisorFiscal.ts.
  const emisor = elegirIdentidadEmisor((data ?? []) as unknown as IdentidadEmisor[], opts)

  if (opts.fiscal) {
    if (!emisor) {
      throw new Error(
        'Este comprobante no tiene un emisor fiscal asociado y el negocio no tiene emisor configurado. ' +
          'Cargá los datos fiscales en Configuración → Facturación antes de reimprimir.',
      )
    }
    if (!emisor.cuit?.trim() || !emisor.condicion_iva_emisor) {
      throw new Error(
        `El emisor del comprobante ("${emisor.razon_social_fiscal ?? emisor.cuit ?? '?'}") no tiene ` +
          'CUIT o condición de IVA cargados. No se imprime para no declarar una identidad fiscal falsa.',
      )
    }
  }

  return {
    emisor,
    campos: {
      emisor_razon_social: emisor?.razon_social_fiscal ?? tenantRow?.nombre ?? '',
      emisor_cuit:         emisor?.cuit ?? '',
      emisor_domicilio:    emisor?.domicilio_fiscal ?? undefined,
      // Sin emisor no se INVENTA condición (el viejo ?? 'responsable_inscripto' era la mentira):
      // en documentos no fiscales simplemente no se muestra.
      emisor_condicion_iva: emisor?.condicion_iva_emisor ?? '',
      emisor_logo_url:     emisor?.logo_url ?? tenantRow?.logo_url ?? null,
      emisor_ingresos_brutos:    emisor?.ingresos_brutos ?? null,
      emisor_inicio_actividades: emisor?.inicio_actividades ?? null,
      emisor_sitio_web:    tenantRow?.sitio_web ?? null,   // contacto del negocio, no identidad fiscal
      emisor_banco:        emisor?.banco ?? null,
      emisor_cbu:          emisor?.cbu ?? null,
      emisor_alias:        emisor?.alias_cbu ?? null,
      emisor_leyenda:      emisor?.leyenda_comprobante ?? null,
    },
  }
}
