import toast from 'react-hot-toast'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { submitConstraintEdit } from '@src/clientSideScene/submitConstraintEdit'
import { SKETCH_FILE_VERSION } from '@src/lib/constants'
import { SKETCH_SOLVE_ERROR_TOAST_ID } from '@src/machines/sketchSolve/sketchSolveErrors'

describe('submitConstraintEdit', () => {
  const toastErrorSpy = vi.spyOn(toast, 'error').mockImplementation(() => '')
  const consoleErrorSpy = vi
    .spyOn(console, 'error')
    .mockImplementation(() => undefined)

  beforeEach(() => {
    toastErrorSpy.mockClear()
    consoleErrorSpy.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('toasts when editing a constraint fails', async () => {
    const editConstraint = vi
      .fn()
      .mockRejectedValue(new Error('Undefined variable: newDistance'))
    const sketchSolveActor = {
      getSnapshot: vi.fn(() => ({
        context: {
          editingConstraintId: 12,
          sketchId: 34,
        },
      })),
      send: vi.fn(),
    }

    await submitConstraintEdit({
      sketchSolveActor,
      rustContext: { editConstraint },
      editingConstraintId: 12,
      value: 'newDistance',
      settings: {},
    })

    expect(sketchSolveActor.send).toHaveBeenCalledTimes(1)
    expect(sketchSolveActor.send).toHaveBeenCalledWith({
      type: 'stop editing constraint',
    })
    expect(editConstraint).toHaveBeenCalledWith(
      SKETCH_FILE_VERSION,
      34,
      12,
      'newDistance',
      {},
      true
    )
    expect(toastErrorSpy).toHaveBeenCalledWith(
      'Undefined variable: newDistance',
      { id: SKETCH_SOLVE_ERROR_TOAST_ID }
    )
  })

  it('toasts the clean KCL message when editing a constraint fails', async () => {
    const editConstraint = vi.fn().mockRejectedValue(
      Object.assign(
        new Error('refactor: Invalid constraint value: Unexpected token: *'),
        {
          msg: 'Invalid constraint value: Unexpected token: *',
        }
      )
    )
    const sketchSolveActor = {
      getSnapshot: vi.fn(() => ({
        context: {
          editingConstraintId: 12,
          sketchId: 34,
        },
      })),
      send: vi.fn(),
    }

    await submitConstraintEdit({
      sketchSolveActor,
      rustContext: { editConstraint },
      editingConstraintId: 12,
      value: '**',
      settings: {},
    })

    expect(toastErrorSpy).toHaveBeenCalledWith(
      'Invalid constraint value: Unexpected token: *',
      { id: SKETCH_SOLVE_ERROR_TOAST_ID }
    )
  })
})
