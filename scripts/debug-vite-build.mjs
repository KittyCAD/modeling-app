/**
 * Debug wrapper for vite build.
 * Runs vite build and then dumps any open handles that prevent Node from exiting.
 * This helps diagnose Vercel build hangs after "computing gzip size...".
 */
import { createRequire } from 'node:module'

// Install the open-handle trackers before anything else
const require = createRequire(import.meta.url)
const whyIsNodeRunning = require('why-is-node-running')
const wtf = require('wtfnode')

// Run vite build programmatically
const { build } = await import('vite')

console.log('[debug] Starting vite build...')
const startTime = Date.now()

try {
  await build()
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`[debug] vite build completed in ${elapsed}s`)
} catch (err) {
  console.error('[debug] vite build failed:', err)
  process.exit(1)
}

// Give a moment for any async cleanup
setTimeout(() => {
  console.log('[debug] === wtfnode DUMP (5s after build) ===')
  wtf.dump()
  console.log('[debug] === END wtfnode DUMP ===')

  console.log('[debug] === why-is-node-running DUMP ===')
  whyIsNodeRunning()
  console.log('[debug] === END why-is-node-running DUMP ===')

  // Force exit after dumping
  setTimeout(() => {
    console.log('[debug] Force-exiting process after handle dump')
    process.exit(0)
  }, 2000)
}, 5000)
