/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        gray: {
          750: '#2b3544',
          850: '#18202f',
        },
      },
    },
  },
  plugins: [],
}
