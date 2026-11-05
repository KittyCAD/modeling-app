import { defineRegistryItemFactory, provideService } from '@kittycad/registry'
import { createProjectSessionService } from '@src/lib/projectSession/next/session'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import { IS_STAGING_OR_DEBUG } from '@src/routes/utils'

const id = 'project-session-next-extension'

export default defineRegistryItemFactory((ctx) => {
  if (!IS_STAGING_OR_DEBUG) return { id }
  const service = createProjectSessionService(() =>
    ctx.services.get(fileOperationsService)
  )
  return {
    id,
    providesServices: [provideService(projectSessionService, service)],
    dispose: service.closeProject,
  }
}, id)
