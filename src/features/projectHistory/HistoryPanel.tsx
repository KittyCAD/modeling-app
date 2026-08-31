import { Button, EmptyState } from '@kittycad/ui-kit'
import { useComputed, useSignal } from '@preact/signals'
import { useService } from '@src/app/context'
import { projectHistoryService } from '@src/contracts/projectHistory'
import type { RevertOutcome } from '@src/lib/collab/revertContribution'
import {
  type TimelineEntry,
  authorLabel,
  authorsOf,
  formatHistoryExport,
  timelineFrom,
} from '@src/lib/collab/historyTimeline'
import { formatRelativeTime } from '@src/lib/format'
import './historyPanel.css'

/**
 * Everything that has been done to this project, in order.
 *
 * The panel the existing app does not have, and the reason it can exist here is
 * that the log already did: every coordinated writer tags its transactions with
 * a contribution id and records a labelled action against it, so the history is
 * a fact the app already keeps rather than a feature that has to be invented.
 * This draws it.
 *
 * **What is in it** is worth being exact about, because "every edit" would be a
 * claim this cannot support. It holds every *coordinated* change — a modelling
 * operation, a Zookeeper turn, any mutation that spanned more than one file —
 * each of which is one thing somebody meant to do. Your own typing is not a row:
 * it belongs to the buffer's own undo stack, and putting a thousand keystrokes
 * in here would bury the twelve things that happened.
 *
 * Newest first, because the thing you want to undo is nearly always the thing
 * that just happened.
 */
export function HistoryPanel() {
  const history = useService(projectHistoryService)

  const entries = useComputed(() => timelineFrom(history.entries.value))
  const authors = useComputed(() => authorsOf(history.entries.value))

  if (entries.value.length === 0) {
    return (
      <EmptyState
        icon="stopwatch"
        eyebrow="History"
        title="Nothing has happened yet"
        description="Modelling operations and Zookeeper turns appear here as they are applied, each with the files it changed and a way back."
      />
    )
  }

  return (
    <div class="zds-history">
      {/*
        Only worth saying when there is more than one: with a single author the
        lanes carry no information and the line is noise.
      */}
      {authors.value.length > 1 ? (
        <p class="zds-history__authors">
          {authors.value.map((author) => (
            <span
              class="zds-history__author"
              key={authorLabel(author)}
              data-lane={
                entries.value.find(
                  (entry) => authorLabel(entry.author) === authorLabel(author)
                )?.lane
              }
            >
              {authorLabel(author)}
            </span>
          ))}
        </p>
      ) : null}

      <ol class="zds-history__list">
        {entries.value.map((entry) => (
          <HistoryEntry key={entry.action.id} entry={entry} />
        ))}
      </ol>
    </div>
  )
}

/**
 * One thing that happened.
 *
 * The revert button is offered only while the change history can still undo the
 * action *exactly* — asked of the log rather than assumed from age, because what
 * ends an action's revertibility is not time but the file moving on: a horizon,
 * a buffer closed, an edit made outside the app. An entry that has passed that
 * point stays in the list and says so; deleting it would be pretending it never
 * happened.
 */
function HistoryEntry({ entry }: { entry: TimelineEntry }) {
  const history = useService(projectHistoryService)
  const outcome = useSignal<RevertOutcome | null>(null)

  const revertible = useComputed(() => history.canRevert(entry.action.id).value)

  const { action } = entry
  const when = new Date(action.at)

  return (
    <li class="zds-history__entry" data-lane={entry.lane}>
      <span class="zds-history__mark" aria-hidden="true" />

      <div class="zds-history__body">
        <p class="zds-history__label">{action.label}</p>

        <p class="zds-history__meta">
          <span class="zds-history__who">{authorLabel(entry.author)}</span>
          <time dateTime={when.toISOString()} title={when.toLocaleString()}>
            {formatRelativeTime(action.at)}
          </time>
        </p>

        {action.paths.length > 0 ? (
          <ul class="zds-history__paths">
            {action.paths.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
        ) : null}

        {outcome.value ? <RevertReport outcome={outcome.value} /> : null}

        {revertible.value ? (
          <Button
            size="small"
            variant="ghost"
            icon="arrowRotateLeft"
            label="Revert"
            onClick={() => {
              outcome.value = history.revert(action.id)
            }}
          />
        ) : (
          <p class="zds-history__note">
            {/*
              Said rather than left to a disabled button, because "cannot" and
              "cannot *exactly*" are different claims and only the second is true.
            */}
            Can no longer be undone exactly — the files have moved on.
          </p>
        )}
      </div>
    </li>
  )
}

/**
 * What the revert actually did.
 *
 * Partial success is normal: an action spanning three files can be undone in two
 * of them, and text somebody typed inside a reverted block is *kept* rather than
 * deleted. Both are reported, because a revert that quietly did two thirds of
 * itself is worse than one that says so.
 */
function RevertReport({ outcome }: { outcome: RevertOutcome }) {
  if (outcome.missing.length === 0 && outcome.stranded.length === 0) {
    return (
      <p class="zds-history__note zds-history__note--done">
        Undone in {outcome.reverted.join(', ') || 'no files'}.
      </p>
    )
  }

  return (
    <div class="zds-history__note zds-history__note--partial">
      {outcome.reverted.length > 0 ? (
        <p>Undone in {outcome.reverted.join(', ')}.</p>
      ) : null}
      {outcome.missing.length > 0 ? (
        <p>
          Left alone: {outcome.missing.join(', ')} — no history for it here.
        </p>
      ) : null}
      {outcome.stranded.length > 0 ? (
        <p>
          Kept what was typed inside it, in{' '}
          {[...new Set(outcome.stranded.map((range) => range.path))].join(', ')}
          .
        </p>
      ) : null}
    </div>
  )
}

/**
 * Carry the history out of the app.
 *
 * The whole point of the log being exact is being able to show that it is, and
 * a history you have to be looking at this panel to believe is not evidence of
 * anything. Tab-separated with the full contribution ids, so it pastes into a
 * spreadsheet, a PR description or a diff.
 */
export function HistoryPanelActions() {
  const history = useService(projectHistoryService)
  const copied = useSignal(false)

  return (
    <Button
      size="small"
      variant="ghost"
      icon={copied.value ? 'checkmark' : 'clipboard'}
      iconOnly
      label={copied.value ? 'Copied' : 'Copy history'}
      disabled={history.entries.value.length === 0}
      onClick={() => {
        const text = formatHistoryExport(history.entries.peek())

        void navigator.clipboard
          ?.writeText(text)
          .then(() => {
            copied.value = true
            window.setTimeout(() => {
              copied.value = false
            }, 1500)
          })
          .catch((error: unknown) => {
            // A clipboard the browser refused. Nothing is lost and nothing is
            // worth interrupting for; the log is still on screen.
            console.warn('history: could not copy', error)
          })
      }}
    />
  )
}
