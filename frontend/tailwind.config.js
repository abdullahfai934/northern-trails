/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: { 950: '#070b14', 900: '#0b1220', 850: '#0f1727', 800: '#141d30', 700: '#1c2740' },
        frost: { 50: '#f4f8ff', 100: '#e4edfb', 200: '#c3d4ee', 300: '#93aed4', 400: '#6684af' },
        glacier: { 300: '#7ee0e6', 400: '#38c9d6', 500: '#18aebd', 600: '#0d8c9c' },
        saffron: { 300: '#ffd28a', 500: '#f59e0b' },
        amberz: { 300: '#fcd77f', 400: '#f5b73d', 500: '#e29a15' },
        rose: { 400: '#fb7185', 500: '#f43f5e' },
      },
      fontFamily: {
        display: ['"Clash Display"', '"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        sans: ['"Plus Jakarta Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        lift: '0 24px 60px -24px rgba(2,8,23,.85)',
        glow: '0 0 0 1px rgba(126,224,230,.18), 0 20px 60px -30px rgba(56,201,214,.65)',
      },
      backgroundImage: {
        aurora: 'radial-gradient(60% 55% at 20% 0%, rgba(56,201,214,.22), transparent 60%), radial-gradient(45% 45% at 85% 10%, rgba(245,183,61,.16), transparent 60%), radial-gradient(60% 60% at 60% 100%, rgba(99,102,241,.18), transparent 65%)',
      },
      keyframes: {
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-10px)' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        ping2: { '0%': { transform: 'scale(.6)', opacity: '.7' }, '100%': { transform: 'scale(2.4)', opacity: '0' } },
        marquee: { '0%': { transform: 'translateX(0)' }, '100%': { transform: 'translateX(-50%)' } },
        drift: { '0%': { transform: 'translateX(-6%)' }, '100%': { transform: 'translateX(6%)' } },
      },
      animation: {
        float: 'float 6s ease-in-out infinite',
        shimmer: 'shimmer 2.2s infinite',
        ping2: 'ping2 2.6s cubic-bezier(0,0,.2,1) infinite',
        marquee: 'marquee 32s linear infinite',
        drift: 'drift 26s ease-in-out infinite alternate',
      },
    },
  },
  plugins: [],
}
