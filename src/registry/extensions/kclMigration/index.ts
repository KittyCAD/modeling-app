import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { effect, signal } from '@preact/signals-core'
import type { ZDSProject } from '@src/lang/KclManager'
import type { MigrationController } from '@src/lib/kclMigration/controller'
import { authService } from '@src/registry/contracts/auth'
import {
  type KclMigrationService,
  kclMigrationService,
} from '@src/registry/contracts/kclMigration'
import { projectSession } from '@src/registry/contracts/projectSession'

const migrationSession = defineRegistryItemFactory((ctx) => {
  const auth = ctx.services.signal(authService)
  const projects = ctx.services.signal(projectSession)
  const controller = signal<MigrationController | undefined>(undefined)
  let owner: ZDSProject | undefined
  let token: string | undefined
  const clear = () => {
    controller.peek()?.dispose()
    controller.value = undefined
    owner = undefined
    token = undefined
  }
  let stop: (() => void) | undefined
  const service: KclMigrationService = {
    controller,
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
