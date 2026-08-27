import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { computed } from '@preact/signals'
import {
  type Command,
  commandService,
  commandsValueSpec,
} from '@src/contracts/commands'

/**
 * Resolves the contributed command list into a runnable registry.
 *
 * The service is deliberately thin. It does not own any commands, decide what
 * is available, or know about UI — it just turns a list of contributions into
 * something addressable by id, so a keybinding and a button can both reach the
 * same behaviour without either of them holding it.
 */
export default defineRegistryItemFactory((ctx) => {
  const all = computed(() => ctx.valueSpecs.get(commandsValueSpec))

  const byId = computed(() => {
    const map = new Map<string, Command>()
    // Later contributions lose to earlier ones, matching value-spec ordering.
    for (const command of all.value) {
      if (!map.has(command.id)) map.set(command.id, command)
    }
    return map
  })

  const get = (id: string) => byId.value.get(id)

  return {
    item: defineRuntimeRegistryItem({
      id: 'commands',
      providesServices: [
        provideService(commandService, {
          all,
          get,
          run: (id: string) => {
            const command = get(id)
            if (!command) {
              console.warn(`commands: no command registered for "${id}"`)
              return
            }
            if (command.enabled && !command.enabled.value) return

            // Commands may be async; a rejection is the command's own problem
            // to report, but it must not become an unhandled rejection.
            void Promise.resolve()
              .then(() => command.run())
              .catch((error) => {
                console.error(`commands: "${id}" failed`, error)
              })
          },
        }),
      ],
    }),
  }
}, 'commands')
