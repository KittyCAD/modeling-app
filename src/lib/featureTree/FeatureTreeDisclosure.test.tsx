import { Disclosure } from '@headlessui/react'
import {
  FeatureTreeDisclosure,
  FeatureTreeExpansionProvider,
} from '@src/lib/featureTree/FeatureTreeDisclosure'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

function Tree({
  bodyId = 'body',
  showBody = true,
  filePath = 'part.kcl',
}: {
  bodyId?: string
  showBody?: boolean
  filePath?: string
}) {
  return (
    <FeatureTreeExpansionProvider filePath={filePath}>
      <FeatureTreeDisclosure expansionKey="part">
        <Disclosure.Button>Part</Disclosure.Button>
        <Disclosure.Panel>
          {showBody && (
            <FeatureTreeDisclosure key={bodyId} expansionKey="part/body-0">
              <Disclosure.Button>Body 1</Disclosure.Button>
              <Disclosure.Panel>
                <FeatureTreeDisclosure expansionKey="part/body-0/sketch">
                  <Disclosure.Button>Sketch</Disclosure.Button>
                  <Disclosure.Panel>Sketch features</Disclosure.Panel>
                </FeatureTreeDisclosure>
              </Disclosure.Panel>
            </FeatureTreeDisclosure>
          )}
        </Disclosure.Panel>
      </FeatureTreeDisclosure>
    </FeatureTreeExpansionProvider>
  )
}

function toggle(name: string) {
  fireEvent.click(screen.getByRole('button', { name }))
}

describe('Feature Tree expansion', () => {
  it('starts imported parts, bodies and sketch groups collapsed and expands each independently', () => {
    render(<Tree />)
    expect(screen.getByRole('button', { name: 'Part' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    expect(
      screen.queryByRole('button', { name: 'Body 1' })
    ).not.toBeInTheDocument()
    toggle('Part')
    expect(screen.getByRole('button', { name: 'Body 1' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    toggle('Body 1')
    expect(screen.getByRole('button', { name: 'Sketch' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    toggle('Sketch')
    expect(screen.getByText('Sketch features')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Part' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
  })

  it('restores expanded bodies and features after sketch execution removes and recreates the body', () => {
    const view = render(<Tree />)
    toggle('Part')
    toggle('Body 1')
    toggle('Sketch')
    view.rerender(<Tree showBody={false} />)
    view.rerender(<Tree bodyId="rebuilt-body" />)
    expect(screen.getByText('Sketch features')).toBeVisible()
  })

  it('remembers explicit collapsed choices when the parent is reopened', () => {
    render(<Tree />)
    toggle('Part')
    toggle('Body 1')
    toggle('Sketch')
    toggle('Sketch')
    toggle('Part')
    toggle('Part')
    expect(screen.getByRole('button', { name: 'Body 1' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    expect(screen.getByRole('button', { name: 'Sketch' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
  })

  it('starts collapsed when switching files', () => {
    const view = render(<Tree />)
    toggle('Part')
    toggle('Body 1')
    view.rerender(<Tree filePath="assembly.kcl" />)
    expect(screen.getByRole('button', { name: 'Part' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    expect(
      screen.queryByRole('button', { name: 'Body 1' })
    ).not.toBeInTheDocument()
  })
})
