import { Bonjour } from 'bonjour-service'

import { discoverMachineApi } from '@src/lib/discoverMachineApi'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const getHandleCounts = (): Record<string, number> => {
  const handles = (
    process as NodeJS.Process & {
      _getActiveHandles?: () => unknown[]
    }
  )._getActiveHandles?.()
  if (!handles) {
    return {}
  }

  return handles.reduce<Record<string, number>>((counts, handle) => {
    const constructorName =
      (handle as { constructor?: { name?: string } }).constructor?.name ??
      'unknown'
    counts[constructorName] = (counts[constructorName] ?? 0) + 1
    return counts
  }, {})
}

const discoverMachineApiLeaky = async (timeoutAfterMs: number) => {
  return new Promise<string | null>((resolve) => {
    setTimeout(() => resolve(null), timeoutAfterMs)
    const bonjour = new Bonjour({}, () => resolve(null))
    bonjour.find({ protocol: 'tcp', type: 'machine-api' }, (service) => {
      const ip = service.addresses?.[0]
      if (!ip) {
        resolve(null)
        return
      }
      resolve(`${ip}:${service.port}`)
    })
  })
}

const run = async () => {
  const mode = process.argv[2] ?? 'clean'
  const iterations = Number(process.argv[3] ?? '40')
  const timeoutAfterMs = Number(process.argv[4] ?? '10')

  await sleep(100)
  global.gc?.()
  await sleep(100)
  const baseline = getHandleCounts()

  for (let i = 0; i < iterations; i += 1) {
    if (mode === 'leaky') {
      await discoverMachineApiLeaky(timeoutAfterMs)
      continue
    }

    await discoverMachineApi({
      timeoutAfterMs,
      createBonjour: (onError) => new Bonjour({}, onError),
    })
  }

  await sleep(500)
  global.gc?.()
  await sleep(500)
  const after = getHandleCounts()

  // Keep stdout machine-readable so the parent test can assert on real handle counts.
  process.stdout.write(
    JSON.stringify({
      mode,
      iterations,
      timeoutAfterMs,
      baseline,
      after,
    })
  )

  const baselineSockets = baseline.Socket ?? 0
  const afterSockets = after.Socket ?? 0

  if (mode === 'clean' && afterSockets > baselineSockets + 2) {
    process.exitCode = 1
  }
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
