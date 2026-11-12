import { ensureDirectory } from '@src/lib/fileSystem/ensureDirectory'
import { FileAlreadyExists } from '@src/lib/fileSystem/fileSystem'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import { describe, expect, it, vi } from 'vitest'

function existingPathError(path: string) {
  return new FileAlreadyExists({
    operation: 'create-directory',
    path,
    cause: 'EEXIST',
    message: `Unable to create-directory ${path}`,
  })
}

describe('ensureDirectory', () => {
  it('creates a missing directory', async () => {
    const createDirectory = vi.fn().mockResolvedValue(undefined)
    const fileOperations = {
      createDirectory,
      stat: vi.fn(),
    } as unknown as FileOperationsRegistryService

    await ensureDirectory(fileOperations, '/projects/demo')

    expect(createDirectory).toHaveBeenCalledWith('/projects/demo')
    expect(fileOperations.stat).not.toHaveBeenCalled()
  })

  it('accepts an existing directory', async () => {
    const fileOperations = {
      createDirectory: vi
        .fn()
        .mockRejectedValue(existingPathError('/projects/demo')),
      stat: vi.fn().mockResolvedValue({ kind: 'directory' }),
    } as unknown as FileOperationsRegistryService

    await expect(
      ensureDirectory(fileOperations, '/projects/demo')
    ).resolves.toBeUndefined()
  })

  it('rejects an existing file at the requested directory path', async () => {
    const collision = existingPathError('/projects/demo')
    const fileOperations = {
      createDirectory: vi.fn().mockRejectedValue(collision),
      stat: vi.fn().mockResolvedValue({ kind: 'file' }),
    } as unknown as FileOperationsRegistryService

    await expect(
      ensureDirectory(fileOperations, '/projects/demo')
    ).rejects.toBe(collision)
  })
})
