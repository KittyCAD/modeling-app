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
import { kclLanguageServerService } from '@src/contracts/kclLsp'
import {
  keybindingScopesValueSpec,
  keybindingService,
} from '@src/contracts/keybindings'
import { projectSessionService } from '@src/contracts/projectSession'
import { selectionService } from '@src/contracts/selection'
import {
  baselineCapability,
  readOnlyCapability,
} from '@src/features/editorCapabilities/baseline'
import { createExecutionAdapterCapability } from '@src/features/editorCapabilities/executionAdapter'
import {
  CODE_EDITOR_SCOPE,
  createKeymapScopeCapability,
} from '@src/features/editorCapabilities/keymapScope'
import { languageCapability } from '@src/features/editorCapabilities/language'
import { createPersistenceCapability } from '@src/features/editorCapabilities/persistence'
import { createSelectionRevealCapability } from '@src/features/editorCapabilities/selectionReveal'
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
    // Optional, and asked per result: a build without a language server keeps
    // the gutter, and one with a server that is not running keeps it too.
    diagnosticsOwnedElsewhere: (languageId) =>
      ctx.services
        .optional(kclLanguageServerService)
        ?.ownsDiagnosticsFor(languageId) ?? false,
    coordinator: () => ctx.services.get(executionCoordinatorService),
    captureSnapshot: () =>
      ctx.services
        .get(projectSessionService)
        .current.peek()
        ?.captureSnapshot() ?? null,
  })

  /**
   * Reveal the code behind a selection.
   *
   * Optional, so a build with no selection feature is unchanged. Only the
   * executing buffer gets it, since the artifact graph describes that program.
   */
  const selectionReveal = createSelectionRevealCapability({
    selection: () => ctx.services.optional(selectionService),
  })

  const keymapScope = createKeymapScopeCapability({
    keys: () => ctx.services.get(keybindingService),
  })

  return {
    item: defineRuntimeRegistryItem({
      id: 'editorCapabilities',
      provides: [
        /**
         * The scope a focused buffer holds.
         *
         * Above `base` so a binding declared here beats the app-wide one for the
         * same keys, and `textEntry` because what is focused is taking
         * characters — an unmodified key belongs to the document, not to the
         * keymap.
         */
        provide(keybindingScopesValueSpec, {
          id: CODE_EDITOR_SCOPE,
          displayName: 'Code editor focused',
          priority: 1000,
          textEntry: true,
        }),

        provide(editorCapabilitiesValueSpec, keymapScope),
        provide(editorCapabilitiesValueSpec, selectionReveal),
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
