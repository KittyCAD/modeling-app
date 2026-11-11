import { python } from '@codemirror/lang-python'
import {
  defineRegistryItemFactory,
  provide,
  provideService,
} from '@kittycad/registry'
import { createElement } from 'react'
import {
  codeEditorExtensionValueSpec,
  editorLanguageValueSpec,
  editorViewValueSpec,
} from '@src/lib/editors/registry/contract'
import { defineEditorView } from '@src/lib/editors/views'
import { executionContext } from '@src/lib/executors/context'
import {
  executorsService,
  executorCapabilityValueSpec,
} from '@src/lib/executors/registry/contract'
import {
  isPyorigamiSource,
  matchesPyorigami,
  PYORIGAMI_DOCUMENT,
} from '@src/lib/pyorigami/document'
import { pyorigamiExecutorCapability } from '@src/lib/pyorigami/executor'
import {
  authoringService,
  pyorigamiAuthoringService,
} from '@src/lib/pyorigami/authoring'
import { keymapEventOwnersValueSpec } from '@src/registry/contracts/keymap'
import { PyorigamiView } from '@src/lib/pyorigami/PyorigamiView'

export const pyorigamiExtension = defineRegistryItemFactory(
  ({ services }) => ({
    id: 'pyorigami.document',
    providesServices: [
      provideService(pyorigamiAuthoringService, authoringService),
    ],
    provides: [
      provide(keymapEventOwnersValueSpec, {
        id: 'pyorigami.history',
        scope: 'pyorigami.history.focused',
        owns: (event) =>
          (event.metaKey || event.ctrlKey) &&
          !event.altKey &&
          ['z', 'y'].includes(event.key.toLowerCase()) &&
          event
            .composedPath()
            .some(
              (target) =>
                target instanceof HTMLElement &&
                target.hasAttribute('data-pyorigami-editor')
            ),
      }),
      provide(editorLanguageValueSpec, {
        id: PYORIGAMI_DOCUMENT,
        mediaType: 'text/x-python',
        matches: isPyorigamiSource,
      }),
      provide(codeEditorExtensionValueSpec, {
        id: 'pyorigami.python',
        matches: matchesPyorigami,
        extensions: [python()],
      }),
      provide(executorCapabilityValueSpec, pyorigamiExecutorCapability),
      provide(
        editorViewValueSpec,
        defineEditorView((host) => {
          const lifetime = new AbortController()
          host.onDispose(() => lifetime.abort())
          return {
            ...executionContext(pyorigamiExecutorCapability, () =>
              services.get(executorsService)
            )(host),
            authoring: services.get(pyorigamiAuthoringService),
            signal: lifetime.signal,
          }
        })({
          id: 'pyorigami.diagram',
          label: 'Origami',
          matches: matchesPyorigami,
          Component: ({ context, editor }) =>
            createElement(PyorigamiView, {
              executor: context.executor,
              editor,
              authoring: context.authoring,
              signal: context.signal,
            }),
        })
      ),
    ],
  }),
  'pyorigami.document'
)
