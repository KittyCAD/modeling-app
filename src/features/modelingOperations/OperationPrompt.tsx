import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { Button, Select, Switch, TextField } from '@kittycad/ui-kit'
import { useService } from '@src/app/context'
import { modelingOperationsService } from '@src/contracts/modelingOperationsService'
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
 */
export function OperationPrompt() {
  const modeling = useService(modelingOperationsService)
  const pending = modeling.pending.value

  const draft = useSignal('')
  const input = useRef<HTMLInputElement>(null)

  const index = pending?.index ?? -1
  const argument = pending?.inputs[index]

  /**
   * A fresh answer per argument, focused.
   *
   * Keyed on the index so moving to the next argument clears what was typed for
   * the last one — and on the operation, since two runs of the same operation
   * are not the same prompt.
   */
  useEffect(() => {
    if (!pending) return
    draft.value =
      pending.prompt.kind === 'boolean'
        ? 'false'
        : ((pending.prompt.kind === 'choice'
            ? pending.prompt.options[0]?.value
            : '') ?? '')
    input.current?.focus()
    input.current?.select()
  }, [pending?.operation.id, index, draft])

  if (!pending || !argument) return null

  const label =
    pending.operation.annotations?.labels?.[argument.name] ?? argument.name
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
            {index + 1} of {pending.inputs.length}
          </p>
        </header>

        {/*
          How to answer, when there is more than one way.
          A `Sketch` can be a name in the file or a region picked in the scene;
          which one is the user's choice, not the first resolver's.
        */}
        {pending.methods.length > 1 ? (
          <div
            class="zds-operation__methods"
            role="group"
            aria-label="How to choose"
          >
            {pending.methods.map((method) => (
              <Button
                key={method.id}
                size="small"
                variant="ghost"
                label={method.label}
                pressed={method.id === pending.method}
                onClick={() => void modeling.chooseMethod(method.id)}
              />
            ))}
          </div>
        ) : null}

        <div class="zds-operation__field">
          <p class="zds-operation__name">
            {label}
            {argument.required ? null : (
              <span class="zds-operation__optional zds-label">optional</span>
            )}
          </p>

          {/* The docs are the stdlib's own, which is the whole argument for
              deriving: nobody has to write help text twice. */}
          {argument.docs ? (
            <p class="zds-operation__docs">{argument.docs}</p>
          ) : null}

          {pending.prompt.kind === 'choice' ? (
            <Select
              label={label}
              hideLabel
              size="small"
              value={draft.value}
              options={pending.prompt.options.map((option) => ({
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

          {pending.prompt.kind === 'expression' ? (
            <TextField
              label={label}
              hideLabel
              size="small"
              value={draft.value}
              placeholder={
                pending.prompt.unit
                  ? `${pending.prompt.placeholder ?? ''} (${pending.prompt.unit})`
                  : pending.prompt.placeholder
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

          {pending.prompt.kind === 'boolean' ? (
            <Switch
              label={label}
              checked={draft.value === 'true'}
              onCheckedChange={(checked) => {
                draft.value = checked ? 'true' : 'false'
              }}
            />
          ) : null}
        </div>

        {pending.error ? (
          <p class="zds-operation__error" role="alert">
            {pending.error}
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
            label={index + 1 === pending.inputs.length ? 'Apply' : 'Next'}
            disabled={pending.busy}
            onClick={submit}
          />
        </footer>
      </div>
    </div>
  )
}
