import LegalLayout, { LegalSection } from '@/components/LegalLayout'
import { BRAND, LEGAL_TITULAR, legalCompleto } from '@/config/brand'

// ⚖️ NOTA PARA GO: marco sólido alineado a la Ley 25.326 (AR) y sus normas complementarias,
// PERO debe ser revisado por un abogado antes de ser definitivo. La identidad del responsable
// sale de LEGAL_TITULAR (src/config/brand.ts) — completarla ahí. Pendiente operativo: registrar
// la base ante la AAIP (Agencia de Acceso a la Información Pública).

export default function PrivacidadPage() {
  return (
    <LegalLayout title="Política de Privacidad">
      <p>
        En {BRAND.name} valoramos tu privacidad. Esta Política explica qué datos personales tratamos,
        con qué finalidad, con quiénes los compartimos y cómo podés ejercer tus derechos, conforme a
        la Ley 25.326 de Protección de los Datos Personales de la República Argentina y sus normas
        complementarias.
      </p>

      <LegalSection n={1} title="Responsable de la base de datos">
        <p>
          El responsable del tratamiento de los datos es{' '}
          {legalCompleto
            ? <>{LEGAL_TITULAR.nombre} ({LEGAL_TITULAR.condicion}), CUIT {LEGAL_TITULAR.cuit}, con domicilio en {LEGAL_TITULAR.domicilio}, titular de {BRAND.name}</>
            : <>el titular de {BRAND.name} (datos identificatorios en definición, a completar antes de la puesta en producción)</>}.
          {' '}Para cualquier consulta o para ejercer tus derechos podés contactarnos en{' '}
          <a href={`mailto:${LEGAL_TITULAR.email}`} className="text-accent hover:underline">{LEGAL_TITULAR.email}</a>.
        </p>
      </LegalSection>

      <LegalSection n={2} title="Datos que recopilamos">
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>De registro y cuenta:</strong> nombre, correo electrónico, contraseña (almacenada de forma cifrada) y datos del negocio (nombre, tipo de comercio, país, teléfono).</li>
          <li><strong>De facturación:</strong> datos fiscales que cargues y la información necesaria para procesar pagos a través de nuestros proveedores de pago.</li>
          <li><strong>De uso:</strong> registros de actividad, datos técnicos del dispositivo y de la sesión, necesarios para operar y asegurar el Servicio. El detalle de cookies y tecnologías similares está en nuestra <a href="/cookies" className="text-accent hover:underline">Política de Cookies</a>.</li>
          <li><strong>Datos que cargás en el Servicio:</strong> información de tus clientes, proveedores, empleados y operaciones. Respecto de estos datos, actuamos como encargados del tratamiento por cuenta tuya.</li>
        </ul>
      </LegalSection>

      <LegalSection n={3} title="Finalidad del tratamiento">
        <p>Tratamos tus datos para:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>prestar, mantener y mejorar el Servicio;</li>
          <li>gestionar tu cuenta, la contratación de planes y los pagos;</li>
          <li>brindarte soporte y comunicarte información operativa (por ejemplo, avisos de servicio y facturación);</li>
          <li>cumplir obligaciones legales y prevenir fraudes o usos indebidos;</li>
          <li>enviarte comunicaciones de marketing, <strong>solo si prestaste tu consentimiento</strong> (ver sección 9).</li>
        </ul>
      </LegalSection>

      <LegalSection n={4} title="Base legal y consentimiento">
        <p>
          El tratamiento se basa en la ejecución de la relación contractual (prestarte el Servicio),
          en el cumplimiento de obligaciones legales y en tu consentimiento cuando así se requiere.
          El consentimiento de marketing es libre, informado, separado y revocable en cualquier
          momento, sin que ello afecte la prestación del Servicio.
        </p>
      </LegalSection>

      <LegalSection n={5} title="Con quién compartimos tus datos">
        <p>
          No vendemos tus datos personales. Los compartimos únicamente con proveedores que nos
          ayudan a operar el Servicio, en calidad de encargados y bajo obligación de
          confidencialidad, entre ellos:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Infraestructura y base de datos</strong> (alojamiento y almacenamiento del Servicio);</li>
          <li><strong>Envío de correos</strong> (notificaciones transaccionales y, si corresponde, marketing);</li>
          <li><strong>Procesamiento de pagos</strong> (por ejemplo, Mercado Pago);</li>
          <li><strong>Facturación electrónica</strong> ante AFIP/ARCA y servicios asociados;</li>
          <li><strong>Monitoreo de errores y rendimiento</strong> (Sentry), para mantener el Servicio estable y corregir fallas; no graba tu sesión ni tu pantalla;</li>
          <li><strong>Mapas y direcciones</strong> (Google Maps), únicamente en las pantallas donde cargás direcciones.</li>
        </ul>
        <p>
          Algunos de estos proveedores pueden alojar datos fuera de la Argentina. En esos casos,
          adoptamos recaudos para que la transferencia internacional cumpla con la normativa
          aplicable. También podremos divulgar datos cuando lo exija una autoridad competente o la ley.
        </p>
      </LegalSection>

      <LegalSection n={6} title="Conservación de los datos">
        <p>
          Conservamos tus datos mientras mantengas una cuenta activa y durante los plazos necesarios
          para cumplir obligaciones legales, contables y fiscales, o para resolver disputas. Vencidos
          esos plazos, los eliminamos o anonimizamos.
        </p>
      </LegalSection>

      <LegalSection n={7} title="Seguridad">
        <p>
          Aplicamos medidas técnicas y organizativas razonables para proteger los datos contra
          accesos no autorizados, pérdida o alteración (por ejemplo, cifrado en tránsito, control de
          accesos y aislamiento de datos por cuenta). Ningún sistema es completamente infalible, por
          lo que no podemos garantizar seguridad absoluta.
        </p>
      </LegalSection>

      <LegalSection n={8} title="Tus derechos">
        <p>
          Como titular de los datos, podés ejercer los derechos de acceso, rectificación,
          actualización y supresión de tus datos personales, conforme a los artículos 14 y 16 de la
          Ley 25.326. Para ejercerlos, escribinos a{' '}
          <a href={`mailto:${BRAND.email}`} className="text-accent hover:underline">{BRAND.email}</a>.
          El titular de los datos tiene derecho a acceder de forma gratuita a sus datos en intervalos
          no inferiores a seis meses, salvo interés legítimo. La <strong>Agencia de Acceso a la
          Información Pública (AAIP)</strong>, órgano de control de la Ley 25.326, tiene la atribución
          de atender denuncias y reclamos respecto del incumplimiento de las normas de protección de
          datos personales.
        </p>
      </LegalSection>

      <LegalSection n={9} title="Marketing y cómo revocarlo">
        <p>
          Solo te enviaremos comunicaciones de marketing (novedades, promociones y consejos) si
          expresamente lo aceptaste al registrarte o luego. Podés revocar ese consentimiento en
          cualquier momento, sin costo, usando el enlace para darte de baja incluido en cada correo o
          escribiéndonos a{' '}
          <a href={`mailto:${BRAND.email}`} className="text-accent hover:underline">{BRAND.email}</a>.
          Aunque revoques el marketing, seguirás recibiendo comunicaciones operativas necesarias para
          la prestación del Servicio.
        </p>
      </LegalSection>

      <LegalSection n={10} title="Menores de edad">
        <p>
          El Servicio está dirigido a personas mayores de 18 años. No recopilamos intencionalmente
          datos de menores de edad.
        </p>
      </LegalSection>

      <LegalSection n={11} title="Cambios en esta Política">
        <p>
          Podemos actualizar esta Política. Publicaremos la versión vigente en esta página con su
          fecha de actualización y, ante cambios sustanciales, procuraremos notificarte.
        </p>
      </LegalSection>

      <LegalSection n={12} title="Contacto">
        <p>
          Ante cualquier consulta sobre esta Política o sobre el tratamiento de tus datos, escribinos
          a <a href={`mailto:${BRAND.email}`} className="text-accent hover:underline">{BRAND.email}</a>.
        </p>
      </LegalSection>
    </LegalLayout>
  )
}
