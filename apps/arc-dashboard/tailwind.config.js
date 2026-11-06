const channel = (name) => `rgb(var(--c-${name}) / <alpha-value>)`

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
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: {
        lg: '8px',
        md: '8px',
      },
    },
  },
  plugins: [],
}
