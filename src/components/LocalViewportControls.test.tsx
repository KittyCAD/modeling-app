import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it } from 'vitest'
import { LocalViewportControls } from '@src/components/LocalViewportControls'
import { DEFAULT_LOCAL_VIEWPORT_OPTIONS } from '@src/clientSideScene/localRenderer/viewportOptions'

afterEach(cleanup)

function Controls() {
  const [options, setOptions] = useState(DEFAULT_LOCAL_VIEWPORT_OPTIONS)
  const [edges, setEdges] = useState(true)
  const [ao, setAO] = useState(true)
  return (
    <LocalViewportControls
      options={options}
      onChange={setOptions}
      showEdges={edges}
      onShowEdgesChange={setEdges}
      enableSSAO={ao}
      onEnableSSAOChange={setAO}
    />
  )
}

it('keeps the panel open while changing visibility and restores the complete viewport', () => {
  render(<Controls />)
  fireEvent.click(screen.getByRole('button', { name: 'Viewport' }))
  expect(screen.getByRole('combobox', { name: 'Section Plane' })).toBeDisabled()
  expect(
    screen.getByRole('slider', { name: 'Section Position' })
  ).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Section View' }))
  fireEvent.change(screen.getByRole('combobox', { name: 'Section Plane' }), {
    target: { value: 'XZ' },
  })
  fireEvent.change(screen.getByRole('slider', { name: 'Section Position' }), {
    target: { value: '75' },
  })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Reverse Section' }))
  expect(screen.getByRole('combobox', { name: 'Section Plane' })).toHaveValue(
    'XZ'
  )
  expect(screen.getByRole('slider', { name: 'Section Position' })).toHaveValue(
    '75'
  )
  expect(
    screen.getByRole('checkbox', { name: 'Reverse Section' })
  ).toBeChecked()
  expect(
    screen.getByRole('combobox', { name: 'Render Resolution' })
  ).toHaveValue('1.5')
  fireEvent.change(
    screen.getByRole('combobox', { name: 'Render Resolution' }),
    { target: { value: '2' } }
  )
  fireEvent.change(screen.getByRole('slider', { name: 'Brightness' }), {
    target: { value: '150' },
  })
  fireEvent.change(screen.getByRole('slider', { name: 'Color Contrast' }), {
    target: { value: '80' },
  })
  fireEvent.click(screen.getByRole('checkbox', { name: 'B-rep Bodies' }))
  expect(screen.getByRole('checkbox', { name: 'Body Edges' })).toBeDisabled()
  expect(
    screen.getByRole('checkbox', { name: 'Sketches and Curves' })
  ).toBeChecked()
  fireEvent.change(screen.getByRole('combobox', { name: 'Shading' }), {
    target: { value: 'wireframe' },
  })
  expect(
    screen.getByRole('checkbox', { name: 'Ambient Occlusion' })
  ).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Reset Viewport' }))
  expect(
    screen.getByRole('checkbox', { name: 'Section View' })
  ).not.toBeChecked()
  expect(
    screen.getByRole('checkbox', { name: 'Reverse Section' })
  ).not.toBeChecked()
  expect(screen.getByRole('combobox', { name: 'Section Plane' })).toHaveValue(
    'XY'
  )
  expect(screen.getByRole('combobox', { name: 'Section Plane' })).toBeDisabled()
  expect(screen.getByRole('slider', { name: 'Section Position' })).toHaveValue(
    '50'
  )
  expect(screen.getByRole('checkbox', { name: 'B-rep Bodies' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'Body Edges' })).toBeEnabled()
  expect(
    screen.getByRole('checkbox', { name: 'Ambient Occlusion' })
  ).toBeEnabled()
  expect(screen.getByRole('combobox', { name: 'Shading' })).toHaveValue(
    'shaded'
  )
  expect(
    screen.getByRole('combobox', { name: 'Render Resolution' })
  ).toHaveValue('1.5')
  expect(screen.getByRole('slider', { name: 'Brightness' })).toHaveValue('100')
  expect(screen.getByRole('slider', { name: 'Color Contrast' })).toHaveValue(
    '100'
  )
})
