import { useComputed, useSignal } from '@preact/signals'
import { Button, EmptyState, Spinner } from '@kittycad/ui-kit'
import { useService } from '@src/app/context'
import type { Conversation, Turn } from '@src/contracts/zookeeper'
import { zookeeperService } from '@src/contracts/zookeeper'
import './zookeeper.css'

/**
 * The agent, as a participant in the project.
 *
 * Deliberately not a chat window that happens to write files. The transcript
 * shows what each turn *did* — which files it changed, what it could not change,
 * what it is waiting for — because that is the part a user has to be able to
 * audit, and it is the part `main`'s pane cannot show at all: it writes whole
 * files to disk and has nothing to report afterwards.
 */
export function ZookeeperPanel() {
  const zookeeper = useService(zookeeperService)

  const active = useComputed(() => {
    const id = zookeeper.active.value
    return id === null ? null : (zookeeper.conversations.value.get(id) ?? null)
  })

  const reason = useComputed(() => zookeeper.unavailableReason.value)

  if (reason.value !== null) {
    return (
      <EmptyState
        icon="elephant"
        eyebrow="Zookeeper"
        title="Not available"
        description={reason.value}
      />
    )
  }

  if (active.value === null) {
    return (
      <EmptyState
        icon="elephant"
        eyebrow="Zookeeper"
        title="No conversation open"
        description="Ask for a change and Zookeeper edits the project alongside you."
        actions={
          <Button
            label="Start a conversation"
            variant="primary"
            onClick={() => zookeeper.open()}
          />
        }
      />
    )
  }

  return <ConversationView conversation={active.value} />
}

function ConversationView({ conversation }: { conversation: Conversation }) {
  const draft = useSignal('')
  const turns = useComputed(() => conversation.transcript.value)
  const status = useComputed(() => conversation.status.value)
  const link = useComputed(() => conversation.connection.value)
  // Nothing can be sent until the socket is up, and saying so beats a prompt
  // that silently goes nowhere.
  const sendable = useComputed(() => link.value.status === 'connected')

  const submit = () => {
    const prompt = draft.value.trim()
    if (prompt === '') return
    draft.value = ''
    void conversation.send(prompt)
  }

  return (
    <div class="zds-zoo">
      <div class="zds-zoo__transcript">
        {turns.value.length === 0 ? (
          <p class="zds-zoo__hint">
            Describe the change you want. Zookeeper edits the files with you,
            and every edit it makes can be undone on its own.
          </p>
        ) : (
          turns.value.map((turn) => (
            <TurnView
              key={turn.id}
              turn={turn}
              onRevert={() => conversation.revert(turn.id)}
            />
          ))
        )}
      </div>

      <div class="zds-zoo__composer">
        {link.value.status === 'connecting' ? (
          <div class="zds-zoo__working">
            <Spinner size="small" label="Connecting to Zookeeper" />
            <span>Connecting…</span>
          </div>
        ) : null}

        {link.value.status === 'failed' || link.value.status === 'offline' ? (
          <p class="zds-zoo__note zds-zoo__note--conflict">
            {link.value.error ?? 'Not connected.'}
            {link.value.superseded
              ? ' This conversation is open somewhere else, so reconnecting will not help.'
              : ''}
          </p>
        ) : null}

        {status.value === 'streaming' ? (
          <div class="zds-zoo__working">
            <Spinner size="small" label="Zookeeper is working" />
            <span>Working…</span>
            <Button
              label="Stop"
              size="small"
              variant="ghost"
              onClick={() => conversation.interrupt()}
            />
          </div>
        ) : null}

        <textarea
          class="zds-zoo__input"
          rows={3}
          placeholder="Make the bracket 4mm thicker…"
          value={draft.value}
          disabled={status.value === 'streaming' || !sendable.value}
          onInput={(event) => {
            draft.value = event.currentTarget.value
          }}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter is a newline. A prompt is usually one
            // line, and reaching for a button every time would be worse.
            if (event.key !== 'Enter' || event.shiftKey) return
            event.preventDefault()
            submit()
          }}
        />
        <div class="zds-zoo__composerActions">
          <Button
            label="Send"
            variant="primary"
            size="small"
            disabled={status.value === 'streaming' || !sendable.value}
            onClick={submit}
          />
        </div>
      </div>
    </div>
  )
}

function TurnView({ turn, onRevert }: { turn: Turn; onRevert: () => void }) {
  return (
    <article class="zds-zoo__turn" data-status={turn.status}>
      <p class="zds-zoo__prompt">{turn.prompt}</p>

      {turn.response === '' ? null : (
        <p class="zds-zoo__response">{turn.response}</p>
      )}

      {turn.waiting.length > 0 ? (
        <p class="zds-zoo__note zds-zoo__note--waiting">
          Waiting for {turn.waiting.join(', ')} — another conversation is
          editing it.
        </p>
      ) : null}

      {turn.conflicts.length > 0 ? (
        <div class="zds-zoo__note zds-zoo__note--conflict">
          <p>
            Could not change{' '}
            {turn.conflicts.map((each) => each.path).join(', ')}
            {' — '}
            you edited it first.
          </p>
        </div>
      ) : null}

      {turn.status === 'failed' ? (
        <p class="zds-zoo__note zds-zoo__note--conflict">That turn failed.</p>
      ) : null}

      {turn.paths.length > 0 ? (
        <footer class="zds-zoo__changed">
          <ul class="zds-zoo__paths">
            {turn.paths.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
          {/*
            Revert is a button rather than a keystroke on purpose: Cmd+Z is
            per-buffer, and a turn can span files. This undoes the whole turn
            without touching what the user did afterwards.
          */}
          <Button
            label="Revert this turn"
            size="small"
            variant="ghost"
            onClick={onRevert}
          />
        </footer>
      ) : null}
    </article>
  )
}
