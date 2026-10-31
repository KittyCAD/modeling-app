import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  evaluate,
  fitRanker,
  validateRecords,
} from './sketch-constraint-eval.mjs'

function candidate(type, label, score) {
  return {
    constraint_type: type,
    baseline_score: score,
    normalizedResidual: 1 - score,
    previewMovementRatio: 0.01,
    freePointFraction: 0.5,
    label,
    reason:
      label === 'accept'
        ? 'Preserves the intended relation'
        : 'Incidental alignment',
    dimension_edit: label === 'accept' ? 'pass' : 'not_tested',
  }
}

function record(id, family, split, candidates, expectedAction = 'suggest') {
  return {
    schema_version: 1,
    sample_id: id,
    project_family: family,
    source_ref: `${family}/${id}`,
    split,
    reviewer: 'CAD reviewer',
    expected_action: expectedAction,
    review_reason: 'Checked the intended response to a dimension edit',
    selection_ids: [3],
    candidates,
  }
}

test('rejects incomplete labels and leakage across project families', () => {
  const first = record('one', 'family-a', 'train', [
    candidate('Horizontal', 'accept', 0.9),
  ])
  const second = record(
    'two',
    'family-a',
    'test',
    [candidate('Vertical', 'reject', 0.8)],
    'none'
  )
  assert.throws(() => validateRecords([first, second]), /both train and test/)
  second.project_family = 'family-b'
  second.candidates[0].label = 'unreviewed'
  assert.throws(() => validateRecords([first, second]), /unreviewed/)
  second.candidates[0].label = 'reject'
  second.source_ref = 'FILL_IN'
  assert.throws(() => validateRecords([first, second]), /source_ref/)
})

test('reports held-out top-one intent and dimension-edit outcomes', () => {
  const rows = validateRecords([
    record('one', 'family-a', 'test', [
      candidate('Horizontal', 'reject', 0.95),
      candidate('Distance', 'accept', 0.8),
    ]),
    record(
      'two',
      'family-b',
      'test',
      [candidate('Vertical', 'reject', 0.6)],
      'none'
    ),
  ])
  const metrics = evaluate(rows, (entry) => entry.baseline_score)
  assert.equal(metrics.precision_at_one, 0)
  assert.equal(metrics.intent_recall, 0)
  assert.equal(metrics.no_suggestion_accuracy, 0)
  assert.equal(metrics.wrong_intent_rate, 1)
  assert.equal(metrics.candidate_recall, 1)
  const rescored = evaluate(
    rows,
    (entry) => Number(entry.label === 'accept'),
    0.5
  )
  assert.equal(rescored.precision_at_one, 1)
  assert.equal(rescored.intent_recall, 1)
  assert.equal(rescored.no_suggestion_accuracy, 1)
  assert.equal(rescored.dimension_edit_coverage, 1)
  assert.equal(rescored.dimension_edit_pass_rate, 1)

  rows[0].candidates[1].dimension_edit = 'not_tested'
  const untested = evaluate(
    rows,
    (entry) => Number(entry.label === 'accept'),
    0.5
  )
  assert.equal(untested.dimension_edit_coverage, 0)
  assert.equal(untested.dimension_edit_pass_rate, null)
})

test('fits a ranker only after both labels have enough reviewed examples', () => {
  const tooFew = [
    record('one', 'family-a', 'train', [
      candidate('Horizontal', 'accept', 0.9),
    ]),
  ]
  assert.throws(() => fitRanker(tooFew), /at least 10/)
  const rows = Array.from({ length: 6 }, (_, index) =>
    record(`sample-${index}`, `family-${index}`, 'train', [
      candidate('Horizontal', 'accept', 0.8),
      candidate('Vertical', 'reject', 0.7),
    ])
  )
  const model = fitRanker(validateRecords(rows))
  assert.equal(model.weights.length, model.feature_names.length)
  assert.ok(model.weights.every(Number.isFinite))
})
