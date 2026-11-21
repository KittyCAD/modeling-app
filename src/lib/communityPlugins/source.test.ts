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
})
