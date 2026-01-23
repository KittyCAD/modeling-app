import { ChangeSpec } from '@codemirror/state'
import { PropsOf } from '@headlessui/react/dist/types'
import { useSignals } from '@preact/signals-react/runtime'
import { Operation } from '@rust/kcl-lib/bindings/Operation'
import { CustomIcon } from '@src/components/CustomIcon'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { VisibilityToggle } from '@src/components/VisibilityToggle'
import {
  type Artifact,
  getBodiesFromArtifactGraph,
} from '@src/lang/std/artifactGraph'
import { Program } from '@src/lang/wasm'
import type { AreaTypeComponentProps } from '@src/lib/layout'
import {
  getHideOpByArtifactId,
  getHideOperations,
  getOperationVariableName,
  getVariableNameFromNodePath,
  HideOperation,
} from '@src/lib/operations'
import { engineCommandManager, kclManager } from '@src/lib/singletons'
import { reportRejection } from '@src/lib/trap'
import { uuidv4 } from '@src/lib/utils'
import { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { use, useEffect, useMemo, useState } from 'react'

type SolidArtifact = Artifact & { type: 'compositeSold' | 'sweep' }

export function BodiesPane(props: AreaTypeComponentProps) {
  useSignals()
  const { artifactGraph, operations } = kclManager.execStateSignal.value
  // If there are parse errors we show the last successful operations
  // and overlay a message on top of the pane

  const bodies = artifactGraph
    ? getBodiesFromArtifactGraph(artifactGraph)
    : undefined
  const bodiesWithProps: Map<string, PropsOf<typeof BodyItem>> = new Map()

  let i = 0
  for (let [id, artifact] of bodies || new Map()) {
    bodiesWithProps.set(id, {
      artifact,
      label: `Body ${i + 1}`,
      hideOperation: getHideOpByArtifactId(operations, id),
    })
    i++
  }

  useEffect(
    () => console.log('FRANK bodiesWithProps', bodiesWithProps),
    [bodiesWithProps]
  )

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

/**
 * Temporary function to toggle visibility directly through engine.
 * Visibility ultimately should be written to KCL via a codemod API.
 */
async function toggleVisibility({
  artifact,
  hideOperation,
  program,
  wasmInstance,
}: {
  artifact: SolidArtifact
  hideOperation?: HideOperation
  program: Program
  wasmInstance: ModuleType
}) {
  const variableName =
    !hideOperation &&
    getVariableNameFromNodePath(
      artifact.codeRef.pathToNode,
      program,
      wasmInstance
    )
  const changes: ChangeSpec | undefined = hideOperation
    ? {
        from: hideOperation.sourceRange[0],
        to: hideOperation.sourceRange[1],
        insert: '',
      }
    : variableName
      ? {
          from: kclManager.code.length,
          insert: `hide(${variableName})`,
        }
      : undefined

  kclManager.dispatch({ changes })
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
          toggleVisibility({
            artifact,
            hideOperation,
            program: kclManager.astSignal.value,
            wasmInstance,
          })
        }}
      />
    </li>
  )
}
