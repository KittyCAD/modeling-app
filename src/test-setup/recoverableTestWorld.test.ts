import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { createRecoverableTestWorld } from '@src/test-setup/recoverableTestWorld'
import { expect, it, vi } from 'vitest'

function world() {
  return {
    connected: true,
    native: new Map<string, number>(),
    actor: { stopped: false },
  }
}

it('reuses healthy worlds and discards all state after a disconnect', async () => {
  const released: ReturnType<typeof world>[] = []
  const fixture = createRecoverableTestWorld({
    create: async () => world(),
    reusable: (value) => value.connected,
    dispose: (value) => {
      value.actor.stopped = true
      released.push(value)
    },
  })
  const first = await fixture.getWorld()
  first.native.set('old geometry', 42)
  expect(await fixture.getWorld()).toBe(first)
  first.connected = false
  const replacement = await fixture.getWorld()
  expect(first.actor.stopped).toBe(true)
  expect(replacement).not.toBe(first)
  expect(replacement.native.size).toBe(0)
  expect(replacement.actor).not.toBe(first.actor)
  expect(replacement.actor.stopped).toBe(false)
  expect(await fixture.getWorld()).toBe(replacement)
  await fixture.dispose()
  await fixture.dispose()
  expect(released).toEqual([first, replacement])
  await expect(fixture.getWorld()).rejects.toThrow('disposed')
})

it('can create a new world after opening fails', async () => {
  const create = vi
    .fn<() => Promise<ReturnType<typeof world>>>()
    .mockRejectedValueOnce(new Error('connection refused'))
    .mockImplementation(async () => world())
  const fixture = createRecoverableTestWorld({
    create,
    reusable: (value) => value.connected,
    dispose: () => {},
  })
  await expect(fixture.getWorld()).rejects.toThrow('connection refused')
  expect((await fixture.getWorld()).connected).toBe(true)
  await fixture.dispose()
})

it('shares opening work and releases a world that finishes opening after disposal', async () => {
  const opening = Promise.withResolvers<ReturnType<typeof world>>()
  let openingSignal: AbortSignal | undefined
  const release = vi.fn()
  const fixture = createRecoverableTestWorld({
    create: (signal) => {
      openingSignal = signal
      return opening.promise
    },
    reusable: (value) => value.connected,
    dispose: release,
  })
  const first = fixture.getWorld()
  expect(fixture.getWorld()).toBe(first)
  const closed = fixture.dispose()
  expect(openingSignal?.aborted).toBe(true)
  const late = world()
  opening.resolve(late)
  await expect(first).rejects.toThrow('closed while opening')
  await closed
  expect(release).toHaveBeenCalledExactlyOnceWith(late)
})

it('provides fresh native state to an actual Vitest retry after disconnection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'engine-world-retry-'))
  try {
    const reportPath = join(directory, 'results.json')
    const require = createRequire(import.meta.url)
    await promisify(execFile)(
      process.execPath,
      [
        join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs'),
        'run',
        '--config',
        resolve('src/test-setup/fixtures/retry.config.ts'),
        '--reporter=json',
        '--outputFile=' + reportPath,
      ],
      { timeout: 20_000, maxBuffer: 1024 * 1024 }
    )
    const report: unknown = JSON.parse(await readFile(reportPath, 'utf8'))
    expect(report).toMatchObject({ success: true, numPassedTests: 1 })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 25_000)
