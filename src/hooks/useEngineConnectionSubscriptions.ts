import { useEffect, useRef } from 'react'

import { useModelingContext } from '@src/hooks/useModelingContext'
import { defaultSourceRange } from '@src/lang/sourceRange'
import { getCodeRefsByArtifactId } from '@src/lang/std/artifactGraph'
import {
  getEventForSelectWithPoint,
  selectSketchPlane,
} from '@src/lib/selections'
import { reportRejection } from '@src/lib/trap'

export function useEngineConnectionSubscriptions() {
  const { send, context, state } = useModelingContext()
  const { engineCommandManager, executingEditor, rustContext, wasmInstance } =
    context
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    if (!engineCommandManager) return

    const unSubHover = engineCommandManager.subscribeToUnreliable({
      // Note this is our hover logic, "highlight_set_entity" is the event that is fired when we hover over an entity
      event: 'highlight_set_entity',
      callback: ({ data }) => {
        if (data?.entity_id) {
          const codeRefs = getCodeRefsByArtifactId(
            data.entity_id,
            executingEditor.artifactGraph
          )
          if (codeRefs) {
            executingEditor.setHighlightRange(
              codeRefs.map(({ range }) => range)
            )
          }
        } else if (
          !executingEditor.highlightRange ||
          (executingEditor.highlightRange[0] &&
            executingEditor.highlightRange[0][0] !== 0 &&
            executingEditor.highlightRange[0][1] !== 0)
        ) {
          executingEditor.setHighlightRange([defaultSourceRange()])
        }
      },
    })
    const unSubClick = engineCommandManager.subscribeTo({
      event: 'select_with_point',
      callback: (engineEvent) => {
        ;(async () => {
          if (
            stateRef.current.matches('Sketch no face') ||
            // Ignore select_with_point in sketch solve: without this selection is overridden
            // and breaks multiple line highlights
            stateRef.current.matches('sketchSolveMode')
          ) {
            return
          }
          const event = await getEventForSelectWithPoint(engineEvent, {
            engineCommandManager,
            executingEditor,
            rustContext,
            wasmInstance,
          })
          // Check state again, in case we went into sketch mode before getEventForSelectWithPoint returned.
          // This is probably rare, but we do go into sketch mode on double click.
          if (
            stateRef.current.matches('Sketch no face') ||
            stateRef.current.matches('sketchSolveMode')
          ) {
            return
          }
          if (event) send(event)
        })().catch(reportRejection)
      },
    })
    return () => {
      unSubHover()
      unSubClick()
    }
  }, [
    context?.sketchEnginePathId,
    executingEditor,
    send,
    engineCommandManager,
    rustContext,
    wasmInstance,
  ])

  useEffect(() => {
    if (!engineCommandManager) return

    const unSub = engineCommandManager.subscribeTo({
      event: 'select_with_point',
      callback: state.matches('Sketch no face')
        ? ({ data }) => {
            void selectSketchPlane(
              data.entity_id,
              context.store.useSketchSolveMode?.current,
              executingEditor
            )
          }
        : () => {},
    })
    return unSub
  }, [
    context.store.useSketchSolveMode,
    state,
    executingEditor,
    rustContext,
    engineCommandManager,
  ])

  // Re-apply plane visibility when planes are (re)created on the Rust side
  useEffect(() => {
    const unsubscribe = rustContext.planesCreated.add(() => {
      const vis = stateRef.current.context.defaultPlaneVisibility
      void executingEditor.setPlaneVisibilityByKey('xy', vis.xy)
      void executingEditor.setPlaneVisibilityByKey('xz', vis.xz)
      void executingEditor.setPlaneVisibilityByKey('yz', vis.yz)
    })
    return unsubscribe
  }, [executingEditor, rustContext])
}
