import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed } from '@preact/signals'
import { authService } from '@src/contracts/auth'
import { commandsValueSpec } from '@src/contracts/commands'
import { fileSystemService } from '@src/contracts/fileSystem'
import { fsOperationQueueService } from '@src/contracts/fsOperations'
import { keybindingsValueSpec } from '@src/contracts/keybindings'
import { layoutAreasValueSpec, layoutService } from '@src/contracts/layout'
import { projectSessionService } from '@src/contracts/projectSession'
import { ZOOKEEPER_AREA_ID, zookeeperService } from '@src/contracts/zookeeper'
import {
  ZookeeperHeaderActions,
  ZookeeperPanel,
} from '@src/features/zookeeper/ZookeeperPanel'
import { createZookeeperService } from '@src/features/zookeeper/createZookeeperService'

/**
 * The CAD agent, as a collaborator in the project session.
 *
 * The feature contributes a panel, a service, and two commands — no layout
 * placement, which belongs to whichever preset wants it, and no engine or buffer
 * knowledge, which it reaches through contracts. `deriveEdit.ts` is the only part
 * that knows the Zookeeper protocol; everything about *applying* a remote
 * writer's edits lives in `src/lib/collab/` and is meant to be shared with human
 * live-collab when it arrives.
 */
export default defineRegistryItemFactory((ctx) => {
  /*
   * Lazy, and never resolved in this body: the graph is still being flattened
   * here, and resolving a service now is the first of the container's two rules.
   */
  const auth = () => ctx.services.get(authService)
  const sessions = () => ctx.services.get(projectSessionService)
  const fileSystem = () => ctx.services.get(fileSystemService)
  const queue = () => ctx.services.get(fsOperationQueueService)
  const layout = () => ctx.services.get(layoutService)

  let built: ReturnType<typeof createZookeeperService> | null = null

  /**
   * The real service, built on first use.
   *
   * It needs three other services, so it cannot be constructed here. Everything
   * exposed below defers to this through a `computed` or a method call, both of
   * which run long after flattening — the workaround the container documents.
   */
  const zookeeper = () => {
    built ??= createZookeeperService({
      auth: auth(),
      sessions: sessions(),
      fileSystem: fileSystem(),
      queue: queue(),
      /*
       * Absent in a build with no service configured, which is a supported state
       * rather than a misconfiguration: the panel says so once instead of failing
       * to connect over and over.
       */
      url: import.meta.env?.VITE_ZOOKEEPER_WEBSOCKET_URL as string | undefined,
    })
    return built
  }

  const openPanelAndConversation = () => {
    // Opening a conversation with the panel shut would leave somebody waiting on
    // something they cannot see.
    if (!layout().isAreaOpen(ZOOKEEPER_AREA_ID).peek()) {
      layout().toggleArea(ZOOKEEPER_AREA_ID)
    }
    zookeeper().open()
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'zookeeper',
      providesServices: [
        provideService(zookeeperService, {
          conversations: computed(() => zookeeper().conversations.value),
          active: computed(() => zookeeper().active.value),
          available: computed(() => zookeeper().available.value),
          unavailableReason: computed(
            () => zookeeper().unavailableReason.value
          ),
          open: () => zookeeper().open(),
          close: (id) => zookeeper().close(id),
          activate: (id) => zookeeper().activate(id),
          conversation: (id) => zookeeper().conversation(id),
          holderOf: (path) => zookeeper().holderOf(path),
          stored: computed(() => zookeeper().stored.value),
          resume: (id) => zookeeper().resume(id),
          forget: (id) => zookeeper().forget(id),
        }),
      ],
      provides: [
        provide(layoutAreasValueSpec, {
          id: ZOOKEEPER_AREA_ID,
          title: 'Zookeeper',
          icon: 'elephant',
          shortcut: '⌘3',
          render: () => <ZookeeperPanel />,
          headerActions: () => <ZookeeperHeaderActions />,
        }),

        provide(commandsValueSpec, {
          id: 'zookeeper.toggle',
          title: 'Toggle Zookeeper',
          category: 'View',
          icon: 'elephant',
          shortcut: '⌘3',
          run: () => layout().toggleArea(ZOOKEEPER_AREA_ID),
        }),
        provide(commandsValueSpec, {
          id: 'zookeeper.newConversation',
          title: 'New Zookeeper conversation',
          category: 'Zookeeper',
          icon: 'elephant',
          enabled: computed(() => zookeeper().available.value),
          run: openPanelAndConversation,
        }),

        provide(keybindingsValueSpec, {
          keystrokes: ['Mod+3'],
          commandId: 'zookeeper.toggle',
        }),
      ],
    }),
  }
}, 'zookeeper')
