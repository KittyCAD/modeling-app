import { projectConfigurationFromToml } from '@src/lib/settings/projectConfigurationFromToml'
import {
  defaultProjectConfiguration,
  projectId,
  invalidProjectConfigurationCases,
  projectConfigurationCases,
} from '@src/lib/settings/projectConfiguration.fixtures'
import { parse as parseToml } from 'smol-toml'
import { describe, expect, it } from 'vitest'

describe('projectConfigurationFromToml', () => {
  it('preserves environment names that overlap JavaScript object properties', () => {
    const cloud = Object.fromEntries([
      ['__proto__', { project_id: projectId }],
      ['constructor', {}],
    ])
    expect(
      projectConfigurationFromToml(
        parseToml(
          `[cloud.__proto__]\nproject_id = "${projectId}"\n[cloud.constructor]`,
          { integersAsBigInt: false }
        )
      )
    ).toEqual({ ...defaultProjectConfiguration, cloud })
  })

  it.each(projectConfigurationCases)('$description', ({ toml, expected }) => {
    expect(
      projectConfigurationFromToml(parseToml(toml, { integersAsBigInt: false }))
    ).toEqual(expected)
  })

  it.each(invalidProjectConfigurationCases)(
    'rejects invalid settings: %j',
    (toml) => {
      let failure: unknown
      try {
        failure = projectConfigurationFromToml(
          parseToml(toml, { integersAsBigInt: false })
        )
      } catch (cause) {
        failure = cause
      }
      expect(failure).toBeInstanceOf(Error)
    }
  )
})
