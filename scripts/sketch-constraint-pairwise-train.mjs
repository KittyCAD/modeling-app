/** Experimental ranking model trained on constraints masked from KCL fixtures. */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const TYPES = [
  'Horizontal',
  'Vertical',
  'Parallel',
  'Perpendicular',
  'LinesEqualLength',
  'EqualRadius',
  'Tangent',
  'Symmetric',
  'Distance',
  'Radius',
  'Diameter',
]
const FEATURE_NAMES = [
  'intercept',
  'normalizedResidual',
  'previewMovementRatio / 0.05',
  'freePointFraction',
  ...TYPES.map((type) => `type:${type}`),
]
const ALLOWED_PROVENANCE = new Set([
  'omitted_constraint_in_internal_test_fixture',
  'masked_constraint_in_internal_test_fixture',
])

function familyFor(record) {
  if (record.family) return record.family
  if (record.case_id === 'equal-radius-circles') return 'equal-radius-circles'
  if (record.case_id === 'tangent-line-circle') return 'tangent-line-circle'
  if (
    record.case_id === 'horizontal-triangle' ||
    record.case_id === 'equal-length-triangle'
  ) {
    return 'triangle-profile'
  }
  throw new Error(`Unknown family for ${record.variant}`)
}

function loadRecords(contents) {
  const records = contents
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  for (const record of records) {
    if (
      record.schema_version !== 1 ||
      !ALLOWED_PROVENANCE.has(record.label_provenance) ||
      !record.source_ref?.includes('#sha256:') ||
      !Array.isArray(record.candidates) ||
      !record.variant
    ) {
      throw new Error(`Invalid record: ${record.variant}`)
    }
    record.family = familyFor(record)
    const seen = new Set()
    for (const candidate of record.candidates) {
      if (
        !TYPES.includes(candidate.constraint_type) ||
        seen.has(candidate.constraint_type) ||
        candidate.label !==
          (candidate.constraint_type === record.weak_target_type
            ? 'accept'
            : 'reject')
      ) {
        throw new Error(`Invalid candidate in ${record.variant}`)
      }
      seen.add(candidate.constraint_type)
      for (const key of [
        'baseline_score',
        'normalizedResidual',
        'previewMovementRatio',
        'freePointFraction',
      ]) {
        if (
          !Number.isFinite(candidate[key]) ||
          candidate[key] < 0 ||
          candidate[key] > 1
        ) {
          throw new Error(`Invalid ${key} in ${record.variant}`)
        }
      }
    }
  }
  return records
}

function vector(candidate) {
  return [
    1,
    candidate.normalizedResidual,
    candidate.previewMovementRatio / 0.05,
    candidate.freePointFraction,
    ...TYPES.map((type) => Number(candidate.constraint_type === type)),
  ]
}

function score(weights, candidate) {
  return vector(candidate).reduce(
    (sum, value, index) => sum + value * weights[index],
    0
  )
}

function retrieval(records, weights) {
  let topOne = 0
  let ambiguous = 0
  let ambiguousTopOne = 0
  for (const record of records) {
    const best = [...record.candidates].sort(
      (a, b) => score(weights, b) - score(weights, a)
    )[0]
    if (best?.label === 'accept') topOne += 1
    if (record.candidates.length > 1) {
      ambiguous += 1
      if (best?.label === 'accept') ambiguousTopOne += 1
    }
  }
  return {
    selections: records.length,
    top_one: topOne,
    ambiguous,
    ambiguous_top_one: ambiguousTopOne,
  }
}

function familyPairs(records) {
  const byFamily = new Map()
  for (const record of records) {
    const positives = record.candidates.filter(
      (candidate) => candidate.label === 'accept'
    )
    const negatives = record.candidates.filter(
      (candidate) => candidate.label === 'reject'
    )
    if (positives.length !== 1 || negatives.length === 0) continue
    const pairs = byFamily.get(record.family) ?? []
    for (const negative of negatives) {
      const positiveVector = vector(positives[0])
      const negativeVector = vector(negative)
      pairs.push(
        positiveVector.map((value, index) => value - negativeVector[index])
      )
    }
    byFamily.set(record.family, pairs)
  }
  return byFamily
}

export function fitPairwise(records) {
  const pairs = familyPairs(records)
  if (pairs.size < 2) {
    throw new Error(
      'Need ambiguous training examples from at least two sketch families'
    )
  }
  // Geometry residual supplies a conservative prior. Learn only small
  // corrections from the masked-source labels.
  const prior = Array(FEATURE_NAMES.length).fill(0)
  prior[1] = -1
  const weights = [...prior]
  const regularization = 0.35
  for (let step = 0; step < 1600; step += 1) {
    const gradient = weights.map((weight, index) =>
      index === 0 ? 0 : regularization * (weight - prior[index])
    )
    for (const familyExamples of pairs.values()) {
      for (const difference of familyExamples) {
        const margin = difference.reduce(
          (sum, value, index) => sum + value * weights[index],
          0
        )
        const error = -1 / (1 + Math.exp(Math.max(-30, Math.min(30, margin))))
        for (let index = 1; index < weights.length; index += 1) {
          gradient[index] +=
            (error * difference[index]) / (pairs.size * familyExamples.length)
        }
      }
    }
    for (let index = 1; index < weights.length; index += 1) {
      weights[index] -= 0.12 * gradient[index]
    }
  }
  return { schema_version: 2, feature_names: FEATURE_NAMES, weights }
}

function sumResults(results) {
  return results.reduce(
    (sum, result) => ({
      selections: sum.selections + result.selections,
      top_one: sum.top_one + result.top_one,
      ambiguous: sum.ambiguous + result.ambiguous,
      ambiguous_top_one: sum.ambiguous_top_one + result.ambiguous_top_one,
    }),
    { selections: 0, top_one: 0, ambiguous: 0, ambiguous_top_one: 0 }
  )
}

export function trainAndEvaluate(records) {
  const seenVariants = new Set()
  for (const record of records) {
    if (seenVariants.has(record.variant)) {
      throw new Error(`Duplicate training variant: ${record.variant}`)
    }
    seenVariants.add(record.variant)
  }
  const usable = records.filter((record) =>
    record.candidates.some((candidate) => candidate.label === 'accept')
  )
  const families = [...new Set(usable.map((record) => record.family))]
  if (families.length < 4) {
    throw new Error('Need at least four independent source families')
  }
  const baselineWeights = Array(FEATURE_NAMES.length).fill(0)
  baselineWeights[1] = -1
  const folds = families.map((heldOutFamily) => {
    const train = usable.filter((record) => record.family !== heldOutFamily)
    const test = usable.filter((record) => record.family === heldOutFamily)
    const model = fitPairwise(train)
    return {
      held_out_family: heldOutFamily,
      train_selections: train.length,
      baseline: retrieval(test, baselineWeights),
      learned: retrieval(test, model.weights),
    }
  })
  const fitted = fitPairwise(usable)
  const heldOutBaseline = sumResults(folds.map((fold) => fold.baseline))
  const heldOutLearned = sumResults(folds.map((fold) => fold.learned))
  const candidateRecall = usable.length / records.length
  const enableInPreview =
    heldOutLearned.top_one >= heldOutBaseline.top_one &&
    heldOutLearned.ambiguous_top_one >= heldOutBaseline.ambiguous_top_one
  return {
    model: {
      ...fitted,
      training_provenance: 'masked_internal_kcl_constraints',
      training_selections: usable.length,
      training_candidates: usable.reduce(
        (total, record) => total + record.candidates.length,
        0
      ),
      training_source_families: families.length,
      experimental_only: true,
    },
    report: {
      purpose:
        'rank solver-safe candidates by recovering hidden KCL constraints',
      label_provenance: 'masked_internal_kcl_constraints',
      cad_reviewed_labels: 0,
      source_families: families.length,
      captured_selections: records.length,
      usable_selections: usable.length,
      candidate_recall: candidateRecall,
      leave_one_family_out: folds,
      leave_one_family_out_summary: {
        baseline: heldOutBaseline,
        learned: heldOutLearned,
      },
      enable_in_preview: enableInPreview,
      enable_reason: enableInPreview
        ? 'The trained ranker matched or beat the rules order on weak-label family holdouts; this is an experimental preview only.'
        : 'The trained ranker lost to the rules order on weak-label family holdouts.',
      limitations: [
        'Labels recover hidden fixture constraints, not CAD-reviewed design intent.',
        'Other candidates may also encode valid design intent; weak negatives are uncertain.',
        'The model only ranks generated, solver-safe candidates; it cannot recover a candidate the generator missed.',
        'Perturbed variants of one source sketch share a family and are held out together.',
      ],
    },
  }
}

export async function run(weakPath, corpusPath, modelPath, reportPath) {
  const records = [
    ...loadRecords(await readFile(weakPath, 'utf8')),
    ...loadRecords(await readFile(corpusPath, 'utf8')),
  ]
  const result = trainAndEvaluate(records)
  await writeFile(modelPath, `${JSON.stringify(result.model, null, 2)}\n`)
  await writeFile(reportPath, `${JSON.stringify(result.report, null, 2)}\n`)
  return result.report
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [, , weakPath, corpusPath, modelPath, reportPath] = process.argv
  if (!weakPath || !corpusPath || !modelPath || !reportPath) {
    console.error(
      'Usage: node scripts/sketch-constraint-pairwise-train.mjs weak.jsonl corpus.jsonl model.json report.json'
    )
    process.exitCode = 2
  } else {
    run(weakPath, corpusPath, modelPath, reportPath)
      .then((report) => console.log(JSON.stringify(report, null, 2)))
      .catch((error) => {
        console.error(error.message)
        process.exitCode = 1
      })
  }
}
