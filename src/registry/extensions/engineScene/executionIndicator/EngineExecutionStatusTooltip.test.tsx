import { signal } from '@preact/signals-core'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EngineExecutionStatusTooltip } from './EngineExecutionStatusTooltip'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('EngineExecutionStatusTooltip', () => {
  it('shows the retained duration without polling pending commands when opened after execution', () => {
    const getPendingCommandCount = vi.fn(() => 0)
    render(
      <EngineExecutionStatusTooltip
        isExecuting={false}
        executionElapsedMs={signal(65_000)}
        getPendingCommandCount={getPendingCommandCount}
      />
    )

    expect(
      screen.getByText('Engine execution took 1m 05s.')
    ).toBeInTheDocument()
    expect(screen.queryByText(/Pending commands/)).not.toBeInTheDocument()
    expect(getPendingCommandCount).not.toHaveBeenCalled()
  })

  it('updates an open tooltip when execution finishes and resumes live timing on the next run', () => {
    vi.useFakeTimers()
    const executionElapsedMs = signal(1200)
    const getPendingCommandCount = vi.fn(() => 2)
    const { rerender } = render(
      <EngineExecutionStatusTooltip
        isExecuting
        executionElapsedMs={executionElapsedMs}
        getPendingCommandCount={getPendingCommandCount}
      />
    )

    expect(screen.getByText('Engine executing for 1.2s.')).toBeInTheDocument()
    expect(screen.getByText('Pending commands: 2')).toBeInTheDocument()

    act(() => {
      executionElapsedMs.value = 1500
    })
    rerender(
      <EngineExecutionStatusTooltip
        isExecuting={false}
        executionElapsedMs={executionElapsedMs}
        getPendingCommandCount={getPendingCommandCount}
      />
    )

    expect(screen.getByText('Engine execution took 1.5s.')).toBeInTheDocument()
    expect(screen.queryByText(/Pending commands/)).not.toBeInTheDocument()
    getPendingCommandCount.mockClear()
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(getPendingCommandCount).not.toHaveBeenCalled()

    act(() => {
      executionElapsedMs.value = 0
    })
    getPendingCommandCount.mockReturnValue(3)
    rerender(
      <EngineExecutionStatusTooltip
        isExecuting
        executionElapsedMs={executionElapsedMs}
        getPendingCommandCount={getPendingCommandCount}
      />
    )

    expect(screen.getByText('Engine executing for 0.0s.')).toBeInTheDocument()
    expect(screen.getByText('Pending commands: 3')).toBeInTheDocument()
  })
})
