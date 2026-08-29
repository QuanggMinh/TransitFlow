import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { networkInterfaces } from 'os'

function getLanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap(entries => entries ?? [])
    .filter(entry => entry.family === 'IPv4' && !entry.internal)
    .map(entry => entry.address)
}

function networkEnvironmentInfo() {
  return {
    name: 'transitflow-network-info',
    configureServer(server: { httpServer?: { once: (event: string, listener: () => void) => void } | null }) {
      server.httpServer?.once('listening', () => {
        console.log('\n  TransitFlow development environment')
        console.log('  Local:     http://localhost:3000')
        for (const address of getLanAddresses()) {
          console.log(`  LAN:       http://${address}:3000  (GPS unavailable over HTTP)`)
        }
        console.log('  GPS/HTTPS: npm run dev:https  (URL appears in the HTTPS terminal output)\n')
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), networkEnvironmentInfo()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    host: true,
    port: 3000,
    strictPort: true,
    // Allow Cloudflare Quick Tunnel hostnames used for HTTPS/GPS testing on phones.
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/map-tiles': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
})
