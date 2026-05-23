/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          900: '#0b0d12',
          800: '#11141b',
          700: '#181c26',
          600: '#222734',
          500: '#2e3442',
          400: '#3a4150'
        },
        accent: {
          DEFAULT: '#6ea8fe',
          dim: '#3d6fc4'
        }
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
      }
    }
  },
  plugins: []
}
