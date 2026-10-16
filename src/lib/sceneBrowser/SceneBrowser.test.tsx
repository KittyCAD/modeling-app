import {
  Registry,
  defineRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import type { ReactNode } from 'react'
import type {
  ZooFeatureTree,
  ZooFeatureTreeRow,
} from '@kittycad/ui-components/web-components'
import { signal } from '@preact/signals-core'
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  const state: { registry: Registry | null } = { registry: null }
  return state
})
vi.mock('@src/lib/boot', () => ({
  useApp: () => ({ registry: state.registry! }),
}))
vi.mock('@src/components/Tooltip', () => ({
  default: ({ children }: { children: ReactNode }) => (
    <span role="tooltip">{children}</span>
  ),
}))
vi.mock('@src/components/ContextMenu', () => ({ ContextMenu: () => null }))

import {
  FeatureTreeDivider,
  FeatureTreeRow,
} from '@src/lib/featureTree/FeatureTreeView'
import { SceneBrowser } from '@src/lib/sceneBrowser/SceneBrowser'
import {
  sceneBrowserAppearance,
  sceneBrowserSections,
  sceneBrowserService,
  type SceneBrowserAppearance,
  TOGGLE_BROWSER_COMMAND,
} from '@src/lib/sceneBrowser/registry/contract'
import { sceneBrowserExtension } from '@src/lib/sceneBrowser/registry/extension'
import { commandsValueSpec } from '@src/registry/contracts/commands'
import {
  keymapService,
  keymapValueSpec,
  resolveKeymapItems,
  createKeymapTree,
  KEYMAP_SCHEMA_VERSION,
  type KeymapService,
  type KeymapTree,
} from '@src/registry/contracts/keymap'
import type { Signal } from '@preact/signals-core'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  state.registry?.[Symbol.dispose]()
  state.registry = null
})
describe('docked Browser tree', () => {
  function setup(keymap?: Signal<KeymapTree>) {
    const registry = new Registry()
    state.registry = registry
    const appearance = signal<SceneBrowserAppearance>('hud')
    registry.configure([
      sceneBrowserExtension,
      defineRegistryItem({
        id: 'test-content',
        providesServices: keymap
          ? [provideService(keymapService, { keymap } as KeymapService)]
          : [],
        provides: [
          provide(sceneBrowserAppearance, appearance),
          provide(sceneBrowserSections, {
            id: 'history',
            title: 'Feature tree',
            order: 0,
            Component: () => (
              <>
                <FeatureTreeRow nodeId="plane" label="Top plane" />
                <FeatureTreeDivider />
                <FeatureTreeRow nodeId="operation" label="Extrude" />
              </>
            ),
          }),
          provide(sceneBrowserSections, {
            id: 'bodies',
            title: 'Bodies',
            order: 1,
            Component: () => <FeatureTreeRow nodeId="body" label="Body 1" />,
          }),
        ],
      }),
    ])
    const view = render(<SceneBrowser />)
    const tree =
      view.container.querySelector<ZooFeatureTree>('zoo-feature-tree')!
    const row = (id: string) =>
      view.container.querySelector<ZooFeatureTreeRow>(`[node-id="${id}"]`)!
    return { registry, appearance, view, tree, row }
  }
  it('shows the Scene browser name and keeps its tooltip shortcut in sync with remapping', () => {
    const keymap = signal(createKeymapTree([]))
    const { registry, view } = setup(keymap)
    const bindings = registry.get(keymapValueSpec).items
    act(() => {
      keymap.value = createKeymapTree(bindings)
    })
    expect(
      view.getByRole('complementary', { name: 'Scene browser' })
    ).toBeTruthy()
    const defaultShortcut = view
      .getByRole('tooltip')
      .querySelector('kbd')!.textContent
    expect(defaultShortcut?.toLowerCase()).toContain('t')
    act(() => {
      keymap.value = createKeymapTree(
        resolveKeymapItems(bindings, {
          version: KEYMAP_SCHEMA_VERSION,
          bindings: [
            { command: TOGGLE_BROWSER_COMMAND, keystrokes: ['mod+b'] },
          ],
        })
      )
    })
    expect(
      view.getByRole('tooltip').querySelector('kbd')!.textContent?.toLowerCase()
    ).toContain('b')
    expect(
      view.getByRole('tooltip').querySelector('kbd')!.textContent
    ).not.toBe(defaultShortcut)
    fireEvent.click(
      view.getByRole('button', { name: /Collapse scene browser/ })
    )
    expect(view.getByRole('tooltip').textContent).toContain(
      'Expand scene browser'
    )
    act(() => {
      keymap.value = createKeymapTree([])
    })
    expect(view.getByRole('tooltip').querySelector('kbd')).toBeNull()
  })
  it('uses one keyboard tree for section headings, planes, operations and bodies, skipping dividers', async () => {
    const { view, tree, row, registry } = setup()
    await waitFor(() =>
      expect(row('body').getAttribute('aria-level')).toBe('2')
    )
    expect(view.container.querySelectorAll('zoo-feature-tree')).toHaveLength(1)
    expect(row('plane').getAttribute('aria-level')).toBe('2')
    expect(row('operation').getAttribute('aria-level')).toBe('2')
    row('plane').focus()
    fireEvent.keyDown(row('plane'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(row('operation'))
    fireEvent.keyDown(row('operation'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(row('browser-section:bodies'))
    expect(registry.get(sceneBrowserService).tree.value).toBe(tree)
    view.unmount()
    expect(registry.get(sceneBrowserService).tree.value).toBeNull()
  })
  it('focuses the toggle when the command opens or closes the tray without stealing focus on mount', async () => {
    const initialFocus = document.activeElement
    const { registry, view } = setup()
    expect(document.activeElement).toBe(initialFocus)
    const toggle = view.getByRole('button', { name: 'Collapse scene browser' })
    const command = registry
      .get(commandsValueSpec)
      .find(({ id }) => id === TOGGLE_BROWSER_COMMAND)!
    const outside = document.createElement('button')
    view.container.append(outside)
    outside.focus()
    await act(async () => {
      await command.onSubmit({} as never)
    })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(toggle)
    outside.focus()
    await act(async () => {
      await command.onSubmit({} as never)
    })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(toggle)
  })
  it('shares one width, preserves section collapse, and focuses the icon-only tray toggle when closed', async () => {
    const { view, row } = setup()
    await waitFor(() =>
      expect(row('browser-section:history').expanded).toBe(true)
    )
    const frame = () =>
      view.container.querySelector('.scene-browser-content')?.parentElement
    const resizable = frame()!
    // Supply layout measurements unavailable in happy-dom; use the real resizer.
    Object.defineProperty(resizable, 'offsetWidth', {
      configurable: true,
      get: () => Number.parseFloat(resizable.style.width),
    })
    Object.defineProperty(resizable, 'offsetHeight', { value: 200 })
    const handle = resizable.querySelector<HTMLElement>(
      '[style*="col-resize"]'
    )!
    fireEvent.mouseDown(handle, { clientX: 280, clientY: 100 })
    fireEvent.mouseMove(window, { clientX: 420, clientY: 100 })
    fireEvent.mouseUp(window)
    expect(resizable.style.width).toBe('420px')
    fireEvent.click(
      row('browser-section:history').shadowRoot!.querySelector(
        '[part="content"]'
      )!
    )
    await waitFor(() =>
      expect(row('browser-section:history').expanded).toBe(false)
    )
    expect(row('browser-section:bodies').expanded).toBe(true)
    fireEvent.click(
      view.getByRole('button', {
        name: /Collapse scene browser|Expand scene browser/,
      })
    )
    expect(frame()).toBeUndefined()
    const toggle = view.getByRole('button', {
      name: /Collapse scene browser|Expand scene browser/,
    })
    expect(document.activeElement).toBe(toggle)
    expect(
      view.getByRole('complementary').classList.contains('is-collapsed')
    ).toBe(true)
    fireEvent.click(toggle)
    expect(frame()!.style.width).toBe('420px')
    await waitFor(() =>
      expect(row('browser-section:history').expanded).toBe(false)
    )
    expect(row('browser-section:bodies').expanded).toBe(true)
  })
  it('limits dragging to the available scene width and minimum usable tree width', () => {
    vi.spyOn(document.body, 'clientWidth', 'get').mockReturnValue(600)
    const { view } = setup()
    const resizable = view.container.querySelector('.scene-browser-content')!
      .parentElement!
    Object.defineProperty(resizable, 'offsetWidth', {
      get: () => Number.parseFloat(resizable.style.width),
    })
    Object.defineProperty(resizable, 'offsetHeight', { value: 200 })
    const handle = resizable.querySelector<HTMLElement>(
      '[style*="col-resize"]'
    )!
    fireEvent.mouseDown(handle, { clientX: 280, clientY: 100 })
    fireEvent.mouseMove(window, { clientX: 900, clientY: 100 })
    fireEvent.mouseUp(window)
    expect(resizable.style.width).toBe('599px')
    fireEvent.mouseDown(handle, { clientX: 599, clientY: 100 })
    fireEvent.mouseMove(window, { clientX: 0, clientY: 100 })
    fireEvent.mouseUp(window)
    expect(resizable.style.width).toBe('200px')
  })
})
