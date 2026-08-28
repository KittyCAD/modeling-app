import { type Signal, useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { Button, Icon, Select, Switch, TextField } from '@kittycad/ui-kit'
import { useService } from '@src/app/context'
import { modelingOperationsService } from '@src/contracts/modelingOperationsService'
import { selectionService } from '@src/contracts/selection'
import { worthAsking } from '@src/features/modelingOperations/createOperationRunner'
import './modelingOperations.css'

/**
 * The one prompt for every operation's every argument.
 *
 * Generic over the *interaction shape* a resolver returns, not over the
 * operation or the KCL type — so a new operation adds no UI at all, and a new
 * resolver adds a case here only if it needs an interaction nobody has needed
 * before. Picking geometry in the viewport will be that; a new stdlib function
 * will not.
 *
 * **Not modal.** It began as a dialog with a scrim, which was wrong for the app
 * it is in: the next argument type to arrive is "click a region in the scene",
 * and a sheet over the viewport cannot be answered. So it docks at the bottom of
 * the frame, the scene and the editor stay live behind it, and Escape is what
 * dismisses it. That also fixes something the old version got wrong on its own
 * terms — it claimed to keep the code in view and then covered it.
 *
 * **One surface of several.** It reads `asking`, which is the run projected down
 * to a single question. A dialog over the scene reads `pending.fields` instead
 * and shows them all; neither is the real one.
 */
/**
 * The argument that is answered by clicking the model.
 *
 * Reads the selection live rather than taking a snapshot, because the whole
 * interaction is "click, look, click something else" — and the sheet is docked
 * precisely so that is possible while this is on screen.
 *
 * The answer it submits is entity ids; turning those into KCL is the resolver's
 * job, since only it knows that a wall's code is the segment that drew it.
 */
function SelectionField({
  accepts,
  multiple,
  ordered,
  emptyLabel,
  draft,
}: {
  accepts: readonly string[]
  multiple: boolean
  ordered: boolean
  emptyLabel?: string
  draft: Signal<string>
}) {
  const selection = useService(selectionService)
  const picked = selection.entities.value

  // An argument that takes one thing gets the last thing clicked, not the first:
  // clicking a second face is a correction, and taking the first would make the
  // field ignore it.
  const entities = multiple ? picked : picked.slice(-1)

  // Kept in the draft as the selection changes, so Apply submits what is
  // currently picked without the user having to confirm it twice.
  draft.value = entities.map((entity) => entity.entityId).join(' ')

  return (
    <div class="zds-operation__selection">
      {entities.length === 0 ? (
        <p class="zds-operation__hint">
          {emptyLabel ??
            `Click ${accepts.length > 0 ? accepts.join(' or ') : 'geometry'} in the scene.`}
        </p>
      ) : (
        <ul class="zds-operation__picked">
          {entities.map((entity, index) => (
            <li key={entity.entityId} class="zds-operation__pick">
              {/* Position is shown only where it means something. Numbering a
                  set would imply an order the argument does not have. */}
              {ordered ? (
                <span class="zds-label">{index + 1}</span>
              ) : (
                <Icon name="cube" size="small" />
              )}
              <span class="zds-value">{entity.kind ?? 'geometry'}</span>
              {/* Only what the graph could name; an entity with no code behind
                  it is still shown, because it is still selected. */}
              {entity.sourceRange ? (
                <span class="zds-label">offset {entity.sourceRange[0]}</span>
              ) : (
                <span class="zds-label">not in this file</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function OperationPrompt() {
  const modeling = useService(modelingOperationsService)
  const pending = modeling.pending.value
  const field = modeling.asking.value

  const draft = useSignal('')
  const input = useRef<HTMLInputElement>(null)

  const name = field?.input.name ?? ''

  /**
   * A fresh answer per argument, focused.
   *
   * Keyed on the argument's name rather than its position, because a field set
   * has no positions to move between — answering one argument can bring another
   * back, and what was typed for this one is still an answer to this question.
   */
  useEffect(() => {
    if (!field) return
    draft.value = field.answer
      ? (field.raw ?? field.answer.source)
      : field.prompt.kind === 'boolean'
        ? 'false'
        : ((field.prompt.kind === 'choice'
            ? field.prompt.options[0]?.value
            : '') ?? '')
    // A selection prompt fills the draft from what is picked, which may be
    // nothing yet.

    input.current?.focus()
    input.current?.select()
  }, [pending?.operation.id, name, draft])

  if (!pending || !field) return null

  const argument = field.input
  const layout = modeling.layoutFor(pending.operation.id)
  const presentation = layout.fields[argument.name]

  const label =
    presentation?.label ??
    pending.operation.annotations?.labels?.[argument.name] ??
    argument.name

  // Position among all the arguments, not among the ones left: "2 of 5" should
  // not count down as answers arrive.
  const position = pending.fields.indexOf(field) + 1
  const remaining = pending.edit
    ? pending.fields.length - pending.fields.indexOf(field)
    : pending.fields.filter(worthAsking).length

  const submit = () => void modeling.answer(draft.value)

  return (
    <div class="zds-operation">
      {/* No scrim and no `aria-modal`: the viewport behind this has to stay
          clickable, because that is how a geometric argument gets answered. */}
      <div
        class="zds-operation__sheet"
        role="group"
        aria-label={pending.operation.title}
      >
        <header class="zds-operation__header">
          <p class="zds-label">{pending.operation.title}</p>
          <p class="zds-operation__step">
            {position} of {pending.fields.length}
          </p>
        </header>

        {/*
          How to answer, when there is more than one way.
          A `Sketch` can be a name in the file or a region picked in the scene;
          which one is the user's choice, not the first resolver's.
        */}
        {field.methods.length > 1 ? (
          <div
            class="zds-operation__methods"
            role="group"
            aria-label="How to choose"
          >
            {field.methods.map((method) => (
              <Button
                key={method.id}
                size="small"
                variant="ghost"
                label={method.label}
                pressed={method.id === field.method}
                onClick={() => void modeling.chooseMethod(method.id)}
              />
            ))}
          </div>
        ) : null}

        <div class="zds-operation__field">
          {presentation?.hideLabel ? null : (
            <p class="zds-operation__name">
              {label}
              {argument.required ? null : (
                <span class="zds-operation__optional zds-label">optional</span>
              )}
            </p>
          )}

          {/* The docs are the stdlib's own, which is the whole argument for
              deriving: nobody has to write help text twice. A hint from the
              layout is the exception the stdlib cannot know about. */}
          {presentation?.hint ? (
            <p class="zds-operation__docs">{presentation.hint}</p>
          ) : argument.docs ? (
            <p class="zds-operation__docs">{argument.docs}</p>
          ) : null}

          {field.prompt.kind === 'choice' ? (
            <Select
              label={label}
              hideLabel
              size="small"
              value={draft.value}
              options={field.prompt.options.map((option) => ({
                value: option.value,
                label: option.detail
                  ? `${option.label} — ${option.detail}`
                  : option.label,
              }))}
              onValueChange={(value) => {
                draft.value = value
              }}
            />
          ) : null}

          {field.prompt.kind === 'expression' ? (
            <TextField
              label={label}
              hideLabel
              size="small"
              value={draft.value}
              placeholder={
                field.prompt.unit
                  ? `${field.prompt.placeholder ?? ''} (${field.prompt.unit})`
                  : field.prompt.placeholder
              }
              inputRef={input}
              onValueInput={(value) => {
                draft.value = value
              }}
              onSubmit={submit}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return
                event.preventDefault()
                event.stopPropagation()
                modeling.cancel()
              }}
            />
          ) : null}

          {field.prompt.kind === 'selection' ? (
            <SelectionField
              accepts={field.prompt.accepts}
              // Ordered implies multiple, so an argument that says only the
              // former still collects more than one.
              multiple={
                field.prompt.multiple === true || field.prompt.ordered === true
              }
              ordered={field.prompt.ordered ?? false}
              emptyLabel={presentation?.emptyLabel}
              draft={draft}
            />
          ) : null}

          {field.prompt.kind === 'boolean' ? (
            <Switch
              label={label}
              checked={draft.value === 'true'}
              onCheckedChange={(checked) => {
                draft.value = checked ? 'true' : 'false'
              }}
            />
          ) : null}
        </div>

        {/* The argument's own trouble first: it is the one the user can act on.
            The operation's own failure is what is left. */}
        {(field.error ?? pending.error) ? (
          <p class="zds-operation__error" role="alert">
            {field.error ?? pending.error}
          </p>
        ) : null}

        <footer class="zds-operation__actions">
          <Button
            size="small"
            label="Cancel"
            disabled={pending.busy}
            onClick={() => modeling.cancel()}
          />
          <Button
            size="small"
            variant="primary"
            label={remaining > 1 ? 'Next' : 'Apply'}
            disabled={pending.busy}
            onClick={submit}
          />
        </footer>
      </div>
    </div>
  )
}
