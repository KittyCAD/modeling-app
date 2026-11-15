import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
  server: {
    port: 5173,
    strictPort: true,
    open: false,
    proxy: {
      '/': { target: 'http://localhost:3000', ws: true },
    },
  },
})
await server.listen()
