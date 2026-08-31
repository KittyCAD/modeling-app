import { StatusDot } from '@kittycad/ui-kit'
import { useComputed } from '@preact/signals'
import { useService } from '@src/app/context'
import { creditsService } from '@src/contracts/credits'
import './credits.css'

/**
 * The balance, on Home's left column.
 *
 * The same numbers the status bar carries, given room to be read rather than
 * glanced at — Home is where somebody asks "what have I got left" before
 * starting, so it is worth more than eight characters there.
 *
 * It also names what is spending, which on Home is the only place that
 * information can appear at all: the conversations doing the spending belong to
 * projects that are, by definition, not open.
 */
export function CreditsSummary() {
  const credits = useService(creditsService)

  const balance = useComputed(() => credits.balance.value)
  const error = useComputed(() => credits.error.value)
  const consumers = useComputed(() => credits.consumers.value)

  const unlimited = useComputed(() => balance.value?.unlimited ?? false)

  const total = useComputed(() => {
    const current = balance.value
    return current === null || current.unlimited
      ? null
      : current.monthlyRemaining + current.stableRemaining
  })

  return (
    <section class="zds-home__credits" aria-label="Zoo credits">
      <header class="zds-home__credits-head">
        <p class="zds-label">Credits</p>
        {consumers.value.length > 0 ? (
          <span class="zds-home__credits-live">
            <StatusDot tone="busy" label="Spending" />
            {consumers.value.length} spending
          </span>
        ) : null}
      </header>

      {unlimited.value ? (
        <>
          <p class="zds-home__credits-total">Unlimited</p>
          <p class="zds-home__credits-split">
            {balance.value?.scope === 'org'
              ? 'via your Zoo org'
              : 'billed by contract'}
          </p>
        </>
      ) : total.value === null ? (
        <p class="zds-home__credits-empty">
          {error.value ?? 'Reading your balance…'}
        </p>
      ) : (
        <>
          <p class="zds-home__credits-total">{total.value.toLocaleString()}</p>
          <p class="zds-home__credits-split">
            {balance.value?.monthlyRemaining.toLocaleString()} monthly ·{' '}
            {balance.value?.stableRemaining.toLocaleString()} carried over
          </p>
        </>
      )}

      {consumers.value.length > 0 ? (
        <ul class="zds-home__credits-consumers">
          {consumers.value.map((consumer) => (
            <li key={consumer.id}>
              <span class="zds-home__credits-project">
                {consumer.project ?? 'No project'}
              </span>
              <span class="zds-home__credits-label">{consumer.label}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
