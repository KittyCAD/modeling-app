import { describe, expect, it, vi } from 'vitest'
import { assertProjectPathWithoutSymlinks } from '@src/lib/fileSystem/projectPath'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'

vi.mock('@src/lib/fs-zds', async () => ({
  default: (await import('@chainner/node-path')).win32,
}))

const directory = {
  kind: 'directory' as const,
  device: 0,
  inode: 0,
  size: 0,
  accessedAt: 0,
  modifiedAt: 0,
  changedAt: 0,
  createdAt: 0,
}

describe('project path checks with Windows spelling', () => {
  it('stops at the project root when its drive and directory casing differ', async () => {
    const stat = vi
      .fn<FileOperationsRegistryService['stat']>()
      .mockResolvedValue(directory)
    await assertProjectPathWithoutSymlinks(
      { stat },
      'C:\\project',
      'c:\\PROJECT\\part.kcl'
    )
    expect(stat.mock.calls.map(([path]) => path)).toEqual([
      'c:\\PROJECT\\part.kcl',
      'c:\\PROJECT',
    ])
    expect(stat).toHaveBeenCalledWith('c:\\PROJECT', { followSymlinks: false })
  })

  it.each([
    'D:\\outside.kcl',
    'C:\\project-other\\part.kcl',
    'C:\\project\\..\\outside.kcl',
  ])('rejects outside path %s before inspecting storage', async (target) => {
    const stat = vi
      .fn<FileOperationsRegistryService['stat']>()
      .mockResolvedValue(directory)
    await expect(
      assertProjectPathWithoutSymlinks({ stat }, 'C:\\project', target)
    ).rejects.toThrow('outside its project')
    expect(stat).not.toHaveBeenCalled()
  })
})
