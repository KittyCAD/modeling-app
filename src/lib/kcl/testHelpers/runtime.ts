import { emptyExecState, type ExecState } from '@src/lang/wasm'
import type { KclSources } from '@src/lib/kcl/session'
import { vi } from 'vitest'

/** Controllable execution keeps lifecycle tests independent of WASM and remote geometry. */
export function fakeKclRuntime() {
  return {
    execute: vi.fn(
      async (_contents: KclSources, _src: string): Promise<ExecState> =>
        emptyExecState()
    ),
    evaluateExpression: vi.fn(async () => emptyExecState()),
    validate: vi.fn(async (): Promise<Error | undefined> => undefined),
    waitForAllEngineModelingCommands: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
  }
}
