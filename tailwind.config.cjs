/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        heading: ['Bebas Neue', 'sans-serif'],
        body: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        base: {
          DEFAULT: '#0b0b0e',
          surface: '#141419',
          elevated: '#1c1c24',
          border: '#2a2a33',
        },
        accent: {
          DEFAULT: '#e11d48',
          soft: '#f43f5e',
        },
      },
    },
  },
  plugins: [],
};