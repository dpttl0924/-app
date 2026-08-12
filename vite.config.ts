import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // 5173 被佔用時可由環境變數指派,不用改設定檔
    port: Number(process.env.PORT) || 5173,
  },
})
