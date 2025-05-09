const secrets: Record<string, string> = {}
secrets.token = process.env.token || ''
// add more env vars here to make them available in CI

export { secrets }
