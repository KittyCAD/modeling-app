import { projectSessionService } from '@src/lib/projectSession/next/contract'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'
import { createProjectSessionService } from '@src/lib/projectSession/next/session'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { extension as defineExtension, provide } from 'plankton'

const id = 'project-session-next-extension'
export default withProjectShellFeature(
  defineExtension({
    key: id,
    create: (_dependencies, ctx) => {
      const service = createProjectSessionService(() =>
        ctx.required(fileOperationsService)
      )
      return {
        items: [provide(projectSessionService, service)],
        dispose: service.closeProject,
      }
    },
  }),
  id
)
