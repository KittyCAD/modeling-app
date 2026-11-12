import type * as ClientErrors from '@src/lib/clientErrors'
import {
  ExpectedFileOperationError,
  reportFileOperationError,
} from '@src/lib/fileSystem/operationErrors'
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

describe('file operation client error reporting', () => {
  beforeEach(() => {
    mocks.reportClientError.mockClear()
  })

  it('does not send filesystem paths from the original error', () => {
    const sensitivePath = '/Users/alice/Secret Project/main.kcl'
    const error = Object.assign(
      new Error(`EACCES: permission denied, open '${sensitivePath}'`),
      { code: 'EACCES' }
    )

    reportFileOperationError({
      error,
      operation: 'create blank file',
      risk: 'write',
      source: 'FileOperations',
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
      `    at actor (${sensitivePath}/projectOperations.ts:824:30)`,
    ].join('\n')

    reportFileOperationError({
      error,
      operation: 'apply_edits',
      risk: 'destructive',
      source: 'FileOperations',
    })

    const report = mocks.reportClientError.mock.calls[0]?.[0]
    expect(report).toMatchObject({
      error: expect.any(Error),
      errorName: 'Error',
      dedupeKey:
        'SystemIO:FileOperations:apply_edits:onFileSystemSuccess:Error:EACCES',
      extra: {
        errorCode: 'EACCES',
        errorType: 'Error',
        rootErrorName: 'Error',
        phase: 'onFileSystemSuccess',
      },
    })
    expect(report.error).not.toBe(error)
    expect(report.error.stack).toContain('at actor projectOperations.ts:824:30')
    expect(JSON.stringify(report)).not.toContain(sensitivePath)
    expect(JSON.stringify(report)).not.toContain(cause.message)
    expect(report.error.stack).not.toContain(sensitivePath)
  })

  it('does not treat a safe-looking raw error message as context', () => {
    const sensitiveFileName = 'secret-project.kcl'

    reportFileOperationError({
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

    reportFileOperationError({
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

    reportFileOperationError({
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
    reportFileOperationError({
      error: new ExpectedFileOperationError('Filename already exists.'),
      operation: 'rename',
      risk: 'destructive',
      source: 'FileOperations',
    })

    expect(mocks.reportClientError).not.toHaveBeenCalled()
  })

  it('does not report expected errors wrapped with operation context', () => {
    reportFileOperationError({
      error: new Error('sharedBulkCreateWorkflow', {
        cause: new ExpectedFileOperationError('Filename already exists.'),
      }),
      operation: 'rename',
      risk: 'destructive',
      source: 'FileOperations',
    })

    expect(mocks.reportClientError).not.toHaveBeenCalled()
  })
})
