import { afterEach, expect, it } from 'vitest'
import { contribute, Facet, Registry } from 'plankton'
import source from '@root/examples/community-plugins/personal-logo.zds.ts?raw'
import { prepareAccountExtensions } from '@src/lib/appConfiguration/extensions'
import { logoLinkContributionAdapter } from '@src/registry/extensions/appHeader/communityLogo'
import { appHeaderStartItemsFacet } from '@src/registry/contracts/appHeader'
import type { CommunityContributionAdapter } from '@src/lib/communityPlugins/contributions'
import type {
  LoadedAccountConfig,
  PreparedAccountExtensions,
} from '@src/lib/appConfiguration/devAccount'

const request = {
  accountId: 'user-a',
  projectId: 'config-project',
  baseUrl: 'https://api.example.test',
  token: 'test-token',
}
const loaded = (contents = source): LoadedAccountConfig => ({
  contents: '',
  revision: 'version-1',
  sources: [
    {
      id: 'personal:logo',
      contents,
      projectId: request.projectId,
      versionId: 'version-1',
      sha256: 'a'.repeat(64),
    },
  ],
})
const registries: Registry[] = []
const prepared: PreparedAccountExtensions[] = []
afterEach(async () => {
  for (const registry of registries.splice(0)) await registry.dispose()
  for (const plan of prepared.splice(0)) plan.dispose()
})

it('mounts a composition-bound logo directly without a manual plugin installation', async () => {
  const plan = await prepareAccountExtensions(
    loaded(),
    ['personal:logo'],
    request,
    [logoLinkContributionAdapter],
    () => {}
  )
  prepared.push(plan)
  const registry = new Registry()
  registries.push(registry)
  await registry.configure(plan.extensions)
  expect(registry.get(appHeaderStartItemsFacet).map((item) => item.id)).toEqual(
    ['configuration.personal:logo.home']
  )
  await registry.configure([])
  expect(registry.get(appHeaderStartItemsFacet)).toEqual([])
})

it('rejects permissions requested by a configured extension instead of granting them from the manifest', async () => {
  await expect(
    prepareAccountExtensions(
      loaded(source.replace('permissions = []', 'permissions = ["ui.notify"]')),
      ['personal:logo'],
      request,
      [logoLinkContributionAdapter],
      () => {}
    )
  ).rejects.toThrow('permissions = []')
})

it('revokes callbacks when the configuration is removed and when later source preparation fails', async () => {
  const callbacks: (() => Error | undefined)[] = []
  const probe = new Facet<
    () => Error | undefined,
    readonly (() => Error | undefined)[]
  >('probe', (inputs) => inputs)
  const adapter: CommunityContributionAdapter = {
    kind: 'probe',
    requiredPermissions: [],
    prepare: (_value, { invoke }) => {
      const callback = () => invoke(0)
      callbacks.push(callback)
      return contribute(probe, () => callback)
    },
  }
  const contents =
    '/* @zds-plugin\nid = "probe"\nname = "Probe"\napi_version = 1\npermissions = []\n*/\nexport default zds => zds.contribute("probe",{run:()=>{}})'
  const plan = await prepareAccountExtensions(
    loaded(contents),
    ['personal:logo'],
    request,
    [adapter],
    () => {}
  )
  prepared.push(plan)
  const registry = new Registry()
  registries.push(registry)
  await registry.configure(plan.extensions)
  const retained = registry.get(probe)[0]
  expect(retained()).toBeUndefined()
  await registry.configure([])
  expect(retained()).toBeInstanceOf(Error)
  const partial = loaded(contents)
  partial.sources = [
    ...partial.sources!,
    { ...partial.sources![0], id: 'personal:broken', contents: 'bad source' },
  ]
  await expect(
    prepareAccountExtensions(
      partial,
      ['personal:logo', 'personal:broken'],
      request,
      [adapter],
      () => {}
    )
  ).rejects.toThrow()
  expect(callbacks.at(-1)!()).toBeInstanceOf(Error)
})

it('rejects unsupported settings pages explicitly rather than using another installation namespace', async () => {
  const { settingsContributionAdapter } = await import(
    '@src/lib/communityPlugins/settings/adapter'
  )
  const contents =
    '/* @zds-plugin\nid = "settings"\nname = "Settings"\napi_version = 1\npermissions = []\n*/\nexport default zds => zds.contribute("settings",{fields:{greeting:{type:"string",title:"Greeting",default:"Hello"}}})'
  await expect(
    prepareAccountExtensions(
      loaded(contents),
      ['personal:logo'],
      request,
      [settingsContributionAdapter],
      () => {}
    )
  ).rejects.toThrow('Settings pages for configuration extensions')
})
