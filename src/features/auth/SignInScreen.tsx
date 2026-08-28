import { useComputed } from '@preact/signals'
import { Button } from '@kittycad/ui-kit'
import { useService, useValueSpec } from '@src/app/context'
import { authService, signInFlowsValueSpec } from '@src/contracts/auth'
import './signIn.css'

/**
 * The sign-in screen.
 *
 * A screen, not a route guard. It declares itself active when something has
 * asked for credentials, and wins by order — so "is the app gated?" is one
 * predicate here rather than a wrapper around everything else.
 *
 * Dismissable on purpose. Local projects, editing, and KCL diagnostics work
 * without an account, so this asks rather than demands, and says which capability
 * prompted it.
 */
export function SignInScreen() {
  const auth = useService(authService)
  const flows = useValueSpec(signInFlowsValueSpec)

  const available = useComputed(() =>
    [...flows.value]
      .filter((flow) => flow.available.value)
      .sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id)
      )
  )

  const primary = useComputed(() => available.value[0])
  const alternatives = useComputed(() => available.value.slice(1))
  const reason = useComputed(() => auth.signInReason.value)

  return (
    <div class="zds-signin zds-scroll">
      <div class="zds-signin__inner">
        <header class="zds-signin__header">
          <p class="zds-label">Account</p>
          <h1 class="zds-display">Sign in to Zoo</h1>
          <p class="zds-signin__lead">
            {reason.value ??
              'An account is needed for the modeling engine and anything else that talks to Zoo.'}
          </p>
        </header>

        <hr class="zds-rule zds-signin__rule" />

        {primary.value ? (
          <section class="zds-signin__primary">
            <h2 class="zds-label">{primary.value.title}</h2>
            {primary.value.render({ onSignedIn: () => auth.dismissSignIn() })}
          </section>
        ) : (
          <p class="zds-signin__error">
            No sign-in method is available on this platform.
          </p>
        )}

        {alternatives.value.length > 0 ? (
          <section class="zds-signin__alternatives">
            <hr class="zds-rule zds-signin__rule" />
            {alternatives.value.map((flow) => (
              <div class="zds-signin__alternative" key={flow.id}>
                <h2 class="zds-label">{flow.title}</h2>
                {flow.render({ onSignedIn: () => auth.dismissSignIn() })}
              </div>
            ))}
          </section>
        ) : null}

        <footer class="zds-signin__footer">
          {/*
            The escape hatch, and the point of not gating the whole app: most of
            it works without an account, so leaving is a normal choice rather
            than giving up.
          */}
          <Button
            variant="ghost"
            icon="arrowLeft"
            label="Continue without an account"
            onClick={() => auth.dismissSignIn()}
          />
        </footer>
      </div>
    </div>
  )
}
