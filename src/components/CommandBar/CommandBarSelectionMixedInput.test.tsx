import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

import CommandBarSelectionMixedInput from '@src/components/CommandBar/CommandBarSelectionMixedInput'
import type { CommandArgument } from '@src/lib/commandTypes'

vi.mock('@src/lib/singletons', () => {
  const mockModelingSend = vi.fn()
  return {
    engineCommandManager: { modelingSend: mockModelingSend },
    kclManager: {
      setSelectionFilter: vi.fn(),
      defaultSelectionFilter: vi.fn(),
      wasmInstancePromise: vi.importActual(
        '@rust/kcl-wasm-lib/pkg/kcl_wasm_lib'
      ),
    },
    commandBarActor: { send: vi.fn() },
    useCommandBarState: () => ({ context: { argumentsToSubmit: {} } }),
  }
})

vi.mock('@xstate/react', () => ({
  useSelector: () => ({ graphSelections: [], otherSelections: [] }),
}))

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
  })

  describe('clearSelectionFirst behavior', () => {
    it('should send clear selection command when clearSelectionFirst is true', async () => {
      const { engineCommandManager, kclManager } = await import(
        '@src/lib/singletons'
      )
      const mockModelingSend = vi.mocked(engineCommandManager.modelingSend)

      const arg = createArg(true)

      render(
        <CommandBarSelectionMixedInput
          arg={arg}
          stepBack={mockProps.stepBack}
          onSubmit={mockProps.onSubmit}
        />
      )

      await waitFor(async () => {
        await kclManager.wasmInstancePromise
        expect(mockModelingSend).toHaveBeenCalledWith({
          type: 'Set selection',
          data: { selectionType: 'singleCodeCursor' },
        })
      })
    })

    it('should NOT send clear selection command when clearSelectionFirst is false', async () => {
      const { engineCommandManager } = await import('@src/lib/singletons')
      const mockModelingSend = vi.mocked(engineCommandManager.modelingSend)

      const arg = createArg(false)

      render(
        <CommandBarSelectionMixedInput
          arg={arg}
          stepBack={mockProps.stepBack}
          onSubmit={mockProps.onSubmit}
        />
      )

      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(mockModelingSend).not.toHaveBeenCalled()
    })

    it('should NOT send clear selection command when clearSelectionFirst is undefined', async () => {
      const { engineCommandManager } = await import('@src/lib/singletons')
      const mockModelingSend = vi.mocked(engineCommandManager.modelingSend)

      const arg = createArg() // No argument = undefined

      render(
        <CommandBarSelectionMixedInput
          arg={arg}
          stepBack={mockProps.stepBack}
          onSubmit={mockProps.onSubmit}
        />
      )

      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(mockModelingSend).not.toHaveBeenCalled()
    })

    it('should send clear selection command only once on mount', async () => {
      const { engineCommandManager } = await import('@src/lib/singletons')
      const mockModelingSend = vi.mocked(engineCommandManager.modelingSend)

      const arg = createArg(true)

      const { rerender } = render(
        <CommandBarSelectionMixedInput
          arg={arg}
          stepBack={mockProps.stepBack}
          onSubmit={mockProps.onSubmit}
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
        />
      )

      // Should still be called only once
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(mockModelingSend).toHaveBeenCalledTimes(1)
    })

    it('should set hasClearedSelection state after clearing', async () => {
      const { engineCommandManager } = await import('@src/lib/singletons')
      const mockModelingSend = vi.mocked(engineCommandManager.modelingSend)

      const arg = createArg(true)

      render(
        <CommandBarSelectionMixedInput
          arg={arg}
          stepBack={mockProps.stepBack}
          onSubmit={mockProps.onSubmit}
        />
      )

      // Verify that the clear command was sent
      await waitFor(() => {
        expect(mockModelingSend).toHaveBeenCalledWith({
          type: 'Set selection',
          data: { selectionType: 'singleCodeCursor' },
        })
      })

      // The component should have set hasClearedSelection to true after clearing
      // This is tested indirectly by verifying the clear command was sent
      expect(mockModelingSend).toHaveBeenCalledTimes(1)
    })
  })
})
