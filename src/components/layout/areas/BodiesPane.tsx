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
import type { ArtifactGraph } from '@src/lang/wasm'
import { useSingletons } from '@src/lib/boot'
import { sendSelectionEvent } from '@src/lib/featureTree'
import type { AreaTypeComponentProps } from '@src/lib/layout'
import {
  type HideOperation,
  getHideOpByArtifactId,
  onHide,
  onUnhide,
} from '@src/lib/operations'
import { err } from '@src/lib/trap'
import type { Selection, Selections } from '@src/machines/modelingSharedTypes'
import { useSignals } from '@preact/signals-react/runtime'
import toast from 'react-hot-toast'
import type { Operation } from '@rust/kcl-lib/bindings/Operation'

export type SolidArtifact = Artifact & {
  type: 'compositeSolid' | 'sweep' | 'pattern'
}

export type BodyItemProps = {
  label: string
  artifact: SolidArtifact
  artifactGraph: ArtifactGraph
  hideOperation?: HideOperation
  engineEntityId?: string
  patternIndex?: number
}

export function getBodyItemPropsFromArtifactGraph({
  artifactGraph,
  operations,
}: {
  artifactGraph: ArtifactGraph
  operations?: Operation[]
}): Map<string, BodyItemProps> {
  const bodies = getBodiesFromArtifactGraph(artifactGraph)
  const bodyProps: Map<string, BodyItemProps> = new Map()

  let i = 0
  for (const [id, artifact] of bodies || new Map()) {
    const patternIndex =
      artifact.type === 'pattern'
        ? Math.max(0, artifact.copyIds.indexOf(id) + 1)
        : undefined
    const hideOperation =
      (operations ? getHideOpByArtifactId(operations, id) : undefined) ??
      (artifact.type === 'pattern' && patternIndex === 0
        ? operations
          ? getHideOpByArtifactId(operations, artifact.sourceId)
          : undefined
        : undefined)
    bodyProps.set(id, {
      artifact,
      artifactGraph,
      label: `Body ${i + 1}`,
      hideOperation,
      engineEntityId: artifact.type === 'pattern' ? id : undefined,
      patternIndex,
    })
    i++
  }

  return bodyProps
}

export function BodiesPane(props: AreaTypeComponentProps) {
  useSignals()
  const { kclManager } = useSingletons()
  const execState = kclManager.execStateSignal.value
  const artifactGraph = execState.artifactGraph
  const operations = execState.operations
  const bodiesWithProps = getBodyItemPropsFromArtifactGraph({
    artifactGraph,
    operations,
  })

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
      <BodiesList bodies={bodiesWithProps} />
    </LayoutPanel>
  )
}

export function BodiesList({ bodies }: { bodies: Map<string, BodyItemProps> }) {
  return (
    <section className="overflow-auto mr-1 pb-8">
      <ul>
        {Array.from(bodies.entries()).map(([id, props], i) => (
          <BodyItem key={id || i} {...props} />
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
}: BodyItemProps) {
  const { kclManager } = useSingletons()
  const modeling = useModelingContext()
  const modelingActor = modeling?.actor
  const modelingContext = modeling?.context
  const modelingSend = modeling?.send

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
    ? modelingContext?.selectionRanges.graphSelections.some(
        (selection) => selection.engineEntityId === engineEntityId
      ) === true
    : kclManager.editorState.selection.main.from >=
        toUtf16(sourceRange[0], kclManager.code) &&
      kclManager.editorState.selection.main.to <=
        toUtf16(sourceRange[1], kclManager.code)
  const onSelect = () => {
    if (!modelingSend) {
      return
    }
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

    sendSelectionEvent(
      {
        sourceRange,
        kclManager,
        modelingSend,
      },
      true
    )
  }

  return (
    <li className="px-1 py-0.5 group/visibilityToggle">
      <RowItemWithIconMenuAndToggle
        icon="body"
        onClick={onSelect}
        isSelected={isSelected}
        Toggle={
          <VisibilityToggle
            visible={hideOperation === undefined}
            onVisibilityChange={() => {
              onSelect()
              if (hideOperation === undefined) {
                if (modelingActor) {
                  onHide({
                    ast: kclManager.ast,
                    artifactGraph: kclManager.artifactGraph,
                    modelingActor,
                    objects: selections,
                  })
                }
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
