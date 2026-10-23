import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type {
  ApiConstraint,
  ApiObject,
  SceneGraph,
  SceneGraphDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { KCLError } from '@src/lang/errors'
import {
  generateConstraintCandidates,
  rankConstraintSuggestions,
} from '@src/machines/sketchSolve/constraints/constraintSuggestions'
import { describe, expect, it } from 'vitest'

type CorpusRow = {
  family: string
  input_path: string
  input_sha256: string
  source_ref: string
}

type PreviewResult =
  | { ok: true; delta: SceneGraphDelta }
  | { ok: false; error: string }

function capture(binary: string, input: string, previewPath?: string) {
  const args = previewPath ? [input, previewPath] : [input]
  return JSON.parse(
    execFileSync(binary, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  ) as {
    graph: SceneGraph
    previews?: PreviewResult[]
  }
}

function selectedSegmentIds(constraint: ApiConstraint): number[] | null {
  switch (constraint.type) {
    case 'Horizontal':
    case 'Vertical':
      return 'line' in constraint ? [constraint.line] : null
    case 'LinesEqualLength':
    case 'Parallel':
    case 'Perpendicular':
      return constraint.lines.length === 2 ? constraint.lines : null
    case 'EqualRadius':
    case 'Tangent':
      return constraint.input.length === 2 ? constraint.input : null
    case 'Coincident':
    case 'Distance':
    case 'Angle':
    case 'Diameter':
    case 'Fixed':
    case 'HorizontalDistance':
    case 'VerticalDistance':
    case 'Midpoint':
    case 'Radius':
    case 'Symmetric':
      return null
  }
}

function maskableConstraint(
  object: ApiObject,
  source: string,
  graph: SceneGraph
) {
  if (object.kind.type !== 'Constraint' || object.source.type !== 'Simple') {
    return null
  }
  const selected = selectedSegmentIds(object.kind.constraint)
  if (!selected || selected.some((id) => typeof id !== 'number')) {
    return null
  }
  const range = object.source.range
  const expression = source.slice(range[0], range[1]).trim()
  if (
    !/^(horizontal|vertical|equalLength|equalRadius|tangent|parallel|perpendicular)\(/.test(
      expression
    )
  ) {
    return null
  }
  const sketchIndex = graph.objects
    .filter((candidate) => candidate?.kind.type === 'Sketch')
    .findIndex(
      (candidate) =>
        candidate.kind.type === 'Sketch' &&
        candidate.kind.constraints.includes(object.id)
    )
  if (sketchIndex < 0) {
    return null
  }
  return { selected, sketchIndex, range }
}

function mapSelection(
  selectedIds: readonly number[],
  original: SceneGraph,
  masked: SceneGraph,
  removedRange: readonly number[]
) {
  const [removedStart, removedEnd] = removedRange
  const removedLength = removedEnd - removedStart
  const mapped: number[] = []
  for (const id of selectedIds) {
    const originalObject = original.objects[id]
    if (
      originalObject?.kind.type !== 'Segment' ||
      originalObject.kind.segment.type === 'Point' ||
      originalObject.source.type !== 'Simple'
    ) {
      return null
    }
    const segmentType = originalObject.kind.segment.type
    const originalRange = originalObject.source.range
    const adjusted = [originalRange[0], originalRange[1]].map((offset) =>
      offset >= removedEnd ? offset - removedLength : offset
    )
    const matches = masked.objects.filter(
      (candidate) =>
        candidate?.kind.type === 'Segment' &&
        candidate.kind.segment.type === segmentType &&
        candidate.source.type === 'Simple' &&
        candidate.source.range[0] === adjusted[0] &&
        candidate.source.range[1] === adjusted[1]
    )
    if (matches.length !== 1) {
      return null
    }
    mapped.push(matches[0].id)
  }
  return mapped
}

describe.skipIf(!process.env.SKETCH_CORPUS_MANIFEST)(
  'experimental source-constraint capture',
  () => {
    it('masks fixture constraints and captures solver-safe suggestions', async () => {
      const manifestPath = process.env.SKETCH_CORPUS_MANIFEST
      const outputPath = process.env.SKETCH_CORPUS_OUTPUT
      if (!manifestPath || !outputPath) {
        throw new Error('Set SKETCH_CORPUS_MANIFEST and SKETCH_CORPUS_OUTPUT')
      }
      const repoRoot = resolve(dirname(manifestPath), '../..')
      const binary = resolve(
        process.cwd(),
        'rust/target/debug/examples/sketch_constraint_capture'
      )
      const rows: CorpusRow[] = readFileSync(manifestPath, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      const temp = mkdtempSync(join(tmpdir(), 'sketch-corpus-capture-'))
      const examples = []
      const counts = {
        eligible: 0,
        maskedExecutionFailed: 0,
        selectionMappingFailed: 0,
        candidateMissed: 0,
      }
      try {
        for (const row of rows) {
          const source = readFileSync(resolve(repoRoot, row.input_path), 'utf8')
          expect(createHash('sha256').update(source).digest('hex')).toBe(
            row.input_sha256
          )
          const originalPath = resolve(repoRoot, row.input_path)
          const original = capture(binary, originalPath).graph
          for (const constraintObject of original.objects) {
            if (!constraintObject) {
              continue
            }
            const mask = maskableConstraint(constraintObject, source, original)
            if (!mask || constraintObject.kind.type !== 'Constraint') {
              continue
            }
            counts.eligible += 1
            const [start, end] = mask.range
            const maskedSource = source.slice(0, start) + source.slice(end)
            const inputPath = join(temp, 'masked.kcl')
            const previewPath = join(temp, 'previews.json')
            writeFileSync(inputPath, maskedSource)
            let masked: SceneGraph
            try {
              masked = capture(binary, inputPath).graph
            } catch {
              counts.maskedExecutionFailed += 1
              continue
            }
            const selectionIds = mapSelection(
              mask.selected,
              original,
              masked,
              mask.range
            )
            const sketch = masked.objects.filter(
              (object) => object?.kind.type === 'Sketch'
            )[mask.sketchIndex]
            if (!selectionIds || sketch?.kind.type !== 'Sketch') {
              counts.selectionMappingFailed += 1
              continue
            }
            const candidates = generateConstraintCandidates(
              selectionIds,
              sketch.id,
              masked.objects
            )
            writeFileSync(
              previewPath,
              JSON.stringify(
                candidates.map((candidate) => ({
                  sketch_id: sketch.id,
                  constraint: candidate.payload,
                }))
              )
            )
            const previews = capture(binary, inputPath, previewPath).previews
            if (!previews) {
              throw new Error('Native capture did not return previews')
            }
            let previewIndex = 0
            const suggestions = await rankConstraintSuggestions({
              selectionIds,
              sketchId: sketch.id,
              objects: masked.objects,
              rustContext: {
                previewConstraint: async () => {
                  const result = previews[previewIndex++]
                  if (result.ok) {
                    return result.delta
                  }
                  throw Object.setPrototypeOf(
                    new Error(result.error),
                    KCLError.prototype
                  )
                },
              },
              settings: {},
            })
            expect(previewIndex).toBe(candidates.length)
            const targetType = constraintObject.kind.constraint.type
            if (
              !suggestions.some(
                (suggestion) => suggestion.payload.type === targetType
              )
            ) {
              counts.candidateMissed += 1
            }
            examples.push({
              schema_version: 1,
              case_id: `${row.family}-${constraintObject.id}`,
              family: row.family,
              source_ref: row.source_ref,
              source_sha256: row.input_sha256,
              variant_sha256: createHash('sha256')
                .update(maskedSource)
                .digest('hex'),
              variant: `${row.input_path}#constraint:${constraintObject.id}`,
              source_transform: 'removed one constraint expression',
              selection_ids: selectionIds,
              weak_target_type: targetType,
              label_provenance: 'masked_constraint_in_internal_test_fixture',
              generated_candidates: candidates.length,
              solver_rejected: previews.filter((item) => !item.ok).length,
              candidates: suggestions.map((suggestion) => ({
                constraint_type: suggestion.payload.type,
                candidate_payload: suggestion.payload,
                baseline_score: suggestion.score,
                ...suggestion.features,
                label:
                  suggestion.payload.type === targetType ? 'accept' : 'reject',
              })),
            })
          }
        }
        writeFileSync(
          outputPath,
          `${examples.map((row) => JSON.stringify(row)).join('\n')}\n`
        )
        console.log({ ...counts, captured: examples.length })
      } finally {
        rmSync(temp, { recursive: true, force: true })
      }
    }, 120_000)
  }
)
