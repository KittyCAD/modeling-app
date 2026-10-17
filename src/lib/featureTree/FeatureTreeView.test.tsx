import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/components/ContextMenu', () => ({ ContextMenu: () => null }))

import { useState } from 'react'
import { flushSync } from 'react-dom'
import {
  Registry,
  defineRegistryItem,
  provideService,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import { featureTreeExtension } from '@src/lib/featureTree/registry/extension'
import { FEATURE_TREE_COMMANDS } from '@src/lib/featureTree/registry/contract'
import { sceneBrowserExtension } from '@src/lib/sceneBrowser/registry/extension'
import {
  sceneBrowserService,
  SCENE_BROWSER_FOCUSED_SCOPE,
} from '@src/lib/sceneBrowser/registry/contract'
import { SCENE_BROWSER_FEATURE } from '@src/lib/sceneBrowser/featureFlag'
import {
  userFeaturesService,
  type UserFeaturesRegistryService,
} from '@src/registry/contracts/userFeatures'
import type { UserFeaturesContext } from '@src/machines/userFeaturesMachine'
import { commandsValueSpec } from '@src/registry/contracts/commands'
import {
  createKeymapTree,
  KEYMAP_SCHEMA_VERSION,
  keymapValueSpec,
  matchKeymapKeystrokes,
  resolveKeymapItems,
} from '@src/registry/contracts/keymap'

import type { ZooFeatureTree } from '@kittycad/ui-components/web-components'
import {
  FeatureTree,
  FeatureTreeRow,
} from '@src/lib/featureTree/FeatureTreeView'

afterEach(cleanup)
describe('ZDS feature tree adapter', () => {
  it('selects focused rows with Space or Enter without editing', async () => {
    const parentSelect = vi.fn()
    const select = vi.fn()
    const edit = vi.fn()
    function ControlledTree() {
      const [selected, setSelected] = useState(false)
      return (
        <FeatureTree>
          <FeatureTreeRow
            nodeId="parent"
            label="Parent"
            defaultOpen
            onSelect={parentSelect}
          >
            <FeatureTreeRow
              nodeId="child"
              label="Child"
              selected={selected}
              onSelect={() => {
                select()
                setSelected(true)
              }}
              onDoubleClick={edit}
              visibility={{ visible: true, onVisibilityChange: vi.fn() }}
            />
          </FeatureTreeRow>
        </FeatureTree>
      )
    }
    const view = render(<ControlledTree />)
    const tree =
      view.container.querySelector<ZooFeatureTree>('zoo-feature-tree')!
    const child =
      view.container.querySelector<HTMLElement>('[node-id="child"]')!
    await waitFor(() => expect(child.getAttribute('role')).toBe('treeitem'))
    child.focus()
    fireEvent.keyDown(child, { key: ' ' })
    await waitFor(() => expect(tree.selectedIds).toEqual(['child']))
    expect(select).toHaveBeenCalledOnce()
    expect(edit).not.toHaveBeenCalled()
    expect(parentSelect).not.toHaveBeenCalled()

    fireEvent.keyDown(child, { key: 'Enter' })
    expect(select).toHaveBeenCalledTimes(2)
    expect(edit).not.toHaveBeenCalled()

    fireEvent.keyDown(view.getByRole('button', { name: 'Hide Child' }), {
      key: 'Enter',
    })
    expect(select).toHaveBeenCalledTimes(2)
    expect(edit).not.toHaveBeenCalled()
    expect(parentSelect).not.toHaveBeenCalled()
  })
  it.each(['shift+enter', 'shift+space', 'f3'])(
    'routes %s through the edit command to the focused row',
    async (chord) => {
      const registry = new Registry()
      registry.configure([
        sceneBrowserExtension,
        featureTreeExtension,
        defineRegistryItem({
          providesServices: [
            provideService(userFeaturesService, {
              context: signal({
                featureIds: new Set([SCENE_BROWSER_FEATURE]),
              } as UserFeaturesContext),
            } as unknown as UserFeaturesRegistryService),
          ],
        }),
      ])
      const browser = registry.get(sceneBrowserService)
      const edit = vi.fn()
      const parentEdit = vi.fn()
      const select = vi.fn()
      function ControlledTree() {
        const [selected, setSelected] = useState(false)
        return (
          <FeatureTree onMount={browser.setTree}>
            <FeatureTreeRow
              nodeId="parent"
              label="Parent"
              defaultOpen
              onDoubleClick={parentEdit}
            >
              <FeatureTreeRow
                nodeId="child"
                label="Child"
                selected={selected}
                onDoubleClick={edit}
                onSelect={() => {
                  select()
                  flushSync(() => setSelected(true))
                }}
              />
            </FeatureTreeRow>
          </FeatureTree>
        )
      }
      const view = render(<ControlledTree />)
      try {
        const child =
          view.container.querySelector<HTMLElement>('[node-id="child"]')!
        await waitFor(() => expect(child.getAttribute('role')).toBe('treeitem'))
        child.focus()
        const keymap = createKeymapTree(
          resolveKeymapItems(registry.get(keymapValueSpec).items, {
            version: KEYMAP_SCHEMA_VERSION,
            bindings:
              chord === 'f3'
                ? [
                    {
                      command: FEATURE_TREE_COMMANDS.edit,
                      keystrokes: ['f3'],
                      when: [SCENE_BROWSER_FOCUSED_SCOPE],
                    },
                  ]
                : [],
          })
        )
        const match = matchKeymapKeystrokes(
          keymap,
          [SCENE_BROWSER_FOCUSED_SCOPE],
          [chord]
        )
        expect(match.type).toBe('full')
        if (match.type !== 'full') return
        expect(match.item.command).toBe(FEATURE_TREE_COMMANDS.edit)
        const command = registry
          .get(commandsValueSpec)
          .find(({ id }) => id === match.item.command)!
        await command.onSubmit({} as never)
        expect(select).toHaveBeenCalledOnce()
        expect(edit).toHaveBeenCalledOnce()
        expect(select.mock.invocationCallOrder[0]).toBeLessThan(
          edit.mock.invocationCallOrder[0]
        )
        expect(parentEdit).not.toHaveBeenCalled()
        expect(browser.tree.value?.selectedIds).toEqual(['child'])
      } finally {
        view.unmount()
        registry[Symbol.dispose]()
      }
    }
  )
  it('keeps the clicked representation selected when a feature and body share a source selection', async () => {
    const view = render(
      <FeatureTree>
        <FeatureTreeRow nodeId="feature" label="Extrude" selected />
        <FeatureTreeRow nodeId="body" label="Body 1" selected />
      </FeatureTree>
    )
    const tree =
      view.container.querySelector<ZooFeatureTree>('zoo-feature-tree')!
    const body = view.container.querySelector('[node-id="body"]')!
    await waitFor(() => expect(body.getAttribute('role')).toBe('treeitem'))
    body.dispatchEvent(
      new CustomEvent('zoo-select', {
        bubbles: true,
        composed: true,
        detail: { nodeId: 'body' },
      })
    )
    expect(tree.selectedIds).toEqual(['body'])
  })
  it('preserves branch expansion across selection updates and routes one row action', async () => {
    let tree: ZooFeatureTree | null = null
    const mount = (element: ZooFeatureTree | null) => {
      tree = element
    }
    const parent = vi.fn(),
      child = vi.fn()
    const hide = vi.fn()
    const view = (selected: boolean) => (
      <FeatureTree onMount={mount}>
        <FeatureTreeRow
          nodeId="parent"
          label="Parent"
          defaultOpen
          onSelect={parent}
        >
          <FeatureTreeRow
            nodeId="child"
            label="Child"
            selected={selected}
            onSelect={child}
            visibility={{ visible: true, onVisibilityChange: hide }}
          />
        </FeatureTreeRow>
      </FeatureTree>
    )
    const rendered = render(view(false))
    await waitFor(() => expect(tree?.expandedIds).toEqual(['parent']))
    const row = rendered.container.querySelector('[node-id="child"]')!
    expect(row.getAttribute('slot')).toBe('children')
    row.dispatchEvent(
      new CustomEvent('zoo-select', {
        bubbles: true,
        composed: true,
        detail: { nodeId: 'child' },
      })
    )
    expect(child).toHaveBeenCalledOnce()
    expect(parent).not.toHaveBeenCalled()
    fireEvent.click(rendered.getByRole('button', { name: 'Hide Child' }))
    expect(hide).toHaveBeenCalledOnce()
    expect(child).toHaveBeenCalledOnce()
    tree!.dispatchEvent(
      new CustomEvent('zoo-expand', {
        detail: { nodeId: 'parent', expanded: false },
      })
    )
    rendered.rerender(view(true))
    await waitFor(() => expect(tree?.selectedIds).toEqual(['child']))
    expect(tree!.expandedIds).toEqual([])
    expect(tree!.shortcuts).toBe(false)
    rendered.unmount()
    expect(tree).toBeNull()
  })
})
