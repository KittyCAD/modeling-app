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
import { statusBarItemsValueSpec } from '@src/contracts/shell'
import { projectSessionService } from '@src/contracts/projectSession'
import { ZOOKEEPER_AREA_ID, zookeeperService } from '@src/contracts/zookeeper'
import {
  ZookeeperHeaderActions,
  ZookeeperPanel,
  ZookeeperPresenceField,
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

  /**
   * The most recent turn of the active conversation that changed anything.
   *
   * The *active* one rather than the most recent across all of them: with two
   * conversations open, "revert the last turn" has to mean the one you are
   * looking at, or the command does something the panel does not explain.
   */
  const lastRevertibleTurn = () => {
    const service = zookeeper()
    const id = service.active.value
    if (id === null) return null

    const conversation = service.conversations.value.get(id)
    if (conversation === undefined) return null

    const turn = [...conversation.transcript.value]
      .reverse()
      .find((each) => each.paths.length > 0)
    return turn === undefined ? null : { conversation, turnId: turn.id }
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
          presence: computed(() => zookeeper().presence.value),
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

        /*
         * Revert as a command, not a keystroke.
         *
         * Cmd+Z is per-buffer and a turn can span files, so binding this to it
         * would need an extension in front of `historyKeymap` — a keymap
         * precedence change affecting every buffer. The palette and the
         * transcript's own button are already strictly better than undoing a
         * multi-file turn one pane at a time.
         */
        provide(commandsValueSpec, {
          id: 'zookeeper.revertLastTurn',
          title: 'Revert Zookeeper’s last turn',
          category: 'Zookeeper',
          icon: 'arrowRotateLeft',
          enabled: computed(() => lastRevertibleTurn() !== null),
          run: () => {
            const target = lastRevertibleTurn()
            if (target === null) return
            target.conversation.revert(target.turnId)
          },
        }),

        provide(statusBarItemsValueSpec, {
          id: 'zookeeper.presence',
          zone: 'end',
          order: -20,
          render: () => <ZookeeperPresenceField />,
        }),

        provide(keybindingsValueSpec, {
          keystrokes: ['Mod+3'],
          commandId: 'zookeeper.toggle',
        }),
      ],
    }),
  }
}, 'zookeeper')
