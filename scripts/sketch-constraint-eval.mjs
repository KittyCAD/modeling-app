import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const TYPES = [
  'Horizontal',
  'Vertical',
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

function requiredString(value, name) {
  if (typeof value !== 'string' || !value.trim() || value === 'FILL_IN') {
    throw new Error(`${name} must be filled in`)
  }
}

function fraction(value, name) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw new Error(`${name} must be a number from 0 to 1`)
  }
}

export function validateRecords(records) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error('No review records')
  }
  const familySplits = new Map()
  const sourceSplits = new Map()
  const sampleIds = new Set()
  for (const [index, record] of records.entries()) {
    const prefix = `record ${index + 1}`
    if (record.schema_version !== 1) {
      throw new Error(`${prefix}: unsupported schema_version`)
    }
    for (const field of [
      'sample_id',
      'project_family',
      'source_ref',
      'reviewer',
    ]) {
      requiredString(record[field], `${prefix}.${field}`)
    }
    if (sampleIds.has(record.sample_id)) {
      throw new Error(`${prefix}: duplicate sample_id`)
    }
    sampleIds.add(record.sample_id)
    if (!['train', 'test'].includes(record.split)) {
      throw new Error(`${prefix}: invalid split`)
    }
    if (!['suggest', 'none'].includes(record.expected_action)) {
      throw new Error(`${prefix}: expected_action must be suggest or none`)
    }
    requiredString(record.review_reason, `${prefix}.review_reason`)
    if (
      !Array.isArray(record.selection_ids) ||
      record.selection_ids.length === 0
    ) {
      throw new Error(`${prefix}: selection_ids are required`)
    }
    if (!Array.isArray(record.candidates)) {
      throw new Error(`${prefix}: candidates must be an array`)
    }
    for (const [key, map] of [
      ['project_family', familySplits],
      ['source_ref', sourceSplits],
    ]) {
      const previous = map.get(record[key])
      if (previous && previous !== record.split) {
        throw new Error(`${prefix}: ${key} appears in both train and test`)
      }
      map.set(record[key], record.split)
    }
    let accepted = 0
    const candidateTypes = new Set()
    for (const [candidateIndex, candidate] of record.candidates.entries()) {
      const name = `${prefix}.candidates[${candidateIndex}]`
      if (!TYPES.includes(candidate.constraint_type)) {
        throw new Error(`${name}: invalid constraint_type`)
      }
      if (candidateTypes.has(candidate.constraint_type)) {
        throw new Error(`${name}: duplicate constraint_type`)
      }
      candidateTypes.add(candidate.constraint_type)
      for (const field of [
        'baseline_score',
        'normalizedResidual',
        'freePointFraction',
      ]) {
        fraction(candidate[field], `${name}.${field}`)
      }
      fraction(candidate.previewMovementRatio, `${name}.previewMovementRatio`)
      if (candidate.previewMovementRatio > 0.05) {
        throw new Error(
          `${name}: candidate did not pass the preview movement gate`
        )
      }
      if (!['accept', 'reject'].includes(candidate.label)) {
        throw new Error(`${name}: label is unreviewed`)
      }
      requiredString(candidate.reason, `${name}.reason`)
      if (!['pass', 'fail', 'not_tested'].includes(candidate.dimension_edit)) {
        throw new Error(`${name}: invalid dimension_edit`)
      }
      if (candidate.label === 'accept') {
        accepted += 1
      }
    }
    if (record.expected_action === 'none' && accepted > 0) {
      throw new Error(
        `${prefix}: accepted candidate conflicts with expected_action none`
      )
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

function probability(weights, candidate) {
  const dot = vector(candidate).reduce(
    (sum, value, index) => sum + value * weights[index],
    0
  )
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, dot))))
}

export function fitRanker(records) {
  const examples = records
    .filter((record) => record.split === 'train')
    .flatMap((record) => record.candidates)
  if (
    examples.length < 10 ||
    !examples.some((candidate) => candidate.label === 'accept') ||
    !examples.some((candidate) => candidate.label === 'reject')
  ) {
    throw new Error(
      'Training needs at least 10 reviewed candidates and both accept and reject labels'
    )
  }
  const weights = Array(FEATURE_NAMES.length).fill(0)
  const regularization = 0.2
  for (let step = 0; step < 1500; step += 1) {
    const gradient = weights.map((weight, index) =>
      index === 0 ? 0 : regularization * weight
    )
    for (const candidate of examples) {
      const error =
        probability(weights, candidate) - Number(candidate.label === 'accept')
      const features = vector(candidate)
      for (let index = 0; index < weights.length; index += 1) {
        gradient[index] += (error * features[index]) / examples.length
      }
    }
    for (let index = 0; index < weights.length; index += 1) {
      weights[index] -= 0.15 * gradient[index]
    }
  }
  return { schema_version: 1, feature_names: FEATURE_NAMES, weights }
}

export function evaluate(records, score, threshold = -Infinity) {
  let proposed = 0
  let correct = 0
  let wrongIntent = 0
  let expectedSuggestions = 0
  let expectedNoSuggestion = 0
  let correctNoSuggestion = 0
  let candidateRecall = 0
  let dimensionTested = 0
  let dimensionPassed = 0
  for (const record of records) {
    if (record.expected_action === 'suggest') {
      expectedSuggestions += 1
      if (record.candidates.some((candidate) => candidate.label === 'accept')) {
        candidateRecall += 1
      }
    } else {
      expectedNoSuggestion += 1
    }
    const best = [...record.candidates].sort((a, b) => score(b) - score(a))[0]
    if (!best || score(best) < threshold) {
      if (record.expected_action === 'none') {
        correctNoSuggestion += 1
      }
      continue
    }
    proposed += 1
    if (best.label === 'accept') {
      correct += 1
      if (best.dimension_edit !== 'not_tested') {
        dimensionTested += 1
        if (best.dimension_edit === 'pass') {
          dimensionPassed += 1
        }
      }
    } else {
      wrongIntent += 1
    }
  }
  return {
    selections: records.length,
    proposed,
    correct_top_one: correct,
    coverage: proposed / records.length,
    precision_at_one: proposed ? correct / proposed : null,
    intent_recall: expectedSuggestions ? correct / expectedSuggestions : null,
    no_suggestion_accuracy: expectedNoSuggestion
      ? correctNoSuggestion / expectedNoSuggestion
      : null,
    wrong_intent_rate: proposed ? wrongIntent / proposed : null,
    candidate_recall: expectedSuggestions
      ? candidateRecall / expectedSuggestions
      : null,
    dimension_edit_tested: dimensionTested,
    dimension_edit_coverage: correct ? dimensionTested / correct : null,
    dimension_edit_pass_rate: dimensionTested
      ? dimensionPassed / dimensionTested
      : null,
  }
}

export async function run(dataPath, modelOutputPath) {
  const lines = (await readFile(dataPath, 'utf8'))
    .split(/\r?\n/)
    .filter(Boolean)
  const records = validateRecords(
    lines.map((line, index) => {
      try {
        return JSON.parse(line)
      } catch {
        throw new Error(`Invalid JSON on line ${index + 1}`)
      }
    })
  )
  const train = records.filter((record) => record.split === 'train')
  const test = records.filter((record) => record.split === 'test')
  if (!train.length || !test.length) {
    throw new Error('Both train and test splits are required')
  }
  const model = fitRanker(records)
  if (modelOutputPath) {
    await writeFile(modelOutputPath, `${JSON.stringify(model, null, 2)}\n`)
  }
  return {
    train_selections: train.length,
    test_selections: test.length,
    baseline: evaluate(test, (candidate) => candidate.baseline_score),
    learned_rank: evaluate(test, (candidate) =>
      probability(model.weights, candidate)
    ),
    learned_rank_abstain_0_7: evaluate(
      test,
      (candidate) => probability(model.weights, candidate),
      0.7
    ),
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [, , dataPath, modelOutputPath] = process.argv
  if (!dataPath) {
    console.error(
      'Usage: node scripts/sketch-constraint-eval.mjs reviews.jsonl [model.json]'
    )
    process.exitCode = 2
  } else {
    run(dataPath, modelOutputPath)
      .then((result) => console.log(JSON.stringify(result, null, 2)))
      .catch((error) => {
        console.error(error.message)
        process.exitCode = 1
      })
  }
}
