import type { ExecutionDiagnostic } from '@src/contracts/execution'
import {
  type KclCompilationIssue,
  issuesToDiagnostics,
} from '@src/features/kclAnalysis/diagnostics'

/** The parts of `ExecOutcome` this app reads. */
export interface KclExecOutcome {
  issues?: KclCompilationIssue[]
  operations?: unknown
  artifactGraph?: unknown
  variables?: Record<string, unknown>
  defaultPlanes?: unknown
}

/** What `Context.execute` resolves with. */
export interface KclSceneGraphDelta {
  exec_outcome?: KclExecOutcome
  new_objects?: unknown[]
}

/** What a failed execution throws: an error plus everything it got done first. */
export interface KclErrorWithOutputs {
  error?: {
    kind?: string
    details?: {
      msg?: string
      sourceRanges?: [number, number, number][]
    }
  }
  nonFatal?: KclCompilationIssue[]
}

/**
 * A summary of one execution, for the UI.
 *
 * The artifact graph and operations are kept as opaque values: the viewport
 * shows the engine's own render, so nothing here needs to understand geometry
 * yet, and pretending to would invite parsing it in the wrong places.
 */
export interface KclExecutionSummary {
  /** Top-level variable names, in declaration order. */
  variableNames: string[]
  /** Whether the engine reported default planes, i.e. a scene exists. */
  hasScene: boolean
  operations: unknown
  artifactGraph: unknown
}

export function summarize(outcome: KclExecOutcome): KclExecutionSummary {
  return {
    variableNames: Object.keys(outcome.variables ?? {}),
    hasScene: Boolean(outcome.defaultPlanes),
    operations: outcome.operations,
    artifactGraph: outcome.artifactGraph,
  }
}

/**
 * Diagnostics from a *successful* execution.
 *
 * Success still produces issues: warnings, deprecations, and non-fatal problems
 * all arrive here rather than as a thrown error.
 */
export function diagnosticsFromOutcome(
  outcome: KclExecOutcome,
  contentLength: number
): ExecutionDiagnostic[] {
  return issuesToDiagnostics(outcome.issues ?? [], contentLength)
}

/**
 * Diagnostics from a failed execution.
 *
 * The fatal error comes first, then whatever non-fatal issues were collected
 * before it. Both matter: the error says why it stopped, and the warnings often
 * say why it went wrong.
 */
export function diagnosticsFromFailure(
  thrown: unknown,
  contentLength: number
): ExecutionDiagnostic[] {
  const failure = asErrorWithOutputs(thrown)

  if (!failure) {
    return [
      {
        from: 0,
        to: Math.min(1, contentLength),
        severity: 'error',
        message: thrown instanceof Error ? thrown.message : 'Execution failed.',
      },
    ]
  }

  const details = failure.error?.details
  const [range] = details?.sourceRanges ?? []
  const fatal: ExecutionDiagnostic[] = details?.msg
    ? issuesToDiagnostics(
        [
          {
            sourceRange: range ?? [0, 0, 0],
            message: details.msg,
            severity: 'Error',
          },
        ],
        contentLength
      )
    : []

  return [
    ...fatal,
    ...issuesToDiagnostics(failure.nonFatal ?? [], contentLength),
  ]
}

/**
 * Recognise the structured failure shape.
 *
 * WASM throws values rather than `Error`s, and they arrive either as an object
 * or as a JSON string depending on the path, so both are accepted before giving
 * up and reporting the raw text.
 */
function asErrorWithOutputs(thrown: unknown): KclErrorWithOutputs | null {
  if (thrown && typeof thrown === 'object' && 'error' in thrown) {
    return thrown as KclErrorWithOutputs
  }

  const text =
    thrown instanceof Error
      ? thrown.message
      : typeof thrown === 'string'
        ? thrown
        : null
  if (!text) return null

  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && 'error' in parsed
      ? (parsed as KclErrorWithOutputs)
      : null
  } catch {
    return null
  }
}
