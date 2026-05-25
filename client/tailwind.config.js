/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'jdil-green': '#1a7a3c',
        'jdil-green-dark': '#145e2e',
        'jdil-green-light': '#22a350',
        'jdil-red': '#e63329',
        'jdil-red-dark': '#c4261d',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
