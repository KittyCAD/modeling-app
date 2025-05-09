import dotenv from 'dotenv'

// dotenv override when present
const NODE_ENV = process.env.NODE_ENV 
dotenv.config({ path: [`.env.${NODE_ENV}.local`, `.env.${NODE_ENV}`] })

const secrets: Record<string, string> = {}
secrets.token = process.env.token || ''
// add more env vars here to make them available in CI

export { secrets }
