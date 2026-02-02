import type { PropsOf } from '@headlessui/react/dist/types'
import type { AreaTypeComponentProps } from '@src/lib/layout'
import { useSignals } from '@preact/signals-react/runtime'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { VisibilityToggle } from '@src/components/VisibilityToggle'
import {
  type Artifact,
  getBodiesFromArtifactGraph,
} from '@src/lang/std/artifactGraph'
import {
  getHideOpByArtifactId,
  onHide,
  onUnhide,
  type HideOperation,
} from '@src/lib/operations'
import { useSingletons } from '@src/lib/boot'
import { RowItemWithIconMenuAndToggle } from '@src/components/RowItemWithIconMenuAndToggle'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { sourceRangeFromRust } from '@src/lang/sourceRange'
import { sendSelectionEvent } from '@src/lib/featureTree'
import { useMemo } from 'react'
import toast from 'react-hot-toast'
import { err } from '@src/lib/trap'

type SolidArtifact = Artifact & { type: 'compositeSolid' | 'sweep' }

export function BodiesPane(props: AreaTypeComponentProps) {
  useSignals()
  const { kclManager } = useSingletons()
  const execState = kclManager.execStateSignal.value
  const bodies = execState?.artifactGraph
    ? getBodiesFromArtifactGraph(execState.artifactGraph)
    : undefined
  const bodiesWithProps: Map<string, PropsOf<typeof BodyItem>> = new Map()

  if (execState?.operations) {
    let i = 0
    for (let [id, artifact] of bodies || new Map()) {
      bodiesWithProps.set(id, {
        artifact,
        label: `Body ${i + 1}`,
        hideOperation: getHideOpByArtifactId(execState.operations, id),
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
  return (
    <section className="overflow-auto mr-1 pb-8">
      <ul>
        {bodies.entries().map(([id, props], i) => (
          <BodyItem key={id || i} {...props} />
        ))}
      </ul>
    </section>
  )
}

function BodyItem({
  label,
  artifact,
  hideOperation,
}: { label: string; artifact: SolidArtifact; hideOperation?: HideOperation }) {
  useSignals()
  const { kclManager, rustContext } = useSingletons()
  const systemDeps = useMemo(
    () => ({ kclManager, rustContext }),
    [kclManager, rustContext]
  )
  const { actor: modelingActor, send: modelingSend } = useModelingContext()

  const sourceRange = sourceRangeFromRust(artifact.codeRef.range)
  const isSelected =
    kclManager.editorState.selection.main.from >= sourceRange[0] &&
    kclManager.editorState.selection.main.to <= sourceRange[1]
  const onSelect = () =>
    sendSelectionEvent({
      sourceRange,
      kclManager,
      modelingSend,
    })

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
                onHide({
                  ast: kclManager.ast,
                  artifactGraph: kclManager.artifactGraph,
                  modelingActor,
                })
              } else {
                onUnhide({
                  hideOperation,
                  targetArtifact: artifact,
                  systemDeps,
                })
                  .then((result) => {
                    if (err(result)) {
                      toast.error(result.message || 'Error while unhiding')
                    }
                  })
                  .catch((e) => {
                    toast.error(e.message || 'Error while unhiding')
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
