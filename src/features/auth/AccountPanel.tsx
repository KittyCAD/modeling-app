import { useComputed } from '@preact/signals'
import { useOptionalService, useService } from '@src/app/context'
import { authService } from '@src/contracts/auth'
import { creditsService } from '@src/contracts/credits'
import { runtimeService } from '@src/contracts/runtime'
import './account.css'

/**
 * Where this build is pointed.
 *
 * Read from the environment rather than from a service because that is what it
 * is — a build-time decision — and because the whole point of showing it is to
 * catch the case where it is not what somebody assumed.
 */
function apiHost(): string {
  const configured = import.meta.env?.VITE_KC_API_BASE_URL as string | undefined
  if (!configured) return 'not configured'
  try {
    return new URL(configured).host
  } catch {
    return configured
  }
}

function Row({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div class="zds-account__row">
      <span class="zds-account__label">{label}</span>
      <span class="zds-account__value">
        {value}
        {hint ? <span class="zds-account__hint">{hint}</span> : null}
      </span>
    </div>
  )
}

/**
 * What the app thinks your account is.
 *
 * Written as a diagnostic rather than as a profile, and the distinction is the
 * reason it exists: when the service refuses a request for billing reasons, the
 * question is not "who am I" but "which identity, whose plan, and against which
 * environment did it decide that". Every one of those was previously invisible,
 * so a refusal that looked wrong could not be checked without a debugger.
 *
 * The environment row earns its place: an entitlement on the production org does
 * not apply to a build pointed at the dev API, and that is a configuration
 * mistake nothing else on screen would reveal.
 *
 * Credits are read optionally. The feature can be absent, and this panel is
 * about the account either way.
 */
export function AccountPanel() {
  const auth = useService(authService)
  const runtime = useService(runtimeService)
  const credits = useOptionalService(creditsService)

  const user = useComputed(() => auth.user.value)
  const org = useComputed(() => auth.user.value?.org ?? null)
  const balance = useComputed(() => credits?.balance.value ?? null)
  const creditsError = useComputed(() => credits?.error.value ?? null)

  const pool = useComputed(() => {
    const current = balance.value
    if (current === null) return creditsError.value ?? 'not read yet'
    if (current.unlimited) {
      return current.scope === 'org' ? 'unlimited, via org' : 'unlimited'
    }
    const total = current.monthlyRemaining + current.stableRemaining
    return `${total.toLocaleString()} remaining`
  })

  if (!user.value) {
    return (
      <p class="zds-account__empty">
        Not signed in, so there is no account to describe. Signing in fills this
        in.
      </p>
    )
  }

  return (
    <div class="zds-account">
      <Row label="Signed in as" value={user.value.email || user.value.name} />

      {org.value ? (
        <>
          <Row label="Org" value={org.value.name} />
          <Row
            label="Your role"
            value={org.value.role || 'unknown'}
            hint={`id ${org.value.id}`}
          />
        </>
      ) : (
        /*
         * Said outright rather than by omitting the rows. "No org" is the
         * answer somebody is looking for when they believed otherwise, and a
         * missing row reads as a UI that failed to load.
         */
        <Row
          label="Org"
          value="none"
          hint="this account is not a member of an org"
        />
      )}

      <Row
        label="Credits"
        value={pool.value}
        hint={
          balance.value === null
            ? undefined
            : balance.value.scope === 'org'
              ? 'read from the org’s pool'
              : 'read from your personal pool'
        }
      />

      <Row label="API" value={apiHost()} />
      <Row
        label="Token"
        value={auth.source.value ?? 'unknown'}
        hint="where this session’s token came from"
      />
      <Row label="Build" value={runtime.info.value.version} />
    </div>
  )
}
