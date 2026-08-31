import { Menu, StatusDot } from '@kittycad/ui-kit'
import { useComputed, useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { useService } from '@src/app/context'
import type { CreditConsumer } from '@src/contracts/credits'
import { creditsService } from '@src/contracts/credits'
import './credits.css'

/** How often the elapsed times in the breakdown are redrawn. */
const ELAPSED_TICK_MS = 1_000

const formatCredits = (value: number) =>
  value >= 10_000 ? `${Math.round(value / 1_000)}k` : value.toLocaleString()

const formatMoney = (value: number) =>
  value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  })

/**
 * Usage as credits, at one credit a minute.
 *
 * The existing app's own estimate reduces to exactly this: its multiply and
 * divide by the credit price cancel, leaving elapsed minutes subtracted from the
 * credit balance. So credits are minute-denominated there, and matching it is
 * the only way for these two numbers to be about the same thing.
 */
const estimatedCredits = (ms: number) => ms / 60_000

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1_000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes === 0) return `${seconds}s`
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

function formatAsOf(fetchedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - fetchedAt) / 1_000))
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  return `${minutes}m ago`
}

/**
 * A clock that only runs when something is being timed.
 *
 * The breakdown shows elapsed times, so it has to redraw every second — but only
 * while a conversation is actually spending. An interval running behind a closed
 * menu with nothing in flight would be a wakeup a second for no pixels.
 */
function useNow(active: boolean): number {
  const now = useSignal(Date.now())

  useEffect(() => {
    if (!active) return
    now.value = Date.now()
    const timer = setInterval(() => {
      now.value = Date.now()
    }, ELAPSED_TICK_MS)
    return () => clearInterval(timer)
  }, [active, now])

  return now.value
}

/** One conversation that is spending, as a row under its project. */
function ConsumerRow({
  consumer,
  now,
}: {
  consumer: CreditConsumer
  now: number
}) {
  return (
    <div class="zds-credits__row">
      <StatusDot tone="busy" label="Spending" />
      <span class="zds-credits__what">{consumer.label}</span>
      <span class="zds-credits__elapsed">
        {formatElapsed(now - consumer.startedAt)}
      </span>
    </div>
  )
}

/**
 * The account's credit balance, globally.
 *
 * In the status bar and never gated on a project, which is the point: credits are
 * one account-level pool, and every agent in the app spends from it. A readout
 * that only appeared with a project open would vanish exactly when somebody went
 * to the home screen to ask what they had left.
 *
 * It shows a number and an "as of", not a ticking estimate. The Zookeeper
 * protocol reports no usage and the balance endpoint quotes no per-second price,
 * so a number counting down would be a guess dressed as a reading. What it does
 * instead is name who is spending, which it actually knows.
 */
export function CreditsField() {
  const credits = useService(creditsService)

  const consumers = useComputed(() => credits.consumers.value)
  const usage = useComputed(() => credits.usage.value)
  const spending = useComputed(() => credits.spending.value)
  const balance = useComputed(() => credits.balance.value)
  const state = useComputed(() => credits.state.value)
  const error = useComputed(() => credits.error.value)

  const now = useNow(spending.value)

  /** Grouped by project, in the order each project's oldest span started. */
  const byProject = useComputed(() => {
    const groups = new Map<string, CreditConsumer[]>()
    for (const consumer of consumers.value) {
      const key = consumer.project ?? ''
      const existing = groups.get(key)
      if (existing) existing.push(consumer)
      else groups.set(key, [consumer])
    }
    return [...groups.entries()]
  })

  const unlimited = useComputed(() => balance.value?.unlimited ?? false)

  const remaining = useComputed(() => {
    const current = balance.value
    if (current === null || current.unlimited) return null
    return current.monthlyRemaining + current.stableRemaining
  })

  /**
   * Depleted, and therefore charging.
   *
   * Once the pools are empty "0 remaining" has stopped being the useful number
   * and the amount accruing has started, so the field changes what it counts.
   */
  const depleted = useComputed(
    () => !unlimited.value && remaining.value !== null && remaining.value <= 0
  )

  const due = useComputed(() => balance.value?.totalDue ?? null)

  const summary = useComputed(() => {
    if (unlimited.value) return '∞'
    if (state.value === 'loading') return '…'
    if (remaining.value === null) return '—'
    if (depleted.value) {
      // Absent is not zero: the API only sends the amount when asked, so a
      // missing figure says "depleted" rather than claiming nothing is owed.
      return due.value === null ? 'depleted' : formatMoney(due.value)
    }
    return formatCredits(remaining.value)
  })

  const title = useComputed(() => {
    if (error.value !== null) return error.value
    if (unlimited.value) {
      return balance.value?.scope === 'org'
        ? 'Unlimited credits through your org'
        : 'Unlimited credits'
    }
    if (remaining.value === null) return 'Zoo credit balance'
    if (depleted.value) {
      return due.value === null
        ? 'Your credits are used up. Further usage is billed.'
        : `Your credits are used up. ${formatMoney(due.value)} owed so far.`
    }
    const count = consumers.value.length
    if (count === 0) return 'Zoo credit balance'
    return `${count} ${count === 1 ? 'conversation' : 'conversations'} spending credits`
  })

  const sections = [
    {
      id: 'balance',
      label: 'Zoo credits',
      content: (
        <div class="zds-credits__balance">
          {error.value !== null ? (
            <p class="zds-credits__error">{error.value}</p>
          ) : balance.value === null ? (
            <p class="zds-credits__error">Reading your balance…</p>
          ) : unlimited.value ? (
            /*
             * No pools, because there are none to show: a contract owns billing
             * and the two figures the API returns are zero. Listing them would
             * be the misleading version of this state.
             */
            <>
              <div class="zds-credits__pool">
                <span>Unlimited</span>
                <span>∞</span>
              </div>
              <p class="zds-credits__asof">
                {balance.value.scope === 'org'
                  ? 'billed to your org'
                  : 'billed by contract'}
              </p>
            </>
          ) : (
            <>
              <div class="zds-credits__pool">
                <span>Monthly</span>
                <span>{balance.value.monthlyRemaining.toLocaleString()}</span>
              </div>
              <div class="zds-credits__pool">
                <span>Carried over</span>
                <span>{balance.value.stableRemaining.toLocaleString()}</span>
              </div>
              {depleted.value ? (
                <div class="zds-credits__pool zds-credits__pool--due">
                  <span>Owed</span>
                  <span>
                    {due.value === null
                      ? 'not reported'
                      : formatMoney(due.value)}
                  </span>
                </div>
              ) : null}
              <p class="zds-credits__asof">
                as of {formatAsOf(balance.value.fetchedAt, now)}
              </p>
            </>
          )}
        </div>
      ),
    },
    {
      id: 'spending',
      label: spending.value ? 'Spending now' : undefined,
      content: spending.value ? (
        <div class="zds-credits__consumers">
          {byProject.value.map(([project, group]) => (
            <div class="zds-credits__group" key={project || 'none'}>
              {/*
               * The project, once, as the heading its conversations sit under.
               * Named even when there is one, because the whole reason this is
               * grouped is that there may not be.
               */}
              <p class="zds-credits__project">{project || 'No project'}</p>
              {group.map((consumer) => (
                <ConsumerRow key={consumer.id} consumer={consumer} now={now} />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <p class="zds-credits__idle">Nothing is spending credits.</p>
      ),
    },
    /*
     * What each conversation has cost, this session.
     *
     * Separate from "spending now" because it outlives it: "what has this
     * conversation used" is asked after it has gone quiet at least as often as
     * during. Only shown once there is something to report.
     */
    ...(usage.value.length > 0
      ? [
          {
            id: 'usage',
            label: 'Used this session',
            content: (
              <div class="zds-credits__consumers">
                {usage.value.map((entry) => (
                  <div class="zds-credits__row" key={entry.groupId}>
                    <StatusDot
                      tone={entry.active ? 'busy' : 'idle'}
                      label={entry.active ? 'Spending' : 'Idle'}
                    />
                    <span class="zds-credits__what">{entry.label}</span>
                    <span class="zds-credits__elapsed">
                      {`≈${estimatedCredits(entry.totalMs).toFixed(1)}`}
                    </span>
                  </div>
                ))}
                <p class="zds-credits__asof">
                  estimated, from how long each held the service busy
                </p>
              </div>
            ),
          },
        ]
      : []),
  ]

  return (
    <Menu
      label="Zoo credit balance and what is spending it"
      align="end"
      // The status bar is the bottom of the window; there is nothing below it.
      side="above"
      sections={sections}
      trigger={({ open, toggle, ref }) => (
        <button
          type="button"
          ref={ref}
          class="zds-status-button"
          title={title.value}
          aria-expanded={open}
          onClick={() => {
            // Opening it is a request for the current number, not the one from
            // the last poll.
            void credits.refresh()
            toggle()
          }}
        >
          {spending.value ? (
            <StatusDot tone="busy" label="Spending credits" />
          ) : null}
          <span>credits</span>
          <span class="zds-status-field__value">{summary.value}</span>
          {consumers.value.length > 0 ? (
            <span class="zds-credits__count">×{consumers.value.length}</span>
          ) : null}
        </button>
      )}
    />
  )
}
