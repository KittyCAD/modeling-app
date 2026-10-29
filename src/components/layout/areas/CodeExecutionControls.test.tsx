import { signal } from '@preact/signals-core'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  session: vi.fn(),
  send: vi.fn(),
}))
vi.mock('@src/lib/boot', () => ({
  useApp: () => ({
    settings: { useSettings: mocks.settings, actor: { send: mocks.send } },
    registry: { signal: mocks.session },
  }),
}))

import { CodeExecutionControls } from '@src/components/layout/areas/CodeExecutionControls'

const executeCode = vi.fn().mockResolvedValue(undefined)
const editor = {
  executeCode,
  hasEditsSinceLastExecution: signal(true),
  isExecuting: signal(false),
}

beforeEach(() => {
  vi.clearAllMocks()
  editor.hasEditsSinceLastExecution.value = true
  editor.isExecuting.value = false
  mocks.settings.mockReturnValue({
    textEditor: { automaticallyRender: { current: false } },
  })
  mocks.session.mockReturnValue({
    value: { executingEditor: { value: editor } },
  })
})

describe('paused code execution controls', () => {
  it('executes pending edits while keeping automatic execution paused', () => {
    render(<CodeExecutionControls />)
    expect(screen.getByRole('status')).toHaveTextContent(
      'You can still rotate, zoom, and pan.'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Execute' }))
    expect(executeCode).toHaveBeenCalledOnce()
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('resumes automatic execution and executes pending edits once', () => {
    render(<CodeExecutionControls />)
    fireEvent.click(
      screen.getByRole('button', { name: 'Resume automatic execution' })
    )
    expect(mocks.send).toHaveBeenCalledWith({
      type: 'set.textEditor.automaticallyRender',
      data: { level: 'user', value: true },
    })
    expect(executeCode).toHaveBeenCalledOnce()
  })

  it('pauses future execution without requesting a render', () => {
    mocks.settings.mockReturnValue({
      textEditor: { automaticallyRender: { current: true } },
    })
    render(<CodeExecutionControls />)
    fireEvent.click(screen.getByRole('button', { name: 'Pause execution' }))
    expect(mocks.send).toHaveBeenCalledWith({
      type: 'set.textEditor.automaticallyRender',
      data: { level: 'user', value: false },
    })
    expect(executeCode).not.toHaveBeenCalled()
  })

  it('prevents duplicate execution while a model is running', () => {
    editor.isExecuting.value = true
    render(<CodeExecutionControls />)
    expect(screen.getByRole('button', { name: 'Execute' })).toBeDisabled()
    fireEvent.click(
      screen.getByRole('button', { name: 'Resume automatic execution' })
    )
    expect(executeCode).not.toHaveBeenCalled()
  })
})
