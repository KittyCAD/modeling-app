import { StateEffect } from '@codemirror/state'
import type { Diagnostic } from '@codemirror/lint'
import { describe, expect, it, vi } from 'vitest'

import {
  createKclManagerTestHarness,
  getLatestDispatchedDiagnostics,
} from '@src/lang/testHelpers/kclManagerTestHarness'

function createDiagnostic(
  from: number,
  to: number,
  message: string
): Diagnostic {
  return {
    from,
    to,
    message,
    severity: 'error',
  }
}

describe('KclManager diagnostics', () => {
  it('filters out duplicated diagnostics', () => {
    const { kclManager } = createKclManagerTestHarness()

    const duplicatedDiagnostics: Diagnostic[] = [
      {
        from: 2,
        to: 10,
        severity: 'hint',
        message: 'my cool message',
      },
      {
        from: 2,
        to: 10,
        severity: 'hint',
        message: 'my cool message',
      },
      {
        from: 2,
        to: 10,
        severity: 'hint',
        message: 'my cool message',
      },
    ]

    expect(
      kclManager.makeUniqueDiagnostics(duplicatedDiagnostics)
    ).toStrictEqual([duplicatedDiagnostics[0]])
  })

  it('filters duplicated diagnostics while preserving distinct ones', () => {
    const { kclManager } = createKclManagerTestHarness()

    const duplicatedDiagnostics: Diagnostic[] = [
      {
        from: 0,
        to: 10,
        severity: 'hint',
        message: 'my cool message',
      },
      {
        from: 0,
        to: 10,
        severity: 'hint',
        message: 'my cool message',
      },
      {
        from: 88,
        to: 99,
        severity: 'hint',
        message: 'my super cool message',
      },
    ]

    expect(
      kclManager.makeUniqueDiagnostics(duplicatedDiagnostics)
    ).toStrictEqual([duplicatedDiagnostics[0], duplicatedDiagnostics[2]])
  })

  it('filters out diagnostics whose ranges are outside the current document', () => {
    const { kclManager } = createKclManagerTestHarness('abcd')
    const dispatchSpy = vi.spyOn(kclManager.editorView, 'dispatch')

    const validDiagnostic = createDiagnostic(0, 2, 'valid')
    const staleDiagnostic = createDiagnostic(3, 5, 'stale')

    kclManager.setDiagnostics([validDiagnostic, staleDiagnostic])

    expect(getLatestDispatchedDiagnostics(dispatchSpy.mock.calls)).toEqual([
      validDiagnostic,
    ])
  })

  it('drops stale diagnostics after deleting code while diagnostics are present', () => {
    const { kclManager } = createKclManagerTestHarness('0123456789')
    const dispatchSpy = vi.spyOn(kclManager.editorView, 'dispatch')

    const baseDiagnostic = createDiagnostic(0, 2, 'base diagnostic')
    const staleBaseDiagnostic = createDiagnostic(8, 10, 'stale base diagnostic')
    const sketchSolveDiagnostic = createDiagnostic(
      2,
      3,
      'sketch solve diagnostic'
    )
    const staleSketchSolveDiagnostic = createDiagnostic(
      7,
      9,
      'stale sketch solve diagnostic'
    )

    kclManager.diagnostics = [baseDiagnostic, staleBaseDiagnostic]
    kclManager.setSketchSolveDiagnostics([
      sketchSolveDiagnostic,
      staleSketchSolveDiagnostic,
    ])

    expect(() =>
      kclManager.updateCodeEditor('012', {
        shouldExecute: false,
        shouldWriteToDisk: false,
        shouldResetCamera: false,
      })
    ).not.toThrow()

    expect(getLatestDispatchedDiagnostics(dispatchSpy.mock.calls)).toEqual([
      baseDiagnostic,
      sketchSolveDiagnostic,
    ])
  })

  it('deduplicates identical diagnostics across base and sketch-solve layers', () => {
    const { kclManager } = createKclManagerTestHarness('abcdef')
    const dispatchSpy = vi.spyOn(kclManager.editorView, 'dispatch')

    const duplicateDiagnostic = createDiagnostic(1, 4, 'duplicate')

    kclManager.diagnostics = [duplicateDiagnostic]
    kclManager.setSketchSolveDiagnostics([duplicateDiagnostic])

    expect(getLatestDispatchedDiagnostics(dispatchSpy.mock.calls)).toEqual([
      duplicateDiagnostic,
    ])
  })

  it('writes to file when the code is unchanged and shouldWriteToDisk is true', () => {
    const { kclManager } = createKclManagerTestHarness('persist me')
    const writeToFileSpy = vi
      .spyOn(kclManager, 'writeToFile')
      .mockResolvedValue(undefined)

    const currentCode = kclManager.code
    kclManager.updateCodeEditor(currentCode, {
      shouldWriteToDisk: true,
      shouldExecute: false,
      shouldResetCamera: false,
    })

    expect(writeToFileSpy).toHaveBeenCalledWith(currentCode)
  })

  it('does not write to file when the code is unchanged and shouldWriteToDisk is false', () => {
    const { kclManager } = createKclManagerTestHarness('persist me')
    const writeToFileSpy = vi
      .spyOn(kclManager, 'writeToFile')
      .mockResolvedValue(undefined)

    const currentCode = kclManager.code
    kclManager.updateCodeEditor(currentCode, {
      shouldWriteToDisk: false,
      shouldExecute: false,
      shouldResetCamera: false,
    })

    expect(writeToFileSpy).not.toHaveBeenCalled()
  })

  it('dispatches additional effects when creating a checkpoint-only history commit', () => {
    const { kclManager } = createKclManagerTestHarness('persist me')
    const dispatchSpy = vi.spyOn(kclManager.editorView, 'dispatch')
    const testEffect = StateEffect.define<string>()
    const effectInstance = testEffect.of('scene-update')

    kclManager.updateCodeEditor(
      'persist me',
      {
        shouldAddToHistory: true,
        shouldWriteToDisk: false,
        shouldExecute: false,
        shouldResetCamera: false,
      },
      {
        sketchCheckpointId: 42,
        effects: [effectInstance],
      }
    )

    expect(
      dispatchSpy.mock.calls.some((call) => {
        const spec = call[0]
        if (!spec || typeof spec !== 'object' || !('effects' in spec)) {
          return false
        }

        const effects = Array.isArray(spec.effects)
          ? spec.effects
          : [spec.effects]
        return effects.some((effect) => effect === effectInstance)
      })
    ).toBe(true)
  })
})
