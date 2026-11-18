import type { PropsOf } from '@headlessui/react/dist/types'
import { useSignals } from '@preact/signals-react/runtime'
import {
  ContextMenuDivider,
  ContextMenuItem,
} from '@src/components/ContextMenu'
import { RowItemWithIconMenuAndToggle } from '@src/components/RowItemWithIconMenuAndToggle'
import { VisibilityToggle } from '@src/components/VisibilityToggle'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { toUtf16 } from '@src/lang/errors'
import { sourceRangeFromRust } from '@src/lang/sourceRange'
import {
  type Artifact,
  type CodeRef,
  getBodiesFromArtifactGraph,
  getCodeRefsByArtifactId,
} from '@src/lang/std/artifactGraph'
import { type ArtifactGraph, getAllOperations } from '@src/lang/wasm'
import { engineIdForArtifact } from '@src/lang/std/kclNamedViews'
import { useSingletons } from '@src/lib/boot'
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
}: {
  bodies: Map<string, PropsOf<typeof BodyItem>>
}) {
  return (
    <section className="overflow-auto mr-1 pb-8">
      <ul>
        {Array.from(bodies.entries()).map(([id, props], i) => (
          <li key={id || i}>
            <BodyItem {...props} />
          </li>
        ))}
      </ul>
    </section>
  )
}

export function BodyItem({
  label,
  artifact,
  artifactGraph,
  hideOperation,
  engineEntityId,
  patternIndex,
  disabled = false,
}: {
  label: string
  artifact: SolidArtifact
  artifactGraph: ArtifactGraph
  hideOperation?: HideOperation
  engineEntityId?: string
  patternIndex?: number
  disabled?: boolean
}) {
  const { kclManager } = useSingletons()
  const {
    actor: modelingActor,
    context: modelingContext,
    send: modelingSend,
  } = useModelingContext()

  const sourceRange = sourceRangeFromRust(artifact.codeRef.range)
  const artifactCodeRef = getCodeRefsByArtifactId(
    artifact.id,
    artifactGraph
  )?.[0] ?? {
    range: sourceRange,
    pathToNode: [],
  }
  const codeRef: CodeRef = {
    ...artifactCodeRef,
    range: [
      toUtf16(artifactCodeRef.range[0], kclManager.code),
      toUtf16(artifactCodeRef.range[1], kclManager.code),
      artifactCodeRef.range[2],
    ],
  }
  const sourceArtifact = engineEntityId
    ? artifactGraph.get(engineEntityId)
    : artifact
  const bodyEngineId = engineIdForArtifact({
    id: engineEntityId ?? artifact.id,
    artifact:
      sourceArtifact?.type === 'sweep' ||
      sourceArtifact?.type === 'compositeSolid'
        ? sourceArtifact
        : artifact,
    artifactGraph,
  })
  const selection: Selection = {
    artifact,
    codeRef,
    entityRef: { type: 'solid3d', solid3d_id: bodyEngineId },
    engineEntityId: bodyEngineId,
    ...(patternIndex !== undefined ? { patternIndex } : {}),
  }
  const selections: Selections = {
    graphSelections: [selection],
    otherSelections: [],
  }

  const isSelected = modelingContext.selectionRanges.graphSelections.some(
    (selection) =>
      selection.engineEntityId === bodyEngineId ||
      (selection.entityRef?.type === 'solid3d' &&
        selection.entityRef.solid3d_id === bodyEngineId)
  )
  const onSelect = () => {
    modelingSend({
      type: 'Set selection',
      data: {
        selectionType: 'singleCodeCursor',
        selection,
      },
    })
  }
  const handleDelete = () => {
    onDelete({
      modelingActor,
      objects: selections,
    })
  }
  const centerBody = () => {
    modelingSend({
      type: 'Set selection',
      data: { selectionType: 'completeSelection', selection: selections },
    })
    modelingSend({ type: 'Center camera on selection' })
  }
  const toggleVisibility = () => {
    if (hideOperation === undefined) {
      onHide({
        ast: kclManager.ast,
        artifactGraph: kclManager.artifactGraph,
        modelingActor,
        objects: selections,
      })
    } else {
      onUnhide({ hideOperation, targetArtifact: artifact, kclManager })
        .then((result) => {
          if (err(result)) {
            toast.error(result.message || 'Error while unhiding.')
          }
        })
        .catch((e) => {
          toast.error(e.message || 'Error while unhiding.')
        })
    }
  }

  return (
    <div className="min-w-0">
      <RowItemWithIconMenuAndToggle
        icon="body"
        disabled={disabled}
        onClick={onSelect}
        onContextMenu={() => {
          if (!isSelected && !disabled) onSelect()
        }}
        isSelected={isSelected}
        aria-pressed={isSelected}
        className={`font-medium ${hideOperation && !isSelected ? 'text-2' : ''}`}
        menuItems={
          disabled
            ? undefined
            : [
                <ContextMenuItem
                  key="center"
                  onClick={centerBody}
                  disabled={hideOperation !== undefined}
                >
                  Center on body
                </ContextMenuItem>,
                <ContextMenuItem key="visibility" onClick={toggleVisibility}>
                  {hideOperation ? 'Show body' : 'Hide body'}
                </ContextMenuItem>,
                <ContextMenuDivider key="divider" />,
                <ContextMenuItem
                  key="delete"
                  onClick={handleDelete}
                  data-testid="context-menu-delete"
                >
                  Delete body
                </ContextMenuItem>,
              ]
        }
        Toggle={
          disabled ? undefined : (
            <VisibilityToggle
              label={label}
              visible={hideOperation === undefined}
              onVisibilityChange={toggleVisibility}
            />
          )
        }
      >
        {label}
      </RowItemWithIconMenuAndToggle>
    </div>
  )
}
