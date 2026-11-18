import { useState } from 'react'
import type { ActionRecipe, ContactEffect, PropertyCondition } from './actions'
import type { PropertyDefinition } from './game'

export function ActionEditor({
  name,
  properties,
  busy,
  onInstall,
}: {
  name: string
  properties: readonly PropertyDefinition[]
  busy: boolean
  onInstall(recipe: ActionRecipe): Promise<void>
}) {
  const [id, setId] = useState(name || 'MOVE')
  const [trigger, setTrigger] = useState<'turn' | 'contact'>('turn')
  const [conditions, setConditions] = useState<PropertyCondition[]>([])
  const [effects, setEffects] = useState<ContactEffect[]>([])
  const [operation, setOperation] = useState<'step-forward' | 'destroy-self'>(
    'step-forward'
  )
  const [blocked, setBlocked] = useState<'wait' | 'reverse'>('reverse')
  const valid =
    !!id &&
    conditions.every((condition) => !!condition.property) &&
    (trigger === 'turn' || effects.length > 0)
  async function install() {
    if (!valid) return
    const common = { id, label: id }
    const recipe: ActionRecipe =
      trigger === 'contact'
        ? { ...common, trigger, conditions, effects }
        : {
            ...common,
            trigger,
            conditions: conditions.map((condition) => ({
              ...condition,
              target: 'self',
            })),
            effects: [
              operation === 'destroy-self'
                ? { kind: 'destroy', target: 'self' }
                : { kind: 'step-forward', blocked },
            ],
          }
    await onInstall(recipe)
  }
  return (
    <fieldset className="action-author" disabled={busy}>
      <legend>New action</legend>
      <label>
        Action name
        <input
          value={id}
          maxLength={16}
          onChange={(event) =>
            setId(event.target.value.toUpperCase().replace(/[^A-Z]/g, ''))
          }
        />
      </label>
      <label>
        Trigger
        <select
          aria-label="Action trigger"
          value={trigger}
          onChange={(event) => {
            const value = event.target.value
            if (value === 'turn' || value === 'contact') {
              setTrigger(value)
              setConditions([])
            }
          }}
        >
          <option value="turn">At turn end</option>
          <option value="contact">Attempted contact</option>
        </select>
      </label>
      {trigger === 'contact' && (
        <p className="field-hint">
          Runs for either participant before blocking or pushing. “This entity”
          is the entity carrying this action.
        </p>
      )}
      <div className="recipe-heading">Conditions (all must match)</div>
      {conditions.map((condition, index) => (
        <div className="recipe-item" key={index}>
          <select
            aria-label={`Condition ${index + 1} target`}
            value={condition.target}
            onChange={(event) => {
              const value = event.target.value
              if (value === 'self' || value === 'other')
                setConditions(
                  conditions.map((c, i) =>
                    i === index ? { ...c, target: value } : c
                  )
                )
            }}
          >
            <option value="self">This entity</option>
            {trigger === 'contact' && (
              <option value="other">Other entity</option>
            )}
          </select>
          <select
            aria-label={`Condition ${index + 1} test`}
            value={condition.present ? 'has' : 'lacks'}
            onChange={(event) =>
              setConditions(
                conditions.map((c, i) =>
                  i === index
                    ? { ...c, present: event.target.value === 'has' }
                    : c
                )
              )
            }
          >
            <option value="has">Has property</option>
            <option value="lacks">Lacks property</option>
          </select>
          <select
            aria-label={`Condition ${index + 1} property`}
            value={condition.property}
            onChange={(event) =>
              setConditions(
                conditions.map((c, i) =>
                  i === index ? { ...c, property: event.target.value } : c
                )
              )
            }
          >
            <option value="">Choose property…</option>
            {properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.id}
              </option>
            ))}
          </select>
          <button
            aria-label={`Remove condition ${index + 1}`}
            onClick={() =>
              setConditions(conditions.filter((_, i) => i !== index))
            }
          >
            ×
          </button>
        </div>
      ))}
      <button
        className="text-button"
        onClick={() =>
          setConditions([
            ...conditions,
            {
              target: trigger === 'contact' ? 'other' : 'self',
              property: '',
              present: true,
            },
          ])
        }
      >
        Add condition
      </button>
      <div className="recipe-heading">Effects</div>
      {trigger === 'turn' ? (
        <>
          <label>
            At turn end
            <select
              aria-label="Action operation"
              value={operation}
              onChange={(event) => {
                const value = event.target.value
                if (value === 'step-forward' || value === 'destroy-self')
                  setOperation(value)
              }}
            >
              <option value="step-forward">Step forward</option>
              <option value="destroy-self">Destroy self</option>
            </select>
          </label>
          {operation === 'step-forward' && (
            <label>
              If blocked
              <select
                aria-label="If blocked"
                value={blocked}
                onChange={(event) => {
                  const value = event.target.value
                  if (value === 'wait' || value === 'reverse') setBlocked(value)
                }}
              >
                <option value="reverse">Reverse and retry</option>
                <option value="wait">Wait</option>
              </select>
            </label>
          )}
        </>
      ) : (
        <>
          {effects.map((effect, index) => (
            <div className="recipe-item" key={index}>
              <select
                aria-label={`Effect ${index + 1} kind`}
                value={effect.kind}
                onChange={(event) => {
                  const value = event.target.value
                  if (value === 'block' || value === 'destroy')
                    setEffects(
                      effects.map((e, i) =>
                        i === index
                          ? value === 'block'
                            ? { kind: 'block' }
                            : { kind: 'destroy', target: 'other' }
                          : e
                      )
                    )
                }}
              >
                <option value="destroy">Destroy</option>
                <option value="block">Block movement</option>
              </select>
              {effect.kind === 'destroy' && (
                <select
                  aria-label={`Effect ${index + 1} target`}
                  value={effect.target}
                  onChange={(event) => {
                    const value = event.target.value
                    if (value === 'self' || value === 'other')
                      setEffects(
                        effects.map((e, i) =>
                          i === index ? { kind: 'destroy', target: value } : e
                        )
                      )
                  }}
                >
                  <option value="self">This entity</option>
                  <option value="other">Other entity</option>
                </select>
              )}
              <button
                aria-label={`Remove effect ${index + 1}`}
                onClick={() =>
                  setEffects(effects.filter((_, i) => i !== index))
                }
              >
                ×
              </button>
            </div>
          ))}
          <button
            className="text-button"
            onClick={() =>
              setEffects([
                ...effects,
                {
                  kind: 'destroy',
                  target: effects.length === 0 ? 'other' : 'self',
                },
              ])
            }
          >
            Add effect
          </button>
        </>
      )}
      <button className="install-action" disabled={!valid} onClick={install}>
        Install action
      </button>
    </fieldset>
  )
}
