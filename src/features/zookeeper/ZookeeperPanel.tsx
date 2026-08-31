import { useComputed, useSignal } from '@preact/signals'
import { Button, EmptyState, Icon, Spinner } from '@kittycad/ui-kit'
import { useService } from '@src/app/context'
import type {
  Conversation,
  ReasoningEntry,
  Turn,
} from '@src/contracts/zookeeper'
import { zookeeperService } from '@src/contracts/zookeeper'
import {
  describeReasoning,
  reasoningHeadline,
} from '@src/features/zookeeper/reasoning'
import './zookeeper.css'

/**
 * Where Zookeeper is, in the status bar.
 *
 * Only shown when it has actually written somewhere recently, so it says
 * something true rather than something reassuring: the protocol reveals no file
 * until an edit lands, and scraping filenames out of streamed prose is what
 * `main` does.
 */
export function ZookeeperPresenceField() {
  const zookeeper = useService(zookeeperService)

  const latest = useComputed(() => {
    let newest: { path: string; at: number } | null = null
    for (const [path, entry] of zookeeper.presence.value) {
      if (newest === null || entry.at > newest.at)
        newest = { path, at: entry.at }
    }
    return newest
  })

  if (latest.value === null) return null

  return (
    <span class="zds-zoo__presence" title="Zookeeper edited this file just now">
      <Icon name="elephant" />
      {latest.value.path}
    </span>
  )
}

/**
 * The panel's header button.
 *
 * In the chrome rather than the body because it belongs to the panel, not to any
 * one conversation — and because the body's own "start a conversation" button
 * only exists in the empty state, so without this there would be no way to open
 * a second one.
 */
export function ZookeeperHeaderActions() {
  const zookeeper = useService(zookeeperService)
  const available = useComputed(() => zookeeper.available.value)

  return (
    <Button
      label="New conversation"
      iconOnly
      icon="plus"
      size="small"
      variant="ghost"
      disabled={!available.value}
      onClick={() => zookeeper.open()}
    />
  )
}

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
      <div class="zds-zoo">
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
        <StoredConversations />
      </div>
    )
  }

  return (
    <div class="zds-zoo">
      <ConversationTabs />
      <ConversationView conversation={active.value} />
    </div>
  )
}

/**
 * Conversations this project has had before.
 *
 * The point of writing transcripts to disk: one you cannot get back to is only
 * an audit trail. Reopening brings the turns back for reading and asks the
 * service to replay its side.
 *
 * What it does *not* bring back is the ability to revert those edits exactly —
 * the change history they were applied against died with the session, so the
 * list says so rather than offering a button that would quietly do something
 * weaker than it claims.
 */
function StoredConversations() {
  const zookeeper = useService(zookeeperService)
  const stored = useComputed(() => zookeeper.stored.value)

  if (stored.value.length === 0) return null

  return (
    <section class="zds-zoo__stored">
      <h3 class="zds-zoo__storedTitle">Earlier conversations</h3>
      <ul class="zds-zoo__storedList">
        {stored.value.map((conversation) => (
          <li class="zds-zoo__storedItem" key={conversation.id}>
            <button
              type="button"
              class="zds-zoo__storedButton"
              onClick={() => zookeeper.resume(conversation.id)}
            >
              <span class="zds-zoo__storedPrompt">
                {conversation.turns.at(0)?.prompt ?? 'Empty conversation'}
              </span>
              <span class="zds-zoo__storedMeta">
                {`${conversation.turns.length} turn${
                  conversation.turns.length === 1 ? '' : 's'
                }`}
              </span>
            </button>
            <Button
              label="Forget this conversation"
              iconOnly
              icon="trash"
              size="small"
              variant="ghost"
              onClick={() => zookeeper.forget(conversation.id)}
            />
          </li>
        ))}
      </ul>
      <p class="zds-zoo__storedNote">
        Reopening shows what was said, and its edits can still be reverted turn
        by turn — unless the file has changed outside the app since.
      </p>
    </section>
  )
}

/**
 * Which collaborator you are talking to.
 *
 * Hidden with one conversation, because a tab strip over a single tab is noise.
 * It appears the moment a second exists, which is also the moment "Zookeeper"
 * stops being a single thing and the label has to say which one.
 */
function ConversationTabs() {
  const zookeeper = useService(zookeeperService)
  const entries = useComputed(() => [...zookeeper.conversations.value.values()])
  const active = useComputed(() => zookeeper.active.value)

  if (entries.value.length < 2) return null

  return (
    <div class="zds-zoo__tabs" role="tablist" aria-label="Conversations">
      {entries.value.map((conversation, index) => (
        <div class="zds-zoo__tab" key={conversation.id}>
          <button
            type="button"
            role="tab"
            aria-selected={active.value === conversation.id}
            class="zds-zoo__tabButton"
            onClick={() => zookeeper.activate(conversation.id)}
          >
            {/* Numbered rather than named: a conversation has no title until
                somebody gives it one, and "Zookeeper (2)" is what the waiting
                message calls it. */}
            {`Zookeeper (${index + 1})`}
            <StatusMark conversation={conversation} />
          </button>
          <Button
            label={`Close Zookeeper (${index + 1})`}
            iconOnly
            icon="close"
            size="small"
            variant="ghost"
            onClick={() => zookeeper.close(conversation.id)}
          />
        </div>
      ))}
    </div>
  )
}

/** A dot on a tab, so a conversation working in the background is visible. */
function StatusMark({ conversation }: { conversation: Conversation }) {
  const status = useComputed(() => conversation.status.value)
  if (status.value === 'idle') return null
  return (
    <span
      class="zds-zoo__tabMark"
      data-status={status.value}
      aria-label={status.value}
    />
  )
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
    <div class="zds-zoo__body">
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

/**
 * What the service showed of its working.
 *
 * Open while the turn runs, collapsed once it settles — the reasoning is how you
 * follow a turn in progress and clutter once you know the answer. Native
 * `<details>`, so the disclosure is keyboard-reachable and announced without
 * this file reimplementing any of that.
 *
 * The auto-collapse yields to a person: once they have opened or closed it
 * themselves, `choice` holds and the turn settling no longer moves it. A pane
 * that snapped shut on something being read would be worse than one that never
 * collapsed at all.
 */
function ReasoningView({ turn }: { turn: Turn }) {
  const choice = useSignal<boolean | null>(null)

  if (turn.reasoning.length === 0) return null

  const streaming = turn.status === 'streaming'
  const open = choice.value ?? streaming

  return (
    <details
      class="zds-zoo__reasoning"
      open={open}
      onToggle={(event) => {
        choice.value = event.currentTarget.open
      }}
    >
      <summary class="zds-zoo__reasoningSummary">
        {reasoningHeadline(turn.reasoning, streaming)}
      </summary>
      <ol class="zds-zoo__reasoningSteps">
        {turn.reasoning.map((entry, index) => (
          // Index as key: the list is append-only and entries have no identity
          // of their own, so position is the only stable thing about them.
          // biome-ignore lint/suspicious/noArrayIndexKey: append-only, no id
          <li class="zds-zoo__reasoningStep" key={index}>
            <ReasoningEntryView entry={entry} />
          </li>
        ))}
      </ol>
    </details>
  )
}

function ReasoningEntryView({ entry }: { entry: ReasoningEntry }) {
  if (entry.kind === 'text') {
    return <p class="zds-zoo__reasoningText">{entry.content}</p>
  }

  if (entry.kind === 'plan') {
    /*
     * Rendered as a list of files rather than folded into prose, because this is
     * the only thing in the protocol that names what a turn intends to touch
     * *before* it touches it — the one honest form of "which file is it working
     * on" that does not mean scraping filenames out of streamed text.
     */
    return (
      <div class="zds-zoo__reasoningPlan">
        <p class="zds-zoo__reasoningLabel">Plan</p>
        <ul class="zds-zoo__reasoningPlanSteps">
          {entry.steps.map((step) => (
            <li key={`${step.path}:${step.instructions}`}>
              <span class="zds-zoo__reasoningPath">{step.path}</span>
              <span class="zds-zoo__reasoningText">{step.instructions}</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  if (entry.kind === 'code') {
    return <pre class="zds-zoo__reasoningCode">{entry.content}</pre>
  }

  if (entry.kind === 'error') {
    return <p class="zds-zoo__note zds-zoo__note--conflict">{entry.message}</p>
  }

  if (entry.kind === 'file') {
    return <p class="zds-zoo__reasoningFile">{describeReasoning(entry)}</p>
  }

  /*
   * A reference can be a whole documentation dump, so it stays behind its own
   * disclosure. Knowing that it looked something up is usually the whole point;
   * what it read is available if you want it.
   */
  return (
    <details class="zds-zoo__reasoningReference">
      <summary class="zds-zoo__reasoningLabel">{entry.label}</summary>
      <pre class="zds-zoo__reasoningCode">{entry.content}</pre>
    </details>
  )
}

function TurnView({ turn, onRevert }: { turn: Turn; onRevert: () => void }) {
  const zookeeper = useService(zookeeperService)
  // Exact revert survives a reload now, but not a file edited outside the app or
  // a turn older than the log's horizon — so this is asked rather than assumed.
  const revertible = useComputed(() => zookeeper.canRevert(turn.id).value)

  return (
    <article class="zds-zoo__turn" data-status={turn.status}>
      <p class="zds-zoo__prompt">{turn.prompt}</p>

      <ReasoningView turn={turn} />

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

            Absent rather than disabled when the history for it is gone: a
            greyed-out button invites a hover to explain itself, and there is
            nothing useful to say beyond "not any more".
          */}
          {revertible.value ? (
            <Button
              label="Revert this turn"
              size="small"
              variant="ghost"
              onClick={onRevert}
            />
          ) : null}
        </footer>
      ) : null}
    </article>
  )
}
