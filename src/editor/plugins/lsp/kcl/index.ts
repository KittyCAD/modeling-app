import type { Extension } from '@codemirror/state'
import {
  EditorView,
  PluginValue,
  ViewPlugin,
  ViewUpdate,
} from '@codemirror/view'
import type {
  LanguageServerClient,
  LanguageServerOptions,
} from '@kittycad/codemirror-lsp-client'
import { lspPlugin } from '@kittycad/codemirror-lsp-client'
import {
  updateOutsideEditorEvent,
  editorCodeUpdateEvent,
  type KclManager,
} from '@src/lang/KclManager'

import { copilotPluginEvent } from '@src/editor/plugins/lsp/copilot'
import { processCodeMirrorRanges } from '@src/lib/selections'
import { deferExecution } from '@src/lib/utils'
import type {
  SceneGraphDelta,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { kclManager } from '@src/lib/singletons'

/** Debounce for execution in ms */
const changesDelay = 600

type KclPluginDeps = {
  client: LanguageServerClient
  kclManager: KclManager
}

class KclPlugin {
  private kclManager: KclManager

  constructor(view: EditorView, systemDeps: KclPluginDeps) {
    this.kclManager = systemDeps.kclManager
    /**
     * TODO: Until we wrangle all the ways we destroy and recreate the EditorView,
     * we need this block of code to set the document value when the LSP is ready.
     */
    hackSetInitialCodeOnLspClientLoad(
      view.state.doc.toString(),
      systemDeps.client,
      systemDeps.kclManager
    )
  }

  update(viewUpdate: ViewUpdate) {
    /** THIS IS A HACK. TODO: NEVER OVERWRITE THE EDITORVIEW */
    this.kclManager.setEditorView(viewUpdate.view)

    this.highlightEngineEntitiesEffect(viewUpdate)
    this.executeKclEffect(viewUpdate)
  }

  /**
   * This is a CodeMirror extension that listens for selection events
   * and fires off engine commands to highlight the corresponding engine entities.
   * It is not debounced.
   */
  highlightEngineEntitiesEffect = (update: ViewUpdate) => {
    if (update.transactions.some((tr) => tr.isUserEvent('select'))) {
      this.kclManager.handleOnViewUpdate(update, processCodeMirrorRanges)
    }
  }

  /**
   * This is a CodeMirror extension that watches for updates to the document,
   * discerns if the change is a kind that we want to re-execute on,
   * then fires (and forgets) an execution with a debounce.
   */
  executeKclEffect = (update: ViewUpdate) => {
    const executeKclDeferred = deferExecution(
      async ({ newCode }: { newCode: string }) => {
        const modelingState = this.kclManager.modelingState
        if (modelingState?.matches('sketchSolveMode')) {
          await hackExecutionForSketchSolve(newCode, this.kclManager)
        } else {
          await this.kclManager.executeCode()
        }
      },
      changesDelay
    )

    const shouldExecute =
      update.docChanged &&
      update.transactions.some((tr) => {
        // The old KCL ViewPlugin had checks that seemed to check for
        // certain events, but really they just set the already-true to true.
        // Leaving here in case we need to switch to an opt-in listener.
        // const relevantEvents = [
        //   tr.isUserEvent('input'),
        //   tr.isUserEvent('delete'),
        //   tr.isUserEvent('undo'),
        //   tr.isUserEvent('redo'),
        //   tr.isUserEvent('move'),
        //   tr.annotation(lspRenameEvent.type),
        //   tr.annotation(lspCodeActionEvent.type),
        // ]
        const ignoredEvents = [
          tr.annotation(editorCodeUpdateEvent.type),
          tr.annotation(copilotPluginEvent.type),
          tr.annotation(updateOutsideEditorEvent.type),
        ]

        return !ignoredEvents.some((v) => Boolean(v))
      })

    if (shouldExecute) {
      const newCode = update.view.state.doc.toString()
      const oldCode = update.startState.doc.toString()
      const anotherCode = update.state.doc.toString()

      console.log('from Execution', {
        newCode,
        oldCode,
        anotherCode,
      })

      this.kclManager.code = newCode
      void this.kclManager.writeToFile(newCode).then(() => {
        executeKclDeferred({ newCode })
      })
    }
  }
}

export function kclPlugin(
  options: LanguageServerOptions,
  systemDeps: {
    kclManager: KclManager
  }
): Extension {
  return [
    lspPlugin(options),
    ViewPlugin.fromClass(KclPlugin).of({
      client: options.client,
      kclManager: systemDeps.kclManager,
    }),
  ]
}

/**
 * Gotcha: Code can be written into the CodeMirror editor but not propagated to kclManager.code
 * because the update function has not run. We need to initialize the kclManager.code when lsp initializes
 * because new code could have been written into the editor before the update callback is initialized.
 * There appears to be limited ways to safely get the current doc content. This appears to be sync and safe.
 */
function hackSetInitialCodeOnLspClientLoad(
  code: string,
  client: LanguageServerClient,
  kclManager: KclManager
) {
  const kclLspPlugin = client.plugins.find((plugin) => {
    return plugin.client.name === 'kcl'
  })
  if (kclLspPlugin) {
    kclManager.code = code
  }
}

/**
 * If we're in sketchSolveMode, update Rust state with the latest AST
 * This handles the case where the user directly edits in the CodeMirror editor
 * these are short term hacks while in rapid development for sketch revamp
 * should be clean up.
 */
async function hackExecutionForSketchSolve(
  newCode: string,
  kclManager: KclManager
) {
  try {
    const modelingState = kclManager.modelingState
    if (modelingState?.matches('sketchSolveMode')) {
      await kclManager.executeCode(newCode)
      const { sceneGraph, execOutcome } = await kclManager.hackSetProgram(
        await jsAppSettings()
      )

      // Convert SceneGraph to SceneGraphDelta and send to sketch solve machine
      const sceneGraphDelta: SceneGraphDelta = {
        new_graph: sceneGraph,
        new_objects: [],
        invalidates_ids: false,
        exec_outcome: execOutcome,
      }

      const kclSource: SourceDelta = {
        text: newCode,
      }

      // Send event to sketch solve machine via modeling machine
      kclManager.sendModelingEvent({
        type: 'update sketch outcome',
        data: {
          kclSource,
          sceneGraphDelta,
        },
      })
    }
  } catch (error) {
    console.error('Error when updating Rust state after user edit:', error)
  }
}
