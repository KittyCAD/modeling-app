/** Train a fixture-target recovery baseline. These labels are not CAD reviews. */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { fitRanker } from './sketch-constraint-eval.mjs'

const PROVENANCE = 'omitted_constraint_in_internal_test_fixture'

function loadRecords(contents) {
  const records = contents
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line)
      } catch {
        throw new Error(`Invalid JSON on line ${index + 1}`)
      }
    })
  if (!records.length) {
    throw new Error('No weak-label records')
  }
  const ids = new Set()
  for (const record of records) {
    if (
      record.schema_version !== 1 ||
      record.label_provenance !== PROVENANCE ||
      typeof record.source_ref !== 'string' ||
      !record.source_ref.includes('#sha256:') ||
      typeof record.variant !== 'string' ||
      typeof record.variant_sha256 !== 'string' ||
      !Array.isArray(record.candidates)
    ) {
      throw new Error(`Invalid provenance or shape for ${record.variant}`)
    }
    if (ids.has(record.variant)) {
      throw new Error(`Duplicate variant: ${record.variant}`)
    }
    ids.add(record.variant)
    const types = new Set()
    for (const candidate of record.candidates) {
      if (types.has(candidate.constraint_type)) {
        throw new Error(`Duplicate candidate type in ${record.variant}`)
      }
      types.add(candidate.constraint_type)
      if (
        candidate.label !==
        (candidate.constraint_type === record.weak_target_type
          ? 'accept'
          : 'reject')
      ) {
        throw new Error(`Inconsistent weak label in ${record.variant}`)
      }
      for (const field of [
        'baseline_score',
        'normalizedResidual',
        'previewMovementRatio',
        'freePointFraction',
      ]) {
        if (
          typeof candidate[field] !== 'number' ||
          !Number.isFinite(candidate[field]) ||
          candidate[field] < 0 ||
          candidate[field] > 1
        ) {
          throw new Error(`Invalid ${field} in ${record.variant}`)
        }
      }
      if (candidate.previewMovementRatio > 0.05) {
        throw new Error(`Unsafe preview in ${record.variant}`)
      }
    }
  }
  return records
}

function probability(model, candidate) {
  const typeIndex = model.feature_names.indexOf(
    `type:${candidate.constraint_type}`
  )
  if (typeIndex < 0) {
    throw new Error('Model has no feature for candidate type')
  }
  const features = [
    1,
    candidate.normalizedResidual,
    candidate.previewMovementRatio / 0.05,
    candidate.freePointFraction,
  ]
  const logit =
    features.reduce(
      (sum, value, index) => sum + value * model.weights[index],
      0
    ) + model.weights[typeIndex]
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, logit))))
}

function retrieval(records, score) {
  let withTarget = 0
  let topOne = 0
  let ambiguous = 0
  let ambiguousTopOne = 0
  for (const record of records) {
    if (!record.candidates.some((candidate) => candidate.label === 'accept')) {
      continue
    }
    withTarget += 1
    const best = [...record.candidates].sort((a, b) => score(b) - score(a))[0]
    if (best.label === 'accept') {
      topOne += 1
    }
    if (record.candidates.length > 1) {
      ambiguous += 1
      if (best.label === 'accept') {
        ambiguousTopOne += 1
      }
    }
  }
  return {
    with_target: withTarget,
    top_one: topOne,
    ambiguous,
    ambiguous_top_one: ambiguousTopOne,
  }
}

function sumRetrieval(results) {
  return results.reduce(
    (sum, result) => ({
      with_target: sum.with_target + result.with_target,
      top_one: sum.top_one + result.top_one,
      ambiguous: sum.ambiguous + result.ambiguous,
      ambiguous_top_one: sum.ambiguous_top_one + result.ambiguous_top_one,
    }),
    { with_target: 0, top_one: 0, ambiguous: 0, ambiguous_top_one: 0 }
  )
}

export function trainWeakBaseline(records) {
  const positive = records
    .flatMap((record) => record.candidates)
    .filter((candidate) => candidate.label === 'accept').length
  const negative = records
    .flatMap((record) => record.candidates)
    .filter((candidate) => candidate.label === 'reject').length
  const families = [...new Set(records.map((record) => record.source_ref))]
  if (families.length < 3 || positive < 10 || negative < 10) {
    throw new Error(
      'Need three source families and at least ten target and non-target candidates'
    )
  }
  const folds = families.map((heldOutSource) => {
    const train = records
      .filter((record) => record.source_ref !== heldOutSource)
      .map((record) => ({ ...record, split: 'train' }))
    const test = records.filter((record) => record.source_ref === heldOutSource)
    const model = fitRanker(train)
    return {
      held_out_source: heldOutSource,
      train_selections: train.length,
      test_selections: test.length,
      baseline: retrieval(test, (candidate) => candidate.baseline_score),
      learned: retrieval(test, (candidate) => probability(model, candidate)),
    }
  })
  const fitted = fitRanker(
    records.map((record) => ({ ...record, split: 'train' }))
  )
  const heldOutBaseline = sumRetrieval(folds.map((fold) => fold.baseline))
  const heldOutLearned = sumRetrieval(folds.map((fold) => fold.learned))
  const model = {
    ...fitted,
    training_provenance: PROVENANCE,
    training_selections: records.length,
    training_candidates: positive + negative,
    training_source_families: families.length,
    experimental_only: true,
  }
  const report = {
    purpose: 'recover the constraint type omitted from a source-derived sketch',
    label_provenance: PROVENANCE,
    cad_reviewed_labels: 0,
    selections: records.length,
    candidates: positive + negative,
    target_candidates: positive,
    non_target_candidates: negative,
    source_families: families.length,
    in_sample: {
      baseline: retrieval(records, (candidate) => candidate.baseline_score),
      learned: retrieval(records, (candidate) => probability(model, candidate)),
    },
    leave_one_source_out: folds,
    leave_one_source_out_summary: {
      baseline: heldOutBaseline,
      learned: heldOutLearned,
    },
    enable_in_app: false,
    enable_reason:
      'The weak-label model lost to the rules baseline on source-family holdouts and has no CAD-reviewed labels.',
    limitations: [
      'Non-target candidates are weak negatives; they may encode valid alternative design intent.',
      'Perturbed variants share source geometry and do not form independent CAD examples.',
      'This experiment does not measure user acceptance or dimension-edit design intent.',
    ],
  }
  return { model, report }
}

export async function run(dataPath, modelPath, reportPath) {
  const records = loadRecords(await readFile(dataPath, 'utf8'))
  const result = trainWeakBaseline(records)
  await writeFile(modelPath, `${JSON.stringify(result.model, null, 2)}\n`)
  await writeFile(reportPath, `${JSON.stringify(result.report, null, 2)}\n`)
  return result.report
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [, , dataPath, modelPath, reportPath] = process.argv
  if (!dataPath || !modelPath || !reportPath) {
    console.error(
      'Usage: node scripts/sketch-constraint-weak-fit.mjs samples.jsonl model.json report.json'
    )
    process.exitCode = 2
  } else {
    run(dataPath, modelPath, reportPath)
      .then((report) => console.log(JSON.stringify(report, null, 2)))
      .catch((error) => {
        console.error(error.message)
        process.exitCode = 1
      })
  }
}
