import { readFileSync } from 'fs'

const secrets: Record<string, string> = {}
try {
  const file = readFileSync('./src/e2e-tests/playwright-secrets.env', 'utf8')
  file.split('\n').forEach((line) => {
    const [key, value] = line.split('=')
    // prefer env vars over secrets file
    secrets[key] = process.env[key] || value.replaceAll('"', '')
  })
} catch (err) {
  console.log('probably running in CI')
}

export { secrets }
