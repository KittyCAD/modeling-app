import { Bonjour } from 'bonjour-service'

import { discoverMachineApi } from '@src/lib/discoverMachineApi'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const run = async () => {
  const iterations = Number(process.argv[2] ?? '40')
  const timeoutAfterMs = Number(process.argv[3] ?? '10')

  // Let startup noise settle before the loop.
  await sleep(100)

  for (let i = 0; i < iterations; i += 1) {
    await discoverMachineApi({
      timeoutAfterMs,
      createBonjour: (onError) => new Bonjour({}, onError),
    })
  }

  // Encourage cleanup before process exit checks in parent test.
  await sleep(250)
  global.gc?.()
  await sleep(250)

  process.stdout.write('ok')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
