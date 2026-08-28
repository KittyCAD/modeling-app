import { useComputed, useSignal } from '@preact/signals'
import { Button, TextField } from '@kittycad/ui-kit'
import { useService } from '@src/app/context'
import { type SignInFlow, authService } from '@src/contracts/auth'
import { computed } from '@preact/signals'

function PasteTokenForm({ onSignedIn }: { onSignedIn: () => void }) {
  const auth = useService(authService)
  const value = useSignal('')
  const submitting = useSignal(false)

  const failure = useComputed(() => auth.error.value)

  const submit = () => {
    if (submitting.value || !value.value.trim()) return
    submitting.value = true

    void auth.signIn(value.value, 'pasted').then((accepted) => {
      submitting.value = false
      if (accepted) {
        // Cleared on success so a credential is not left sitting in the DOM.
        value.value = ''
        onSignedIn()
      }
    })
  }

  return (
    <div class="zds-signin__flow">
      <p class="zds-signin__flow-description">
        Create a token at{' '}
        <span class="zds-value">zoo.dev/account/api-tokens</span> and paste it
        here.
      </p>
      <div class="zds-signin__row">
        <TextField
          label="API token"
          hideLabel
          type="password"
          placeholder="zoo-api-token"
          value={value}
          onValueInput={(next) => {
            value.value = next
          }}
          onSubmit={submit}
          class="zds-signin__field"
        />
        <Button
          variant="primary"
          label={submitting.value ? 'Checking…' : 'Sign in'}
          disabled={computed(
            () => submitting.value || value.value.trim().length === 0
          )}
          onClick={submit}
        />
      </div>
      {failure.value ? (
        <p class="zds-signin__error" role="alert">
          {failure.value}
        </p>
      ) : null}
    </div>
  )
}

/**
 * Signing in by pasting a token.
 *
 * Available everywhere, and the fallback when a redirect or a device flow cannot
 * work — a locked-down browser, a headless test, an environment whose sign-in
 * page is unreachable. Ordered last, because it asks the most of the user.
 */
export const pasteTokenFlow: SignInFlow = {
  id: 'auth.pasteToken',
  order: 100,
  title: 'Use an API token',
  description: 'Paste a token from your Zoo account.',
  available: computed(() => true),
  render: ({ onSignedIn }) => <PasteTokenForm onSignedIn={onSignedIn} />,
}
