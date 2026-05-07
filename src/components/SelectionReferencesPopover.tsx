import type { EntityGetPrimitiveIndex } from '@kittycad/lib'
import { use } from 'react'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'

import { useModelingContext } from '@src/hooks/useModelingContext'
import {
  createCallExpressionStdLibKw,
  createExpressionStatement,
  createLabeledArg,
  createLiteral,
  nonCodeMetaEmpty,
} from '@src/lang/create'
import { getVariableExprsFromSelection } from '@src/lang/queryAst'
import {
  getArtifactOfTypes,
  getCodeRefsByArtifactId,
  getSweepFromSuspectedSweepSurface,
} from '@src/lang/std/artifactGraph'
import type { Artifact, ArtifactGraph, Expr } from '@src/lang/wasm'
import { recast } from '@src/lang/wasm'
import { useSingletons } from '@src/lib/boot'
import { isModelingResponse } from '@src/lib/kcSdkGuards'
import { err, reportRejection } from '@src/lib/trap'
import { uuidv4 } from '@src/lib/utils'
import type {
  EnginePrimitiveSelection,
  Selection,
} from '@src/machines/modelingSharedTypes'
import type { ConnectionManager } from '@src/network/connectionManager'

type SelectionReference = {
  id: string
  label: string
  code: string
}

type SelectionReferenceState =
  | { status: 'idle' | 'loading'; references: SelectionReference[] }
  | { status: 'ready'; references: SelectionReference[] }
  | { status: 'error'; references: SelectionReference[]; message: string }

type PrimitiveInfo = {
  entityId: string
  parentEntityId?: string
  primitiveIndex: number
  primitiveType: 'face' | 'edge'
}

async function getParentEntityIdForEntity(
  entityId: string,
  engineCommandManager: ConnectionManager
): Promise<string | undefined> {
  const parentResponse = await engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd_id: uuidv4(),
    cmd: {
      type: 'entity_get_parent_id',
      entity_id: entityId,
    },
  })
  if (!isModelingResponse(parentResponse)) {
    return undefined
  }
  const parentIdResponse = parentResponse.resp.data.modeling_response
  if (parentIdResponse.type !== 'entity_get_parent_id') {
    return undefined
  }
  return parentIdResponse.data.entity_id
}

async function getPrimitiveInfoForEntity(
  entityId: string,
  engineCommandManager: ConnectionManager
): Promise<PrimitiveInfo | null> {
  const websocketResponse = await engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd_id: uuidv4(),
    cmd: {
      type: 'entity_get_primitive_index',
      entity_id: entityId,
    },
  })

  if (!isModelingResponse(websocketResponse)) {
    return null
  }

  const primitiveIndexResponse = websocketResponse.resp.data.modeling_response
  if (primitiveIndexResponse.type !== 'entity_get_primitive_index') {
    return null
  }

  const entityGetPrimitiveIndex: EntityGetPrimitiveIndex =
    primitiveIndexResponse.data
  if (
    entityGetPrimitiveIndex.entity_type !== 'face' &&
    entityGetPrimitiveIndex.entity_type !== 'edge'
  ) {
    return null
  }

  return {
    entityId,
    parentEntityId: await getParentEntityIdForEntity(
      entityId,
      engineCommandManager
    ),
    primitiveIndex: entityGetPrimitiveIndex.primitive_index,
    primitiveType: entityGetPrimitiveIndex.entity_type,
  }
}

function getPrimitiveInfoFromSelection(
  selection: EnginePrimitiveSelection
): PrimitiveInfo | null {
  if (
    selection.primitiveType !== 'face' &&
    selection.primitiveType !== 'edge'
  ) {
    return null
  }

  return {
    entityId: selection.entityId,
    parentEntityId: selection.parentEntityId,
    primitiveIndex: selection.primitiveIndex,
    primitiveType: selection.primitiveType,
  }
}

function isFaceOrEdgeArtifact(artifact: Artifact | undefined): boolean {
  return (
    artifact?.type === 'wall' ||
    artifact?.type === 'cap' ||
    artifact?.type === 'primitiveFace' ||
    artifact?.type === 'segment' ||
    artifact?.type === 'sweepEdge' ||
    artifact?.type === 'primitiveEdge' ||
    artifact?.type === 'edgeCut'
  )
}

function recastExpr(expr: Expr, wasmInstance: Parameters<typeof recast>[1]) {
  const code = recast(
    {
      start: 0,
      end: 0,
      moduleId: 0,
      outerAttrs: [],
      preComments: [],
      commentStart: 0,
      body: [createExpressionStatement(expr)],
      nonCodeMeta: nonCodeMetaEmpty(),
      shebang: null,
      innerAttrs: [],
    } as unknown as Parameters<typeof recast>[0],
    wasmInstance
  )
  return err(code) ? null : code.trim()
}

function getBodySelectionFromPrimitiveParentEntityId(
  parentEntityId: string,
  artifactGraph: ArtifactGraph
): Selection | null {
  const parentArtifact = artifactGraph.get(parentEntityId)
  if (!parentArtifact) {
    return null
  }

  if (
    parentArtifact.type === 'sweep' ||
    parentArtifact.type === 'compositeSolid'
  ) {
    return {
      artifact: parentArtifact,
      codeRef: parentArtifact.codeRef,
    }
  }

  if (parentArtifact.type === 'path' && parentArtifact.sweepId) {
    const parentSweep = getArtifactOfTypes(
      { key: parentArtifact.sweepId, types: ['sweep'] },
      artifactGraph
    )
    if (!err(parentSweep)) {
      return {
        artifact: parentSweep as Artifact,
        codeRef: parentSweep.codeRef,
      }
    }
  }

  if (
    parentArtifact.type === 'cap' ||
    parentArtifact.type === 'wall' ||
    parentArtifact.type === 'edgeCut'
  ) {
    const parentSweep = getSweepFromSuspectedSweepSurface(
      parentArtifact.id,
      artifactGraph
    )
    if (!err(parentSweep)) {
      return {
        artifact: parentSweep as Artifact,
        codeRef: parentSweep.codeRef,
      }
    }
  }

  const parentCodeRefs = getCodeRefsByArtifactId(parentEntityId, artifactGraph)
  if (!parentCodeRefs || parentCodeRefs.length === 0) {
    return null
  }

  return {
    artifact: parentArtifact,
    codeRef: parentCodeRefs[0],
  }
}

function createPrimitiveReferenceCode({
  primitiveInfo,
  artifactGraph,
  kclManager,
  wasmInstance,
}: {
  primitiveInfo: PrimitiveInfo
  artifactGraph: ArtifactGraph
  kclManager: ReturnType<typeof useSingletons>['kclManager']
  wasmInstance: Parameters<typeof recast>[1]
}): string | null {
  if (!primitiveInfo.parentEntityId) {
    return null
  }

  const bodySelection = getBodySelectionFromPrimitiveParentEntityId(
    primitiveInfo.parentEntityId,
    artifactGraph
  )
  if (!bodySelection) {
    return null
  }

  const bodyVariables = getVariableExprsFromSelection(
    { graphSelections: [bodySelection], otherSelections: [] },
    artifactGraph,
    kclManager.ast,
    wasmInstance,
    undefined,
    { artifactTypeFilter: ['sweep', 'compositeSolid'] }
  )
  if (err(bodyVariables) || bodyVariables.exprs.length === 0) {
    return null
  }

  const bodyExpr = bodyVariables.exprs[0]
  const functionName =
    primitiveInfo.primitiveType === 'face' ? 'faceId' : 'edgeId'
  const call = createCallExpressionStdLibKw(
    functionName,
    structuredClone(bodyExpr),
    [
      createLabeledArg(
        'index',
        createLiteral(primitiveInfo.primitiveIndex, wasmInstance)
      ),
    ]
  )

  return recastExpr(call, wasmInstance)
}

async function getSelectionDebugReferences({
  graphSelections,
  enginePrimitives,
  artifactGraph,
  engineCommandManager,
  kclManager,
  wasmInstance,
}: {
  graphSelections: Selection[]
  enginePrimitives: EnginePrimitiveSelection[]
  artifactGraph: ArtifactGraph
  engineCommandManager: ConnectionManager
  kclManager: ReturnType<typeof useSingletons>['kclManager']
  wasmInstance: Parameters<typeof recast>[1]
}): Promise<SelectionReference[]> {
  const primitiveInfos: PrimitiveInfo[] = []

  for (const selection of graphSelections) {
    if (!isFaceOrEdgeArtifact(selection.artifact)) {
      continue
    }

    const entityId = selection.artifact?.id || selection.engineEntityId
    if (!entityId) {
      continue
    }

    const primitiveInfo = await getPrimitiveInfoForEntity(
      entityId,
      engineCommandManager
    )
    if (primitiveInfo) {
      primitiveInfos.push(primitiveInfo)
    }
  }

  for (const selection of enginePrimitives) {
    const primitiveInfo = getPrimitiveInfoFromSelection(selection)
    if (primitiveInfo) {
      primitiveInfos.push(primitiveInfo)
    }
  }

  const dedupedPrimitiveInfos = [
    ...new Map(
      primitiveInfos.map((info) => [
        `${info.primitiveType}:${info.parentEntityId || ''}:${info.primitiveIndex}:${info.entityId}`,
        info,
      ])
    ).values(),
  ]

  return dedupedPrimitiveInfos.flatMap((primitiveInfo) => {
    const code = createPrimitiveReferenceCode({
      primitiveInfo,
      artifactGraph,
      kclManager,
      wasmInstance,
    })
    if (!code) {
      return []
    }

    return [
      {
        id: `${primitiveInfo.primitiveType}:${primitiveInfo.entityId}`,
        label:
          primitiveInfo.primitiveType === 'face'
            ? `Face ${primitiveInfo.primitiveIndex}`
            : `Edge ${primitiveInfo.primitiveIndex}`,
        code,
      },
    ]
  })
}

function getEnginePrimitiveSelections(
  selections: ReturnType<
    typeof useModelingContext
  >['context']['selectionRanges']
): EnginePrimitiveSelection[] {
  return selections.otherSelections.filter(
    (selection): selection is EnginePrimitiveSelection =>
      typeof selection === 'object' &&
      selection !== null &&
      'type' in selection &&
      selection.type === 'enginePrimitive'
  )
}

async function copyCode(code: string) {
  try {
    await navigator.clipboard.writeText(code)
    toast.success('Copied KCL reference.')
  } catch {
    toast.error('Failed to copy KCL reference.')
  }
}

export function SelectionReferencesPopover() {
  const { kclManager } = useSingletons()
  const { context } = useModelingContext()
  const wasmInstance = use(kclManager.wasmInstancePromise)
  const selectionRanges = context.selectionRanges
  const [state, setState] = useState<SelectionReferenceState>({
    status: 'idle',
    references: [],
  })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading', references: [] })

    getSelectionDebugReferences({
      graphSelections: selectionRanges.graphSelections,
      enginePrimitives: getEnginePrimitiveSelections(selectionRanges),
      artifactGraph: kclManager.artifactGraph,
      engineCommandManager: kclManager.engineCommandManager,
      kclManager,
      wasmInstance,
    })
      .then((references) => {
        if (cancelled) {
          return
        }
        setState({ status: 'ready', references })
      })
      .catch((error) => {
        if (cancelled) {
          return
        }
        setState({
          status: 'error',
          references: [],
          message:
            error instanceof Error
              ? error.message
              : 'Unable to resolve selection references.',
        })
      })

    return () => {
      cancelled = true
    }
  }, [selectionRanges, kclManager, wasmInstance])

  if (state.status === 'loading') {
    return (
      <div className="p-2 text-xs text-chalkboard-70 dark:text-chalkboard-30">
        Resolving selection references...
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="p-2 text-xs text-destroy-80 dark:text-destroy-40">
        {state.message}
      </div>
    )
  }

  if (state.references.length === 0) {
    return (
      <div className="p-2 text-xs text-chalkboard-70 dark:text-chalkboard-30">
        No face or edge references for the current selection.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1 p-2">
      {state.references.map((reference) => (
        <button
          key={reference.id}
          type="button"
          className="grid grid-cols-[5rem,minmax(0,1fr)] gap-2 rounded-sm border border-transparent px-2 py-1 text-left text-xs hover:border-primary/50 hover:bg-primary/10 focus:border-primary focus:bg-primary/10 focus:outline-none"
          onClick={() => copyCode(reference.code).catch(reportRejection)}
        >
          <span className="text-chalkboard-70 dark:text-chalkboard-40">
            {reference.label}
          </span>
          <code className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-chalkboard-100 dark:text-chalkboard-10">
            {reference.code}
          </code>
        </button>
      ))}
    </div>
  )
}
