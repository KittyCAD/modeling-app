import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { effect, signal } from '@preact/signals-core'
import type { ZDSProject } from '@src/lib/projectSession'
import type { MigrationController } from '@src/lib/kclMigration/controller'
import { authService } from '@src/registry/contracts/auth'
import {
  type KclMigrationService,
  type MigrationTurn,
  kclMigrationService,
} from '@src/registry/contracts/kclMigration'
import { projectSession } from '@src/registry/contracts/projectSession'

const migrationSession = defineRegistryItemFactory((ctx) => {
  const auth = ctx.services.signal(authService)
  const projects = ctx.services.signal(projectSession)
  const controller = signal<MigrationController | undefined>(undefined)
  const turns = signal<readonly MigrationTurn[]>([])
  let owner: ZDSProject | undefined
  let token: string | undefined
  const clear = () => {
    controller.peek()?.dispose()
    for (const turn of turns.peek()) turn.controller.dispose()
    turns.value = []
    controller.value = undefined
    owner = undefined
    token = undefined
  }
  let stop: (() => void) | undefined
  const service: KclMigrationService = {
    controller,
    turns,
    clearConversation: clear,
    start(project, create, afterExchange) {
      if (project !== projects.peek()?.project.peek()) return
      const previous = service.getOrCreate(project, create)
      if (previous?.busy || previous?.phase.peek() === 'recovery_required')
        return
      const attempt = previous?.phase.peek() === 'idle' ? previous : create()
      controller.value = attempt
      turns.value = [
        ...turns.peek(),
        { id: crypto.randomUUID(), afterExchange, controller: attempt },
      ]
      void attempt.start()
    },
    getOrCreate(project, create) {
      if (project !== projects.peek()?.project.peek()) return undefined
      if (!controller.peek()) {
        owner = project
        token = auth.peek()?.token.peek()
        controller.value = create()
        // Start after registry construction. Keep observing when the pane closes.
        stop ??= effect(() => {
          const currentProject = projects.value?.project.value
          const currentToken = auth.value?.token.value
          if (owner && (owner !== currentProject || token !== currentToken))
            clear()
        })
      }
      return controller.peek()
    },
  }
  return {
    item: defineRuntimeRegistryItem({
      id: 'kcl-migration-session',
      providesServices: [provideService(kclMigrationService, service)],
      dispose: () => {
        stop?.()
        clear()
      },
    }),
  }
}, 'kcl-migration-session')

export default defineRegistryItem({
  id: 'kcl-migration',
  uses: [migrationSession],
})
