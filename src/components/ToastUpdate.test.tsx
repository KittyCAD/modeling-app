import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'

import { ToastUpdate } from '@src/components/ToastUpdate'

describe('ToastUpdate tests', () => {
  const testData = {
    version: '0.255.255',
    files: [
      {
        url: 'Zoo Modeling App-0.255.255-x64-mac.zip',
        sha512:
          'VJb0qlrqNr+rVx3QLATz+B28dtHw3osQb5/+UUmQUIMuF9t0i8dTKOVL/2lyJSmLJVw2/SGDB4Ud6VlTPJ6oFw==',
        size: 141277345,
      },
      {
        url: 'Zoo Modeling App-0.255.255-arm64-mac.zip',
        sha512:
          'b+ugdg7A4LhYYJaFkPRxh1RvmGGMlPJJj7inkLg9PwRtCnR9ePMlktj2VRciXF1iLh59XW4bLc4dK1dFQHMULA==',
        size: 135278259,
      },
      {
        url: 'Zoo Modeling App-0.255.255-x64-mac.dmg',
        sha512:
          'gCUqww05yj8OYwPiTq6bo5GbkpngSbXGtenmDD7+kUm0UyVK8WD3dMAfQJtGNG5HY23aHCHe9myE2W4mbZGmiQ==',
        size: 146004232,
      },
      {
        url: 'Zoo Modeling App-0.255.255-arm64-mac.dmg',
        sha512:
          'ND871ayf81F1ZT+iWVLYTc2jdf/Py6KThuxX2QFWz14ebmIbJPL07lNtxQOexOFiuk0MwRhlCy1RzOSG1b9bmw==',
        size: 140021522,
      },
    ],
    path: 'Zoo Modeling App-0.255.255-x64-mac.zip',
    sha512:
      'VJb0qlrqNr+rVx3QLATz+B28dtHw3osQb5/+UUmQUIMuF9t0i8dTKOVL/2lyJSmLJVw2/SGDB4Ud6VlTPJ6oFw==',
    releaseNotes:
      '## Some markdown release notes\n\n- This is a list item\n- This is another list item\n\n```javascript\nconsole.log("Hello, world!")\n```\n',
    releaseDate: '2024-10-09T11:57:59.133Z',
  } as const

  test('Happy path: renders the toast with good data', () => {
    const onRestart = vi.fn()
    const onDismiss = vi.fn()

    render(
      <ToastUpdate
        onRestart={onRestart}
        onDismiss={onDismiss}
        version={testData.version}
        releaseNotes={testData.releaseNotes}
      />
    )

    // Locators and other constants
    const versionText = screen.getByTestId('update-version')
    const restartButton = screen.getByRole('button', { name: /restart/i })
    const dismissButton = screen.getByRole('button', { name: /got it/i })
    const releaseNotes = screen.getByTestId('release-notes')

    expect(versionText).toBeVisible()
    expect(versionText).toHaveTextContent(testData.version)

    expect(restartButton).toBeEnabled()
    fireEvent.click(restartButton)
    expect(onRestart.mock.calls).toHaveLength(1)

    expect(dismissButton).toBeEnabled()
    fireEvent.click(dismissButton)
    expect(onDismiss.mock.calls).toHaveLength(1)

    // I cannot for the life of me seem to get @testing-library/react
    // to properly handle click events or visibility checks on the details element.
    // So I'm only checking that the content is in the document.
    expect(releaseNotes).toBeInTheDocument()
    expect(releaseNotes).toHaveTextContent('Release notes')
    const releaseNotesListItems = screen.getAllByRole('listitem')
    expect(releaseNotesListItems.map((el) => el.textContent)).toEqual([
      'This is a list item',
      'This is another list item',
    ])
  })

  test('Happy path: renders the breaking changes notice', () => {
    const releaseNotesWithBreakingChanges = `
## Some markdown release notes
- This is a list item
- This is another list item with a breaking change
- This is a list item
`
    const onRestart = vi.fn()
    const onDismiss = vi.fn()

    render(
      <ToastUpdate
        onRestart={onRestart}
        onDismiss={onDismiss}
        version={testData.version}
        releaseNotes={releaseNotesWithBreakingChanges}
      />
    )

    // Locators and other constants
    const releaseNotes = screen.getByText('Release notes', {
      selector: 'summary',
    })
    const listItemContents = screen
      .getAllByRole('listitem')
      .map((el) => el.textContent)

    // I cannot for the life of me seem to get @testing-library/react
    // to properly handle click events or visibility checks on the details element.
    // So I'm only checking that the content is in the document.
    expect(releaseNotes).toBeInTheDocument()
    expect(listItemContents).toEqual([
      'This is a list item',
      'This is another list item with a breaking change',
      'This is a list item',
    ])
  })

  test('Missing release notes: renders the toast without release notes', () => {
    const onRestart = vi.fn()
    const onDismiss = vi.fn()

    render(
      <ToastUpdate
        onRestart={onRestart}
        onDismiss={onDismiss}
        version={testData.version}
        releaseNotes={''}
      />
    )

    // Locators and other constants
    const versionText = screen.getByTestId('update-version')
    const restartButton = screen.getByRole('button', { name: /restart/i })
    const dismissButton = screen.getByRole('button', { name: /got it/i })
    const releaseNotes = screen.queryByText(/release notes/i, {
      selector: 'details > summary',
    })
    const releaseNotesListItem = screen.queryByRole('listitem', {
      name: /this is a list item/i,
    })

    expect(versionText).toBeVisible()
    expect(versionText).toHaveTextContent(testData.version)
    expect(releaseNotes).not.toBeInTheDocument()
    expect(releaseNotesListItem).not.toBeInTheDocument()
    expect(restartButton).toBeEnabled()
    expect(dismissButton).toBeEnabled()
  })

  test('Happy path: external links render correctly', () => {
    const releaseNotesWithBreakingChanges = `
## Some markdown release notes
- [Zoo](https://zoo.dev/)
`
    const onRestart = vi.fn()
    const onDismiss = vi.fn()

    render(
      <ToastUpdate
        onRestart={onRestart}
        onDismiss={onDismiss}
        version={testData.version}
        releaseNotes={releaseNotesWithBreakingChanges}
      />
    )

    // Locators and other constants
    const zooDev = screen.getByText('Zoo', {
      selector: 'a',
    })

    expect(zooDev).toHaveAttribute('href', 'https://zoo.dev/')
    expect(zooDev).toHaveAttribute('target', '_blank')
    expect(zooDev).toHaveAttribute('onClick')
  })
})
