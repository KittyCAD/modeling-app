import type { ChangeSpec } from '@codemirror/state'
import type { PropsOf } from '@headlessui/react/dist/types'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Program } from '@src/lang/wasm'
import type { AreaTypeComponentProps } from '@src/lib/layout'
import { useSignals } from '@preact/signals-react/runtime'
import { CustomIcon } from '@src/components/CustomIcon'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { VisibilityToggle } from '@src/components/VisibilityToggle'
import {
  type Artifact,
  getBodiesFromArtifactGraph,
} from '@src/lang/std/artifactGraph'
import {
  getHideOpByArtifactId,
  getToggleHiddenTransaction,
  getVariableNameFromNodePath,
  type HideOperation,
} from '@src/lib/operations'
import { kclManager } from '@src/lib/singletons'
import { reportRejection } from '@src/lib/trap'
import { use } from 'react'

type SolidArtifact = Artifact & { type: 'compositeSold' | 'sweep' }

export function BodiesPane(props: AreaTypeComponentProps) {
  useSignals()
  const execState = kclManager.execStateSignal.value
  // If there are parse errors we show the last successful operations
  // and overlay a message on top of the pane

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
  const wasmInstance = use(kclManager.wasmInstancePromise)

  return (
    <li className="flex px-1 py-0.5 group/visibilityToggle">
      <CustomIcon name="body" className="w-6 h-6" />
      <span className="flex-1">{label}</span>
      <VisibilityToggle
        visible={hideOperation === undefined}
        onVisibilityChange={() => {
          kclManager.dispatch(
            getToggleHiddenTransaction({
              targetPathsToNode: [artifact.codeRef.pathToNode],
              hideOperation,
              program: kclManager.astSignal.value,
              code: kclManager.codeSignal.value,
              wasmInstance,
            })
          )
        }}
      />
    </li>
  )
}
