import { setupRecoverableTestWorld } from '@src/test-setup/recoverableTestWorld'
import { expect, it } from 'vitest'

function createWorld() {
  return { connected: true, native: new Map<string, number>(), disposed: false }
}
const created: ReturnType<typeof createWorld>[] = []
let current: ReturnType<typeof createWorld>
let attempts = 0
setupRecoverableTestWorld(
  {
    create: async () => {
      const next = createWorld()
      created.push(next)
      return next
    },
    reusable: (world) => world.connected,
    dispose: (world) => {
      world.disposed = true
    },
  },
  (world) => {
    current = world
  }
)

// The deliberate failure stays inside this child runner, not the CI test report.
it('retries the operation with a new native world', { retry: 1 }, () => {
  if (++attempts === 1) {
    current.native.set('old geometry', 42)
    current.connected = false
    return Promise.reject(
      new Error('Simulated engine disconnection during the first attempt')
    )
  }
  expect(created).toHaveLength(2)
  expect(created[0].disposed).toBe(true)
  expect(current).toBe(created[1])
  expect(current.native.size).toBe(0)
})
