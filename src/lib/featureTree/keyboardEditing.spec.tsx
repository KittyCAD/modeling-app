import {
  Registry,
  defineRegistryItem,
  provideService,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { flushSync } from 'react-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { createActor } from 'xstate'
import { testFileOperations } from '@src/lib/fileSystem/testRuntime'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import type { MachineManager } from '@src/lib/MachineManager'
import {
  FeatureTree,
  FeatureTreeRow,
} from '@src/lib/featureTree/FeatureTreeView'
import { featureTreeExtension } from '@src/lib/featureTree/registry/extension'
import { SCENE_BROWSER_FEATURE } from '@src/lib/sceneBrowser/featureFlag'
import {
  sceneBrowserService,
  SCENE_BROWSER_FOCUSED_SCOPE,
} from '@src/lib/sceneBrowser/registry/contract'
import { sceneBrowserExtension } from '@src/lib/sceneBrowser/registry/extension'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { commandBarMachine } from '@src/machines/commandBarMachine'
import type { UserFeaturesContext } from '@src/machines/userFeaturesMachine'
import {
  commandsValueSpec,
  commandSystemService,
} from '@src/registry/contracts/commands'
import { keymapService } from '@src/registry/contracts/keymap'
import {
  userFeaturesService,
  type UserFeaturesRegistryService,
} from '@src/registry/contracts/userFeatures'
import keymapExtension from '@src/registry/extensions/keymap'

vi.mock('@src/components/ContextMenu', () => ({ ContextMenu: () => null }))
afterEach(cleanup)

it.each(['Enter', ' '])(
  'selects with %s and edits with Shift through the global keymap and command actor',
  async (key) => {
    const actor = createActor(commandBarMachine, {
      input: {
        commands: [],
        wasmInstancePromise: Promise.resolve({} as ModuleType),
        machineManager: {} as MachineManager,
      },
    }).start()
    const registry = new Registry()
    registry.configure([
      sceneBrowserExtension,
      featureTreeExtension,
      keymapExtension,
      defineRegistryItem({
        providesServices: [
          provideService(fileOperationsService, testFileOperations),
          provideService(commandSystemService, {
            actor,
            send: (event) => actor.send(event),
            useState: () => actor.getSnapshot(),
          }),
          provideService(userFeaturesService, {
            context: signal({
              featureIds: new Set([SCENE_BROWSER_FEATURE]),
            } as UserFeaturesContext),
          } as unknown as UserFeaturesRegistryService),
        ],
      }),
    ])
    actor.send({
      type: 'Add commands',
      data: { commands: [...registry.get(commandsValueSpec)] },
    })
    registry.get(keymapService).applyScope(SCENE_BROWSER_FOCUSED_SCOPE)
    const browser = registry.get(sceneBrowserService)
    const edit = vi.fn()
    const select = vi.fn()
    function Tree() {
      const [selected, setSelected] = useState(false)
      return (
        <FeatureTree onMount={browser.setTree}>
          <FeatureTreeRow
            nodeId="sketch"
            label="Sketch"
            selected={selected}
            onSelect={() => {
              select()
              flushSync(() => setSelected(true))
            }}
            onDoubleClick={edit}
          />
        </FeatureTree>
      )
    }
    const view = render(<Tree />)
    try {
      const row = view.container.querySelector<HTMLElement>(
        'zoo-feature-tree-row'
      )!
      await waitFor(() => expect(row.getAttribute('role')).toBe('treeitem'))
      row.focus()
      fireEvent.keyDown(row, { key })
      expect(select).toHaveBeenCalledOnce()
      expect(edit).not.toHaveBeenCalled()
      fireEvent.keyDown(row, { key, shiftKey: true })
      await waitFor(() => expect(edit).toHaveBeenCalledOnce())
      expect(select).toHaveBeenCalledTimes(2)
      expect(browser.tree.value?.selectedIds).toEqual(['sketch'])
    } finally {
      view.unmount()
      registry[Symbol.dispose]()
      actor.stop()
    }
  }
)
