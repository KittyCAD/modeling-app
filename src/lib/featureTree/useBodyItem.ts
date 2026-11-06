import { useModelingContext } from '@src/hooks/useModelingContext'
import { toUtf16 } from '@src/lang/errors'
import { sourceRangeFromRust } from '@src/lang/sourceRange'
import { getCodeRefsByArtifactId } from '@src/lang/std/artifactGraph'
import { useSingletons } from '@src/lib/boot'
import { sendSelectionEvent } from '@src/lib/featureTree'
import { onDelete, onHide, onUnhide } from '@src/lib/operations'
import { err } from '@src/lib/trap'
import type { Selection, Selections } from '@src/machines/modelingSharedTypes'
import toast from 'react-hot-toast'

import type { FeatureTreeBody } from '@src/lib/featureTree/model'

/** One identity-aware selection, deletion and visibility path for both body views. */
export function useBodyItem({
  label,
  artifact,
  artifactGraph,
  hideOperation,
  engineEntityId,
  patternIndex,
}: Omit<FeatureTreeBody, 'id'>) {
  const { kclManager } = useSingletons()
  const {
    actor: modelingActor,
    context: modelingContext,
    send: modelingSend,
  } = useModelingContext()

  const sourceRange = sourceRangeFromRust(artifact.codeRef.range)
  const codeRef = getCodeRefsByArtifactId(artifact.id, artifactGraph)?.[0] ?? {
    range: sourceRange,
    pathToNode: [],
  }
  const selection: Selection = {
    artifact,
    codeRef,
    ...(engineEntityId ? { engineEntityId } : {}),
    ...(patternIndex !== undefined ? { patternIndex } : {}),
  }
  const selections: Selections = {
    graphSelections: [selection],
    otherSelections: [],
  }

  const isSelected = engineEntityId
    ? modelingContext.selectionRanges.graphSelections.some(
        (selection) => selection.engineEntityId === engineEntityId
      )
    : kclManager.editorState.selection.main.from >=
        toUtf16(sourceRange[0], kclManager.code) &&
      kclManager.editorState.selection.main.to <=
        toUtf16(sourceRange[1], kclManager.code)
  const onSelect = () => {
    if (engineEntityId) {
      modelingSend({
        type: 'Set selection',
        data: {
          selectionType: 'singleCodeCursor',
          selection,
        },
      })
      return
    }

    sendSelectionEvent({
      sourceRange,
      kclManager,
      modelingSend,
    })
  }
  const handleDelete = () => {
    onSelect()
    onDelete({
      modelingActor,
      objects: selections,
    })
  }

  return {
    label,
    isSelected,
    onSelect,
    handleDelete,
    visibility: {
      visible: hideOperation === undefined,
      onVisibilityChange: () => {
        if (hideOperation === undefined) {
          onHide({
            ast: kclManager.ast,
            artifactGraph: kclManager.artifactGraph,
            modelingActor,
            objects: selections,
          })
        } else {
          onUnhide({
            hideOperation,
            targetArtifact: artifact,
            kclManager,
          })
            .then((result) => {
              if (err(result)) {
                toast.error(result.message || 'Error while unhiding.')
              }
            })
            .catch((e) => {
              toast.error(e.message || 'Error while unhiding.')
            })
        }
      },
    },
  }
}
