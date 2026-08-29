import { signal } from '@preact/signals'
import { describe, expect, it, vi } from 'vitest'
import type {
  BufferExecutionState,
  ExecutionCoordinator,
} from '@src/contracts/execution'
import { afterExecution } from '@src/features/modelingOperations/afterExecution'

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function createCoordinator() {
  const state = signal<BufferExecutionState>({
    bufferId: 'main',
    status: 'idle',
    resultVersion: null,
    diagnostics: [],
    error: null,
    durationMs: null,
    runCount: 0,
  })

  return {
    state,
    coordinator: {
      stateFor: () => state,
    } as unknown as ExecutionCoordinator,
  }
}

describe('afterExecution', () => {
  it('waits for the run that describes the edit', async () => {
    const { state, coordinator } = createCoordinator()
    const run = vi.fn()

    afterExecution(() => coordinator, { bufferId: 'main', version: 4 }, run)
    await settle()
    expect(run).not.toHaveBeenCalled()

    // An earlier result is not this edit: the debounce may still be counting.
    state.value = { ...state.value, resultVersion: 3 }
    await settle()
    expect(run).not.toHaveBeenCalled()

    state.value = { ...state.value, resultVersion: 4 }
    await settle()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('counts a later result, since it contains this edit too', async () => {
    const { state, coordinator } = createCoordinator()
    const run = vi.fn()

    afterExecution(() => coordinator, { bufferId: 'main', version: 4 }, run)
    // Superseded by the user typing; the result still has the sketch block in it.
    state.value = { ...state.value, resultVersion: 9 }
    await settle()

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('runs at once when the edit has already landed', async () => {
    const { state, coordinator } = createCoordinator()
    state.value = { ...state.value, resultVersion: 7 }
    const run = vi.fn()

    afterExecution(() => coordinator, { bufferId: 'main', version: 4 }, run)
    await settle()

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('runs once, however many results follow', async () => {
    const { state, coordinator } = createCoordinator()
    const run = vi.fn()

    afterExecution(() => coordinator, { bufferId: 'main', version: 1 }, run)
    state.value = { ...state.value, resultVersion: 1 }
    await settle()
    state.value = { ...state.value, resultVersion: 2 }
    await settle()

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('does nothing without a coordinator', () => {
    const run = vi.fn()
    afterExecution(() => undefined, { bufferId: 'main', version: 1 }, run)
    expect(run).not.toHaveBeenCalled()
  })

  it('gives up rather than waiting forever', async () => {
    vi.useFakeTimers()
    const { coordinator } = createCoordinator()
    const run = vi.fn()

    afterExecution(() => coordinator, { bufferId: 'main', version: 4 }, run)
    // The run was superseded, the buffer closed, the project switched: all
    // ordinary, and none of them ever produce this version.
    vi.advanceTimersByTime(60_000)

    expect(run).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
