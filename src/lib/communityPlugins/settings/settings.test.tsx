import { vi, afterEach, describe, expect, it } from 'vitest'
vi.mock('react-hot-toast', () => ({ default: vi.fn(), toast: vi.fn() }))
import toast from 'react-hot-toast'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Registry } from 'plankton'
import helloSource from '@root/examples/community-plugins/hello.zds.ts?raw'
import { createCommunityPluginsExtension } from '@src/lib/communityPlugins/registry'
import { communityPluginsService } from '@src/lib/communityPlugins/registry/contract'
import { InstalledPluginsSection } from '@src/lib/communityPlugins/InstalledPlugins'
import {
  pluginStorageFixture,
  helloPlugin,
} from '@src/lib/communityPlugins/testSupport'
import { compilePlugin } from '@src/lib/communityPlugins/source'
import {
  createPluginRuntime,
  type PluginRuntime,
} from '@src/lib/communityPlugins/runtime'
import { commandsFacet } from '@src/registry/contracts/commands'
import { settingsPagesFacet } from '@src/registry/contracts/settingsPages'
import { requireSuccess } from '@src/lib/editors/testViews'

describe('community plugin settings', () => {
  const registries: Registry[] = []
  const runtimes: PluginRuntime[] = []
  afterEach(async () => {
    cleanup()
    for (const registry of registries.splice(0)) {
      await registry.required(communityPluginsService).settled()
      await registry.dispose()
    }
    for (const runtime of runtimes.splice(0)) runtime.dispose()
    vi.clearAllMocks()
  })
  const open = async (fixture = pluginStorageFixture()) => {
    const registry = new Registry()
    registries.push(registry)
    await registry.configure([createCommunityPluginsExtension(fixture.storage)])
    const manager = registry.required(communityPluginsService)
    await manager.settled()
    return { registry, manager, fixture }
  }
  const install = async (
    h: Awaited<ReturnType<typeof open>>,
    text = helloSource,
    mode: 'snapshot' | 'development' = 'snapshot'
  ) => {
    requireSuccess(
      await h.manager.install(
        requireSuccess(await compilePlugin(text)),
        mode,
        '/plugins/hello.zds.ts',
        new Set(['ui.notify'])
      )
    )
    return h.manager.entries.value.at(-1)!.installation.id
  }
  const command = (registry: Registry, id: string) =>
    registry
      .get(commandsFacet)
      .find((command) => command.groupId === `community.installed-${id}`)!

  it('uses the hello setting immediately and retains it through disable and restart', async () => {
    const h = await open()
    const id = await install(h)
    const original = command(h.registry, id)
    original.onSubmit()
    expect(toast).toHaveBeenLastCalledWith('Hello from a local plugin!')
    requireSuccess(
      await h.manager.setSetting(id, 'greeting', 'Personal greeting')
    )
    expect(command(h.registry, id)).toBe(original)
    original.onSubmit()
    expect(toast).toHaveBeenLastCalledWith('Personal greeting')
    const pageId = h.registry.get(settingsPagesFacet)[0].id
    requireSuccess(await h.manager.setEnabled(id, false))
    expect(h.registry.get(settingsPagesFacet)).toEqual([])
    await h.registry.dispose()
    registries.splice(registries.indexOf(h.registry), 1)
    const next = await open(h.fixture)
    expect(next.registry.get(settingsPagesFacet)).toEqual([])
    requireSuccess(await next.manager.setEnabled(id, true))
    expect(next.registry.get(settingsPagesFacet)[0].id).toBe(pageId)
    expect(next.registry.get(settingsPagesFacet)[0].owner).toEqual({
      kind: 'community',
      installationId: id,
    })
    command(next.registry, id).onSubmit()
    expect(toast).toHaveBeenLastCalledWith('Personal greeting')
    requireSuccess(await next.manager.resetSetting(id, 'greeting'))
    command(next.registry, id).onSubmit()
    expect(toast).toHaveBeenLastCalledWith('Hello from a local plugin!')
  })

  it('isolates different plugins and rejects undeclared writes', async () => {
    const h = await open()
    const first = await install(h)
    const second = await install(
      h,
      helloSource.replace('id = "hello"', 'id = "other"')
    )
    requireSuccess(await h.manager.setSetting(first, 'greeting', 'First'))
    requireSuccess(await h.manager.setSetting(second, 'greeting', 'Second'))
    expect(
      await h.manager.setSetting(first, `${second}.greeting`, 'Steal')
    ).toBeInstanceOf(Error)
    expect(await h.manager.setSetting(first, 'greeting', true)).toBeInstanceOf(
      Error
    )
    command(h.registry, first).onSubmit()
    command(h.registry, second).onSubmit()
    expect(vi.mocked(toast).mock.calls.map(([message]) => message)).toEqual([
      'First',
      'Second',
    ])
    requireSuccess(await h.manager.uninstall(first))
    expect(
      requireSuccess(await h.fixture.storage.load()).preferences.settings.map(
        (item) => item.installationId
      )
    ).toEqual([second])
  })

  it('preserves the greeting when replacing a snapshot with a development installation', async () => {
    const h = await open()
    const id = await install(h)
    requireSuccess(
      await h.manager.setSetting(id, 'greeting', 'Personal greeting')
    )
    const replacement = await install(h, helloSource, 'development')
    expect(replacement).toBe(id)
    expect(h.manager.entries.value).toHaveLength(1)
    command(h.registry, id).onSubmit()
    expect(toast).toHaveBeenLastCalledWith('Personal greeting')
  })

  it('renders a host-owned greeting editor with explicit save and reset', async () => {
    const h = await open()
    const id = await install(h)
    render(<InstalledPluginsSection registry={h.registry} />)
    expect(screen.getByLabelText('Greeting')).toHaveValue(
      'Hello from a local plugin!'
    )
    fireEvent.change(screen.getByLabelText('Greeting'), {
      target: { value: 'Edited in settings' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save Greeting' }))
    await vi.waitFor(() =>
      expect(h.manager.entries.value[0].settingsValues.value.greeting).toBe(
        'Edited in settings'
      )
    )
    command(h.registry, id).onSubmit()
    expect(toast).toHaveBeenLastCalledWith('Edited in settings')
    await h.manager.settled()
    fireEvent.click(screen.getByRole('button', { name: 'Reset Greeting' }))
    await vi.waitFor(() =>
      expect(screen.getByLabelText('Greeting')).toHaveValue(
        'Hello from a local plugin!'
      )
    )
  })

  it('reconciles live definitions without discarding incompatible saved values', async () => {
    const h = await open()
    const id = await install(h, helloSource, 'development')
    requireSuccess(await h.manager.setSetting(id, 'greeting', 'Custom'))
    const shorter = helloSource
      .replace("default: 'Hello from a local plugin!'", "default: 'New'")
      .replace('maxLength: 1000', 'maxLength: 3')
    const owner = Symbol('editor')
    h.manager.updateDevelopment(
      '/plugins/hello.zds.ts',
      requireSuccess(await compilePlugin(shorter)),
      owner
    )
    await h.manager.settled()
    command(h.registry, id).onSubmit()
    expect(toast).toHaveBeenLastCalledWith('New')
    expect(h.manager.entries.value[0].settingsValues.value.greeting).toBe(
      'Custom'
    )
    h.manager.updateDevelopment(
      '/plugins/hello.zds.ts',
      requireSuccess(await compilePlugin(helloSource)),
      owner
    )
    await h.manager.settled()
    command(h.registry, id).onSubmit()
    expect(toast).toHaveBeenLastCalledWith('Custom')
    const previous = command(h.registry, id)
    const previousPage = h.registry.get(settingsPagesFacet)[0]
    const invalid = helloSource.replace("type: 'string'", "type: 'html'")
    h.manager.updateDevelopment(
      '/plugins/hello.zds.ts',
      requireSuccess(await compilePlugin(invalid)),
      owner
    )
    await h.manager.settled()
    expect(command(h.registry, id)).toBe(previous)
    expect(h.registry.get(settingsPagesFacet)[0]).toBe(previousPage)
  })

  it('withdraws removed schemas while retaining values for a later contribution', async () => {
    const h = await open()
    const id = await install(h, helloSource, 'development')
    requireSuccess(await h.manager.setSetting(id, 'greeting', 'Retained'))
    const owner = Symbol('editor')
    h.manager.updateDevelopment(
      '/plugins/hello.zds.ts',
      requireSuccess(await compilePlugin(helloPlugin())),
      owner
    )
    await h.manager.settled()
    expect(h.registry.get(settingsPagesFacet)).toEqual([])
    expect(h.manager.entries.value[0].settingsValues.value.greeting).toBe(
      'Retained'
    )
    h.manager.updateDevelopment(
      '/plugins/hello.zds.ts',
      requireSuccess(await compilePlugin(helloSource)),
      owner
    )
    await h.manager.settled()
    command(h.registry, id).onSubmit()
    expect(toast).toHaveBeenLastCalledWith('Retained')
  })

  it('keeps guest values unchanged when persisting an edit fails', async () => {
    const h = await open()
    const id = await install(h)
    h.fixture.failWrites(new Error('Disk full'))
    expect(
      await h.manager.setSetting(id, 'greeting', 'Not saved')
    ).toBeInstanceOf(Error)
    command(h.registry, id).onSubmit()
    expect(toast).toHaveBeenLastCalledWith('Hello from a local plugin!')
    expect(h.manager.entries.value[0].settingsValues.value).toEqual({})
  })

  it('edits boolean and numeric fields and enforces numeric limits', async () => {
    const h = await open()
    const source = helloSource.replace(
      'fields: {',
      "fields: { enabled: { type: 'boolean', title: 'Enabled flag', default: true }, count: { type: 'number', title: 'Count', default: 2, min: 0, max: 5 },"
    )
    await install(h, source)
    render(<InstalledPluginsSection registry={h.registry} />)
    fireEvent.click(screen.getByLabelText('Enabled flag'))
    fireEvent.click(screen.getByRole('button', { name: 'Save Enabled flag' }))
    await vi.waitFor(() =>
      expect(h.manager.entries.value[0].settingsValues.value.enabled).toBe(
        false
      )
    )
    await h.manager.settled()
    fireEvent.change(screen.getByLabelText('Count'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Count' }))
    await vi.waitFor(() =>
      expect(h.manager.entries.value[0].settingsValues.value.count).toBe(0)
    )
    await h.manager.settled()
    fireEvent.change(screen.getByLabelText('Count'), { target: { value: '6' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Count' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter a value matching this setting'
    )
    expect(h.manager.entries.value[0].settingsValues.value.count).toBe(0)
  })

  it('supports typed reads during activation and rejects undeclared or mismatched reads', async () => {
    const source = requireSuccess(
      await compilePlugin(`/* @zds-plugin
id = "typed"
name = "Typed"
api_version = 1
permissions = ["ui.notify"]
*/
export default zds => {
 zds.contribute('settings', {fields:{flag:{type:'boolean',title:'Flag',default:false},count:{type:'number',title:'Count',default:0}}});
 const flag = zds.settings.getBoolean('flag');
 const count = zds.settings.getNumber('count');
 zds.contribute('command',{id:'hello',title:'Hello',run:()=>zds.ui.notify(String(flag)+':'+String(count))});
}`)
    )
    const messages: string[] = []
    const runtime = requireSuccess(
      await createPluginRuntime(source, new Set(['ui.notify']), (message) =>
        messages.push(message)
      )
    )
    runtimes.push(runtime)
    expect(runtime.invoke(0)).toBeUndefined()
    expect(messages).toEqual(['false:0'])
    const bad = {
      ...source,
      javascript: source.javascript.replace(
        "getNumber('count')",
        "getString('count')"
      ),
    }
    expect(
      await createPluginRuntime(bad, new Set(['ui.notify']), () => {})
    ).toBeInstanceOf(Error)
    const unknown = {
      ...source,
      javascript: source.javascript.replace(
        "getNumber('count')",
        "getNumber('other.count')"
      ),
    }
    expect(
      await createPluginRuntime(unknown, new Set(['ui.notify']), () => {})
    ).toBeInstanceOf(Error)
  })
})
