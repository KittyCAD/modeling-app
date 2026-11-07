import { editorMatchContext } from '@src/lib/editors/matching'
import type { ReadonlySignal } from '@preact/signals-core'
import type { Command } from '@src/lib/commandTypes'
import { loadProjectEditor } from '@src/lib/editors/loadProjectEditor'
import type { EditorsService } from '@src/lib/editors/registry/contract'
import type {
  ExecutorCapability,
  ExecutorsService,
  ExecutorViewContribution,
} from '@src/lib/executors/registry/contract'
import {
  viewsForSource,
  candidateViewsForSource,
} from '@src/lib/executors/views'
import fsZds from '@src/lib/fs-zds'
import { isErr } from '@src/lib/trap'
import { GLOBAL_COMMAND_SCOPES } from '@src/registry/contracts/commands'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import type {
  ProjectSessionService,
  OpenProjectSession,
} from '@src/lib/projectSession/next/contract'

export const OPEN_EXECUTOR_COMMAND = {
  id: 'zds.executors.open',
  name: 'open-executor',
  groupId: 'executors',
} as const

/** Choose an editor or unopened file, then a contributed view, before starting execution. */
export function createOpenExecutorCommand(
  executors: ExecutorsService,
  getEditors: () => EditorsService,
  getProjectSession: () => ProjectSessionService | undefined,
  getFileOperations: () => Pick<FileOperationsRegistryService, 'readFile'>,
  capabilities: ReadonlySignal<readonly ExecutorCapability[]>,
  views: ReadonlySignal<readonly ExecutorViewContribution[]>
): Command {
  let pending: AbortController | undefined
  const editorKeys = new Map<symbol, string>()
  let nextKey = 0
  let prepared:
    | { src: string; contents: string; session: OpenProjectSession }
    | undefined
  const applicable = (src: string, contents?: string) => {
    const knownContents =
      contents ??
      (prepared?.src === src &&
      prepared.session === getProjectSession()?.currentSession.peek()
        ? prepared.contents
        : undefined)
    return knownContents === undefined
      ? candidateViewsForSource(src, capabilities.value, views.value)
      : viewsForSource(
          { src, contents: knownContents },
          capabilities.value,
          views.value
        )
  }
  const sources = () => {
    const editors = getEditors().editors.value
    for (const id of editorKeys.keys()) {
      if (!editors.some((editor) => editor.id === id)) editorKeys.delete(id)
    }
    const project = getProjectSession()?.currentProject.value
    const label = (src: string) =>
      project ? fsZds.relative(project.contents.path, src) : src
    return [
      ...editors
        .filter(
          (editor) =>
            applicable(editor.src.value ?? '', editor.contents.value).length > 0
        )
        .map((editor, index) => {
          if (!editorKeys.has(editor.id))
            editorKeys.set(editor.id, `editor:${nextKey++}`)
          return {
            value: editorKeys.get(editor.id)!,
            name: `${editor.src.value ? label(editor.src.value) : 'Untitled'} (${editors.filter((other) => other.src.value === editor.src.value).length > 1 ? `editor ${index + 1}` : 'open editor'})`,
            src: editor.src.value ?? '',
            contents: editor.contents.value,
            editor,
          }
        }),
      ...(getProjectSession()?.listFiles() ?? [])
        .filter(
          (file) => !editors.some((editor) => editor.src.value === file.path)
        )
        .filter((file) => applicable(file.path).length > 0)
        .map((file) => ({
          value: file.path,
          name: label(file.path),
          src: file.path,
          contents: undefined,
          editor: undefined,
        })),
    ].sort((a, b) => a.name.localeCompare(b.name))
  }
  const sourceFor = (value: unknown) => {
    const current = sources()
    return (
      current.find((source) => source.value === value) ??
      current.find((source) => source.src === value)
    )
  }
  const viewOptions = (src: unknown) => {
    const source = sourceFor(src)
    return source
      ? applicable(source.src, source.contents).map((view) => ({
          name: view.label,
          value: view.id,
        }))
      : []
  }
  return {
    ...OPEN_EXECUTOR_COMMAND,
    displayName: 'Open executor',
    description: 'Open a file in a contributed executor view.',
    icon: 'code',
    scopes: GLOBAL_COMMAND_SCOPES,
    needsReview: false,
    args: {
      src: {
        displayName: 'Source',
        inputType: 'options',
        options: () => sources().map(({ name, value }) => ({ name, value })),
        required: true,
        // Only the selected unopened file is read; the project list stays synchronous.
        // Resolve content predicates before the next argument offers exact view choices.
        validation: async ({ data }) => {
          pending?.abort()
          const controller = new AbortController()
          pending = controller
          try {
            const source = sourceFor(data.src)
            if (!source) return 'The selected file is no longer available'
            if (source.editor) return true
            const session = getProjectSession()?.currentSession.peek()
            if (!session) return 'Open a project first'
            const bytes = await getFileOperations().readFile(source.src)
            if (
              controller.signal.aborted ||
              getProjectSession()?.currentSession.peek() !== session
            )
              return 'Opening the executor was cancelled'
            prepared = {
              src: source.src,
              contents: new TextDecoder().decode(bytes),
              session,
            }
            return (
              applicable(source.src).length > 0 ||
              'No executor view matches this file'
            )
          } catch (cause) {
            return isErr(cause)
              ? cause.message
              : 'Unable to read the selected file'
          } finally {
            if (pending === controller) pending = undefined
          }
        },
      },
      view: {
        displayName: 'View',
        inputType: 'options',
        options: ({ argumentsToSubmit }) => viewOptions(argumentsToSubmit.src),
        defaultValue: ({
          argumentsToSubmit,
        }: {
          argumentsToSubmit: Record<string, unknown>
        }) => viewOptions(argumentsToSubmit.src)[0]?.value,
        prepopulate: true,
        required: true,
      },
    },
    onCancel: () => {
      pending?.abort()
      prepared = undefined
    },
    onSubmit: async (data?: { src?: unknown; view?: unknown }) => {
      pending?.abort()
      const controller = new AbortController()
      pending = controller
      try {
        const source = sourceFor(data?.src)
        if (!source)
          return new Error(
            'The selected executor source is no longer available'
          )
        const requestedView = data?.view
        if (
          requestedView !== undefined &&
          !applicable(source.src, source.contents).some(
            (view) => view.id === requestedView
          )
        ) {
          return new Error('The selected executor view is no longer available')
        }
        const editors = getEditors()
        const session = getProjectSession()?.currentSession.peek()
        const editor =
          source.editor ??
          (await loadProjectEditor(
            source.src,
            editors,
            getProjectSession,
            getFileOperations,
            { signal: controller.signal, reuseExisting: true }
          ))
        if (isErr(editor)) return editor
        if (controller.signal.aborted)
          return new Error('Opening the executor was cancelled')
        if (getProjectSession()?.currentSession.peek() !== session) {
          return new Error('The project changed before the executor opened')
        }
        const available = viewsForSource(
          editorMatchContext(editor),
          capabilities.peek(),
          views.peek()
        )
        const view =
          requestedView === undefined
            ? available[0]
            : available.find((view) => view.id === requestedView)
        if (!editors.editors.peek().includes(editor) || !view) {
          return new Error('The selected executor view is no longer available')
        }
        return executors.openView(editor, view.id)
      } finally {
        if (pending === controller) pending = undefined
      }
    },
  }
}
