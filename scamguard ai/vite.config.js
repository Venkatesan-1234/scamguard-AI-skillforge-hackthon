import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/groq': {
        target: 'https://api.groq.com/openai/v1/chat/completions',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/groq/, '')
      }
    }
  }
})