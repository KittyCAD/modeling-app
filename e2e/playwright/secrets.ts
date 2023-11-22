import { readFileSync } from 'fs'

const secrets: Record<string, string> = {}
try {
  const file = readFileSync('./e2e/playwright/playwright-secrets.env', 'utf8')
  file
    .split('\n')
    .filter((line) => line && line.length > 1)
    .forEach((line) => {
      const [key, value] = line.split('=')
      // prefer env vars over secrets file
      secrets[key] = process.env[key] || (value as any).replaceAll('"', '')
    })
} catch (err) {
  // probably running in CI
  secrets.token = process.env.token || ''
  // add more env vars here to make them available in CI
}

export { secrets }
