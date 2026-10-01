/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Deep navy/midnight foundation — the app's resting state.
        midnight: {
          950: '#05070d',
          900: '#0a0e1a',
          800: '#111828',
          700: '#1b2436',
          600: '#2a3650',
        },
        // Neutral surfaces on top of midnight, for cards/panels.
        surface: {
          DEFAULT: '#141b2b',
          raised: '#1a2338',
          border: '#26314a',
        },
        // Blue/cyan — the security/identity accent, used for primary actions
        // and anything related to encryption state.
        cyan: {
          400: '#5eead4' /* intentionally teal-leaning cyan, see verify below for pure teal */,
          500: '#22d3ee',
          600: '#0891b2',
        },
        // Teal/green — reserved specifically for verification states
        // (blockchain-confirmed, signature valid, integrity OK).
        verify: {
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
        },
        // Amber — warnings only (expiring vault docs, pending confirmations).
        warn: {
          400: '#fbbf24',
          500: '#f59e0b',
        },
        // Red — reserved exclusively for critical alerts.
        critical: {
          500: '#ef4444',
          600: '#dc2626',
        },
      },
      fontFamily: {
        // Display face: a geometric sans with a slightly technical feel for
        // headings and the security score / big numbers.
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        // Body face: a humanist sans tuned for long reading (file lists,
        // settings copy) — kept distinct from the display face on purpose.
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
        // Utility/mono face: hashes, transaction IDs, key fingerprints —
        // anything the user might need to compare character-by-character.
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(34,211,238,0.15), 0 0 24px rgba(34,211,238,0.08)',
      },
    },
  },
  plugins: [],
};
