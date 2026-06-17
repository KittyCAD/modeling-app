import { use } from 'react'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'

import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
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
  getPatternArtifactForCopyId,
  getSweepFromSuspectedSweepSurface,
} from '@src/lang/std/artifactGraph'
import type { Artifact, ArtifactGraph, Expr } from '@src/lang/wasm'
import { recast } from '@src/lang/wasm'
import { useSingletons } from '@src/lib/boot'
import {
  getPrimitiveSelectionForEntity,
  isEnginePrimitiveSelection,
} from '@src/lib/selections'
import { err, reportRejection } from '@src/lib/trap'
import type {
  EnginePrimitiveSelection,
  Selection,
  Selections,
} from '@src/machines/modelingSharedTypes'
import type { ConnectionManager } from '@src/network/connectionManager'

type SelectionReference = {
  id: string
  label: string
  code: string
  graphSelection?: Selection
  enginePrimitiveSelection?: EnginePrimitiveSelection
}

type SelectionReferenceState =
  | { status: 'idle' | 'loading'; references: SelectionReference[] }
  | { status: 'ready'; references: SelectionReference[] }
  | { status: 'error'; references: SelectionReference[]; message: string }

type ReferenceablePrimitiveSelection = EnginePrimitiveSelection & {
  primitiveType: 'face' | 'edge'
  graphSelection?: Selection
  enginePrimitiveSelection?: EnginePrimitiveSelection
}

const BODY_REFERENCE_ARTIFACT_TYPES: Artifact['type'][] = [
  'sweep',
  'compositeSolid',
  'pattern',
  'helix',
]

function isReferenceablePrimitiveSelection(
  selection: EnginePrimitiveSelection
): selection is ReferenceablePrimitiveSelection {
  return (
    selection.primitiveType === 'face' || selection.primitiveType === 'edge'
  )
}

function isBodyReferenceArtifact(
  artifact: Artifact | undefined
): artifact is Extract<
  Artifact,
  { type: 'sweep' | 'compositeSolid' | 'pattern' | 'helix' }
> {
  return (
    artifact?.type === 'sweep' ||
    artifact?.type === 'compositeSolid' ||
    artifact?.type === 'pattern' ||
    artifact?.type === 'helix'
  )
}

function isSegmentReferenceArtifact(
  artifact: Artifact | undefined
): artifact is Extract<Artifact, { type: 'segment' }> {
  return artifact?.type === 'segment'
}

function isPrimitiveReferenceArtifact(artifact: Artifact | undefined): boolean {
  return (
    artifact?.type === 'wall' ||
    artifact?.type === 'cap' ||
    artifact?.type === 'primitiveFace' ||
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
  const parentArtifact =
    artifactGraph.get(parentEntityId) ??
    getPatternArtifactForCopyId(parentEntityId, artifactGraph)
  if (!parentArtifact) {
    return null
  }

  if (isBodyReferenceArtifact(parentArtifact)) {
    return {
      artifact: parentArtifact,
      codeRef: parentArtifact.codeRef,
      engineEntityId:
        parentArtifact.id === parentEntityId ? undefined : parentEntityId,
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
  primitiveSelection,
  artifactGraph,
  kclManager,
  wasmInstance,
}: {
  primitiveSelection: ReferenceablePrimitiveSelection
  artifactGraph: ArtifactGraph
  kclManager: ReturnType<typeof useSingletons>['kclManager']
  wasmInstance: Parameters<typeof recast>[1]
}): string | null {
  if (!primitiveSelection.parentEntityId) {
    return null
  }

  const bodySelection = getBodySelectionFromPrimitiveParentEntityId(
    primitiveSelection.parentEntityId,
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
    {
      lastChildLookup: true,
      artifactTypeFilter: BODY_REFERENCE_ARTIFACT_TYPES,
    }
  )
  if (err(bodyVariables) || bodyVariables.exprs.length === 0) {
    return null
  }

  const bodyExpr = bodyVariables.exprs[0]
  const functionName =
    primitiveSelection.primitiveType === 'face' ? 'faceId' : 'edgeId'
  const call = createCallExpressionStdLibKw(
    functionName,
    structuredClone(bodyExpr),
    [
      createLabeledArg(
        'index',
        createLiteral(primitiveSelection.primitiveIndex, wasmInstance)
      ),
    ]
  )

  return recastExpr(call, wasmInstance)
}

function createExpressionReferences({
  label,
  selection,
  artifactGraph,
  kclManager,
  wasmInstance,
  options,
}: {
  label: string
  selection: Selection
  artifactGraph: ArtifactGraph
  kclManager: ReturnType<typeof useSingletons>['kclManager']
  wasmInstance: Parameters<typeof recast>[1]
  options?: Parameters<typeof getVariableExprsFromSelection>[5]
}): SelectionReference[] {
  const variableExprs = getVariableExprsFromSelection(
    { graphSelections: [selection], otherSelections: [] },
    artifactGraph,
    kclManager.ast,
    wasmInstance,
    undefined,
    options
  )
  if (err(variableExprs)) {
    return []
  }

  return variableExprs.exprs.flatMap((expr) => {
    const code = recastExpr(expr, wasmInstance)
    if (!code) {
      return []
    }

    return [
      {
        id: `${label}:${selection.artifact?.id || selection.engineEntityId || code}:${code}`,
        label,
        code,
        graphSelection: selection,
      },
    ]
  })
}

async function getSelectionReferences({
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
  const references: SelectionReference[] = []
  const primitiveSelections: ReferenceablePrimitiveSelection[] = []

  for (const selection of graphSelections) {
    if (isBodyReferenceArtifact(selection.artifact)) {
      references.push(
        ...createExpressionReferences({
          label: 'Body',
          selection,
          artifactGraph,
          kclManager,
          wasmInstance,
          options: {
            lastChildLookup: true,
            artifactTypeFilter: BODY_REFERENCE_ARTIFACT_TYPES,
          },
        })
      )
      continue
    }

    if (isSegmentReferenceArtifact(selection.artifact)) {
      references.push(
        ...createExpressionReferences({
          label: 'Segment',
          selection,
          artifactGraph,
          kclManager,
          wasmInstance,
        })
      )
      continue
    }

    if (!isPrimitiveReferenceArtifact(selection.artifact)) {
      continue
    }

    const entityId = selection.artifact?.id || selection.engineEntityId
    if (!entityId) {
      continue
    }

    const primitiveSelection = await getPrimitiveSelectionForEntity(
      entityId,
      engineCommandManager
    )
    if (
      primitiveSelection &&
      isReferenceablePrimitiveSelection(primitiveSelection)
    ) {
      primitiveSelections.push({
        ...primitiveSelection,
        graphSelection: selection,
      })
    }
  }

  for (const selection of enginePrimitives) {
    if (isReferenceablePrimitiveSelection(selection)) {
      primitiveSelections.push({
        ...selection,
        enginePrimitiveSelection: selection,
      })
    }
  }

  const dedupedPrimitiveSelections = [
    ...new Map(
      primitiveSelections.map((selection) => [
        `${selection.primitiveType}:${selection.parentEntityId || ''}:${selection.primitiveIndex}:${selection.entityId}`,
        selection,
      ])
    ).values(),
  ]

  references.push(
    ...dedupedPrimitiveSelections.flatMap((primitiveSelection) => {
      const code = createPrimitiveReferenceCode({
        primitiveSelection,
        artifactGraph,
        kclManager,
        wasmInstance,
      })
      if (!code) {
        return []
      }

      return [
        {
          id: `${primitiveSelection.primitiveType}:${primitiveSelection.entityId}`,
          label: primitiveSelection.primitiveType === 'face' ? 'Face' : 'Edge',
          code,
          graphSelection: primitiveSelection.graphSelection,
          enginePrimitiveSelection: primitiveSelection.enginePrimitiveSelection,
        },
      ]
    })
  )

  return [
    ...new Map(
      references.map((reference) => [
        `${reference.label}:${reference.code}`,
        reference,
      ])
    ).values(),
  ]
}

function getEnginePrimitiveSelections(
  selections: ReturnType<
    typeof useModelingContext
  >['context']['selectionRanges']
): EnginePrimitiveSelection[] {
  return selections.otherSelections.filter(isEnginePrimitiveSelection)
}

async function copyCode(code: string) {
  try {
    await navigator.clipboard.writeText(code)
    toast.success('Copied KCL reference.')
  } catch {
    toast.error('Failed to copy KCL reference.')
  }
}

function isSameCodeRange(left: Selection, right: Selection) {
  return (
    left.codeRef.range[0] === right.codeRef.range[0] &&
    left.codeRef.range[1] === right.codeRef.range[1]
  )
}

function isSameGraphSelection(left: Selection, right: Selection) {
  if (left.artifact?.id && right.artifact?.id) {
    return left.artifact.id === right.artifact.id
  }

  if (left.engineEntityId && right.engineEntityId) {
    return left.engineEntityId === right.engineEntityId
  }

  return isSameCodeRange(left, right)
}

function isSameEnginePrimitiveSelection(
  left: EnginePrimitiveSelection,
  right: EnginePrimitiveSelection
) {
  return left.entityId === right.entityId
}

function removeReferenceFromSelections(
  selections: Selections,
  reference: SelectionReference
): Selections {
  const graphSelectionToRemove = reference.graphSelection
  const enginePrimitiveSelectionToRemove = reference.enginePrimitiveSelection

  return {
    graphSelections: graphSelectionToRemove
      ? selections.graphSelections.filter(
          (selection) =>
            !isSameGraphSelection(selection, graphSelectionToRemove)
        )
      : selections.graphSelections,
    otherSelections: enginePrimitiveSelectionToRemove
      ? selections.otherSelections.filter(
          (selection) =>
            !(
              typeof selection === 'object' &&
              selection !== null &&
              'type' in selection &&
              selection.type === 'enginePrimitive' &&
              isSameEnginePrimitiveSelection(
                selection,
                enginePrimitiveSelectionToRemove
              )
            )
        )
      : selections.otherSelections,
  }
}

export function SelectionReferencesPopover() {
  const { kclManager } = useSingletons()
  const { context, send } = useModelingContext()
  const wasmInstance = use(kclManager.wasmInstancePromise)
  const selectionRanges = context.selectionRanges
  const [state, setState] = useState<SelectionReferenceState>({
    status: 'idle',
    references: [],
  })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading', references: [] })

    getSelectionReferences({
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
        No selection references for the current selection.
      </div>
    )
  }

  const removeReference = (reference: SelectionReference) => {
    send({
      type: 'Set selection',
      data: {
        selectionType: 'completeSelection',
        selection: removeReferenceFromSelections(selectionRanges, reference),
      },
    })
  }

  return (
    <div className="flex flex-col gap-1 p-1 divide-y divide-chalkboard-30 dark:divide-chalkboard-80">
      {state.references.map((reference) => (
        <div
          key={reference.id}
          className="grid grid-cols-[minmax(0,1fr),auto,auto] items-center gap-2 rounded-sm px-2 py-1 text-xs"
        >
          <span className="truncate text-chalkboard-80 dark:text-chalkboard-30">
            {reference.label}
          </span>
          <button
            type="button"
            className="relative rounded-sm p-0.5 text-2 border-none dark:border-none hover:bg-2 focus:bg-2"
            aria-label={`Copy ${reference.label} KCL reference`}
            onClick={() => {
              copyCode(reference.code).catch(reportRejection)
            }}
          >
            <CustomIcon name="clipboard" className="h-4 w-4" />
            <Tooltip
              position="left"
              contentClassName="max-w-72 text-xs text-left"
            >
              <div className="mb-1">Copy KCL reference</div>
              <code className="block whitespace-normal break-all font-mono">
                {reference.code}
              </code>
            </Tooltip>
          </button>
          <button
            type="button"
            className="relative p-0.5 rounded-sm text-2 hover:bg-destroy-80 focus:bg-destroy-80 !border-none"
            aria-label={`Remove ${reference.label} from selection`}
            onClick={() => removeReference(reference)}
          >
            <CustomIcon name="close" className="h-4 w-4" />
            <Tooltip
              position="left"
              contentClassName="max-w-64 text-xs text-left"
            >
              Remove this item from the selection.
            </Tooltip>
          </button>
        </div>
      ))}
    </div>
  )
}
