import { syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { classHighlighter } from '@lezer/highlight'
import { useSignals } from '@preact/signals-react/runtime'
import {
  collectInlineFeatures,
  inlineFeaturesCompartment,
  inlineFeaturesField,
  inlineFeaturesTheme,
  inlinePlanesField,
  revealInlineFeature,
  setInlineFeatures,
  setInlinePlanes,
} from '@src/editor/plugins/inlineFeatures'
import { toUtf16 } from '@src/lang/errors'
import { getOperationsForCurrentFile } from '@src/lang/wasm'
import { useSingletons } from '@src/lib/boot'
import {
  InlineFeatureItem,
  InlineFeaturePlanes,
} from '@src/lib/featureTree/FeatureTreePane'
import { getOperationKey } from '@src/lib/featureTree/featureTreeOperationTree'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

/** Portals keep widgets under the app's existing React/modeling context. */
export function InlineFeatureCode() {
  useSignals()
  const { kclManager } = useSingletons()
  const view = kclManager.editorView
  const ast = kclManager.astSignal.value
  const execution = kclManager.execStateSignal.value
  const path = kclManager.path
  const code = kclManager.codeSignal.value
  const unsafe =
    kclManager.isExecuting ||
    kclManager.hasParseErrors() ||
    kclManager.hasEditsSinceLastExecutionSignal.value ||
    kclManager.errorsSignal.value.length > 0
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const planesHost = useMemo(() => {
    const host = document.createElement('div')
    host.className = 'cm-inline-planes'
    host.contentEditable = 'false'
    return host
  }, [])
  const features = useMemo(() => {
    if (unsafe || !ast || code !== kclManager.lastSuccessfulCode) {
      return []
    }
    return collectInlineFeatures(
      code,
      ast.body,
      getOperationsForCurrentFile({
        operationsByModule: execution.operations,
        filenames: execution.filenames,
        currentPath: path,
      }),
      (byte) => toUtf16(byte, code)
    ).map((feature) => {
      const host = document.createElement('div')
      host.className = 'cm-inline-feature'
      host.dataset.featureId = feature.id
      host.contentEditable = 'false'
      return { ...feature, host }
    })
  }, [ast, execution, path, code, unsafe, kclManager])

  useEffect(() => {
    view.dispatch({
      effects: [
        inlineFeaturesCompartment.reconfigure([
          inlineFeaturesField,
          inlinePlanesField,
          inlineFeaturesTheme,
          EditorView.editorAttributes.of({ 'data-inline-features': 'true' }),
          syntaxHighlighting(classHighlighter),
          EditorView.updateListener.of((update) => {
            const next = update.state.field(inlineFeaturesField).expanded
            if (
              next !==
              update.startState.field(inlineFeaturesField, false)?.expanded
            ) {
              setExpanded(next)
            }
          }),
        ]),
        setInlineFeatures.of(features),
        setInlinePlanes.of(planesHost),
      ],
    })
  }, [view, features, planesHost])

  useEffect(
    () => () => {
      view.dispatch({ effects: inlineFeaturesCompartment.reconfigure([]) })
    },
    [view]
  )

  return (
    <>
      {createPortal(<InlineFeaturePlanes />, planesHost)}
      {features.map((feature) =>
        createPortal(
          <div className="cm-inline-feature-operations">
            {feature.operations.map((item) => (
              <InlineFeatureItem
                key={getOperationKey(item)}
                item={item}
                codeDisclosure={{
                  expanded: expanded.has(feature.id),
                  onToggle: () =>
                    view.dispatch({
                      effects: revealInlineFeature.of({
                        id: feature.id,
                        expanded: !expanded.has(feature.id),
                      }),
                    }),
                }}
                onRevealCode={() =>
                  view.dispatch({
                    effects: revealInlineFeature.of({
                      id: feature.id,
                      expanded: true,
                    }),
                  })
                }
              />
            ))}
          </div>,
          feature.host,
          feature.id
        )
      )}
    </>
  )
}
