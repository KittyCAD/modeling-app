import {
  OperationItemWrapper,
  VariableTooltipContents,
} from '@src/components/layout/areas/FeatureTreePane'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

/** The recorded value a row shows after its variable name. */
function stringValue(value: string) {
  return {
    calculated: { type: 'String' as const, value },
    display: `"${value}"`,
  }
}

describe('operation rows', () => {
  it('leaves a bound datum as it was', () => {
    render(
      <OperationItemWrapper
        icon="gdtDatum"
        name="Datum"
        type="StdLibCall"
        variableName="d1"
        valueDetail={stringValue('A')}
      />
    )

    expect(screen.getByText('Datum')).toBeTruthy()
    expect(screen.getByText('d1')).toBeTruthy()
    expect(screen.getByTestId('value-detail').textContent).toBe('A')
  })

  it('leaves an operation with no recorded value as it was', () => {
    render(
      <OperationItemWrapper
        icon="extrude"
        name="Extrude"
        type="StdLibCall"
        variableName="plate"
      />
    )

    expect(screen.getByText('plate')).toBeTruthy()
    expect(screen.queryByText('Extrude')).toBeNull()
    expect(screen.queryByTestId('value-detail')).toBeNull()
  })
})

describe('operation hover text', () => {
  it('leaves a parameter hover as it was', () => {
    const { container } = render(
      <VariableTooltipContents
        name="Parameter"
        type="VariableDeclaration"
        variableName="x"
        valueDetail={{
          calculated: { type: 'String', value: '5' },
          display: '5',
        }}
      />
    )

    expect(container.textContent).toContain('Parameter named x')
  })
})
