import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import {
  editorCapabilitiesValueSpec,
  editorThemesValueSpec,
} from '@src/contracts/buffers'
import { fileSystemService } from '@src/contracts/fileSystem'
import { executionCoordinatorService } from '@src/contracts/execution'
import { fsOperationQueueService } from '@src/contracts/fsOperations'
import { projectSessionService } from '@src/contracts/projectSession'
import {
  baselineCapability,
  readOnlyCapability,
} from '@src/features/editorCapabilities/baseline'
import { createExecutionAdapterCapability } from '@src/features/editorCapabilities/executionAdapter'
import { languageCapability } from '@src/features/editorCapabilities/language'
import { createPersistenceCapability } from '@src/features/editorCapabilities/persistence'
import { zooEditorTheme } from '@src/features/editorCapabilities/theme'

/**
 * The capabilities every buffer is built from.
 *
 * Contributions, not a hard-coded extension list, so a plugin can add a
 * capability — or replace one of these by re-declaring its id — without touching
 * the buffer implementation. Ordering is explicit because CodeMirror resolves
 * conflicts by precedence, and precedence decided by import order is precedence
 * decided by accident.
 */
export default defineRegistryItemFactory((ctx) => {
  const persistence = createPersistenceCapability({
    fileSystem: () => ctx.services.get(fileSystemService),
    queue: () => ctx.services.get(fsOperationQueueService),
  })

  const executionAdapter = createExecutionAdapterCapability({
    coordinator: () => ctx.services.get(executionCoordinatorService),
    captureSnapshot: () =>
      ctx.services
        .get(projectSessionService)
        .current.peek()
        ?.captureSnapshot() ?? null,
  })

  return {
    item: defineRuntimeRegistryItem({
      id: 'editorCapabilities',
      provides: [
        provide(editorCapabilitiesValueSpec, readOnlyCapability),
        provide(editorCapabilitiesValueSpec, baselineCapability),
        provide(editorCapabilitiesValueSpec, languageCapability),
        provide(editorCapabilitiesValueSpec, persistence),
        provide(editorCapabilitiesValueSpec, executionAdapter),
        provide(editorThemesValueSpec, zooEditorTheme),
      ],
    }),
  }
}, 'editorCapabilities')
