import { PATHS } from '@src/lib/paths'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import {
  getOnboardingChildRoute,
  isRequestedFileLoaded,
} from '@src/lib/routeLoaders'
import { beforeAll, describe, expect, it } from 'vitest'

describe('route loader onboarding file navigation helpers', () => {
  const blankFilePath =
    '/documents/zoo-design-studio-projects/tutorial-project/blank.kcl'
  const mainFilePath =
    '/documents/zoo-design-studio-projects/tutorial-project/main.kcl'
  const projectPath = '/documents/zoo-design-studio-projects/tutorial-project'

  beforeAll(async () => {
    await moduleFsViaModuleImport({
      type: StorageName.NodeFS,
      options: {},
    })
  })

  it('preserves onboarding child routes when a requested onboarding file falls back', () => {
    expect(
      getOnboardingChildRoute(
        `http://localhost:3000${PATHS.FILE}/${encodeURIComponent(
          blankFilePath
        )}/onboarding/desktop/scene?foo=bar`,
        blankFilePath
      )
    ).toBe('/onboarding/desktop/scene')
  })

  it('does not preserve unrelated child routes during fallback', () => {
    expect(
      getOnboardingChildRoute(
        `http://localhost:3000${PATHS.FILE}/${encodeURIComponent(
          blankFilePath
        )}/settings`,
        blankFilePath
      )
    ).toBe('')
  })

  it('treats requested navigation as complete only when the exact file is loaded', () => {
    expect(
      isRequestedFileLoaded({
        requestedFileName: {
          project: 'tutorial-project',
          file: 'blank.kcl',
        },
        projectName: 'tutorial-project',
        projectPath,
        currentFilePath: blankFilePath,
      })
    ).toBe(true)
  })

  it('does not complete requested navigation after fallback loads the default file', () => {
    expect(
      isRequestedFileLoaded({
        requestedFileName: {
          project: 'tutorial-project',
          file: 'blank.kcl',
        },
        projectName: 'tutorial-project',
        projectPath,
        currentFilePath: mainFilePath,
      })
    ).toBe(false)
  })

  it('does not complete requested navigation for a different project', () => {
    expect(
      isRequestedFileLoaded({
        requestedFileName: {
          project: 'tutorial-project',
          file: 'blank.kcl',
        },
        projectName: 'other-project',
        projectPath,
        currentFilePath: blankFilePath,
      })
    ).toBe(false)
  })
})
