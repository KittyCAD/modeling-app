import { projectSessionService } from '@src/lib/projectSession/next/contract'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'
import { createProjectSessionService } from '@src/lib/projectSession/next/session'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import { fileOperationsExtension } from '@src/registry/extensions/fileOperations'
import { factory as defineFactory, provide, type Factory } from 'plankton'

const id = 'project-session-next-extension'
export const createProjectSessionExtension = (
  files: Factory<{
    operations: FileOperationsRegistryService
  }> = fileOperationsExtension
) =>
  withProjectShellFeature(
    defineFactory({
      dependencies: { files },
      key: id,
      create: ({ files }) => {
        const service = createProjectSessionService(files.operations)
        return {
          items: [provide(projectSessionService, service)],
          dispose: service.closeProject,
        }
      },
    }),
    id
  )

export default createProjectSessionExtension()
