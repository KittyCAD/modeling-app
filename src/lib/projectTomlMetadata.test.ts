import {
  getProjectTitleFromProjectTomlContents,
  setProjectTitleInProjectTomlContents,
} from '@src/lib/projectTomlMetadata'
import { describe, expect, it } from 'vitest'

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
      'default_file = "main.kcl"\n\n[custom]\nvalue = "kept"\n',
      'Some demo'
    )

    expect(getProjectTitleFromProjectTomlContents(toml)).toBe('Some demo')
    expect(toml).toContain('title = "Some demo"')
    expect(toml).toContain('[custom]')
    expect(toml).toContain('value = "kept"')
    expect(toml).toContain('default_file = "main.kcl"')
  })
})
