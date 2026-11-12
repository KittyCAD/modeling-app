import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type {
  SceneGraph,
  SceneGraphDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { KCLError } from '@src/lang/errors'
import {
  generateConstraintCandidates,
  rankConstraintSuggestions,
} from '@src/machines/sketchSolve/constraints/constraintSuggestions'
import { describe, expect, it } from 'vitest'

type SeedRow = {
  case_id: string
  input_path: string
  input_sha256: string
  selection_names: string[]
  source_ref: string
  target_constraint_type: string
}

function sha256(source: string) {
  return createHash('sha256').update(source).digest('hex')
}

function locateSelections(source: string, row: SeedRow, graph: SceneGraph) {
  const sketch = graph.objects.find((object) => object.kind.type === 'Sketch')
  if (!sketch) {
    throw new Error(`${row.case_id}: missing sketch`)
  }
  const selectionIds = row.selection_names.map((name) => {
    const localName = name.split('.').at(-1)
    const declaration = new RegExp(
      `\\b${localName}\\s*=\\s*(?:line|circle|arc)\\s*\\(`
    ).exec(source)
    if (!declaration) {
      throw new Error(`${row.case_id}: missing ${name}`)
    }
    const expressionOffset = declaration.index + declaration[0].length - 1
    const object = graph.objects.find(
      (candidate) =>
        candidate.kind.type === 'Segment' &&
        candidate.kind.segment.type !== 'Point' &&
        candidate.source.type === 'Simple' &&
        candidate.source.range[0] <= expressionOffset &&
        expressionOffset < candidate.source.range[1]
    )
    if (!object) {
      throw new Error(`${row.case_id}: missing object for ${name}`)
    }
    return object.id
  })
  return { sketchId: sketch.id, selectionIds }
}

type PreviewResult =
  | { ok: true; delta: SceneGraphDelta }
  | { ok: false; error: string }

function nativeCapture(binary: string, input: string): { graph: SceneGraph }
function nativeCapture(
  binary: string,
  input: string,
  previewPath: string
): { graph: SceneGraph; previews: PreviewResult[] }
function nativeCapture(binary: string, input: string, previewPath?: string) {
  const args = previewPath ? [input, previewPath] : [input]
  return JSON.parse(execFileSync(binary, args, { encoding: 'utf8' }))
}

function variants(row: SeedRow, seed: string) {
  const offsets = [
    -0.15, -0.12, -0.09, -0.06, -0.03, 0.01, 0.04, 0.07, 0.1, 0.13,
  ]
  return offsets.map((offset, index) => {
    const number = (value: number) => Number(value.toFixed(3))
    let source: string
    let transform: string
    if (row.case_id === 'equal-radius-circles') {
      source = seed.replace('14.9mm', `${number(15 + offset)}mm`)
      transform = 'jittered the free circle start point'
    } else if (row.case_id === 'tangent-line-circle') {
      source = seed
        .replace('6.03mm', `${number(6 + offset)}mm`)
        .replace('3.03mm', `${number(3 + offset)}mm`)
      transform = 'jittered the free circle center while preserving its radius'
    } else if (row.case_id === 'equal-length-triangle') {
      source = `s = sketch(on = XY) {
  line2 = line(start = [var 0mm, var 0mm], end = [var 4mm, var 3mm])
  line3 = line(start = [var 10mm, var 0mm], end = [var 14mm, var ${number(3 + offset)}mm])
}
`
      transform =
        'isolated the fixture equal-length line pair and jittered one endpoint'
    } else if (row.case_id === 'horizontal-triangle') {
      source = `s = sketch(on = XY) {
  line1 = line(start = [var 0mm, var 0mm], end = [var ${number(10 + offset)}mm, var ${number(0.05 + index * 0.01)}mm])
}
`
      transform =
        'isolated the fixture horizontal line and jittered endpoint and length'
    } else {
      throw new Error(`Unsupported fixture: ${row.case_id}`)
    }
    if (source === seed) {
      throw new Error(`${row.case_id}: variant has no change`)
    }
    return { id: `${row.case_id}-${index + 1}`, source, transform }
  })
}

describe.skipIf(!process.env.SKETCH_WEAK_TRAIN_MANIFEST)(
  'experimental sketch weak-label capture',
  () => {
    it('captures solver-safe candidates from source-derived sketches', async () => {
      const manifestPath = process.env.SKETCH_WEAK_TRAIN_MANIFEST
      const outputPath = process.env.SKETCH_WEAK_TRAIN_OUTPUT
      if (!manifestPath || !outputPath) {
        throw new Error(
          'Set SKETCH_WEAK_TRAIN_MANIFEST and SKETCH_WEAK_TRAIN_OUTPUT'
        )
      }
      const repoRoot = resolve(dirname(manifestPath), '../..')
      const binary = resolve(
        process.cwd(),
        'rust/target/debug/examples/sketch_constraint_capture'
      )
      const rows: SeedRow[] = readFileSync(manifestPath, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      const temp = mkdtempSync(join(tmpdir(), 'sketch-weak-capture-'))
      const examples = []
      try {
        for (const row of rows) {
          const seed = readFileSync(resolve(repoRoot, row.input_path), 'utf8')
          expect(sha256(seed)).toBe(row.input_sha256)
          for (const variant of variants(row, seed)) {
            const inputPath = join(temp, `${variant.id}.kcl`)
            const previewPath = join(temp, `${variant.id}.json`)
            writeFileSync(inputPath, variant.source)
            const { graph } = nativeCapture(binary, inputPath)
            const { sketchId, selectionIds } = locateSelections(
              variant.source,
              row,
              graph
            )
            const candidates = generateConstraintCandidates(
              selectionIds,
              sketchId,
              graph.objects
            )
            writeFileSync(
              previewPath,
              JSON.stringify(
                candidates.map((candidate) => ({
                  sketch_id: sketchId,
                  constraint: candidate.payload,
                }))
              )
            )
            const previewCapture = nativeCapture(binary, inputPath, previewPath)
            let previewIndex = 0
            const suggestions = await rankConstraintSuggestions({
              selectionIds,
              sketchId,
              objects: graph.objects,
              rustContext: {
                previewConstraint: async () => {
                  const result = previewCapture.previews[previewIndex++]
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
            examples.push({
              schema_version: 1,
              case_id: row.case_id,
              source_ref: row.source_ref,
              seed_sha256: row.input_sha256,
              variant_sha256: sha256(variant.source),
              variant: variant.id,
              source_transform: variant.transform,
              selection_ids: selectionIds,
              weak_target_type: row.target_constraint_type,
              label_provenance: 'omitted_constraint_in_internal_test_fixture',
              generated_candidates: candidates.length,
              solver_rejected: previewCapture.previews.filter(
                (item) => !item.ok
              ).length,
              candidates: suggestions.map((suggestion) => ({
                constraint_type: suggestion.payload.type,
                candidate_payload: suggestion.payload,
                baseline_score: suggestion.score,
                ...suggestion.features,
                label:
                  suggestion.payload.type === row.target_constraint_type
                    ? 'accept'
                    : 'reject',
              })),
            })
            console.log(
              variant.id,
              candidates.length,
              suggestions.map((item) => item.payload.type)
            )
          }
        }
        writeFileSync(
          outputPath,
          `${examples.map((row) => JSON.stringify(row)).join('\n')}\n`
        )
      } finally {
        rmSync(temp, { recursive: true, force: true })
      }
    }, 120_000)
  }
)
