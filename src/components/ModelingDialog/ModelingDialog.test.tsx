import type { ModelingDialogKclChange } from '@src/components/ModelingDialog/ModelingDialogKclInput'
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
    kclInputChanges: new Map<
      string,
      (change: ModelingDialogKclChange) => void
    >(),
    state: {
      context: {} as CommandBarContext,
      matches: () => false,
    },
    wasmPromise: Promise.resolve({}),
    kclManager: {
      astSignal: { value: {} },
      artifactGraph: new Map(),
      setSelectionFilterToDefault: vi.fn(),
      showPlanes: vi.fn(() => Promise.resolve()),
      hidePlanes: vi.fn(() => Promise.resolve()),
      _isAstEmpty: vi.fn(() => false),
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
  ModelingDialogKclInput: ({
    name,
    value,
    onChange,
  }: {
    name: string
    value: string
    onChange: (change: ModelingDialogKclChange) => void
  }) => {
    mocks.kclInputChanges.set(name, onChange)
    return (
      <input
        aria-label={name}
        value={value}
        onChange={(event) =>
          onChange({ source: 'edit', value: event.target.value })
        }
      />
    )
  },
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
import { normalizeExtrudeDialogArguments } from '@src/lib/commandBarConfigs/extrudeDialog'
import { ModelingDialogViewExtension } from '@src/registry/extensions/engineScene/ModelingDialogViewExtension'

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
    mocks.kclInputChanges.clear()
    mocks.kclManager.showPlanes.mockReset().mockResolvedValue()
    mocks.kclManager.hidePlanes.mockReset().mockResolvedValue()
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
      commandInvocationId: 1,
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
        commandInvocationId: mocks.state.context.commandInvocationId,
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

  it('loads the next feature values when the same command is opened again', async () => {
    const sharedCommand = command('Extrude')
    const nextTarget = [
      ['body', 'Program'],
      [1, 'index'],
    ]
    mocks.state.context = {
      ...mocks.state.context,
      selectedCommand: sharedCommand,
      argumentsToSubmit: {
        label: 'First feature',
        nodeToEdit: [
          ['body', 'Program'],
          [0, 'index'],
        ],
      },
    }
    const { rerender } = render(<ModelingDialogViewExtension />)
    await act(async () => resolveWasm({}))
    const input = screen.getByRole('textbox')
    expect(input).toHaveValue('First feature')
    fireEvent.change(input, { target: { value: 'First feature draft' } })

    mocks.state = {
      ...mocks.state,
      context: {
        ...mocks.state.context,
        commandInvocationId: 2,
        argumentsToSubmit: { label: 'Second feature', nodeToEdit: nextTarget },
      },
    }
    rerender(<ModelingDialogViewExtension />)
    await act(async () => {})
    expect(screen.getByRole('textbox')).toHaveValue('Second feature')
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await act(async () => {})

    expect(mocks.send).toHaveBeenCalledWith({
      type: 'Submit command from dialog',
      data: {
        command: sharedCommand,
        commandInvocationId: 2,
        argumentsToSubmit: { label: 'Second feature', nodeToEdit: nextTarget },
      },
    })
  })

  it('cancels a pending submission when another feature uses the same command', async () => {
    const sharedCommand = command('Extrude')
    mocks.state.context = {
      ...mocks.state.context,
      selectedCommand: sharedCommand,
      argumentsToSubmit: {
        label: 'First feature',
        nodeToEdit: [
          ['body', 'Program'],
          [0, 'index'],
        ],
      },
    }
    const { rerender } = render(<ModelingDialogViewExtension />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    mocks.state = {
      ...mocks.state,
      context: {
        ...mocks.state.context,
        commandInvocationId: 2,
        argumentsToSubmit: {
          label: 'Second feature',
          nodeToEdit: [
            ['body', 'Program'],
            [1, 'index'],
          ],
        },
      },
    }
    rerender(<ModelingDialogViewExtension />)
    await act(async () => resolveWasm({}))

    expect(mocks.send).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox')).toHaveValue('Second feature')
    expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled()
  })

  it.each(['calculation', 'edit'] as const)(
    'only preserves user edits when KCL defaults load after a %s update',
    async (source) => {
      mocks.state.context.selectedCommand = {
        ...command(),
        args: {
          length: { inputType: 'kcl', required: true, defaultValue: '10' },
        },
      }
      render(<ModelingDialog />)
      act(() => {
        mocks.kclInputChanges.get('length')?.({ source, value: '27' })
      })
      await act(async () => resolveWasm({}))

      expect(screen.getByRole('textbox', { name: 'length' })).toHaveValue(
        source === 'edit' ? '27' : '10'
      )
    }
  )

  it('preserves an inactive KCL draft when changing Extrude extent', async () => {
    mocks.state.context.selectedCommand = {
      ...command('Extrude'),
      dialogLayout: {
        groups: [],
        normalizeArguments: normalizeExtrudeDialogArguments,
      },
      args: {
        extentType: {
          inputType: 'options',
          required: true,
          defaultValue: 'distance',
          options: [
            { name: 'Distance', value: 'distance' },
            { name: 'To face', value: 'toFace' },
          ],
          dialog: { controlStyle: 'segmented' },
        },
        length: {
          inputType: 'kcl',
          required: ({ argumentsToSubmit }) =>
            argumentsToSubmit.extentType === 'distance',
          hidden: ({ argumentsToSubmit }) =>
            argumentsToSubmit.extentType === 'toFace',
          defaultValue: '10',
        },
      },
    }
    render(<ModelingDialog />)
    await act(async () => resolveWasm({}))
    fireEvent.change(screen.getByRole('textbox', { name: 'length' }), {
      target: { value: '27mm' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'To face' }))
    expect(
      screen.queryByRole('textbox', { name: 'length' })
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Distance' }))

    expect(screen.getByRole('textbox', { name: 'length' })).toHaveValue('27mm')
  })

  it('repairs dependent export options and removes unsupported hidden values', async () => {
    mocks.state.context.selectedCommand = {
      ...command('Export'),
      args: {
        type: {
          inputType: 'options',
          displayName: 'Format',
          required: true,
          defaultValue: 'gltf',
          options: [
            { name: 'glTF', value: 'gltf' },
            { name: 'STL', value: 'stl' },
            { name: 'OBJ', value: 'obj' },
          ],
          dialog: { controlStyle: 'segmented' },
        },
        storage: {
          inputType: 'options',
          displayName: 'Encoding',
          skip: true,
          required: ({ argumentsToSubmit }) => argumentsToSubmit.type !== 'obj',
          hidden: ({ argumentsToSubmit }) => argumentsToSubmit.type === 'obj',
          defaultValue: ({ argumentsToSubmit }: CommandBarContext) =>
            argumentsToSubmit.type === 'gltf' ? 'embedded' : 'ascii',
          options: ({ argumentsToSubmit }) =>
            argumentsToSubmit.type === 'gltf'
              ? [{ name: 'Embedded', value: 'embedded', isCurrent: true }]
              : argumentsToSubmit.type === 'stl'
                ? [
                    { name: 'Binary', value: 'binary' },
                    { name: 'ASCII', value: 'ascii', isCurrent: true },
                  ]
                : [],
        },
      },
    }
    render(<ModelingDialog />)
    await act(async () => resolveWasm({}))
    expect(
      screen.getByRole('combobox', { name: /Encoding/ })
    ).toHaveDisplayValue('Embedded')
    fireEvent.click(screen.getByRole('button', { name: 'STL' }))
    expect(
      screen.getByRole('combobox', { name: /Encoding/ })
    ).toHaveDisplayValue('ASCII')
    fireEvent.change(screen.getByRole('combobox', { name: /Encoding/ }), {
      target: { value: '0' },
    })
    expect(
      screen.getByRole('combobox', { name: /Encoding/ })
    ).toHaveDisplayValue('Binary')
    fireEvent.click(screen.getByRole('button', { name: 'OBJ' }))
    expect(
      screen.queryByRole('combobox', { name: /Encoding/ })
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await act(async () => {})

    expect(mocks.send).toHaveBeenCalledWith({
      type: 'Submit command from dialog',
      data: {
        command: mocks.state.context.selectedCommand,
        commandInvocationId: mocks.state.context.commandInvocationId,
        argumentsToSubmit: { type: 'obj', storage: undefined },
      },
    })
  })

  it('submits the selected printer after an equivalent object listing refresh', async () => {
    let machines = [
      { id: 'Printer 1', state: 'idle' },
      { id: 'Printer 2', state: 'idle' },
    ]
    mocks.state.context.selectedCommand = {
      ...command('Make'),
      args: {
        machine: {
          inputType: 'options',
          required: true,
          defaultValue: () => machines[0],
          options: () =>
            machines.map((machine) => ({ name: machine.id, value: machine })),
        },
      },
    }
    const { rerender } = render(<ModelingDialog />)
    await act(async () => resolveWasm({}))
    const input = screen.getByRole('combobox', { name: /Machine/ })
    fireEvent.change(input, { target: { value: '1' } })
    expect(input).toHaveDisplayValue('Printer 2')

    machines = machines.map((machine) => ({ ...machine }))
    rerender(<ModelingDialog />)
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await act(async () => {})

    expect(mocks.send).toHaveBeenCalledWith({
      type: 'Submit command from dialog',
      data: {
        command: mocks.state.context.selectedCommand,
        commandInvocationId: mocks.state.context.commandInvocationId,
        argumentsToSubmit: { machine: { id: 'Printer 2', state: 'idle' } },
      },
    })
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

  it('keeps selection planes visible when a new dialog invocation needs them', async () => {
    let planesVisible = false
    mocks.kclManager.showPlanes.mockImplementation(() => {
      planesVisible = true
      return Promise.resolve()
    })
    mocks.kclManager.hidePlanes.mockImplementation(() => {
      planesVisible = false
      return Promise.resolve()
    })
    mocks.state.context.selectedCommand = {
      ...command('Offset plane'),
      args: {
        plane: {
          inputType: 'selection',
          selectionTypes: ['plane'],
          multiple: false,
          required: false,
        },
      },
    }
    const { rerender } = render(<ModelingDialogViewExtension />)
    await act(async () => resolveWasm({}))
    expect(planesVisible).toBe(true)

    mocks.state = {
      ...mocks.state,
      context: { ...mocks.state.context, commandInvocationId: 2 },
    }
    rerender(<ModelingDialogViewExtension />)
    await act(async () => {})

    expect(planesVisible).toBe(true)
  })
})
