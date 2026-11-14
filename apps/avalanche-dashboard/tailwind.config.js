/* The colour values are the landing page's oklch tokens, stored as "L C H" so alpha still works. */
const channel = (name) => `oklch(var(--c-${name}) / <alpha-value>)`

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: channel('bg'),
        surface: channel('surface'),
        subtle: channel('subtle'),
        line: channel('line'),
        edge: channel('edge'),
        ink: channel('ink'),
        muted: channel('muted'),
        accent: channel('accent'),
        'accent-fg': channel('accent-fg'),
        'accent-soft': channel('accent-soft'),
        ok: channel('ok'),
        'ok-soft': channel('ok-soft'),
        warn: channel('warn'),
        'warn-soft': channel('warn-soft'),
        bad: channel('bad'),
        'bad-soft': channel('bad-soft'),
      },
      fontFamily: {
        sans: ['Instrument Sans Variable', 'Instrument Sans', 'system-ui', 'sans-serif'],
        display: ['Instrument Serif', 'Georgia', 'serif'],
        mono: ['JetBrains Mono Variable', 'JetBrains Mono', 'ui-monospace', 'monospace'],
        brand: ['Poppins', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        lg: '0.25rem',
        md: '0.25rem',
      },
    },
  },
  plugins: [],
}
