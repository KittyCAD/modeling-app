import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import {
  notifyActiveWasmInstance,
  onActiveWasmInstance,
} from '@src/lib/wasmLifecycle'
import { afterEach, describe, expect, it, vi } from 'vitest'

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.()
  }
})

describe('wasm lifecycle', () => {
  it('notifies active wasm instance listeners in registration order', async () => {
    const wasmInstance = {} as ModuleType
    const calls: string[] = []

    cleanups.push(
      onActiveWasmInstance(async (instance) => {
        expect(instance).toBe(wasmInstance)
        calls.push('first')
      })
    )
    cleanups.push(
      onActiveWasmInstance((instance) => {
        expect(instance).toBe(wasmInstance)
        calls.push('second')
      })
    )

    await notifyActiveWasmInstance(wasmInstance)

    expect(calls).toEqual(['first', 'second'])
  })

  it('does not notify removed listeners', async () => {
    const wasmInstance = {} as ModuleType
    const listener = vi.fn()
    const cleanup = onActiveWasmInstance(listener)

    cleanup()
    await notifyActiveWasmInstance(wasmInstance)

    expect(listener).not.toHaveBeenCalled()
  })
})
