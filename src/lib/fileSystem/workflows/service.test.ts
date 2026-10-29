import { createFileWorkflows } from '@src/lib/fileSystem/workflows/service'
import { testFileOperations } from '@src/lib/fileSystem/testRuntime'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  copy: vi.fn(),
  read: vi.fn(async () => []),
  access: vi.fn(async () => ({ value: true, error: undefined })),
}))
vi.mock('@src/lib/fileSystem/workflows/actions', () => ({
  workflowActions: {
    'copy recursive': mocks.copy,
    'read folders from project directory': mocks.read,
    'check read write': mocks.access,
  },
}))
vi.mock('@src/lib/fileSystem/workflows/errorReporting', () => ({
  reportSystemIOError: vi.fn(),
}))

const create = () =>
  createFileWorkflows({
    fileOperations: testFileOperations,
    project: undefined,
    wasmPromise: Promise.resolve({} as ModuleType),
  })

describe('async file workflows', () => {
  it('queues operations and captures the target directory at submission', async () => {
    const service = create()
    await service.setProjectDirectoryPath({
      requestedProjectDirectoryPath: '/first',
    })
    const gate = Promise.withResolvers<undefined>()
    const roots: string[] = []
    mocks.copy.mockImplementationOnce(async ({ input }) => {
      roots.push(input.context.projectDirectoryPath)
      await gate.promise
      return { message: '' }
    })
    mocks.copy.mockImplementationOnce(async ({ input }) => {
      roots.push(input.context.projectDirectoryPath)
      return { message: '' }
    })
    const first = service.copyRecursive({ src: '/first/a', target: '/first/b' })
    const second = service.copyRecursive({
      src: '/first/c',
      target: '/first/d',
    })
    const switchDirectory = service.setProjectDirectoryPath({
      requestedProjectDirectoryPath: '/second',
    })
    gate.resolve(undefined)
    await Promise.all([first, second, switchDirectory])
    expect(roots).toEqual(['/first', '/first'])
    expect(service.state.value.projectDirectoryPath).toBe('/second')
    expect(service.status.value).toBe('idle')
  })

  it('rejects failed operations and continues accepting work', async () => {
    const service = create()
    mocks.copy.mockRejectedValueOnce(new Error('Write failed'))
    await expect(
      service.copyRecursive({ src: '/a', target: '/b' })
    ).rejects.toThrow('Write failed')
    mocks.copy.mockResolvedValueOnce({ message: '' })
    await service.copyRecursive({ src: '/c', target: '/d' })
    await service.whenIdle()
    expect(service.status.value).toBe('idle')
  })
})
