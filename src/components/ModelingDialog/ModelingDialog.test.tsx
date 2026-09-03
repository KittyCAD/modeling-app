import type { Command } from '@src/lib/commandTypes'
import type { CommandBarContext } from '@src/machines/commandBarMachine'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const selectionRanges: Selections = {
    graphSelections: [],
    otherSelections: [],
  }
  return {
    send: vi.fn(),
    state: {
      context: {} as CommandBarContext,
      matches: () => false,
    },
    wasmPromise: Promise.resolve({}),
    kclManager: {
      astSignal: { value: {} },
      artifactGraph: new Map(),
      setSelectionFilterToDefault: vi.fn(),
    },
    modeling: {
      context: {
        selectionRanges,
      },
      send: vi.fn(),
    },
  }
})

vi.mock('@src/lib/boot', () => ({
  useApp: () => ({
    commands: { send: mocks.send, useState: () => mocks.state },
    wasmPromise: mocks.wasmPromise,
  }),
  useSingletons: () => ({ kclManager: mocks.kclManager }),
}))
vi.mock('@src/hooks/useModelingContext', () => ({
  useModelingContext: () => mocks.modeling,
}))
vi.mock('@src/hooks/useResolvedTheme', () => ({
  useResolvedTheme: () => 'light',
}))
vi.mock('@src/components/CommandBar/CodemodReviewDiff', () => ({
  CodemodReviewDiff: () => null,
}))
vi.mock('@src/components/MarkdownText', () => ({
  MarkdownText: () => null,
}))
vi.mock('@src/components/ModelingDialog/ModelingDialogKclInput', () => ({
  ModelingDialogKclInput: () => null,
  getKclInputValue: () => '',
  getKclSubmitValue: () => '',
}))
vi.mock('@src/lang/std/artifactGraph', () => ({
  coerceSelectionsToBody: vi.fn(),
}))
vi.mock('@src/lib/selections', () => ({
  canSubmitSelectionArg: vi.fn(),
  getSelectionCountByType: vi.fn(),
  getSelectionTypeDisplayText: () => '1 segment',
  handleSelectionBatch: vi.fn(),
}))
vi.mock('@src/lib/kclHelpers', () => ({ stringToKclExpression: vi.fn() }))

import { ModelingDialog } from '@src/components/ModelingDialog/ModelingDialog'

function command(name = 'extrude'): Command {
  return {
    name,
    groupId: 'modeling',
    needsReview: false,
    scopes: ['mode-modeling'],
    useModelingDialog: true,
    onSubmit: vi.fn(),
    args: {
      label: { inputType: 'string', required: true, defaultValue: 'Part' },
    },
  }
}

describe('modeling dialog submission lifetime', () => {
  let resolveWasm: (value: object) => void

  beforeEach(() => {
    mocks.send.mockClear()
    mocks.modeling.context.selectionRanges = {
      graphSelections: [],
      otherSelections: [],
    }
    mocks.modeling.send.mockImplementation((event) => {
      mocks.modeling.context.selectionRanges = event.data.selection
    })
    mocks.wasmPromise = new Promise((resolve) => {
      resolveWasm = resolve
    })
    mocks.state.context = {
      selectedCommand: command(),
      argumentsToSubmit: {},
    } as CommandBarContext
  })

  it('renders the dialog label without changing the shared command label', async () => {
    const labeledCommand = command()
    labeledCommand.args = {
      label: {
        inputType: 'string',
        required: true,
        displayName: 'Palette label',
        dialog: { displayName: 'Dialog label' },
        defaultValue: 'Part',
      },
    }
    mocks.state.context.selectedCommand = labeledCommand
    render(<ModelingDialog />)
    await act(async () => resolveWasm({}))

    expect(
      screen.getByRole('textbox', { name: /Dialog label/ })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('textbox', { name: /Palette label/ })
    ).not.toBeInTheDocument()
  })

  it('submits resolved arguments with their originating command', async () => {
    render(<ModelingDialog />)
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await act(async () => resolveWasm({}))

    expect(mocks.send).toHaveBeenCalledWith({
      type: 'Submit command from dialog',
      data: {
        command: mocks.state.context.selectedCommand,
        argumentsToSubmit: { label: 'Part' },
      },
    })
  })

  it('does not submit a pending dialog after closing and reopening the same command', async () => {
    const firstDialog = render(<ModelingDialog />)
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    firstDialog.unmount()
    render(<ModelingDialog />)
    await act(async () => resolveWasm({}))

    expect(mocks.send).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled()
  })

  it('does not submit a pending dialog after switching commands', async () => {
    const { rerender } = render(<ModelingDialog />)
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    mocks.state.context = {
      ...mocks.state.context,
      selectedCommand: command('revolve'),
    }
    rerender(<ModelingDialog />)
    await act(async () => resolveWasm({}))

    expect(mocks.send).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled()
  })

  it('keeps initial preselection but does not copy another collector into an empty field', async () => {
    const initialSelection: Selections = {
      graphSelections: [{ codeRef: { range: [0, 10, 0], pathToNode: [] } }],
      otherSelections: [],
    }
    mocks.modeling.context.selectionRanges = initialSelection
    mocks.state.context.selectedCommand = {
      ...command(),
      args: {
        profiles: {
          inputType: 'selection',
          displayName: 'Profiles',
          selectionTypes: ['segment'],
          multiple: true,
          required: false,
        },
        path: {
          inputType: 'selection',
          displayName: 'Path',
          selectionTypes: ['segment'],
          multiple: false,
          clearSelectionFirst: true,
          required: false,
        },
      },
    }
    const { rerender } = render(<ModelingDialog />)
    await act(async () => resolveWasm({}))
    expect(mocks.modeling.context.selectionRanges).toEqual(initialSelection)

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    rerender(<ModelingDialog />)
    fireEvent.click(screen.getByRole('button', { name: 'Select Path' }))
    mocks.modeling.context.selectionRanges = initialSelection
    rerender(<ModelingDialog />)
    fireEvent.click(screen.getByRole('button', { name: 'Select Profiles' }))

    expect(mocks.modeling.context.selectionRanges).toEqual({
      graphSelections: [],
      otherSelections: [],
    })
    expect(
      screen.getByRole('button', { name: 'Select Profiles' })
    ).toHaveAttribute('aria-pressed', 'true')
  })
})
