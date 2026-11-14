import { projectSessionService } from '@src/lib/projectSession/next/contract'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'
import { createProjectSessionService } from '@src/lib/projectSession/next/session'
import { observations as fileOperationsObservations } from '@src/registry/contracts/fileOperations'
import { factory as defineFactory, provide } from 'plankton'

const id = 'project-session-next-extension'
export default withProjectShellFeature(
  defineFactory({
    dependencies: { fileOperations: fileOperationsObservations },
    key: id,
    create: ({ fileOperations: fileOperationsInputs }) => {
      const service = createProjectSessionService(() =>
        fileOperationsInputs.fileOperationsService.required()
      )
      return {
        items: [provide(projectSessionService, service)],
        dispose: service.closeProject,
      }
    },
  }),
  id
)
