import { useState } from 'react'
import type { ActionRecipe, ContactEffect, PropertyCondition } from './actions'
import type { PropertyDefinition } from './game'
import { Select, replaceAt } from './ui'

const targets = [
  ['self', 'This entity'],
  ['other', 'Other entity'],
] as const

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
      <Select
        label="Trigger"
        aria-label="Action trigger"
        value={trigger}
        options={[
          ['turn', 'At turn end'],
          ['contact', 'Attempted contact'],
        ]}
        onChange={(value) => {
          setTrigger(value)
          setConditions([])
        }}
      />
      {trigger === 'contact' && (
        <p className="field-hint">
          Runs for either participant before blocking or pushing. “This entity”
          is the entity carrying this action.
        </p>
      )}
      <div className="recipe-heading">Conditions (all must match)</div>
      {conditions.map((condition, index) => (
        <div className="recipe-item" key={index}>
          <Select
            aria-label={`Condition ${index + 1} target`}
            value={condition.target}
            options={trigger === 'contact' ? targets : targets.slice(0, 1)}
            onChange={(target) =>
              setConditions(
                replaceAt(conditions, index, { ...condition, target })
              )
            }
          />
          <Select
            aria-label={`Condition ${index + 1} test`}
            value={condition.present ? 'has' : 'lacks'}
            options={[
              ['has', 'Has property'],
              ['lacks', 'Lacks property'],
            ]}
            onChange={(test) =>
              setConditions(
                replaceAt(conditions, index, {
                  ...condition,
                  present: test === 'has',
                })
              )
            }
          />
          <Select
            aria-label={`Condition ${index + 1} property`}
            value={condition.property}
            options={[
              ['', 'Choose property…'],
              ...properties.map(
                (property) => [property.id, property.id] as const
              ),
            ]}
            onChange={(property) =>
              setConditions(
                replaceAt(conditions, index, { ...condition, property })
              )
            }
          />
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
          <Select
            label="At turn end"
            aria-label="Action operation"
            value={operation}
            options={[
              ['step-forward', 'Step forward'],
              ['destroy-self', 'Destroy self'],
            ]}
            onChange={(value) => setOperation(value)}
          />
          {operation === 'step-forward' && (
            <Select
              label="If blocked"
              value={blocked}
              options={[
                ['reverse', 'Reverse and retry'],
                ['wait', 'Wait'],
              ]}
              onChange={(value) => setBlocked(value)}
            />
          )}
        </>
      ) : (
        <>
          {effects.map((effect, index) => (
            <div className="recipe-item" key={index}>
              <Select
                aria-label={`Effect ${index + 1} kind`}
                value={effect.kind}
                options={[
                  ['destroy', 'Destroy'],
                  ['block', 'Block movement'],
                ]}
                onChange={(kind) =>
                  setEffects(
                    replaceAt(
                      effects,
                      index,
                      kind === 'block' ? { kind } : { kind, target: 'other' }
                    )
                  )
                }
              />
              {effect.kind === 'destroy' && (
                <Select
                  aria-label={`Effect ${index + 1} target`}
                  value={effect.target}
                  options={targets}
                  onChange={(target) =>
                    setEffects(
                      replaceAt(effects, index, { kind: 'destroy', target })
                    )
                  }
                />
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
