export const STATE_BRANCH = 'main'

export function statePath(target) {
  if (!['development', 'production'].includes(target)) {
    throw new Error(`Unknown sample sync target: ${target}`)
  }
  return `sample-sync/${target}.json`
}

function branchPrefix(target) {
  statePath(target)
  return `kcl-sample-sync-ids-${target}-`
}

export async function assertNoPendingCheckpoint({ github, repo, target }) {
  const path = statePath(target)
  const pulls = await github.paginate(github.rest.pulls.list, {
    ...repo,
    state: 'open',
    base: STATE_BRANCH,
    per_page: 100,
  })
  for (const pr of pulls) {
    const generated =
      pr.head.repo?.full_name.toLowerCase() ===
        `${repo.owner}/${repo.repo}`.toLowerCase() &&
      pr.head.ref.startsWith(branchPrefix(target))
    // Also block manual recovery PRs, regardless of their branch name.
    const files = generated
      ? []
      : await github.paginate(github.rest.pulls.listFiles, {
          ...repo,
          pull_number: pr.number,
          per_page: 100,
        })
    if (
      generated ||
      files.some(
        (file) => file.filename === path || file.previous_filename === path
      )
    ) {
      throw new Error(
        `Merge the open ${target} sample checkpoint PR before uploading: ${pr.html_url}`
      )
    }
  }
}

async function readCheckpoint(github, repo, path, ref) {
  try {
    const { data } = await github.rest.repos.getContent({
      ...repo,
      path,
      ref,
    })
    if (data.type !== 'file' || data.encoding !== 'base64') {
      throw new Error(`Invalid committed checkpoint: ${path}`)
    }
    return {
      sha: data.sha,
      content: Buffer.from(data.content, 'base64').toString('utf8'),
    }
  } catch (error) {
    if (error.status === 404) return { sha: null, content: null }
    throw error
  }
}

async function readMainCheckpoint(github, repo, path) {
  const { data } = await github.rest.git.getRef({
    ...repo,
    ref: `heads/${STATE_BRANCH}`,
  })
  const head = data.object.sha
  // Pin the file read to the head used for the PR branch, so its diff contains
  // only the checkpoint even if main advances while the job is running.
  return { ...(await readCheckpoint(github, repo, path, head)), head }
}

export async function restoreCheckpoint({
  github,
  repo,
  target,
  initialize = false,
  bootstrap,
}) {
  const path = statePath(target)
  if (initialize && bootstrap !== undefined) {
    throw new Error('Choose checkpoint migration or initialization, not both')
  }
  await assertNoPendingCheckpoint({ github, repo, target })
  const checkpoint = await readMainCheckpoint(github, repo, path)
  if (checkpoint.sha && (initialize || bootstrap !== undefined)) {
    throw new Error(
      'Checkpoint already committed; disable migration and initialization'
    )
  }
  if (!checkpoint.sha) {
    if (bootstrap !== undefined) {
      checkpoint.content = `${JSON.stringify(JSON.parse(bootstrap), null, 2)}\n`
    } else if (!initialize) {
      throw new Error(
        `Missing ${STATE_BRANCH}:${path}; migrate the existing checkpoint or initialize an empty sample account`
      )
    }
  }
  return checkpoint
}

export async function proposeCheckpoint({
  github,
  repo,
  target,
  sourceSha,
  runUrl,
  runId,
  runAttempt,
  checkpoint,
  content,
  syncSucceeded,
}) {
  const path = statePath(target)
  if (content === null) return
  if (content === checkpoint.content && (checkpoint.sha || !syncSucceeded)) {
    // In particular, never commit an unchanged bootstrap after failed validation.
    return
  }
  JSON.parse(content)
  if (!/^\d+$/.test(String(runId)) || !/^\d+$/.test(String(runAttempt))) {
    throw new Error('Invalid workflow run ID or attempt')
  }
  await assertNoPendingCheckpoint({ github, repo, target })
  const main = await readMainCheckpoint(github, repo, path)
  if (main.content === content) return
  if (main.sha !== checkpoint.sha) {
    throw new Error(
      `${path} changed on main during sync; reconcile it before retrying`
    )
  }
  const branch = `${branchPrefix(target)}${runId}-${runAttempt}`
  await github.rest.git.createRef({
    ...repo,
    ref: `refs/heads/${branch}`,
    sha: main.head,
  })
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await readCheckpoint(github, repo, path, branch)
    // Also handles a successful commit whose response was lost.
    if (current.content === content) break
    if (current.sha !== checkpoint.sha) {
      throw new Error(
        `${path} changed during sync; reconcile it before retrying`
      )
    }
    try {
      await github.rest.repos.createOrUpdateFileContents({
        ...repo,
        branch,
        path,
        ...(current.sha ? { sha: current.sha } : {}),
        content: Buffer.from(content).toString('base64'),
        message: `Record ${target} KCL sample sync IDs\n\nSource: ${sourceSha}\nRun: ${runUrl}`,
      })
      break
    } catch (error) {
      // Retry only while this run's checkpoint has not been changed by someone else.
      const retryable =
        !error.status || error.status === 409 || error.status >= 500
      if (!retryable || attempt === 2) throw error
    }
  }
  const body = [
    `Records cloud project IDs, revisions, and content hashes from the [${target} sample sync](${runUrl}).`,
    `Merge this checkpoint before the next ${target} upload. The workflow aborts while this PR is open.`,
    ...(!syncSucceeded
      ? [
          'The sync failed after saving this state. These completed uploads must be recorded before retrying the remaining work.',
        ]
      : []),
  ].join('\n\n')
  const { data } = await github.rest.pulls.create({
    ...repo,
    base: STATE_BRANCH,
    head: branch,
    title: `Record ${target} Aquarium sample IDs`,
    body,
    draft: true,
  })
  return data.html_url
}
