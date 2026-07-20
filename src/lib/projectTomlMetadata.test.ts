import {
  getCloudProjectIdFromProjectTomlContents,
  getProjectTitleFromProjectTomlContents,
  normalizeProjectTomlContents,
  preserveProjectTomlMetadataInProjectSettingsContents,
  removeCloudProjectIdFromProjectTomlContents,
  setCloudProjectIdInProjectTomlContents,
  setProjectTitleInProjectTomlContents,
} from '@src/lib/projectTomlMetadata'
import { describe, expect, it } from 'vitest'

function expectOrdered(contents: string, markers: string[]) {
  let previousIndex = -1
  for (const marker of markers) {
    const index = contents.indexOf(marker)
    expect(index, marker).toBeGreaterThan(previousIndex)
    previousIndex = index
  }
}

describe('projectTomlMetadata', () => {
  it('reads project title from the root title field', () => {
    expect(
      getProjectTitleFromProjectTomlContents(
        'title = "Some demo"\n\n[settings.meta]\nid = "project-123"\n'
      )
    ).toBe('Some demo')
  })

  it('does not read title from settings metadata', () => {
    expect(
      getProjectTitleFromProjectTomlContents(
        '[settings.meta]\ntitle = "Some demo"\n'
      )
    ).toBeUndefined()
  })

  it('writes project title without dropping existing project metadata', () => {
    const toml = setProjectTitleInProjectTomlContents(
      'default_file = "main.kcl"\n\n[custom]\nvalue = "kept"\n\n[cloud."zoo.dev"]\nproject_id = "project-123"\n',
      'Some demo'
    )

    expect(getProjectTitleFromProjectTomlContents(toml)).toBe('Some demo')
    expect(toml).toContain('title = "Some demo"')
    expect(toml).toContain('[custom]')
    expect(toml).toContain('value = "kept"')
    expect(getCloudProjectIdFromProjectTomlContents(toml, 'zoo.dev')).toBe(
      'project-123'
    )
    expect(toml).toContain('default_file = "main.kcl"')
  })

  it('preserves top-level project metadata when replacing project settings', () => {
    const toml = preserveProjectTomlMetadataInProjectSettingsContents(
      'title = "Some demo"\ndefault_file = "main.kcl"\n\n[cloud."dev.zoo.dev"]\nproject_id = "project-123"\n\n[settings.meta]\nid = "old-settings-id"\n',
      '[settings.meta]\nid = "new-settings-id"\n'
    )

    expect(toml).toContain('title = "Some demo"')
    expect(toml).toContain('default_file = "main.kcl"')
    expect(toml).toContain('[cloud."dev.zoo.dev"]')
    expect(toml).toContain('project_id = "project-123"')
    expect(toml).toContain('id = "new-settings-id"')
    expect(toml).not.toContain('old-settings-id')
  })

  it('normalizes project metadata table ordering', () => {
    const localOrder =
      'title = "demo-project"\ndefault_file = "main.kcl"\n\n[settings.meta]\nid = "settings-id"\n\n[settings.app]\n[settings.modeling]\n[cloud."dev.zoo.dev"]\nproject_id = "project-123"\n'
    const cloudOrder =
      'default_file = "main.kcl"\ntitle = "demo-project"\n\n[cloud."dev.zoo.dev"]\nproject_id = "project-123"\n\n[settings.app]\n[settings.meta]\nid = "settings-id"\n\n[settings.modeling]\n'
    const normalized = normalizeProjectTomlContents(localOrder)

    expect(normalized).toBe(normalizeProjectTomlContents(cloudOrder))
    expectOrdered(normalized, [
      'title = "demo-project"',
      'default_file = "main.kcl"',
      '[settings.app]',
      '[settings.meta]',
      '[settings.modeling]',
      '[cloud."dev.zoo.dev"]',
    ])
  })

  it('reads cloud project ids from environment-scoped metadata', () => {
    const toml =
      '[cloud."zoo.dev"]\nproject_id = "project-123"\n\n[cloud."dev.zoo.dev"]\nproject_id = "project-456"\n'

    expect(getCloudProjectIdFromProjectTomlContents(toml, 'dev.zoo.dev')).toBe(
      'project-456'
    )
    expect(getCloudProjectIdFromProjectTomlContents(toml)).toBe('project-123')
  })

  it('writes cloud project ids without dropping project settings', () => {
    const toml = setCloudProjectIdInProjectTomlContents(
      'title = "Some demo"\ndefault_file = "main.kcl"\n\n[settings.meta]\nid = "settings-id"\n',
      'zoo.dev',
      'project-123'
    )

    expect(getProjectTitleFromProjectTomlContents(toml)).toBe('Some demo')
    expect(getCloudProjectIdFromProjectTomlContents(toml, 'zoo.dev')).toBe(
      'project-123'
    )
    expect(toml).toContain('default_file = "main.kcl"')
    expectOrdered(toml, [
      'title = "Some demo"',
      'default_file = "main.kcl"',
      '[settings.meta]',
      '[cloud."zoo.dev"]',
    ])
  })

  it('updates existing cloud project ids for an environment', () => {
    const toml = setCloudProjectIdInProjectTomlContents(
      '[cloud."zoo.dev"]\nproject_id = "old-project"\n',
      'zoo.dev',
      'new-project'
    )

    expect(getCloudProjectIdFromProjectTomlContents(toml, 'zoo.dev')).toBe(
      'new-project'
    )
    expect(toml).not.toContain('old-project')
  })

  it('removes one cloud project id without dropping other metadata', () => {
    const toml = removeCloudProjectIdFromProjectTomlContents(
      'title = "Some demo"\ndefault_file = "main.kcl"\n\n[cloud."zoo.dev"]\nproject_id = "project-123"\n\n[cloud."dev.zoo.dev"]\nproject_id = "project-456"\n',
      'zoo.dev'
    )

    expect(getProjectTitleFromProjectTomlContents(toml)).toBe('Some demo')
    expect(
      getCloudProjectIdFromProjectTomlContents(toml, 'zoo.dev')
    ).toBeUndefined()
    expect(getCloudProjectIdFromProjectTomlContents(toml, 'dev.zoo.dev')).toBe(
      'project-456'
    )
    expect(toml).toContain('default_file = "main.kcl"')
  })

  it('leaves invalid TOML unchanged when removing a cloud project id', () => {
    const invalidToml = 'title = "Some demo"\n['

    expect(
      removeCloudProjectIdFromProjectTomlContents(invalidToml, 'zoo.dev')
    ).toBe(invalidToml)
  })
})
