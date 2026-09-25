/** @type {import('tailwindcss').Config} */

/**
 * Theme tokens.
 *
 * The surface (`ink`), text (`frost`) and overlay (`white`) scales resolve
 * to CSS variables that index.css defines once per theme, so every existing
 * `bg-ink-900` or `text-frost-300` flips with the light/dark toggle without
 * a second set of `dark:` classes. `white` is the translucent overlay colour
 * behind `bg-white/[.04]`-style tints: near-white in dark mode, near-black in
 * light mode. For a colour that must not change with the theme, such as text
 * on the bright accent buttons or copy over a photo, use `abyss` and `snow`.
 */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: { 950: v('ink-950'), 900: v('ink-900'), 850: v('ink-850'), 800: v('ink-800'), 700: v('ink-700') },
        frost: { 50: v('frost-50'), 100: v('frost-100'), 200: v('frost-200'), 300: v('frost-300'), 400: v('frost-400') },
        white: v('overlay'),
        abyss: '#070b14',
        // Light text over photos. Warm off-white: nothing is pure #FFFFFF.
        snow: '#EDE8E0',
        glacier: { 200: v('glacier-200'), 300: v('glacier-300'), 400: v('glacier-400'), 500: v('glacier-500'), 600: v('glacier-600') },
        saffron: { 300: v('saffron-300'), 500: '#f59e0b' },
        amberz: { 100: v('amberz-100'), 200: v('amberz-200'), 300: v('amberz-300'), 400: v('amberz-400'), 500: v('amberz-500') },
        rose: { 200: v('rose-200'), 300: v('rose-300'), 400: '#fb7185', 500: '#f43f5e' },
        emerald: { 300: v('emerald-300') },
        sky: { 300: v('sky-300') },
        orange: { 300: v('orange-300') },
      },
      fontFamily: {
        display: ['Inter', 'system-ui', 'sans-serif'],
        serif: ['"Playfair Display"', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        lift: '0 24px 60px -24px rgb(var(--shadow) / .85)',
        glow: '0 0 0 1px rgba(108,196,192,.16), 0 22px 60px -30px rgba(108,196,192,.45)',
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
        kenburns: { '0%': { transform: 'scale(1.04)' }, '100%': { transform: 'scale(1.14)' } },
        typing: { '0%,80%,100%': { transform: 'translateY(0)', opacity: '.35' }, '40%': { transform: 'translateY(-4px)', opacity: '1' } },
      },
      animation: {
        float: 'float 6s ease-in-out infinite',
        shimmer: 'shimmer 2.2s infinite',
        ping2: 'ping2 2.6s cubic-bezier(0,0,.2,1) infinite',
        marquee: 'marquee 32s linear infinite',
        drift: 'drift 26s ease-in-out infinite alternate',
        kenburns: 'kenburns 14s ease-out forwards',
        typing: 'typing 1.2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
