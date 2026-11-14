import { defineConfig } from '@playwright/test'
import config from '@root/playwright.config'

export default defineConfig({
  ...config,
  testDir: './e2e/localhost',
  workers: 1,
  retries: 0,
  reporter: [['list']],
  projects: config.projects?.filter(
    (project) => project.name === 'Google Chrome'
  ),
  use: { ...config.use, baseURL: 'http://localhost:3004' },
  webServer: {
    command: 'npm start -- --port 3004 --strictPort',
    url: 'http://localhost:3004',
    env: {
      VITE_ZOO_API_TOKEN: 'localhost',
      VITE_ZOO_BASE_DOMAIN: 'zoo.dev',
      VITE_KITTYCAD_WEBSOCKET_URL: 'ws://127.0.0.1:8080/ws/modeling/commands',
    },
  },
})
