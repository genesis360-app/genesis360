/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Colores de marca — cambiar en src/index.css (:root) para rebrandear
        primary:    'rgb(var(--color-primary) / <alpha-value>)',
        accent:     'rgb(var(--color-accent) / <alpha-value>)',
        'brand-bg': 'rgb(var(--color-brand-bg) / <alpha-value>)',
      },
    },
  },
  plugins: [],
}
