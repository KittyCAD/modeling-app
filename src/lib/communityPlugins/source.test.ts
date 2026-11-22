import {
  compilePlugin,
  parsePluginManifest,
} from '@src/lib/communityPlugins/source'
import { describe, expect, it } from 'vitest'

describe('plugin source inspection', () => {
  it('reads TOML without executing the source', () => {
    const result = parsePluginManifest(`/* @zds-plugin
id = "hello"
name = "Hello"
api_version = 1
permissions = []
*/
throw new Error('must not run')`)
    expect(result).toEqual({
      id: 'hello',
      name: 'Hello',
      apiVersion: 1,
      permissions: [],
    })
  })
  it.each([
    'api_version = 2',
    'api_version = 1\npermissions = "network"',
    'api_version = 1\npermissions = []\npermission = "network"',
  ])('rejects unsupported or misspelled declarations: %s', (fields) => {
    expect(
      parsePluginManifest(
        `/* @zds-plugin\nid = "test"\nname = "Test"\n${fields}\n*/`
      )
    ).toBeInstanceOf(Error)
  })
  it('reports TypeScript syntax errors without producing executable output', async () => {
    expect(
      await compilePlugin(
        '/* @zds-plugin\nid = "test"\nname = "Test"\napi_version = 1\npermissions = []\n*/\nexport default ('
      )
    ).toBeInstanceOf(Error)
  })

  it('accepts a plain-text description and trims its surrounding whitespace', () => {
    const value = parsePluginManifest(
      '/* @zds-plugin\nid = "hello"\nname = "Hello"\ndescription = "  A useful local tool.  "\napi_version = 1\npermissions = []\n*/'
    )
    expect(value).toEqual({
      id: 'hello',
      name: 'Hello',
      description: 'A useful local tool.',
      apiVersion: 1,
      permissions: [],
    })
  })

  it.each(['true', '42', '[]', JSON.stringify('a'.repeat(2001))])(
    'rejects an invalid description: %s',
    (description) => {
      expect(
        parsePluginManifest(
          `/* @zds-plugin\nid = "hello"\nname = "Hello"\ndescription = ${description}\napi_version = 1\npermissions = []\n*/`
        )
      ).toBeInstanceOf(Error)
    }
  )
})
