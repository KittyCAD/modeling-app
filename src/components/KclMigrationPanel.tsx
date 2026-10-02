import { useSignals } from '@preact/signals-react/runtime'
import {
  AvatarUser,
  ButtonClearChat,
  ChatBubble,
} from '@src/components/ExchangeCard'
import { Thinking } from '@src/components/Thinking'
import { MarkdownText } from '@src/components/MarkdownText'
import type { MigrationController } from '@src/lib/kclMigration/controller'
import { useState } from 'react'

export function KclMigrationStart({
  disabled,
  onStart,
}: {
  disabled: boolean
  onStart: () => void
}) {
  const [open, setOpen] = useState(false)
  const [consent, setConsent] = useState(false)
  return (
    <div className="px-4 py-2 text-sm">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        Migrate to KCL 3
      </button>
      {open && (
        <div className="my-3 flex flex-col items-start gap-3">
          <p>
            Free project conversion, with up to 20 minutes for conversion and
            validation. Validated changes apply automatically. Use Undo to
            restore the previous project.
          </p>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            I agree to migrate to KCL 3 preview, which may change before the
            stable release.
          </label>
          <button
            type="button"
            className="rounded border border-chalkboard-40 px-3 py-1.5 disabled:opacity-50"
            disabled={disabled || !consent}
            onClick={() => {
              if (consent && !disabled) onStart()
            }}
          >
            Start Free Migration
          </button>
        </div>
      )}
    </div>
  )
}

export function KclMigrationPanel({
  controller,
  userAvatar,
  onClickClearChat,
}: {
  controller: MigrationController
  userAvatar?: string
  onClickClearChat?: () => void
}) {
  useSignals()
  const phase = controller.phase.value
  const busy = controller.busy
  return (
    <section
      aria-label="KCL migration"
      className="flex min-w-0 flex-col gap-2 px-4 py-2 text-sm"
    >
      <ChatBubble
        side="right"
        userAvatar={<AvatarUser src={userAvatar} />}
        className="py-2"
      >
        Migrate this project to KCL 3 preview.
      </ChatBubble>
      {(controller.progress.value.length > 0 ||
        controller.progressText.value) && (
        <details open={busy} className="pl-9">
          <summary className="cursor-pointer">See reasoning</summary>
          <div aria-label="Migration reasoning" className="my-3">
            <Thinking
              thoughts={controller.progress.value}
              isDone={!busy}
              onlyShowImmediateThought={false}
            />
            {controller.progressText.value && (
              <MarkdownText text={controller.progressText.value} />
            )}
          </div>
        </details>
      )}
      <ChatBubble
        side="left"
        wfull
        userAvatar={<div className="h-7 w-7 avatar bg-img-mel" />}
        className="py-3 whitespace-normal"
      >
        <p role="status" aria-live="polite">
          {phase === 'capturing'
            ? 'Capturing the project...'
            : phase === 'connecting'
              ? 'Connecting...'
              : phase === 'running'
                ? 'Converting and validating the project...'
                : phase === 'cancelling'
                  ? 'Cancelling...'
                  : phase === 'applying'
                    ? 'Applying project changes...'
                    : controller.detail.value}
        </p>
        {phase === 'disconnected' && (
          <button
            type="button"
            className="mt-3 rounded border border-chalkboard-40 px-3 py-1.5"
            onClick={() => {
              void controller.recover()
            }}
          >
            Check Final Status
          </button>
        )}
      </ChatBubble>
      {onClickClearChat && !busy && (
        <div className="flex justify-end">
          <ButtonClearChat onClick={onClickClearChat} />
        </div>
      )}
    </section>
  )
}
