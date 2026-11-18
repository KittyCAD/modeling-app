import { useSignals } from '@preact/signals-react/runtime'
import { ActionButton } from '@src/components/ActionButton'
import { useApp } from '@src/lib/boot'
import { reportRejection } from '@src/lib/trap'
import { viewportNavigationService } from '@src/registry/contracts/viewportNavigation'

export function RecenterViewControl() {
  useSignals()
  const { registry } = useApp()
  const navigation = registry.optional(viewportNavigationService)
  if (!navigation?.isModelOutOfView.value) return null
  const hint = navigation.recoveryHint?.value ?? { kind: 'neutral' }
  const label =
    hint.kind === 'direction'
      ? 'Model is offscreen'
      : hint.kind === 'zoom-in'
        ? 'Model is too small'
        : hint.kind === 'zoom-out'
          ? 'Zoom out to find the model'
          : 'Fit the model in view'

  return (
    <ActionButton
      Element="button"
      type="button"
      tabIndex={0}
      className="h-8 whitespace-nowrap bg-2 shadow-sm focus-visible:ring-2 focus-visible:ring-primary"
      title={label}
      aria-label="Recenter"
      onClick={() => {
        navigation.recenter().catch(reportRejection)
      }}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-5 w-5 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {hint.kind === 'direction' ? (
          <g transform={`rotate(${hint.angle} 12 12)`}>
            <path d="M4 12h16m-6-6 6 6-6 6" />
          </g>
        ) : hint.kind === 'zoom-out' ? (
          <path d="m9 9-6-6m0 6V3h6m6 12 6 6m-6 0h6v-6" />
        ) : hint.kind === 'zoom-in' ? (
          <path d="m3 3 6 6m-6 0h6V3m12 18-6-6m0 6v-6h6" />
        ) : (
          <>
            <circle cx="12" cy="12" r="5" />
            <path d="M12 2v5m0 10v5M2 12h5m10 0h5" />
          </>
        )}
      </svg>
      Recenter
    </ActionButton>
  )
}
