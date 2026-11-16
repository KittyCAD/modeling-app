import { deriveHomeProjectEntryContributions } from '@src/registry/extensions/homeProjects'
import type { ProjectLibraryRealization } from '@src/registry/contracts/projectLibraries'
import { describe, expect, it } from 'vitest'

const local = (path: string): ProjectLibraryRealization => ({
  id: `local:${path}`,
  localProjectPath: path,
  localProjectName: 'model',
  name: 'model',
  title: 'Model',
  projectId: 'd7f91fd7-8d23-48dd-a589-86e62a319ae2',
  cloudProjectId: 'historical-cloud-id',
  libraryIds: ['local'],
  libraryRefs: [],
  readWriteAccess: true,
})

describe('local Home project entries', () => {
  it('keeps local projects independent of historical cloud metadata', () => {
    const [entry] = deriveHomeProjectEntryContributions({
      realizations: [local('/projects/model')],
    })
    expect(entry.id).toBe('local:/projects/model')
    expect(entry.remoteProjectId).toBeUndefined()
    expect(entry.deleteRemoteOnDelete).toBe(false)
    expect(entry.status).toBe('local')
  })
  it('retains local project identity collision detection', () => {
    const entries = deriveHomeProjectEntryContributions({
      realizations: [local('/projects/model'), local('/copies/model')],
    })
    expect(entries[0].duplicateProjectIdPaths).toEqual(['/copies/model'])
    expect(entries[1].duplicateProjectIdPaths).toEqual(['/projects/model'])
  })
})
