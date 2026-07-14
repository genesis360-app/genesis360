import LegalLayout, { LegalSection } from '@/components/LegalLayout'
import { BRAND, LEGAL_TITULAR, legalCompleto } from '@/config/brand'

// ⚖️ NOTA PARA GO: este texto es un marco sólido y completo, PERO debe ser revisado por un
// abogado antes de considerarlo definitivo. La identidad del titular (razón social / CUIT /
// domicilio / jurisdicción) sale de LEGAL_TITULAR en src/config/brand.ts — completarla ahí
// (único lugar). Mientras esté en PENDIENTE, se muestra "en definición".

export default function TerminosPage() {
  return (
    <LegalLayout title="Términos y Condiciones">
      <p>
        Estos Términos y Condiciones (los "Términos") regulan el acceso y uso de {BRAND.name} (el
        "Servicio"), una plataforma de gestión de inventario, ventas, caja y administración para
        comercios, ofrecida a través de {BRAND.website}. Al registrarte y utilizar el Servicio
        aceptás estos Términos en su totalidad. Si no estás de acuerdo, no debés utilizar el Servicio.
      </p>

      <div className="rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-700 p-4">
        <p className="font-semibold text-gray-800 dark:text-gray-100 mb-1">Titular del Servicio</p>
        {legalCompleto ? (
          <p>
            {LEGAL_TITULAR.nombre} — {LEGAL_TITULAR.condicion} — CUIT {LEGAL_TITULAR.cuit}.
            {' '}Domicilio: {LEGAL_TITULAR.domicilio}. Contacto:{' '}
            <a href={`mailto:${LEGAL_TITULAR.email}`} className="text-accent hover:underline">{LEGAL_TITULAR.email}</a>.
          </p>
        ) : (
          <p className="italic text-gray-400 dark:text-gray-500">
            Los datos identificatorios del titular se encuentran en definición y se completarán
            antes de la puesta en producción del Servicio.
          </p>
        )}
      </div>

      <LegalSection n={1} title="Objeto y aceptación">
        <p>
          El Servicio se presta bajo la modalidad de software como servicio (SaaS). La creación de
          una cuenta, la contratación de un plan o el uso del Servicio implican la aceptación plena
          de estos Términos, de la <a href="/privacidad" className="text-accent hover:underline">Política de Privacidad</a>
          {' '}y de la <a href="/cookies" className="text-accent hover:underline">Política de Cookies</a>,
          que forman parte integrante de este documento.
        </p>
      </LegalSection>

      <LegalSection n={2} title="Descripción del Servicio">
        <p>
          {BRAND.name} permite gestionar productos, stock y movimientos de inventario, registrar
          ventas y gastos, administrar clientes y proveedores, operar caja, generar comprobantes y
          reportes, y otras funcionalidades según el plan contratado. Las funcionalidades
          disponibles pueden variar entre planes y evolucionar con el tiempo.
        </p>
      </LegalSection>

      <LegalSection n={3} title="Registro y cuenta">
        <p>
          Para usar el Servicio debés crear una cuenta con datos veraces, completos y actualizados.
          Sos responsable de mantener la confidencialidad de tus credenciales y de toda actividad
          realizada bajo tu cuenta. Debés notificarnos de inmediato ante cualquier uso no autorizado.
          El Servicio está destinado a personas mayores de 18 años con capacidad legal para contratar.
        </p>
      </LegalSection>

      <LegalSection n={4} title="Planes, prueba gratuita, pagos y renovación">
        <p>
          El Servicio ofrece un período de prueba gratuito y planes pagos con distintos límites de
          uso. Los precios se expresan en pesos argentinos (salvo indicación en contrario) y pueden
          actualizarse; los cambios de precio no afectan el período ya abonado. Los pagos se procesan
          a través de proveedores de pago externos (por ejemplo, Mercado Pago). La suscripción se
          renueva automáticamente por períodos equivalentes hasta que la canceles. Podés cancelar en
          cualquier momento desde tu cuenta: se interrumpe la renovación y no se te vuelve a cobrar,
          pero conservás el acceso al plan contratado hasta el final del período que ya abonaste. La
          cancelación no genera reembolsos por períodos ya iniciados, salvo que la ley aplicable
          disponga lo contrario.
        </p>
        <p>
          <strong>Botón de arrepentimiento (Ley 24.240, art. 34):</strong> si sos consumidor,
          podés revocar la contratación dentro de los <strong>10 días corridos</strong> posteriores
          a tu primera compra, sin costo ni penalidad, desde tu cuenta o escribiéndonos a{' '}
          <a href={`mailto:${BRAND.email}`} className="text-accent hover:underline">{BRAND.email}</a>.
          En ese caso se te reembolsa la <strong>totalidad</strong> de lo abonado y se da de baja el
          Servicio. Fuera de ese plazo, la cancelación interrumpe la renovación pero no genera
          reembolsos por el período en curso; conservás el acceso hasta el fin del período abonado.
        </p>
      </LegalSection>

      <LegalSection n={5} title="Uso aceptable">
        <p>Te comprometés a no utilizar el Servicio para:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>fines ilícitos o que infrinjan derechos de terceros o normativa vigente;</li>
          <li>cargar contenido o datos que no tengas derecho a tratar;</li>
          <li>intentar acceder sin autorización a sistemas, cuentas o datos de otros usuarios;</li>
          <li>vulnerar, sobrecargar o interferir con la seguridad o el normal funcionamiento del Servicio;</li>
          <li>revender, alquilar, sublicenciar o explotar comercialmente el Servicio sin nuestra autorización expresa;</li>
          <li>copiar, modificar, descompilar, realizar ingeniería inversa o intentar obtener el código fuente del Servicio, salvo en la medida en que la ley lo permita expresamente;</li>
          <li>acceder al Servicio mediante medios automatizados (bots, scrapers) o para construir un producto o servicio competidor;</li>
          <li>eludir, deshabilitar o interferir con límites de uso, controles de seguridad o mecanismos de autenticación.</li>
        </ul>
        <p>
          El uso del Servicio se concede bajo una licencia limitada, revocable, personal, intransferible
          y no exclusiva, únicamente para gestionar tu propio negocio conforme a estos Términos. No se
          te transfiere ningún otro derecho sobre el software.
        </p>
      </LegalSection>

      <LegalSection n={6} title="Datos cargados por el usuario">
        <p>
          Los datos que cargás en el Servicio (incluidos datos de tus clientes, proveedores,
          empleados y operaciones) son de tu titularidad y responsabilidad. Respecto de esos datos,
          {' '}{BRAND.name} actúa como encargado del tratamiento y los procesa únicamente para
          prestarte el Servicio, conforme a la Política de Privacidad. Sos responsable de contar con
          base legal y consentimiento para tratar los datos personales de terceros que incorpores.
        </p>
      </LegalSection>

      <LegalSection n={7} title="Facturación electrónica y responsabilidad fiscal">
        <p>
          El Servicio puede facilitar la emisión de comprobantes electrónicos ante AFIP/ARCA y el
          cálculo de importes fiscales, pero <strong>la responsabilidad fiscal y tributaria es
          exclusivamente tuya como contribuyente</strong>. Sos responsable de la correcta
          configuración de tus datos fiscales (condición ante IVA, puntos de venta, certificados),
          de la veracidad de los comprobantes emitidos y del cumplimiento de tus obligaciones ante
          los organismos correspondientes. {BRAND.name} no asume responsabilidad por errores
          derivados de datos mal configurados, ni sustituye el asesoramiento de un profesional
          contable. La emisión ante AFIP puede depender de servicios de terceros y de la
          disponibilidad de los organismos.
        </p>
      </LegalSection>

      <LegalSection n={8} title="Propiedad intelectual">
        <p>
          El Servicio, su software, marca, diseño y contenidos son propiedad de {BRAND.name} o de sus
          licenciantes y están protegidos por la normativa de propiedad intelectual. Estos Términos
          no te transfieren ningún derecho sobre ellos, salvo la licencia limitada, revocable y no
          exclusiva de uso del Servicio conforme a lo aquí previsto. Tus datos siguen siendo tuyos.
        </p>
      </LegalSection>

      <LegalSection n={9} title="Disponibilidad y modificaciones del Servicio">
        <p>
          Nos esforzamos por mantener el Servicio disponible, pero se presta "tal cual" y "según
          disponibilidad", sin garantía de operación ininterrumpida o libre de errores. Podemos
          realizar tareas de mantenimiento, actualizar, modificar o discontinuar funcionalidades.
          Procuraremos avisar los cambios relevantes con antelación razonable.
        </p>
      </LegalSection>

      <LegalSection n={10} title="Limitación de responsabilidad">
        <p>
          En la máxima medida permitida por la ley, {BRAND.name} no será responsable por daños
          indirectos, lucro cesante, pérdida de datos o interrupciones de negocio derivados del uso o
          imposibilidad de uso del Servicio. Es tu responsabilidad conservar copias de tu
          información. Nada en estos Términos limita derechos irrenunciables que te correspondan como
          consumidor conforme a la Ley 24.240.
        </p>
      </LegalSection>

      <LegalSection n={11} title="Suspensión y baja">
        <p>
          Podemos suspender o dar de baja tu cuenta ante incumplimientos de estos Términos, falta de
          pago o usos que afecten la seguridad o a terceros. Podés dar de baja tu cuenta en cualquier
          momento. Tras la baja, tus datos se tratarán conforme a la Política de Privacidad y a los
          plazos legales de conservación.
        </p>
      </LegalSection>

      <LegalSection n={12} title="Modificaciones de los Términos">
        <p>
          Podemos actualizar estos Términos. Publicaremos la versión vigente en esta página con su
          fecha de actualización y, ante cambios sustanciales, procuraremos notificarte. El uso
          continuado del Servicio luego de la entrada en vigencia implica su aceptación.
        </p>
      </LegalSection>

      <LegalSection n={13} title="Ley aplicable y jurisdicción">
        <p>
          Estos Términos se rigen por las leyes de la República Argentina. Para toda controversia se
          aplicará la jurisdicción de {legalCompleto ? `los tribunales ordinarios de ${LEGAL_TITULAR.jurisdiccion}` : 'los tribunales competentes según la normativa vigente'},
          {' '}sin perjuicio de los derechos que la legislación de defensa del consumidor (Ley 24.240)
          otorgue al usuario, incluida la posibilidad de acudir a la autoridad de aplicación o al fuero
          de su domicilio cuando corresponda.
        </p>
      </LegalSection>

      <LegalSection n={14} title="Contacto">
        <p>
          Ante cualquier consulta sobre estos Términos, escribinos a{' '}
          <a href={`mailto:${BRAND.email}`} className="text-accent hover:underline">{BRAND.email}</a>.
        </p>
      </LegalSection>
    </LegalLayout>
  )
}
