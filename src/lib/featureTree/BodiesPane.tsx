import type { PropsOf } from '@headlessui/react/dist/types'
import { useSignals } from '@preact/signals-react/runtime'
import { ContextMenuItem } from '@src/components/ContextMenu'
import { CustomIcon } from '@src/components/CustomIcon'
import {
  FeatureTree,
  FeatureTreeRow,
  FeatureTreeNotice,
} from '@src/lib/featureTree/FeatureTreeView'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { toUtf16 } from '@src/lang/errors'
import { sourceRangeFromRust } from '@src/lang/sourceRange'
import {
  type Artifact,
  getBodiesFromArtifactGraph,
  getCodeRefsByArtifactId,
} from '@src/lang/std/artifactGraph'
import { type ArtifactGraph, getAllOperations } from '@src/lang/wasm'
import { useSingletons } from '@src/lib/boot'
import { sendSelectionEvent } from '@src/lib/featureTree'
import type { AreaTypeComponentProps } from '@src/lib/layout'
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

export function BodiesPane(props: AreaTypeComponentProps) {
  return (
    <LayoutPanel
      title={props.layout.label}
      id={`${props.layout.id}-pane`}
      className="border-none"
    >
      <LayoutPanelHeader
        id={props.layout.id}
        icon="model"
        title={props.layout.label}
      />
      <FeatureTree label="Bodies">
        <BodiesPaneContents />
      </FeatureTree>
    </LayoutPanel>
  )
}

/** Body identity and actions stay in ZDS; the shared tree handles row interaction. */
export function BodiesPaneContents() {
  useSignals()
  const { kclManager } = useSingletons()
  const execState = kclManager.execStateSignal.value
  const artifactGraph = execState.artifactGraph
  const operations = getAllOperations(execState.operations)
  const bodies = getBodiesFromArtifactGraph(artifactGraph)
  const bodiesWithProps: Map<
    string,
    Omit<PropsOf<typeof BodyItem>, 'nodeId'>
  > = new Map()

  if (operations) {
    let i = 0
    for (let [id, artifact] of bodies || new Map()) {
      const patternIndex =
        artifact.type === 'pattern'
          ? Math.max(0, artifact.copyIds.indexOf(id) + 1)
          : undefined
      const hideOperation =
        getHideOpByArtifactId(operations, id) ??
        (artifact.type === 'pattern' && patternIndex === 0
          ? getHideOpByArtifactId(operations, artifact.sourceId)
          : undefined)
      bodiesWithProps.set(id, {
        artifact,
        artifactGraph,
        label: `Body ${i + 1}`,
        hideOperation,
        engineEntityId: artifact.type === 'pattern' ? id : undefined,
        patternIndex,
      })
      i++
    }
  }

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
