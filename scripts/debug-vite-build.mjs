/**
 * Debug wrapper for vite build.
 * Polls open handles during the build and dumps full diagnostics after.
 * This helps diagnose Vercel build hangs after "computing gzip size...".
 */
import { createRequire } from 'node:module'
import whyIsNodeRunning from 'why-is-node-running'

const require = createRequire(import.meta.url)
const wtf = require('wtfnode')

// Run vite build programmatically
const { build } = await import('vite')

console.log('[debug] Starting vite build...')
const startTime = Date.now()

function elapsed() {
  return ((Date.now() - startTime) / 1000).toFixed(1)
}

// Poll every 30s during the build to catch what's happening in real time
let buildDone = false
const pollInterval = setInterval(() => {
  if (buildDone) return
  console.log(`[debug] === POLL at ${elapsed()}s (build still running) ===`)
  console.log(`[debug] Active handles: ${process._getActiveHandles().length}`)
  console.log(`[debug] Active requests: ${process._getActiveRequests().length}`)
  wtf.dump()
  console.log(`[debug] === END POLL ===`)
}, 30_000)
// Unref so the interval itself doesn't keep the process alive
pollInterval.unref()

try {
  await build()
  buildDone = true
  clearInterval(pollInterval)
  console.log(`[debug] vite build promise resolved in ${elapsed()}s`)
} catch (err) {
  buildDone = true
  clearInterval(pollInterval)
  console.error('[debug] vite build failed:', err)
  process.exit(1)
}

// Dump handles then force exit
setTimeout(() => {
  console.log(`[debug] === FINAL DUMP (5s after build, ${elapsed()}s total) ===`)
  console.log(`[debug] Active handles: ${process._getActiveHandles().length}`)
  console.log(`[debug] Active requests: ${process._getActiveRequests().length}`)

  console.log('[debug] --- wtfnode ---')
  wtf.dump()
  console.log('[debug] --- why-is-node-running ---')
  whyIsNodeRunning()
  console.log('[debug] === END FINAL DUMP ===')

  console.log('[debug] Force-exiting process')
  process.exit(0)
}, 5000)
