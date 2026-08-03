import type * as ClientErrors from '@src/lib/clientErrors'
import { ExpectedSystemIOError } from '@src/lib/systemIOErrorReporting'
import { reportSystemIOMachineError } from '@src/machines/systemIO/reporting'
import type { SystemIOContext } from '@src/machines/systemIO/utils'
import { SystemIOMachineActors } from '@src/machines/systemIO/utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  reportClientError: vi.fn(),
}))

vi.mock('@src/lib/clientErrors', async (importOriginal) => {
  const original = await importOriginal<typeof ClientErrors>()
  return {
    ...original,
    reportClientError: mocks.reportClientError,
  }
})

const context = {
  projectDirectoryPath: '/projects',
  hasListedProjects: true,
  folders: [{}, {}],
} as SystemIOContext

const operationCases = [
  {
    operation: SystemIOMachineActors.deleteProject,
    risk: 'destructive',
    partialMutationPossible: true,
    dataLossPossible: true,
  },
  {
    operation: SystemIOMachineActors.duplicateProject,
    risk: 'write',
    partialMutationPossible: true,
    dataLossPossible: undefined,
  },
  {
    operation: SystemIOMachineActors.createBlankFolder,
    risk: 'write',
    partialMutationPossible: true,
    dataLossPossible: undefined,
  },
  {
    operation: SystemIOMachineActors.renameFile,
    risk: 'destructive',
    partialMutationPossible: true,
    dataLossPossible: true,
  },
] as const

describe('SystemIO client error reporting', () => {
  beforeEach(() => {
    mocks.reportClientError.mockClear()
  })

  it.each(operationCases)(
    'classifies $operation failures',
    ({ operation, risk, partialMutationPossible, dataLossPossible }) => {
      const error = new Error('operation failed')

      reportSystemIOMachineError({
        context,
        event: {
          type: `xstate.error.actor.${operation}`,
          error,
        },
      })

      expect(mocks.reportClientError).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'system_io_error',
          error,
          extra: expect.objectContaining({
            source: 'SystemIOMachine',
            operation,
            risk,
            partialMutationPossible,
            ...(dataLossPossible === undefined ? {} : { dataLossPossible }),
            hasProjectDirectory: true,
            hasListedProjects: true,
            projectCount: 2,
          }),
        })
      )
    }
  )

  it('does not report expected user naming conflicts', () => {
    reportSystemIOMachineError({
      context,
      event: {
        type: `xstate.error.actor.${SystemIOMachineActors.renameFile}`,
        error: new ExpectedSystemIOError('Filename already exists.'),
      },
    })

    expect(mocks.reportClientError).not.toHaveBeenCalled()
  })
})
