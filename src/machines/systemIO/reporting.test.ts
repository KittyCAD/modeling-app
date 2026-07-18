import type * as ClientErrors from '@src/lib/clientErrors'
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

import {
  ExpectedSystemIOError,
  withSystemIOErrorMetadata,
} from '@src/lib/systemIOErrorReporting'
import { reportSystemIOMachineError } from '@src/machines/systemIO/reporting'

const context = {
  projectDirectoryPath: '/projects',
  hasListedProjects: true,
  folders: [{}, {}],
} as SystemIOContext

describe('SystemIO client error reporting', () => {
  beforeEach(() => {
    mocks.reportClientError.mockClear()
  })

  it('marks recursive deletion failures as destructive and data-loss-adjacent', () => {
    const error = new Error('delete failed')
    const event = {
      type: `xstate.error.actor.${SystemIOMachineActors.deleteProject}`,
      error,
    }

    reportSystemIOMachineError({ context, event })

    expect(mocks.reportClientError).toHaveBeenCalledWith({
      code: 'system_io_error',
      message: 'delete failed',
      error,
      dedupeKey: expect.any(String),
      extra: expect.objectContaining({
        source: 'SystemIOMachine',
        operation: SystemIOMachineActors.deleteProject,
        risk: 'destructive',
        partialMutationPossible: true,
        dataLossPossible: true,
        hasProjectDirectory: true,
        hasListedProjects: true,
        projectCount: 2,
      }),
    })
  })

  it('includes partial bulk-mutation progress from the actor error', () => {
    const originalError = new Error('third write failed')
    const error = withSystemIOErrorMetadata(originalError, {
      phase: 'write_file',
      attemptedCount: 3,
      completedCount: 2,
      totalCount: 4,
      overwriteRequested: true,
      partialMutationPossible: true,
      dataLossPossible: true,
    })
    const event = {
      type: `xstate.error.actor.${SystemIOMachineActors.bulkCreateAndDeleteKCLFilesAndNavigateToFile}`,
      error,
    }

    reportSystemIOMachineError({ context, event })

    expect(mocks.reportClientError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: originalError,
        extra: expect.objectContaining({
          phase: 'write_file',
          attemptedCount: 3,
          completedCount: 2,
          totalCount: 4,
          overwriteRequested: true,
        }),
      })
    )
  })

  it('preserves prior mutations when a later sub-step fails before mutating', () => {
    const originalError = new Error('delete preflight failed')
    const deleteError = withSystemIOErrorMetadata(originalError, {
      phase: 'collect_project_files',
      partialMutationPossible: false,
      dataLossPossible: false,
    })
    const workflowError = withSystemIOErrorMetadata(deleteError, {
      workflowPhase: 'delete_files',
      writeStageCompleted: true,
      partialMutationPossible: true,
      dataLossPossible: true,
    })

    reportSystemIOMachineError({
      context,
      event: {
        type: `xstate.error.actor.${SystemIOMachineActors.bulkCreateAndDeleteKCLFilesAndNavigateToFile}`,
        error: workflowError,
      },
    })

    expect(mocks.reportClientError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: originalError,
        extra: expect.objectContaining({
          phase: 'collect_project_files',
          workflowPhase: 'delete_files',
          writeStageCompleted: true,
          partialMutationPossible: true,
          dataLossPossible: true,
        }),
      })
    )
  })

  it('treats recursive OPFS-style renames as destructive', () => {
    reportSystemIOMachineError({
      context,
      event: {
        type: `xstate.error.actor.${SystemIOMachineActors.renameFile}`,
        error: new Error('rename failed'),
      },
    })

    expect(mocks.reportClientError).toHaveBeenCalledWith(
      expect.objectContaining({
        extra: expect.objectContaining({
          risk: 'destructive',
          partialMutationPossible: true,
          dataLossPossible: true,
        }),
      })
    )
  })

  it('does not report expected user naming conflicts', () => {
    const event = {
      type: `xstate.error.actor.${SystemIOMachineActors.renameFile}`,
      error: new ExpectedSystemIOError('Filename already exists.'),
    }

    reportSystemIOMachineError({ context, event })

    expect(mocks.reportClientError).not.toHaveBeenCalled()
  })
})
