import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { signal } from '@preact/signals-core'
import CommandBarSelectionMixedInput from '@src/components/CommandBar/CommandBarSelectionMixedInput'
import { KclManager } from '@src/lang/KclManager'
import { App } from '@src/lib/app'
import type { CommandArgument } from '@src/lib/commandTypes'

vi.mock(`@rust/kcl-wasm-lib/pkg/kcl_wasm_lib`)
vi.mock('@src/lang/wasmUtils', async () => {
  const realImport = await import('@src/lang/wasmUtils')
  // We have to mock this because it fetches by default
  const mockInitialiseWasm = () => import(`@rust/kcl-wasm-lib/pkg/kcl_wasm_lib`)
  return {
    ...realImport,
    initialiseWasm: mockInitialiseWasm,
  } satisfies typeof realImport
})

const mockUseSelector = vi.hoisted(() => vi.fn())

vi.mock('@xstate/react', () => ({ useSelector: mockUseSelector }))

vi.mock('@src/lib/selections', () => ({
  canSubmitSelectionArg: () => true,
  getSelectionCountByType: () => ({}),
  getSelectionTypeDisplayText: () => 'Test selection',
}))

describe('CommandBarSelectionMixedInput', () => {
  const mockProps = {
    stepBack: vi.fn(),
    onSubmit: vi.fn(),
  }

  const createArg = (
    clearSelectionFirst?: boolean
  ): CommandArgument<unknown> & {
    inputType: 'selectionMixed'
    name: string
  } => ({
    name: 'testArg',
    inputType: 'selectionMixed',
    selectionTypes: ['path'],
    multiple: true,
    required: true,
    ...(clearSelectionFirst !== undefined && { clearSelectionFirst }),
    machineActor: undefined,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseSelector.mockReturnValue({
      graphSelections: [],
      otherSelections: [],
    })
  })

  describe('clearSelectionFirst behavior', () => {
    it('should send clear selection command when clearSelectionFirst is true', async () => {
      const app = App.getDefaultSystems()
      const executingEditor = new KclManager('some-file', '', {
        commandBar: app.commands.actor,
        settings: app.settings.actor,
        wasmInstancePromise: app.wasmPromise,
        engineCommandManager: app.engineCommandManager,
        rustContext: app.rustContext,
        projectPath: signal('some-project'),
      })
      const mockModelingSend = vi.spyOn(
        executingEditor.engineCommandManager,
        'modelingSend'
      )
      const arg = createArg(true)

      render(
        <CommandBarSelectionMixedInput
          arg={arg}
          stepBack={mockProps.stepBack}
          onSubmit={mockProps.onSubmit}
          executingEditor={executingEditor}
        />
      )

      await waitFor(async () => {
        expect(mockModelingSend).toHaveBeenCalledWith({
          type: 'Set selection',
          data: { selectionType: 'singleCodeCursor' },
        })
      })
    })

    it('should NOT send clear selection command when clearSelectionFirst is false', async () => {
      const app = App.getDefaultSystems()
      const executingEditor = new KclManager('some-file', '', {
        commandBar: app.commands.actor,
        settings: app.settings.actor,
        wasmInstancePromise: app.wasmPromise,
        engineCommandManager: app.engineCommandManager,
        rustContext: app.rustContext,
        projectPath: signal('some-project'),
      })
      const mockModelingSend = vi.spyOn(
        executingEditor.engineCommandManager,
        'modelingSend'
      )

      const arg = createArg(false)

      render(
        <CommandBarSelectionMixedInput
          arg={arg}
          stepBack={mockProps.stepBack}
          onSubmit={mockProps.onSubmit}
          executingEditor={executingEditor}
        />
      )

      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(mockModelingSend).not.toHaveBeenCalled()
    })

    it('should NOT send clear selection command when clearSelectionFirst is undefined', async () => {
      const app = App.getDefaultSystems()
      const executingEditor = new KclManager('some-file', '', {
        commandBar: app.commands.actor,
        settings: app.settings.actor,
        wasmInstancePromise: app.wasmPromise,
        engineCommandManager: app.engineCommandManager,
        rustContext: app.rustContext,
        projectPath: signal('some-project'),
      })
      const mockModelingSend = vi.spyOn(
        executingEditor.engineCommandManager,
        'modelingSend'
      )

      const arg = createArg() // No argument = undefined

      render(
        <CommandBarSelectionMixedInput
          arg={arg}
          stepBack={mockProps.stepBack}
          onSubmit={mockProps.onSubmit}
          executingEditor={executingEditor}
        />
      )

      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(mockModelingSend).not.toHaveBeenCalled()
    })

    it('should send clear selection command only once on mount', async () => {
      const app = App.getDefaultSystems()
      const executingEditor = new KclManager('some-file', '', {
        commandBar: app.commands.actor,
        settings: app.settings.actor,
        wasmInstancePromise: app.wasmPromise,
        engineCommandManager: app.engineCommandManager,
        rustContext: app.rustContext,
        projectPath: signal('some-project'),
      })
      const mockModelingSend = vi.spyOn(
        executingEditor.engineCommandManager,
        'modelingSend'
      )

      const arg = createArg(true)

      const { rerender } = render(
        <CommandBarSelectionMixedInput
          arg={arg}
          stepBack={mockProps.stepBack}
          onSubmit={mockProps.onSubmit}
          executingEditor={executingEditor}
        />
      )

      await waitFor(() => {
        expect(mockModelingSend).toHaveBeenCalledTimes(1)
      })

      // Force a re-render
      rerender(
        <CommandBarSelectionMixedInput
          arg={arg}
          stepBack={mockProps.stepBack}
          onSubmit={mockProps.onSubmit}
          executingEditor={executingEditor}
        />
      )

      // Should still be called only once
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(mockModelingSend).toHaveBeenCalledTimes(1)
    })

    it('should send the clear request before awaiting the empty selection', async () => {
      const app = App.getDefaultSystems()
      const executingEditor = new KclManager('some-file', '', {
        commandBar: app.commands.actor,
        settings: app.settings.actor,
        wasmInstancePromise: app.wasmPromise,
        engineCommandManager: app.engineCommandManager,
        rustContext: app.rustContext,
        projectPath: signal('some-project'),
      })
      const mockModelingSend = vi.spyOn(
        executingEditor.engineCommandManager,
        'modelingSend'
      )

      const arg = createArg(true)

      render(
        <CommandBarSelectionMixedInput
          arg={arg}
          stepBack={mockProps.stepBack}
          onSubmit={mockProps.onSubmit}
          executingEditor={executingEditor}
        />
      )

      // Verify that the clear command was sent
      await waitFor(() => {
        expect(mockModelingSend).toHaveBeenCalledWith({
          type: 'Set selection',
          data: { selectionType: 'singleCodeCursor' },
        })
      })

      // The lifecycle tests below cover the actor's asynchronous selection update.
      expect(mockModelingSend).toHaveBeenCalledTimes(1)
    })

    it('does not submit the stale selection before the clear is observed', async () => {
      mockUseSelector.mockReturnValue({
        graphSelections: [
          {
            codeRef: {
              range: [0, 1, 0],
              pathToNode: [],
            },
          },
        ],
        otherSelections: [],
      })
      const app = App.getDefaultSystems()
      const executingEditor = new KclManager('some-file', '', {
        commandBar: app.commands.actor,
        settings: app.settings.actor,
        wasmInstancePromise: app.wasmPromise,
        engineCommandManager: app.engineCommandManager,
        rustContext: app.rustContext,
        projectPath: signal('some-project'),
      })
      const mockModelingSend = vi.spyOn(
        executingEditor.engineCommandManager,
        'modelingSend'
      )
      const arg = createArg(true)

      const { unmount } = render(
        <CommandBarSelectionMixedInput
          arg={arg}
          stepBack={mockProps.stepBack}
          onSubmit={mockProps.onSubmit}
          executingEditor={executingEditor}
        />
      )

      await waitFor(() => {
        expect(mockModelingSend).toHaveBeenCalledWith({
          type: 'Set selection',
          data: { selectionType: 'singleCodeCursor' },
        })
      })
      unmount()

      expect(mockProps.onSubmit).not.toHaveBeenCalled()
    })

    it('submits a new selection after the clear is observed', async () => {
      const previousSelection = {
        graphSelections: [
          {
            codeRef: {
              range: [0, 1, 0],
              pathToNode: [],
            },
          },
        ],
        otherSelections: [],
      }
      const toolSelection = {
        graphSelections: [
          {
            codeRef: {
              range: [2, 3, 0],
              pathToNode: [],
            },
          },
        ],
        otherSelections: [],
      }
      mockUseSelector.mockReturnValue(previousSelection)
      const app = App.getDefaultSystems()
      const executingEditor = new KclManager('some-file', '', {
        commandBar: app.commands.actor,
        settings: app.settings.actor,
        wasmInstancePromise: app.wasmPromise,
        engineCommandManager: app.engineCommandManager,
        rustContext: app.rustContext,
        projectPath: signal('some-project'),
      })
      const mockModelingSend = vi.spyOn(
        executingEditor.engineCommandManager,
        'modelingSend'
      )
      const arg = createArg(true)
      const component = () => (
        <CommandBarSelectionMixedInput
          arg={arg}
          stepBack={mockProps.stepBack}
          onSubmit={mockProps.onSubmit}
          executingEditor={executingEditor}
        />
      )

      const { rerender, unmount } = render(component())

      await waitFor(() => {
        expect(mockModelingSend).toHaveBeenCalledWith({
          type: 'Set selection',
          data: { selectionType: 'singleCodeCursor' },
        })
      })

      mockUseSelector.mockReturnValue({
        graphSelections: [],
        otherSelections: [],
      })
      rerender(component())
      mockUseSelector.mockReturnValue(toolSelection)
      rerender(component())
      unmount()

      expect(mockProps.onSubmit).toHaveBeenCalledTimes(1)
      expect(mockProps.onSubmit).toHaveBeenCalledWith(toolSelection)
    })
  })
})
