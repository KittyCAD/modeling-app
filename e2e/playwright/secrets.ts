import { readFileSync } from 'fs'

const secrets: Record<string, string> = {}
const secretsPath = './e2e/playwright/playwright-secrets.env'
try {
  const file = readFileSync(secretsPath, 'utf8')
  file
    .split('\n')
    .filter((line) => line && line.length > 1)
    .forEach((line) => {
      // Allow line comments.
      if (line.trimStart().startsWith('#')) return
      const [key, value] = line.split('=')
      // prefer env vars over secrets file
      secrets[key] = process.env[key] || (value as any).replaceAll('"', '')
    })
} catch (err) {
  // probably running in CI
  console.warn(
    `Error reading ${secretsPath}; environment variables will be used`,
    err
  )
}
secrets.token = secrets.token || process.env.token || ''
secrets.snapshottoken = secrets.snapshottoken || process.env.snapshottoken || ''
// add more env vars here to make them available in CI

export { secrets }
