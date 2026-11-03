import { featureTree } from '@src/lib/featureTree/registry/contract'
import type { PropsOf } from '@headlessui/react/dist/types'
import { useSignals } from '@preact/signals-react/runtime'
import { ContextMenuItem } from '@src/components/ContextMenu'
import { CustomIcon } from '@src/components/CustomIcon'
import {
  FeatureTreeRow,
  FeatureTreeNotice,
} from '@src/lib/featureTree/FeatureTreeView'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { toUtf16 } from '@src/lang/errors'
import { sourceRangeFromRust } from '@src/lang/sourceRange'
import {
  type Artifact,
  getBodiesFromArtifactGraph,
  getCodeRefsByArtifactId,
} from '@src/lang/std/artifactGraph'
import { type ArtifactGraph, getAllOperations } from '@src/lang/wasm'
import { useApp, useSingletons } from '@src/lib/boot'
import { sendSelectionEvent } from '@src/lib/featureTree'
import {
  type HideOperation,
  getHideOpByArtifactId,
  onDelete,
  onHide,
  onUnhide,
} from '@src/lib/operations'
import { err } from '@src/lib/trap'
import type { Selection, Selections } from '@src/machines/modelingSharedTypes'
import toast from 'react-hot-toast'

type SolidArtifact = Artifact & { type: 'compositeSolid' | 'sweep' | 'pattern' }

/** Body identity and actions stay in ZDS; the shared tree handles row interaction. */
export function BodiesSection() {
  useSignals()
  const bodies = useApp().registry.get(featureTree).model.value.bodies
  const bodiesWithProps = new Map(bodies.map(({ id, ...body }) => [id, body]))

  return (
    <>
      {Array.from(bodiesWithProps.entries()).map(([id, props]) => (
        <BodyItem key={id} nodeId={id} {...props} />
      ))}

      {!bodiesWithProps.size && (
        <FeatureTreeNotice>
          <p className="feature-tree-empty">No bodies</p>
        </FeatureTreeNotice>
      )}
    </>
  )
}

function BodyItem({
  nodeId,
  label,
  artifact,
  artifactGraph,
  hideOperation,
  engineEntityId,
  patternIndex,
}: {
  nodeId: string
  label: string
  artifact: SolidArtifact
  artifactGraph: ArtifactGraph
  hideOperation?: HideOperation
  engineEntityId?: string
  patternIndex?: number
}) {
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

  return (
    <FeatureTreeRow
      nodeId={nodeId}
      label={label}
      icon={<CustomIcon name="body" className="w-5 h-5" />}
      onSelect={onSelect}
      onContextMenu={() => onSelect()}
      selected={isSelected}
      menuItems={[
        <ContextMenuItem
          key="delete"
          onClick={handleDelete}
          data-testid="context-menu-delete"
        >
          Delete
        </ContextMenuItem>,
      ]}
      visibility={{
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
      }}
    />
  )
}
