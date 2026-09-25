import { rm } from 'fs/promises'

export async function removeVSCodeProfile(profileDir: string): Promise<void> {
  // Node 24's rmSync skips retries for Windows permission-denied errors.
  // Async removal handles read-only files and retries lingering file locks.
  await rm(profileDir, {
    force: true,
    recursive: true,
    maxRetries: 10,
    retryDelay: 200,
  })
}
