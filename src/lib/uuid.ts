import { v4 as uuidv4 } from 'uuid'
import { SHA256 } from 'crypto-js'

export function generateUuidFromHashSeed(seed: string): string {
  const hashedSeed = SHA256(seed).toString()
  const uuid = uuidv4({
    random: hashedSeed.split('').map((c: string) => c.charCodeAt(0)),
  })
  return uuid
}
