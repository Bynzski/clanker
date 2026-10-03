import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

const BOOT_SPLASH_LOGO = path.resolve(__dirname, 'src/assets/branding/generated/clanker-app-128.png')

/**
 * Inlines the canonical app logo into index.html's boot splash as a data URI, so it
 * paints before any request or script, and works in dev, where the branding folder
 * sits outside the Vite root and a relative path would 404.
 */
function bootSplashLogo(): Plugin {
  return {
    name: 'clanker-boot-splash-logo',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replace(
        '%BOOT_SPLASH_LOGO%',
        `data:image/png;base64,${fs.readFileSync(BOOT_SPLASH_LOGO).toString('base64')}`,
      ),
    },
  }
}

export default defineConfig({
  plugins: [react(), bootSplashLogo()],
  base: './',
  root: 'src/renderer',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    chunkSizeWarningLimit: 600,
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/renderer'),
    },
  },
})
