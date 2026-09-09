import { readFileSync } from 'node:fs'

// In outer-retry mode, use a distinct status so the CI wrapper can replace a
// saved run containing global errors while still failing closed otherwise.
const GLOBAL_ERRORS_RETRY_EXIT_CODE = 2
const classifyForOuterRetry = process.argv.includes('--classify-for-outer-retry')

// .last-run.json tracks test failures, but can say passed when worker teardown
// failed. Those errors cannot be recovered by selecting only --last-failed.
const report = JSON.parse(readFileSync('test-results/report.json', 'utf8'))
const lastRun = JSON.parse(readFileSync('test-results/.last-run.json', 'utf8'))

if (!Array.isArray(report.errors)) {
  throw new Error('Playwright report is missing its global errors array')
}
if (!['passed', 'failed'].includes(lastRun.status)) {
  throw new Error(`Playwright run did not finish: ${lastRun.status}`)
}
if (report.errors.length > 0) {
  console.error('Playwright reported errors outside individual tests:')
  for (const error of report.errors) {
    console.error(error.message ?? error.stack ?? JSON.stringify(error))
  }
  process.exitCode = classifyForOuterRetry
    ? GLOBAL_ERRORS_RETRY_EXIT_CODE
    : 1
}
