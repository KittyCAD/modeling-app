import { useSignals } from '@preact/signals-react/runtime'
import {
  AvatarUser,
  ButtonClearChat,
  ChatBubble,
} from '@src/components/ExchangeCard'
import type { MigrationConversation } from '@src/lib/kclMigration/conversation'
import type { MigrationHistoryEntry } from '@src/lib/kclMigration/protocol'

export function KclMigrationHistoryEntry({
  entry,
  userAvatar,
  transcriptPresent = false,
  onClickClearChat,
}: {
  entry: MigrationHistoryEntry
  userAvatar?: string
  transcriptPresent?: boolean
  onClickClearChat?: () => void
}) {
  const clearChat = onClickClearChat && (
    <div className="flex justify-end">
      <ButtonClearChat onClick={onClickClearChat} />
    </div>
  )
  if (transcriptPresent && entry.status !== 'succeeded') return clearChat

  const outcome = {
    running: 'Migration was still running when history was loaded.',
    succeeded: 'Conversion succeeded.',
    failed: 'Migration failed.',
    timed_out: 'Migration timed out.',
    cancelled: 'Migration was cancelled.',
    unsupported: 'This project could not be migrated.',
    validation_failed: 'Migration validation failed.',
  }[entry.status]
  return (
    <section
      aria-label="Past KCL migration"
      className="flex min-w-0 flex-col gap-2 px-4 py-2 text-sm"
    >
      {!transcriptPresent && (
        <ChatBubble
          side="right"
          userAvatar={<AvatarUser src={userAvatar} />}
          className="py-2"
        >
          Migrate this project to KCL 3.0.
        </ChatBubble>
      )}
      <ChatBubble
        side="left"
        wfull
        userAvatar={<div className="h-7 w-7 avatar bg-img-mel" />}
        className="py-3 whitespace-normal"
      >
        {!transcriptPresent && <p>{outcome}</p>}
        {!transcriptPresent && entry.detail && <p>{entry.detail}</p>}
        {entry.status === 'succeeded' && (
          <p>
            {entry.application.status === 'not_applied'
              ? 'Application was not confirmed.'
              : entry.application.status === 'undone'
                ? 'Last reported: migration undone.'
                : 'Last reported: migration applied.'}
          </p>
        )}
      </ChatBubble>
      {clearChat}
    </section>
  )
}

export function KclMigrationHistoryStatus({
  history,
}: {
  history: MigrationConversation
}) {
  useSignals()
  return (
    <div className="px-4 text-sm">
      {history.error.value && (
        <p role="status">
          Migration history could not load: {history.error.value}
        </p>
      )}
      {(history.error.value ||
        history.entries.value.some((entry) => entry.status === 'running')) && (
        <button
          type="button"
          disabled={history.loading.value}
          onClick={() => void history.refresh()}
        >
          Refresh migration history
        </button>
      )}
      {history.applicationError.value && (
        <div role="status">
          <p>
            Could not save migration apply/undo status:{' '}
            {history.applicationError.value}
          </p>
          <button type="button" onClick={() => history.retryApplications()}>
            Retry saving migration status
          </button>
        </div>
      )}
    </div>
  )
}
