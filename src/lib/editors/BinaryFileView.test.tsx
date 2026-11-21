import { signal } from '@preact/signals-core'
import { BinaryFileView } from '@src/lib/editors/BinaryFileView'
import { createEditorBacking } from '@src/lib/editors/backing'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('@src/lib/fs-zds', async () => ({
  default: (await import('node:path')).posix,
}))
afterEach(cleanup)
it('shows file identity and a read-only hex and ASCII preview of the original bytes', () => {
  const src = signal('/project/parts/body.bin')
  const backing = createEditorBacking({
    type: 'binary',
    bytes: new Uint8Array([0, 65, 255, 126]),
  })
  render(<BinaryFileView editor={{ src, backing }} />)
  expect(screen.getByRole('heading', { name: 'body.bin' })).toBeInTheDocument()
  expect(screen.getByText('4 bytes', { selector: 'dd' })).toBeInTheDocument()
  expect(screen.getByText('.bin')).toBeInTheDocument()
  expect(screen.getByText('/project/parts/body.bin')).toBeInTheDocument()
  expect(
    screen.getByRole('table', { name: 'File header bytes' })
  ).toBeInTheDocument()
  expect(screen.getByText('00 41 ff 7e')).toBeInTheDocument()
  expect(screen.getByText('.A.~')).toBeInTheDocument()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  act(() => {
    src.value = '/project/renamed.data'
  })
  expect(
    screen.getByRole('heading', { name: 'renamed.data' })
  ).toBeInTheDocument()
  expect(screen.getByText('.data')).toBeInTheDocument()
  expect(screen.getByText('/project/renamed.data')).toBeInTheDocument()
})
it('shows the full size but reads only the first 64 bytes for a larger file', () => {
  const backing = createEditorBacking({
    type: 'binary',
    bytes: new Uint8Array(1536),
  })
  if (backing.type !== 'binary') return expect.fail('Expected binary data')
  const readBytes = vi.spyOn(backing, 'readBytes')
  render(
    <BinaryFileView editor={{ src: signal('/project/large.stl'), backing }} />
  )
  expect(screen.getByText('1.5 KiB')).toBeInTheDocument()
  expect(screen.getByText('(1,536 bytes)')).toBeInTheDocument()
  expect(screen.getByText('First 64 of 1,536 bytes')).toBeInTheDocument()
  expect(readBytes).toHaveBeenCalledExactlyOnceWith(0, 64)
  expect(screen.getAllByRole('row')).toHaveLength(5)
  expect(screen.queryByText('00000040')).not.toBeInTheDocument()
})
it('shows an empty extensionless file without an empty byte table', () => {
  const backing = createEditorBacking({
    type: 'binary',
    bytes: new Uint8Array(),
  })
  render(
    <BinaryFileView editor={{ src: signal('/project/LICENSE'), backing }} />
  )
  expect(screen.getByRole('heading', { name: 'LICENSE' })).toBeInTheDocument()
  expect(screen.getByText('None')).toBeInTheDocument()
  expect(screen.getByText('0 bytes', { selector: 'dd' })).toBeInTheDocument()
  expect(screen.getByText('Empty file')).toBeInTheDocument()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
})
