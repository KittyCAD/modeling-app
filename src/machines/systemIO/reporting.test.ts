import type * as ClientErrors from '@src/lib/clientErrors'
import {
  ExpectedSystemIOError,
  reportSystemIOError,
} from '@src/machines/systemIO/errorReporting'
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

vi.mock('@src/lib/wasm_lib_wrapper', () => ({}))

const context = {
  projectDirectoryPath: '/projects',
  hasListedProjects: true,
  folders: [{}, {}],
} as SystemIOContext

const operationCases = [
  {
    operation: SystemIOMachineActors.deleteProject,
    risk: 'destructive',
  },
  {
    operation: SystemIOMachineActors.duplicateProject,
    risk: 'write',
  },
  {
    operation: SystemIOMachineActors.createBlankFolder,
    risk: 'write',
  },
  {
    operation: SystemIOMachineActors.renameFile,
    risk: 'destructive',
  },
] as const

describe('SystemIO client error reporting', () => {
  beforeEach(() => {
    mocks.reportClientError.mockClear()
  })

  it.each(operationCases)(
    'classifies $operation failures',
    ({ operation, risk }) => {
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
          errorName: 'Error',
          extra: expect.objectContaining({
            source: 'SystemIOMachine',
            operation,
            risk,
            errorType: 'Error',
            hasProjectDirectory: true,
            hasListedProjects: true,
            projectCount: 2,
          }),
        })
      )
    }
  )

  it('does not send filesystem paths from the original error', () => {
    const sensitivePath = '/Users/alice/Secret Project/main.kcl'
    const error = Object.assign(
      new Error(`EACCES: permission denied, open '${sensitivePath}'`),
      { code: 'EACCES' }
    )

    reportSystemIOMachineError({
      context,
      event: {
        type: `xstate.error.actor.${SystemIOMachineActors.createBlankFile}`,
        error,
      },
    })

    const report = mocks.reportClientError.mock.calls[0]?.[0]
    expect(report).toMatchObject({
      code: 'system_io_error',
      errorName: 'Error',
      message: 'SystemIO write operation failed during create blank file.',
      extra: {
        errorCode: 'EACCES',
        errorType: 'Error',
      },
    })
    expect(report).not.toHaveProperty('error')
    expect(JSON.stringify(report)).not.toContain(sensitivePath)
    expect(JSON.stringify(report)).not.toContain(error.message)
  })

  it('reports context and safe cause details with a privacy-safe stack', () => {
    const sensitivePath = '/Users/alice/Secret Project/main.kcl'
    const cause = Object.assign(
      new Error(`EACCES: permission denied, open '${sensitivePath}'`),
      { code: 'EACCES' }
    )
    const error = new Error('onFileSystemSuccess', { cause })
    error.stack = [
      'Error: onFileSystemSuccess',
      `    at actor (${sensitivePath}/systemIOMachineImpl.ts:824:30)`,
    ].join('\n')

    reportSystemIOMachineError({
      context,
      event: {
        type: `xstate.error.actor.${SystemIOMachineActors.bulkCreateAndDeleteKCLFilesAndNavigateToFile}`,
        error,
      },
    })

    const report = mocks.reportClientError.mock.calls[0]?.[0]
    expect(report).toMatchObject({
      error: expect.any(Error),
      errorName: 'Error',
      dedupeKey:
        'SystemIO:SystemIOMachine:bulk create and delete kcl files and navigate to file:onFileSystemSuccess:Error:EACCES',
      extra: {
        errorCode: 'EACCES',
        errorType: 'Error',
        rootErrorName: 'Error',
        phase: 'onFileSystemSuccess',
      },
    })
    expect(report.error).not.toBe(error)
    expect(report.error.stack).toContain(
      'at actor systemIOMachineImpl.ts:824:30'
    )
    expect(JSON.stringify(report)).not.toContain(sensitivePath)
    expect(JSON.stringify(report)).not.toContain(cause.message)
    expect(report.error.stack).not.toContain(sensitivePath)
  })

  it('does not treat a safe-looking raw error message as context', () => {
    const sensitiveFileName = 'secret-project.kcl'

    reportSystemIOError({
      error: new Error(sensitiveFileName),
      operation: 'read project',
      risk: 'read',
      source: 'SystemIOTest',
    })

    const report = mocks.reportClientError.mock.calls[0]?.[0]
    expect(report.dedupeKey).toBe(
      'SystemIO:SystemIOTest:read project:unknown:Error:unknown'
    )
    expect(report).not.toHaveProperty('error')
    expect(report.extra).not.toHaveProperty('phase')
    expect(JSON.stringify(report)).not.toContain(sensitiveFileName)
  })

  it('does not treat a primitive cause as an error code', () => {
    const sensitiveFileName = 'secret-project.kcl'

    reportSystemIOError({
      error: new Error('sharedBulkDeleteWorkflow', {
        cause: sensitiveFileName,
      }),
      operation: 'write project',
      risk: 'write',
      source: 'SystemIOTest',
    })

    const report = mocks.reportClientError.mock.calls[0]?.[0]
    expect(report.dedupeKey).toBe(
      'SystemIO:SystemIOTest:write project:sharedBulkDeleteWorkflow:Error:unknown'
    )
    expect(report.extra).not.toHaveProperty('errorCode')
    expect(JSON.stringify(report)).not.toContain(sensitiveFileName)
  })

  it('drops unrecognized phase labels', () => {
    const sensitivePhase = '/Users/alice/Secret Project'

    reportSystemIOError({
      error: new Error('operation failed'),
      operation: 'read project',
      risk: 'read',
      source: 'SystemIOTest',
      extra: { phase: sensitivePhase },
    })

    const report = mocks.reportClientError.mock.calls[0]?.[0]
    expect(report.dedupeKey).toBe(
      'SystemIO:SystemIOTest:read project:unknown:Error:unknown'
    )
    expect(report.extra).not.toHaveProperty('phase')
    expect(JSON.stringify(report)).not.toContain(sensitivePhase)
  })

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

  it('does not report expected errors wrapped with operation context', () => {
    reportSystemIOMachineError({
      context,
      event: {
        type: `xstate.error.actor.${SystemIOMachineActors.renameFile}`,
        error: new Error('sharedBulkCreateWorkflow', {
          cause: new ExpectedSystemIOError('Filename already exists.'),
        }),
      },
    })

    expect(mocks.reportClientError).not.toHaveBeenCalled()
  })
})
