import { defineConfig, devices } from '@playwright/test'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Variables de entorno para los tests E2E
// Configurar en .env.test.local (no commitear) o en GitHub Actions secrets
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './tests/e2e/.results',
  // Los tests corren secuencialmente para evitar conflictos en la BD compartida de DEV
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['github'], ['html', { outputFolder: 'tests/e2e/.report', open: 'never' }]]
    : [['html', { outputFolder: 'tests/e2e/.report', open: 'on-failure' }]],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    // ─── Auth setup projects (corren primero)
    {
      name: 'setup-owner',
      testMatch: /auth\.setup\.ts/,
    },
    // Setup CAJERO — solo si las credenciales están disponibles
    ...(process.env.E2E_CAJERO_EMAIL ? [{
      name: 'setup-cajero',
      testMatch: /auth\.cajero\.setup\.ts/,
    }] : []),
    // Setup SUPERVISOR — solo si las credenciales están disponibles
    ...(process.env.E2E_SUPERVISOR_EMAIL ? [{
      name: 'setup-supervisor',
      testMatch: /auth\.supervisor\.setup\.ts/,
    }] : []),
    // Setup RRHH — solo si las credenciales están disponibles
    ...(process.env.E2E_RRHH_EMAIL ? [{
      name: 'setup-rrhh',
      testMatch: /auth\.rrhh\.setup\.ts/,
    }] : []),
    // Setup DEPOSITO — solo si las credenciales están disponibles
    ...(process.env.E2E_DEPOSITO_EMAIL ? [{
      name: 'setup-deposito',
      testMatch: /auth\.deposito\.setup\.ts/,
    }] : []),
    // Setup CONTADOR — solo si las credenciales están disponibles
    ...(process.env.E2E_CONTADOR_EMAIL ? [{
      name: 'setup-contador',
      testMatch: /auth\.contador\.setup\.ts/,
    }] : []),
    // Setup SUPERVISOR de Familia Otranto (tenant SIN clave) — solo si hay credenciales
    ...(process.env.E2E_FOTRANTO_SUP_EMAIL ? [{
      name: 'setup-fotranto-sup',
      testMatch: /auth\.fotranto-sup\.setup\.ts/,
    }] : []),

    // ─── Tests OWNER (main)
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: path.join(__dirname, 'tests/e2e/.auth/session.json'),
      },
      dependencies: ['setup-owner'],
      testIgnore: /1[3-8]_rol_.*|45_descuento_supervisor_tope_mutante|47_conteo_autorizacion_rol_mutante|4[89]_.*_mutante/,
    },

    // ─── Tests CAJERO — solo si hay credenciales
    ...(process.env.E2E_CAJERO_EMAIL ? [{
      name: 'chromium-cajero',
      use: {
        ...devices['Desktop Chrome'],
        storageState: path.join(__dirname, 'tests/e2e/.auth/cajero_session.json'),
      },
      dependencies: ['setup-cajero'],
      testMatch: /13_rol_cajero\.spec\.ts/,
    }] : []),

    // ─── Tests SUPERVISOR — solo si hay credenciales
    ...(process.env.E2E_SUPERVISOR_EMAIL ? [{
      name: 'chromium-supervisor',
      use: {
        ...devices['Desktop Chrome'],
        storageState: path.join(__dirname, 'tests/e2e/.auth/supervisor_session.json'),
      },
      dependencies: ['setup-supervisor'],
      testMatch: /15_rol_supervisor\.spec\.ts|45_descuento_supervisor_tope_mutante\.spec\.ts|47_conteo_autorizacion_rol_mutante\.spec\.ts/,
    }] : []),

    // ─── Tests RRHH — solo si hay credenciales
    ...(process.env.E2E_RRHH_EMAIL ? [{
      name: 'chromium-rrhh',
      use: {
        ...devices['Desktop Chrome'],
        storageState: path.join(__dirname, 'tests/e2e/.auth/rrhh_session.json'),
      },
      dependencies: ['setup-rrhh'],
      testMatch: /16_rol_rrhh\.spec\.ts/,
    }] : []),

    // ─── Tests DEPOSITO — solo si hay credenciales
    ...(process.env.E2E_DEPOSITO_EMAIL ? [{
      name: 'chromium-deposito',
      use: {
        ...devices['Desktop Chrome'],
        storageState: path.join(__dirname, 'tests/e2e/.auth/deposito_session.json'),
      },
      dependencies: ['setup-deposito'],
      testMatch: /17_rol_deposito\.spec\.ts/,
    }] : []),

    // ─── Tests CONTADOR — solo si hay credenciales
    ...(process.env.E2E_CONTADOR_EMAIL ? [{
      name: 'chromium-contador',
      use: {
        ...devices['Desktop Chrome'],
        storageState: path.join(__dirname, 'tests/e2e/.auth/contador_session.json'),
      },
      dependencies: ['setup-contador'],
      testMatch: /18_rol_contador\.spec\.ts/,
    }] : []),

    // ─── Tests del tenant SIN clave (Familia Otranto) — solo si hay credenciales
    ...(process.env.E2E_FOTRANTO_SUP_EMAIL ? [{
      name: 'chromium-fotranto-sup',
      use: {
        ...devices['Desktop Chrome'],
        storageState: path.join(__dirname, 'tests/e2e/.auth/fotranto_sup_session.json'),
      },
      dependencies: ['setup-fotranto-sup'],
      testMatch: /4[89]_(descuento_sin_clave_bloquea|morosidad_cc_bloquea)_mutante\.spec\.ts/,
    }] : []),
  ],

  // Levanta el servidor de dev si no está corriendo (solo local)
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 30000,
      },
})
