import {
  prepareContributions,
  type CommunityContributionAdapter,
} from '@src/lib/communityPlugins/contributions'
import { createPluginRuntime } from '@src/lib/communityPlugins/runtime'
import { compilePlugin } from '@src/lib/communityPlugins/source'
import { contribute, Facet, Registry } from 'plankton'
import { describe, expect, it, vi } from 'vitest'

describe('community contribution adapters', () => {
  it('lets a core feature adapt its own shape and guest callback', async () => {
    const source = await compilePlugin(`/* @zds-plugin
id = "custom"
name = "Custom"
api_version = 1
permissions = ["ui.notify"]
*/
export default zds => zds.contribute('example', { label: 'Custom feature', onSelect: () => zds.ui.notify('Selected') })`)
    if (source instanceof Error) throw source
    const messages: string[] = []
    const runtime = await createPluginRuntime(
      source,
      new Set(['ui.notify']),
      (message) => messages.push(message)
    )
    if (runtime instanceof Error) throw runtime
    const entries = new Facet(
      'example.entries',
      (values: readonly { label: string; select: () => Error | undefined }[]) =>
        values
    )
    const adapter: CommunityContributionAdapter = {
      kind: 'example',
      requiredPermissions: [],
      prepare: (value, { invoke }) => {
        if (
          !value ||
          typeof value !== 'object' ||
          !('label' in value) ||
          typeof value.label !== 'string' ||
          !('onSelect' in value) ||
          !value.onSelect ||
          typeof value.onSelect !== 'object' ||
          !('callback' in value.onSelect) ||
          typeof value.onSelect.callback !== 'number'
        )
          return new Error('Invalid example contribution')
        const label = value.label
        const callback = value.onSelect.callback
        return contribute(entries, () => ({
          label,
          select: () => invoke(callback),
        }))
      },
    }
    const registry = new Registry()
    try {
      const items = prepareContributions(
        runtime,
        source.manifest,
        'installation-1',
        new Set(['ui.notify']),
        [adapter]
      )
      if (items instanceof Error) throw items
      await registry.configure(items)
      const [entry] = registry.get(entries)
      expect(entry.label).toBe('Custom feature')
      expect(entry.select()).toBeUndefined()
      expect(messages).toEqual(['Selected'])
    } finally {
      await registry.dispose()
      runtime.dispose()
    }
  })

  it('rejects unknown contribution kinds and checks grants before invoking an adapter', () => {
    const runtime = {
      contributions: [{ kind: 'example', definition: {} }],
      invoke: () => undefined,
      dispose: () => {},
    }
    const manifest = {
      id: 'test',
      name: 'Test',
      apiVersion: 1 as const,
      permissions: ['example.access'],
    }
    const prepare = vi.fn(() => [])
    const adapter = {
      kind: 'example',
      requiredPermissions: ['example.access'],
      prepare,
    }
    expect(
      prepareContributions(runtime, manifest, 'test', new Set(), [])
    ).toBeInstanceOf(Error)
    expect(
      prepareContributions(runtime, manifest, 'test', new Set(), [adapter])
    ).toBeInstanceOf(Error)
    expect(prepare).not.toHaveBeenCalled()
  })
})
