import { defineRegistryItemFactory, provideService } from '@kittycad/registry'
import { createProjectSessionService } from '@src/lib/projectSession/next/session'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'

const id = 'project-session-next-extension'

export default withProjectShellFeature(
  defineRegistryItemFactory((ctx) => {
    const service = createProjectSessionService(() =>
      ctx.services.get(fileOperationsService)
    )
    return {
      id,
      providesServices: [provideService(projectSessionService, service)],
      dispose: service.closeProject,
    }
  }, id),
  id
)
