#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)
const args = process.argv.slice(2)

function option(name) {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function collectFiles(directory, predicate) {
  if (!fs.existsSync(directory)) {
    return []
  }
  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectFiles(entryPath, predicate))
    } else if (predicate(entryPath)) {
      files.push(path.resolve(entryPath))
    }
  }
  return files.sort()
}

function collectReportResults(report) {
  const results = []
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        for (const result of test.results ?? []) {
          results.push({
            error: result.error?.message ?? '',
            status: result.status,
            title: spec.title,
          })
        }
      }
    }
    for (const child of suite.suites ?? []) {
      visit(child)
    }
  }
  for (const suite of report?.suites ?? []) {
    visit(suite)
  }
  return results
}

function classifyRun(exitCode, evidence) {
  if (exitCode === 0) {
    return 'pass'
  }

  if (
    /Authentication Required|visitor password|Vercel Authentication|Staging authentication is missing|sign[- ]?in redirect/i.test(
      evidence
    )
  ) {
    return 'test_setup'
  }

  if (
    /Failed to add point segment[^\n]*Sketch not found|Sketch not found: ObjectId/i.test(
      evidence
    )
  ) {
    return 'needs_triage'
  }

  if (
    /internal_api: modeling service unavailable|ICE[^\n]*701|STUN|TURN|connection teardown|modeling connection[^\n]*retry|failed to settle[^\n]*connection/i.test(
      evidence
    )
  ) {
    return 'staging_infrastructure'
  }

  return 'needs_triage'
}

function campaignMarkdown(campaign) {
  const lines = [
    `# ${campaign.name} GUI fuzz campaign`,
    '',
    `- Status: **${campaign.status}**`,
    `- Target: ${campaign.target}`,
    `- Git SHA: ${campaign.gitSha}`,
    `- Started: ${campaign.startedAt}`,
    `- Finished: ${campaign.finishedAt ?? 'in progress'}`,
    `- Visual review is mandatory for every executed scenario.`,
    '',
    '| Scenario | Role | Execution | Classification | Visual review |',
    '| --- | --- | --- | --- | --- |',
  ]

  for (const result of campaign.results) {
    lines.push(
      `| ${result.id} | ${result.role} | ${result.execution} | ${result.classification} | ${result.visualReview} |`
    )
  }

  for (const result of campaign.results.filter(
    (item) => item.execution === 'executed'
  )) {
    lines.push(
      '',
      `## ${result.id}: ${result.title}`,
      '',
      `- Feature: ${result.feature}`,
      `- Hypothesis: ${result.hypothesis}`,
      `- Exit code: ${result.exitCode}`,
      `- Classification: **${result.classification}**`,
      `- Visual review: **${result.visualReview}**`,
      `- Artifact directory: ${result.artifactDirectory}`,
      `- Report: ${result.reportPath ?? 'not produced'}`,
      `- Trace count: ${result.traces.length}`,
      `- Screenshot count: ${result.screenshots.length}`
    )
    if (result.errors.length > 0) {
      lines.push('', 'Errors:')
      for (const error of result.errors) {
        lines.push(`- ${error.status}: ${error.message.split('\n')[0]}`)
      }
    }
    if (result.lastScreenshot) {
      lines.push(
        '',
        `Last screenshot: ${result.lastScreenshot}`,
        '',
        `![${result.id} last screenshot](${result.lastScreenshot})`
      )
    }
    if (result.review) {
      lines.push(
        '',
        'Visual review:',
        `- Reviewed: ${result.review.reviewedAt}`,
        `- Summary: ${result.review.summary}`,
        `- Next action: ${result.review.nextAction}`,
        `- Screenshot reviewed: ${result.review.screenshotReviewed ?? 'none'}`
      )
    }
  }

  if (campaign.blocker) {
    lines.push('', `Blocker: ${campaign.blocker}`)
  }
  return `${lines.join('\n')}\n`
}

function persistCampaign(campaignDirectory, campaign) {
  fs.mkdirSync(campaignDirectory, { recursive: true })
  const writeAtomically = (fileName, contents) => {
    const filePath = path.join(campaignDirectory, fileName)
    const temporaryPath = `${filePath}.${process.pid}.tmp`
    fs.writeFileSync(temporaryPath, contents)
    fs.renameSync(temporaryPath, filePath)
  }

  writeAtomically('campaign.json', `${JSON.stringify(campaign, null, 2)}\n`)
  writeAtomically('findings.md', campaignMarkdown(campaign))
}

const reviewCampaignDirectory = option('--review-campaign')
if (reviewCampaignDirectory) {
  const campaignDirectory = path.resolve(reviewCampaignDirectory)
  const campaignPath = path.join(campaignDirectory, 'campaign.json')
  const scenarioId = option('--scenario')
  const classification = option('--classification')
  const summary = option('--summary')
  const nextAction = option('--next-action')
  const allowedClassifications = new Set([
    'pass',
    'product_candidate',
    'staging_infrastructure',
    'test_harness',
    'test_setup',
  ])

  if (!scenarioId || !classification || !summary || !nextAction) {
    throw new Error(
      'Review mode requires --scenario, --classification, --summary, and --next-action.'
    )
  }
  if (!allowedClassifications.has(classification)) {
    throw new Error(`Invalid reviewed classification: ${classification}`)
  }

  const campaign = readJson(campaignPath)
  const result = campaign.results.find((item) => item.id === scenarioId)
  if (!result || result.execution !== 'executed') {
    throw new Error(`Scenario was not executed in this campaign: ${scenarioId}`)
  }

  result.classification = classification
  result.visualReview = 'complete'
  result.review = {
    nextAction,
    reviewedAt: new Date().toISOString(),
    screenshotReviewed: result.lastScreenshot,
    summary,
  }

  const executedResults = campaign.results.filter(
    (item) => item.execution === 'executed'
  )
  if (
    executedResults.length > 0 &&
    executedResults.every((item) => item.visualReview === 'complete')
  ) {
    campaign.blocker = null
    campaign.status = executedResults.every(
      (item) => item.classification === 'pass'
    )
      ? 'complete'
      : 'complete_with_findings'
  }
  persistCampaign(campaignDirectory, campaign)
  console.log(`Recorded visual review for ${scenarioId} in ${campaignPath}`)
  process.exit(0)
}

const manifestPath = path.resolve(
  repoRoot,
  option('--manifest') ?? 'e2e/playwright/gui-fuzz-campaign.json'
)
const manifest = readJson(manifestPath)
const onlyIds = new Set(
  (option('--only') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
)
const scenarios = manifest.scenarios.filter(
  (scenario) =>
    scenario.status === 'active' &&
    (onlyIds.size === 0 || onlyIds.has(scenario.id))
)

if (scenarios.length === 0) {
  throw new Error('No active GUI fuzz scenarios matched this campaign run.')
}

const seen = new Set()
for (const scenario of scenarios) {
  if (seen.has(scenario.id)) {
    throw new Error(`Duplicate scenario id: ${scenario.id}`)
  }
  seen.add(scenario.id)
  const specPath = path.resolve(repoRoot, scenario.spec)
  if (
    !scenario.spec.startsWith('e2e/playwright/') ||
    !fs.existsSync(specPath)
  ) {
    throw new Error(
      `Scenario ${scenario.id} has an invalid spec: ${scenario.spec}`
    )
  }
}

if (args.includes('--dry-run')) {
  console.log(`Campaign: ${manifest.name}`)
  for (const scenario of scenarios) {
    console.log(`${scenario.role.padEnd(11)} ${scenario.id}: ${scenario.spec}`)
  }
  process.exit(0)
}

const runId = new Date()
  .toISOString()
  .replace(/[-:]/g, '')
  .replace(/\.\d{3}Z$/, 'Z')
const campaignDirectory = path.resolve(
  process.env.GUI_FUZZ_CAMPAIGN_OUTPUT_DIR ??
    path.join(repoRoot, 'test-results', 'gui-fuzz', 'campaigns', runId)
)
const gitResult = spawnSync('git', ['rev-parse', 'HEAD'], {
  cwd: repoRoot,
  encoding: 'utf8',
})
const campaign = {
  blocker: null,
  finishedAt: null,
  gitSha: gitResult.stdout.trim() || 'unknown',
  manifest: manifestPath,
  name: manifest.name,
  queue: manifest.queue,
  results: [],
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  status: 'running',
  target: process.env.VERCEL_BASE_URL ?? manifest.target,
}

persistCampaign(campaignDirectory, campaign)
console.log(`GUI fuzz campaign output: ${campaignDirectory}`)

for (const [index, scenario] of scenarios.entries()) {
  const scenarioDirectory = path.join(
    campaignDirectory,
    `${String(index + 1).padStart(2, '0')}-${scenario.id}`
  )
  fs.mkdirSync(scenarioDirectory, { recursive: true })
  console.log(
    `\n[${index + 1}/${scenarios.length}] ${scenario.id}: ${scenario.hypothesis}`
  )

  const child = spawnSync(
    'bash',
    ['./scripts/run-gui-fuzz.sh', `--repeat-each=${scenario.repeatEach ?? 1}`],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        PLAYWRIGHT_GUI_FUZZ_OUTPUT_DIR: scenarioDirectory,
        VERCEL_BASE_URL: campaign.target,
        ZDS_GUI_FUZZ_SPEC: scenario.spec,
      },
      maxBuffer: 64 * 1024 * 1024,
    }
  )

  const stdout = child.stdout ?? ''
  const stderr = child.stderr ?? ''
  process.stdout.write(stdout)
  process.stderr.write(stderr)
  fs.writeFileSync(path.join(scenarioDirectory, 'stdout.log'), stdout)
  fs.writeFileSync(path.join(scenarioDirectory, 'stderr.log'), stderr)

  const reportPath = path.join(scenarioDirectory, 'report.json')
  const report = fs.existsSync(reportPath) ? readJson(reportPath) : null
  const reportResults = collectReportResults(report)
  const contextFiles = collectFiles(
    scenarioDirectory,
    (filePath) =>
      filePath.endsWith('error-context.md') ||
      filePath.endsWith('runtime-events.json')
  )
  const contextEvidence = contextFiles
    .map((filePath) => fs.readFileSync(filePath, 'utf8'))
    .join('\n')
  const evidence = [
    stdout,
    stderr,
    contextEvidence,
    ...reportResults.map((result) => result.error),
  ].join('\n')
  const exitCode = child.status ?? 1
  const classification = classifyRun(exitCode, evidence)
  const screenshots = collectFiles(scenarioDirectory, (filePath) =>
    filePath.endsWith('.png')
  )
  const stepScreenshots = screenshots.filter((filePath) =>
    /^\d{2}-/.test(path.basename(filePath))
  )
  const traces = collectFiles(scenarioDirectory, (filePath) =>
    filePath.endsWith('trace.zip')
  )

  campaign.results.push({
    artifactDirectory: scenarioDirectory,
    classification,
    errors: reportResults
      .filter((result) => result.error)
      .map((result) => ({ message: result.error, status: result.status })),
    execution: 'executed',
    exitCode,
    feature: scenario.feature,
    hypothesis: scenario.hypothesis,
    id: scenario.id,
    lastScreenshot: stepScreenshots.at(-1) ?? screenshots.at(-1) ?? null,
    reportPath: fs.existsSync(reportPath) ? path.resolve(reportPath) : null,
    role: scenario.role,
    screenshots,
    title: scenario.title,
    traces,
    visualReview: 'pending',
  })
  persistCampaign(campaignDirectory, campaign)

  const controlBlocked =
    scenario.role === 'control' && classification !== 'pass'
  const needsReview =
    classification === 'needs_triage' && manifest.stopOnNeedsTriage
  if (controlBlocked || needsReview) {
    campaign.status =
      classification === 'needs_triage' ? 'needs_review' : 'blocked'
    campaign.blocker = `${scenario.id} classified as ${classification}; remaining scenarios were not executed.`
    for (const remaining of scenarios.slice(index + 1)) {
      campaign.results.push({
        classification: 'not_run',
        execution: 'not_run',
        feature: remaining.feature,
        hypothesis: remaining.hypothesis,
        id: remaining.id,
        role: remaining.role,
        title: remaining.title,
        visualReview: 'not_applicable',
      })
    }
    break
  }
}

if (campaign.status === 'running') {
  campaign.status = 'complete_pending_review'
}
campaign.finishedAt = new Date().toISOString()
persistCampaign(campaignDirectory, campaign)

console.log(`\nCampaign status: ${campaign.status}`)
console.log(`Findings: ${path.join(campaignDirectory, 'findings.md')}`)

if (campaign.status === 'blocked') {
  process.exit(2)
}
if (campaign.status === 'needs_review') {
  process.exit(1)
}
