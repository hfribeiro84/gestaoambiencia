/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Paleta base do grupo (ajustável conforme identidade visual).
        ambiencia: '#1f7a52', // verde Ambiência
        netr: '#0f4c81', // azul NETResíduos
      },
    },
  },
  plugins: [],
};
