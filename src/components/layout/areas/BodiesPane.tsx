import type { PropsOf } from '@headlessui/react/dist/types'
import { useSignals } from '@preact/signals-react/runtime'
import { ContextMenuItem } from '@src/components/ContextMenu'
import { RowItemWithIconMenuAndToggle } from '@src/components/RowItemWithIconMenuAndToggle'
import { VisibilityToggle } from '@src/components/VisibilityToggle'
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
import { useApp, useSingletons } from '@src/lib/boot'
import { EXPERIMENTAL_POINT_AND_CLICK_FLAG } from '@src/lib/constants'
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
  useSignals()
  const { kclManager } = useSingletons()
  const execState = kclManager.execStateSignal.value
  const artifactGraph = execState.artifactGraph
  const operations = getAllOperations(execState.operations)
  const bodies = getBodiesFromArtifactGraph(artifactGraph)
  const bodiesWithProps: Map<string, PropsOf<typeof BodyItem>> = new Map()

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
      {bodies && <BodiesList bodies={bodiesWithProps} />}
    </LayoutPanel>
  )
}

function BodiesList({
  bodies,
}: { bodies: Map<string, PropsOf<typeof BodyItem>> }) {
  const { userFeatures } = useApp()
  const showExperimentalPointAndClick = userFeatures.useHas(
    EXPERIMENTAL_POINT_AND_CLICK_FLAG,
    false
  )

  return (
    <section className="overflow-auto mr-1 pb-8">
      <ul>
        {Array.from(bodies.entries()).map(([id, props], i) => (
          <BodyItem
            key={id || i}
            {...props}
            showExperimentalPointAndClick={showExperimentalPointAndClick}
          />
        ))}
      </ul>
    </section>
  )
}

function BodyItem({
  label,
  artifact,
  artifactGraph,
  hideOperation,
  engineEntityId,
  patternIndex,
  showExperimentalPointAndClick = false,
}: {
  label: string
  artifact: SolidArtifact
  artifactGraph: ArtifactGraph
  hideOperation?: HideOperation
  engineEntityId?: string
  patternIndex?: number
  showExperimentalPointAndClick?: boolean
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
    <li className="px-1 py-0.5 group/visibilityToggle">
      <RowItemWithIconMenuAndToggle
        icon="body"
        onClick={onSelect}
        onContextMenu={() => onSelect()}
        isSelected={isSelected}
        menuItems={
          showExperimentalPointAndClick
            ? [
                <ContextMenuItem
                  onClick={handleDelete}
                  data-testid="context-menu-delete"
                >
                  Delete
                </ContextMenuItem>,
              ]
            : undefined
        }
        Toggle={
          <VisibilityToggle
            visible={hideOperation === undefined}
            onVisibilityChange={() => {
              onSelect()
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
            }}
          />
        }
      >
        {label}
      </RowItemWithIconMenuAndToggle>
    </li>
  )
}
