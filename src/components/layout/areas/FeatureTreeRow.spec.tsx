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

describe('a named view row', () => {
  it('shows the label, the variable and the view name', () => {
    render(
      <OperationItemWrapper
        icon="namedView"
        name="Named View"
        type="StdLibCall"
        variableName="plateOnly"
        valueDetail={stringValue('Plate only')}
        isNamedView
      />
    )

    expect(screen.getByText('Named View')).toBeTruthy()
    expect(screen.getByText('plateOnly')).toBeTruthy()
    expect(screen.getByTestId('value-detail').textContent).toBe('Plate only')
  })

  it('shows the view name when the view has no variable', () => {
    render(
      <OperationItemWrapper
        icon="namedView"
        name="Named View"
        type="StdLibCall"
        valueDetail={stringValue('Boss only')}
        isNamedView
      />
    )

    // Without this the row read `Named View` and named nothing at all.
    expect(screen.getByText('Named View')).toBeTruthy()
    expect(screen.getByTestId('value-detail').textContent).toBe('Boss only')
  })
})

describe('rows beside a named view', () => {
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

describe('the hover text of a named view row', () => {
  it('names the view and reports its variable as a declaration', () => {
    const { container } = render(
      <VariableTooltipContents
        name="Named View"
        type="StdLibCall"
        variableName="plateOnly"
        valueDetail={stringValue('Plate only')}
        isNamedView
      />
    )

    expect(container.textContent).toBe(
      'Named View "Plate only", declared as plateOnly'
    )
  })

  it('names the view alone when it has no variable', () => {
    const { container } = render(
      <VariableTooltipContents
        name="Named View"
        type="StdLibCall"
        valueDetail={stringValue('Boss only')}
        isNamedView
      />
    )

    expect(container.textContent).toBe('Named View "Boss only"')
  })

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
