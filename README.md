# StockApp — Sistema WMS para Pequeños Comercios

App web progresiva (PWA) de gestión de inventario para ferreterías, kioscos, despensas y mini-mercados.

## Stack

- **Frontend:** React 18 + Vite + TypeScript + Tailwind CSS
- **Backend:** Supabase (PostgreSQL + Auth + Storage + Edge Functions)
- **Pagos:** Mercado Pago Subscriptions
- **Deploy:** Vercel (frontend) + Supabase (backend)

---

## 1. Configurar Supabase

1. Crear un proyecto nuevo en [supabase.com](https://supabase.com)
2. Ir a **SQL Editor** y ejecutar el archivo `supabase/migrations/001_initial_schema.sql`
3. En **Authentication → Providers**, habilitar **Google** con tus credenciales OAuth
4. En **Storage**, crear un bucket llamado `productos` (público para imágenes)

---

## 2. Configurar variables de entorno

Copiar `.env.example` a `.env.local` y completar:

```bash
cp .env.example .env.local
```

```env
VITE_SUPABASE_URL=https://TU_PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=tu_anon_key
VITE_MP_PUBLIC_KEY=tu_public_key_mp
VITE_APP_URL=http://localhost:5173
```

---

## 3. Instalar y correr localmente

```bash
npm install
npm run dev
```

Abre [http://localhost:5173](http://localhost:5173)

---

## 4. Configurar Mercado Pago

1. Crear cuenta en [Mercado Pago Developers](https://developers.mercadopago.com)
2. Crear un plan de suscripción mensual → copiar el `preapproval_plan_id` como `MP_PRICE_ID`
3. Configurar webhook apuntando a tu Edge Function:
   `https://TU_PROYECTO.supabase.co/functions/v1/mp-webhook`

### Deploy de la Edge Function

```bash
npx supabase functions deploy mp-webhook --project-ref TU_PROJECT_REF
```

Configurar secrets en Supabase:
```bash
npx supabase secrets set MP_ACCESS_TOKEN=... MP_WEBHOOK_SECRET=... --project-ref TU_PROJECT_REF
```

---

## 5. Deploy en Vercel

```bash
npm run build
npx vercel --prod
```

Agregar las variables de entorno en el panel de Vercel.

---

## Roles de usuario

| Rol        | Permisos                                              |
|------------|-------------------------------------------------------|
| OWNER      | Todo: productos, usuarios, configuración, reportes    |
| SUPERVISOR | Inventario completo, movimientos, reportes            |
| CAJERO     | Solo ver inventario y registrar movimientos           |
| ADMIN      | Panel global de todos los tenants (sin pago)          |

---

## Estructura del proyecto

```
stockapp/
├── src/
│   ├── components/
│   │   ├── AuthGuard.tsx         # Guards de rutas
│   │   └── layout/AppLayout.tsx  # Sidebar + layout principal
│   ├── hooks/
│   │   └── useAlertas.ts         # Hook para badge de alertas
│   ├── lib/
│   │   └── supabase.ts           # Cliente + tipos TypeScript
│   ├── pages/
│   │   ├── LoginPage.tsx
│   │   ├── OnboardingPage.tsx    # Registro de nuevo negocio
│   │   ├── DashboardPage.tsx
│   │   ├── InventarioPage.tsx
│   │   ├── MovimientosPage.tsx
│   │   ├── AlertasPage.tsx
│   │   ├── ReportesPage.tsx
│   │   ├── UsuariosPage.tsx
│   │   ├── ConfigPage.tsx
│   │   ├── SuscripcionPage.tsx
│   │   └── AdminPage.tsx
│   ├── store/
│   │   └── authStore.ts          # Estado global con Zustand
│   └── App.tsx                   # Rutas principales
├── supabase/
│   ├── migrations/
│   │   └── 001_initial_schema.sql  # Tablas + RLS + triggers
│   └── functions/
│       └── mp-webhook/index.ts     # Webhook de Mercado Pago
└── .env.example
```

---

## Módulos implementados

- ✅ Autenticación (Google + Email/Password)
- ✅ Registro de negocio con período de trial
- ✅ Guards de suscripción automáticos
- ✅ Layout con sidebar responsivo
- ✅ Dashboard con estadísticas
- ✅ Inventario (lista con búsqueda y filtros)
- ✅ Movimientos de stock (ingreso/rebaje con modal)
- ✅ Alertas de stock mínimo
- ✅ Webhook de Mercado Pago
- ✅ Base de datos completa con RLS

## Módulos pendientes de completar

- 🔲 Formulario completo de producto (con imagen, barcode)
- 🔲 Reportes con exportación Excel/PDF
- 🔲 Gestión de usuarios e invitaciones
- 🔲 Panel de configuración del negocio
- 🔲 Panel de admin global
- 🔲 Scanner de código de barras (mobile)
