import '@src/lib/projectSession/next/testFeature'
import { vi, afterEach, beforeAll, describe, expect, it } from 'vitest'
vi.mock('react-hot-toast', () => ({ default: vi.fn(), toast: vi.fn() }))
import toast from 'react-hot-toast'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Registry } from 'plankton'
import editorsExtension from '@src/lib/editors/registry'
import { editorsService } from '@src/lib/editors/registry/contract'
import { requireSuccess } from '@src/lib/editors/testViews'
import executorsExtension from '@src/lib/executors/registry'
import communityPlugins, {
  createCommunityPluginsExtension,
} from '@src/lib/communityPlugins/registry'
import { communityPluginsService } from '@src/lib/communityPlugins/registry/contract'
import { InstalledPluginsSection } from '@src/lib/communityPlugins/InstalledPlugins'
import { pluginStorageFixture } from '@src/lib/communityPlugins/testSupport'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { commandsFacet } from '@src/registry/contracts/commands'

const hello = `/* @zds-plugin
id = "hello"
name = "Hello"
description = "Build your first local command."
api_version = 1
permissions = ["ui.notify"]
*/
import type { Activate } from '@zoo/zds-plugin'
const activate: Activate = zds => zds.contribute('command', { id: 'hello', title: 'Say hello', run: () => zds.ui.notify('Hello!') })
export default activate`

describe('Plugin Builder', () => {
  let registry: Registry | undefined
  beforeAll(async () => {
    await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
  })
  afterEach(async () => {
    cleanup()
    await registry?.dispose()
    vi.clearAllMocks()
  })
  it('starts only after approval, reloads an edited buffer, and withdraws commands when the document closes', async () => {
    registry = new Registry()
    await registry.configure([
      editorsExtension,
      executorsExtension,
      communityPlugins,
    ])
    const editors = registry.required(editorsService)
    const editor = requireSuccess(
      editors.openEditor('/plugins/hello.zds.ts', hello)
    )
    const instance = requireSuccess(
      editors.createView(editor, 'communityPlugins.builder')
    )
    const binding = editors.viewState(instance).value.binding
    if (binding.type !== 'ready') throw new Error('Expected Plugin Builder')
    const Component = binding.Component
    render(<Component editor={editor} instance={instance} active />)
    const commands = () =>
      registry!
        .get(commandsFacet)
        .filter((command) => command.groupId.startsWith('community.'))
    await screen.findByText('Hello')
    expect(screen.getByText('Build your first local command.')).toBeVisible()
    expect(commands()).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Start preview' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Start preview' }))
    await vi.waitFor(() => expect(commands()).toHaveLength(1))
    commands()[0].onSubmit()
    expect(toast).toHaveBeenLastCalledWith('Hello!')
    const previous = commands()[0]
    editor.dispatch({
      changes: {
        from: 0,
        to: editor.state.doc.length,
        insert: hello.replace('Hello!', 'Edited!'),
      },
    })
    await vi.waitFor(() => expect(commands()[0]).not.toBe(previous))
    commands()[0].onSubmit()
    expect(toast).toHaveBeenLastCalledWith('Edited!')
    const edited = commands()[0]
    editor.dispatch({
      changes: {
        from: 0,
        to: editor.state.doc.length,
        insert: hello + '\nexport default (',
      },
    })
    await screen.findByRole('alert')
    expect(commands()[0]).toBe(edited)
    cleanup()
    editors.closeEditor(editor.id)
    await vi.waitFor(() => expect(commands()).toHaveLength(0))
  })

  it('installs from Plugin Builder and manages startup activation without reopening its source', async () => {
    const fixture = pluginStorageFixture()
    const startApp = async () => {
      registry = new Registry()
      await registry.configure([
        editorsExtension,
        executorsExtension,
        createCommunityPluginsExtension(fixture.storage),
      ])
      const manager = registry.required(communityPluginsService)
      await manager.settled()
      return manager
    }
    const commands = () =>
      registry!
        .get(commandsFacet)
        .filter((command) => command.groupId.startsWith('community.installed-'))
    const manager = await startApp()
    const editors = registry!.required(editorsService)
    const editor = requireSuccess(
      editors.openEditor('/plugins/hello.zds.ts', hello)
    )
    const instance = requireSuccess(
      editors.createView(editor, 'communityPlugins.builder')
    )
    const binding = editors.viewState(instance).value.binding
    if (binding.type !== 'ready') throw new Error('Expected Plugin Builder')
    const Component = binding.Component
    render(<Component editor={editor} instance={instance} active />)
    await screen.findByText('Hello')
    fireEvent.click(
      screen.getByLabelText('Allow this plugin to show notifications')
    )
    fireEvent.click(screen.getByRole('button', { name: 'Install snapshot' }))
    await vi.waitFor(() => expect(commands()).toHaveLength(1))
    const identity = manager.entries.value[0].installation.id
    cleanup()
    editors.closeEditor(editor.id)
    await manager.settled()
    expect(commands()).toHaveLength(1)
    await registry!.dispose()

    const restarted = await startApp()
    expect(restarted.entries.value[0].installation.id).toBe(identity)
    expect(restarted.entries.value[0].installation.description).toBe(
      'Build your first local command.'
    )
    expect(commands()).toHaveLength(1)
    commands()[0].onSubmit()
    expect(toast).toHaveBeenLastCalledWith('Hello!')
    render(<InstalledPluginsSection registry={registry!} />)
    expect(
      screen.getByText(/This version does not declare settings/)
    ).toBeVisible()
    expect(screen.queryByLabelText('Greeting')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Enabled, including on startup'))
    await vi.waitFor(() => expect(commands()).toHaveLength(0))
    await restarted.settled()
    cleanup()
    await registry!.dispose()

    const disabled = await startApp()
    expect(commands()).toHaveLength(0)
    render(<InstalledPluginsSection registry={registry!} />)
    expect(
      screen.getByLabelText('Enabled, including on startup')
    ).not.toBeChecked()
    fireEvent.click(screen.getByLabelText('Enabled, including on startup'))
    await vi.waitFor(() => expect(commands()).toHaveLength(1))
    await disabled.settled()
    fireEvent.click(screen.getByRole('button', { name: 'Uninstall' }))
    await vi.waitFor(() => expect(commands()).toHaveLength(0))
    await disabled.settled()
    expect(
      requireSuccess(await fixture.storage.load()).preferences.grants
    ).toEqual([])
  })
})
