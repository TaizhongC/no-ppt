import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { localPresentationsPlugin } from './scripts/local-presentations.mjs'

export default defineConfig({
  plugins: [localPresentationsPlugin(fileURLToPath(new URL('./presentations/', import.meta.url)))],
})
