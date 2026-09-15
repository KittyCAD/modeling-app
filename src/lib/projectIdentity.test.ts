import { PROJECT_SETTINGS_FILE_NAME } from '@src/lib/constants'
import fsZds from '@src/lib/fs-zds'
import { separateProjectsSharingProjectId } from '@src/lib/projectIdentity'
import { getProjectIdFromProjectTomlContents } from '@src/lib/projectTomlMetadata'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fsZdsMocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}))

const uuidMocks = vi.hoisted(() => ({
  values: ['new-project-id-1', 'new-project-id-2'],
}))

vi.mock('@src/lib/fs-zds', () => ({
  default: {
    join: (...parts: string[]) =>
      parts.reduce((left, right) => (left ? `${left}/${right}` : right), ''),
    readFile: fsZdsMocks.readFile,
    writeFile: fsZdsMocks.writeFile,
  },
}))

vi.mock('uuid', () => ({
  v4: vi.fn(() => uuidMocks.values.shift()),
}))

function projectToml(projectId: string) {
  return `title = "Project"\n\n[settings.meta]\nid = "${projectId}"\n`
}

function writtenProjectId(projectPath: string) {
  const projectTomlPath = `${projectPath}/${PROJECT_SETTINGS_FILE_NAME}`
  const write = fsZdsMocks.writeFile.mock.calls.find(
    ([path]) => path === projectTomlPath
  )
  if (!write) {
    return undefined
  }
  return getProjectIdFromProjectTomlContents(new TextDecoder().decode(write[1]))
}

describe('separateProjectsSharingProjectId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    uuidMocks.values = ['new-project-id-1', 'new-project-id-2']
    fsZdsMocks.readFile.mockResolvedValue(projectToml('shared-project-id'))
    fsZdsMocks.writeFile.mockResolvedValue(undefined)
  })

  it('keeps the selected project id and gives every other copy a new id', async () => {
    await expect(
      separateProjectsSharingProjectId({
        projectPaths: ['/projects/original', '/projects/copy'],
        keepProjectPath: '/projects/copy',
      })
    ).resolves.toEqual({ sharedProjectId: 'shared-project-id' })

    expect(writtenProjectId('/projects/original')).toBe('new-project-id-1')
    expect(writtenProjectId('/projects/copy')).toBeUndefined()
  })

  it('gives every copy a new id when no project keeps the history', async () => {
    await separateProjectsSharingProjectId({
      projectPaths: ['/projects/original', '/projects/copy'],
    })

    expect(writtenProjectId('/projects/original')).toBe('new-project-id-1')
    expect(writtenProjectId('/projects/copy')).toBe('new-project-id-2')
  })

  it('does not write if the folders no longer share one project id', async () => {
    fsZdsMocks.readFile
      .mockResolvedValueOnce(projectToml('project-id-1'))
      .mockResolvedValueOnce(projectToml('project-id-2'))

    await expect(
      separateProjectsSharingProjectId({
        projectPaths: ['/projects/original', '/projects/copy'],
      })
    ).rejects.toThrow('no longer share the same project ID')
    expect(fsZds.writeFile).not.toHaveBeenCalled()
  })
})
