import { readFileSync } from 'node:fs'

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
  process.exitCode = 1
}
