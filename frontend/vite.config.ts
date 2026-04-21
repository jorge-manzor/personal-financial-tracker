import path from 'node:path'
import os from 'node:os'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Keep Vite optimize/cache outside node_modules so CI (npm ci / rm) does not hit EBUSY on Docker layers.
const cacheDir = path.join(os.tmpdir(), 'vite-cache-personal-financial-tracker')

export default defineConfig({
  cacheDir,
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
})
