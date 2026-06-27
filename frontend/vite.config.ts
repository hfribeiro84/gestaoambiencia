import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Configuração do Vite (build do frontend para o Vercel).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});
