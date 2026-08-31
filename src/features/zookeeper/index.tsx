import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed } from '@preact/signals'
import { createAppPlugin } from '@src/app/createAppPlugin'
import { authService } from '@src/contracts/auth'
import { commandsValueSpec } from '@src/contracts/commands'
import {
  type CreditConsumer,
  creditConsumersValueSpec,
} from '@src/contracts/credits'
import { fileSystemService } from '@src/contracts/fileSystem'
import { fsOperationQueueService } from '@src/contracts/fsOperations'
import { keybindingsValueSpec } from '@src/contracts/keybindings'
import { layoutAreasValueSpec, layoutService } from '@src/contracts/layout'
import { statusBarItemsValueSpec } from '@src/contracts/shell'
import {
  changeHistoryService,
  projectHistoryService,
} from '@src/contracts/projectHistory'
import { projectSessionService } from '@src/contracts/projectSession'
import { ZOOKEEPER_AREA_ID, zookeeperService } from '@src/contracts/zookeeper'
import {
  ZookeeperHeaderActions,
  ZookeeperPanel,
  ZookeeperPresenceField,
} from '@src/features/zookeeper/ZookeeperPanel'
import { createZookeeperService } from '@src/features/zookeeper/createZookeeperService'
import { zookeeperServiceUrl } from '@src/features/zookeeper/serviceUrl'

export const ZOOKEEPER_PLUGIN_ID = 'zookeeper'

/**
 * A project's name, from the path a conversation was stamped with.
 *
 * The last segment, because that is what the app calls a project everywhere else
 * — the breadcrumbs, the home list — and a credits breakdown showing absolute
 * paths would be the only place in the app that did.
 */
function projectNameOf(path: string | null): string | null {
  if (path === null) return null
  const name = path
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .pop()
  return name === undefined || name === '' ? null : name
}

/**
 * The CAD agent, as a collaborator in the project session.
 *
 * The feature contributes a panel, a service, and two commands — no layout
 * placement, which belongs to whichever preset wants it, and no engine or buffer
 * knowledge, which it reaches through contracts. `deriveEdit.ts` is the only part
 * that knows the Zookeeper protocol; everything about *applying* a remote
 * writer's edits lives in `src/lib/collab/` and is meant to be shared with human
 * live-collab when it arrives.
 *
 * Everything is inside the plugin slot, including the service — so turning
 * Zookeeper off removes it rather than leaving an inert copy behind. Nothing
 * outside this directory reads `zookeeperService`, which is what makes that
 * possible; the one thing that does cross the boundary is `ZOOKEEPER_AREA_ID`,
 * named by the modelling layout preset, and a rail drops an area id that no
 * longer resolves.
 */
const zookeeperFeature = defineRegistryItemFactory((ctx) => {
  /*
   * Lazy, and never resolved in this body: the graph is still being flattened
   * here, and resolving a service now is the first of the container's two rules.
   */
  const auth = () => ctx.services.get(authService)
  const sessions = () => ctx.services.get(projectSessionService)
  const fileSystem = () => ctx.services.get(fileSystemService)
  const queue = () => ctx.services.get(fsOperationQueueService)
  const changeHistory = () => ctx.services.get(changeHistoryService)
  const projectHistory = () => ctx.services.get(projectHistoryService)
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
      changeHistory: changeHistory(),
      projectHistory: projectHistory(),
      /*
       * Derived from the API host, so a build that was configured for nothing in
       * particular still reaches the service. Undefined only when the host is
       * unusable, which the panel reports once rather than retrying forever.
       */
      url: zookeeperServiceUrl({
        override: import.meta.env?.VITE_ZOOKEEPER_WEBSOCKET_URL as
          | string
          | undefined,
        apiBaseUrl: import.meta.env?.VITE_KC_API_BASE_URL as string | undefined,
      }),
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
      /*
       * Not `zookeeper`: that is the plugin node's id, and the registry dedupes
       * items by id while flattening — a collision silently skips the whole
       * subtree, taking every service and contribution below it with it.
       */
      id: 'zookeeper.feature',
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
          canRevert: (turnId) => zookeeper().canRevert(turnId),
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
          // Presence is per-file, so it can only mean something with a project
          // open. Home is a place in Zookeeper, but not a file it can edit.
          visible: computed(() => sessions().current.value !== null),
          render: () => <ZookeeperPresenceField />,
        }),

        /*
         * What Zookeeper is spending, for the account-level credits readout.
         *
         * Contributed rather than pushed, so that turning this plugin off takes
         * the contribution with it and the readout simply has nothing spending.
         * Credits knows nothing about conversations; this is the whole of what it
         * is told.
         *
         * One consumer per *streaming turn*, not per conversation: a turn is the
         * unit of spending, so an idle conversation with ten turns behind it is
         * costing nothing and should not be listed as though it were.
         */
        provide(creditConsumersValueSpec, {
          id: 'zookeeper.conversations',
          consumers: computed<readonly CreditConsumer[]>(() => {
            const open = [...zookeeper().conversations.value.values()]
            return open.flatMap((conversation, index) => {
              if (conversation.status.value !== 'streaming') return []
              const turn = conversation.transcript.value.at(-1)
              if (turn === undefined) return []
              return [
                {
                  // Per turn, so a new turn reads as a new span rather than
                  // inheriting the previous one's elapsed time.
                  id: `${conversation.id}:${turn.id}`,
                  kind: 'zookeeper.conversation' as const,
                  // Numbered by position, the same way the panel's tabs are.
                  label: `Conversation ${index + 1}`,
                  project: projectNameOf(conversation.projectPath),
                  startedAt: turn.at,
                },
              ]
            })
          }),
        }),

        provide(keybindingsValueSpec, {
          keystrokes: ['Mod+3'],
          commandId: 'zookeeper.toggle',
        }),
      ],
    }),
  }
}, 'zookeeper')

const zookeeperPlugin = createAppPlugin({
  id: ZOOKEEPER_PLUGIN_ID,
  title: 'Zookeeper',
  description:
    'The CAD agent, as a collaborator in your project: a panel, live-applied edits, and attributed turns you can revert.',
  items: [zookeeperFeature],
  // On by default: it is a headline capability of the app rather than an
  // opt-in integration, and it costs nothing until a conversation is opened.
  enabledByDefault: true,
})

export default defineRegistryItem({
  id: 'zookeeper.plugin',
  uses: [zookeeperPlugin],
})
