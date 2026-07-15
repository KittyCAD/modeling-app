import {
  canDuplicateLocalProject,
  projectHasReadAccess,
} from '@src/lib/projectPermissions'
import { describe, expect, it } from 'vitest'

describe('project permissions', () => {
  it('treats a readable read-only project as a valid copy source', () => {
    const project = {
      localProjectName: 'source',
      localProjectPath: '/projects/source',
      readAccess: true,
      readWriteAccess: false,
    }

    expect(projectHasReadAccess(project)).toBe(true)
    expect(canDuplicateLocalProject(project, true)).toBe(true)
  })

  it('rejects unreadable sources and unavailable destinations', () => {
    const unreadableProject = {
      localProjectName: 'source',
      localProjectPath: '/projects/source',
      readAccess: false,
      readWriteAccess: false,
    }

    expect(canDuplicateLocalProject(unreadableProject, true)).toBe(false)
    expect(
      canDuplicateLocalProject(
        { ...unreadableProject, readAccess: true },
        false
      )
    ).toBe(false)
  })

  it('falls back to the combined permission for older project records', () => {
    expect(
      projectHasReadAccess({
        readWriteAccess: true,
      })
    ).toBe(true)
    expect(
      projectHasReadAccess({
        readWriteAccess: false,
      })
    ).toBe(false)
  })
})
