import { fireEvent, render, screen, within } from '@testing-library/react'
import { ZookeeperImagePreview } from '@src/lib/zookeeper/components/ZookeeperImagePreview'
import { expect, test } from 'vitest'

test('opens the original image in a dismissible viewer and downloads with its filename', () => {
  const name = 'Bracket front view (2).png'
  render(<ZookeeperImagePreview url="blob:reference" name={name} />)
  fireEvent.click(screen.getByRole('button', { name: `View ${name}` }))
  const viewer = screen.getByRole('dialog', { name })
  expect(within(viewer).getByRole('img', { name })).toHaveAttribute(
    'src',
    'blob:reference'
  )
  expect(
    within(viewer).getByRole('link', { name: `Download ${name}` })
  ).toHaveAttribute('download', name)
  fireEvent.click(within(viewer).getByRole('button', { name: 'Close' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('keeps a named download available when the preview cannot be decoded', () => {
  render(<ZookeeperImagePreview url="blob:bad-image" name="drawing.png" />)
  fireEvent.error(screen.getByRole('img', { name: 'drawing.png' }))
  expect(screen.getByText('Image preview unavailable')).toBeInTheDocument()
  expect(
    screen.getByRole('link', { name: 'Download drawing.png' })
  ).toHaveAttribute('download', 'drawing.png')
})
