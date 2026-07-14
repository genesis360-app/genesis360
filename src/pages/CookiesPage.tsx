import LegalLayout, { LegalSection } from '@/components/LegalLayout'
import { BRAND } from '@/config/brand'

// ⚖️ NOTA PARA GO: alineada a la decisión del 2026-07-13 (Sentry SOLO errores + rendimiento,
// SIN Session Replay). No usamos cookies de publicidad ni tracking de marketing, así que NO
// hace falta banner de consentimiento bloqueante. Si en el futuro se agrega analytics de
// marketing, remarketing o se reactiva el Session Replay → hay que sumar el banner de
// consentimiento previo y actualizar esta página. Revisar con un abogado antes de definitivo.

export default function CookiesPage() {
  return (
    <LegalLayout title="Política de Cookies y Tecnologías de Seguimiento">
      <p>
        Esta Política explica qué cookies y tecnologías similares (almacenamiento local,
        identificadores de sesión) utiliza {BRAND.name} (el "Servicio") y con qué finalidad.
        Forma parte de nuestra{' '}
        <a href="/privacidad" className="text-accent hover:underline">Política de Privacidad</a>.
      </p>

      <LegalSection n={1} title="Qué son">
        <p>
          Las cookies y el almacenamiento local son pequeños archivos o datos que el navegador
          guarda en tu dispositivo. Permiten, por ejemplo, mantener tu sesión iniciada, recordar
          preferencias y que el Servicio funcione de forma segura y estable.
        </p>
      </LegalSection>

      <LegalSection n={2} title="Qué utilizamos">
        <p>Usamos únicamente tecnologías <strong>esenciales y funcionales</strong>, sin fines publicitarios:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Esenciales (imprescindibles):</strong> token de sesión y autenticación
            (proveído por nuestra infraestructura, Supabase) y almacenamiento local necesario
            para mantener tu sesión, el funcionamiento como aplicación (PWA) y la seguridad. Sin
            estas tecnologías no es posible iniciar sesión ni usar el Servicio.
          </li>
          <li>
            <strong>Rendimiento y diagnóstico de errores (Sentry):</strong> recopilamos datos
            técnicos de errores y de rendimiento para mantener el Servicio funcionando y corregir
            fallas. <strong>No grabamos tu sesión ni tu pantalla</strong> y estos datos no se usan
            para publicidad ni se venden.
          </li>
          <li>
            <strong>Mapas (Google Maps):</strong> en las pantallas donde cargás direcciones
            (por ejemplo, envíos), se utiliza el servicio de Google Maps, que puede emplear sus
            propias cookies. Solo se carga en esas pantallas y conforme a las políticas de Google.
          </li>
        </ul>
      </LegalSection>

      <LegalSection n={3} title="Qué NO utilizamos">
        <p>
          No usamos cookies de publicidad, de remarketing ni de redes publicitarias, no hacemos
          seguimiento de tu navegación fuera del Servicio y no vendemos tus datos. Tampoco
          grabamos la sesión ni la pantalla del usuario.
        </p>
      </LegalSection>

      <LegalSection n={4} title="Cómo controlarlas">
        <p>
          Podés gestionar o eliminar cookies desde la configuración de tu navegador y navegar en
          modo privado. Tené en cuenta que <strong>bloquear las cookies esenciales impedirá el
          inicio de sesión y el uso del Servicio</strong>. Como no utilizamos cookies de
          marketing, no es necesario prestar consentimiento para publicidad.
        </p>
      </LegalSection>

      <LegalSection n={5} title="Cambios y contacto">
        <p>
          Podemos actualizar esta Política; publicaremos la versión vigente en esta página con su
          fecha. Ante cualquier consulta, escribinos a{' '}
          <a href={`mailto:${BRAND.email}`} className="text-accent hover:underline">{BRAND.email}</a>.
        </p>
      </LegalSection>
    </LegalLayout>
  )
}
