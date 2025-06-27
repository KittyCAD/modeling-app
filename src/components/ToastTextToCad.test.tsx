import { render, screen } from '@testing-library/react'
import { ToastTextToCadError } from '@src/components/ToastTextToCad'

describe('ToastTextToCadError tests', () => {
  const testData = {
    errorWithMarkdown: `422 Unprocessable Entity. Text-to-CAD is still improving, and some prompts may fail. Try adjusting your prompt for better results. We review failures to enhance the model over time. For prompt tips and best practices, check out our community on [Discord](https://discord.gg/JQEpHR7Nt2) or [Discourse](https://community.zoo.dev).`,
    errorWithPlainText: "I'M A TEAPOT",
    errorWithMalformedContent: `[bad-link)(h:/ya;lk3&"& th] WHICH ## Heading? *** benches bj;lkj,,,{]<ul>((()))bhwlqq!`,
  } as const

  test('Happy path: renders markdown just fine', () => {
    render(
      <ToastTextToCadError
        toastId="test"
        newProjectName="newProject"
        projectName="currProject"
        method="whyDoWePassThisIn"
        prompt="Something complex like a tiger or a tree"
        message={testData.errorWithMarkdown}
        key="testKey"
      />
    )

    // Locators and other constants
    const editPromptButton = screen.getByRole('button', {
      name: /edit prompt/i,
    })
    const dismissButton = screen.getByRole('button', { name: /dismiss/i })
    // If an actual link is shown the renderer worked
    const errorLink = screen.getByRole('link', { name: /discourse/i })

    expect(editPromptButton).toBeVisible()
    expect(dismissButton).toBeVisible()
    expect(errorLink).toBeVisible()
  })

  test('Happy path: renders plaintext just fine', () => {
    render(
      <ToastTextToCadError
        toastId="test"
        newProjectName="newProject"
        projectName="currProject"
        method="whyDoWePassThisIn"
        prompt="Something complex like a tiger or a tree"
        message={testData.errorWithPlainText}
        key="testKey"
      />
    )

    // Locators and other constants
    const editPromptButton = screen.getByRole('button', {
      name: /edit prompt/i,
    })
    const dismissButton = screen.getByRole('button', { name: /dismiss/i })
    const errorParagraph = screen.getByText('TEAPOT', { exact: false })

    expect(editPromptButton).toBeVisible()
    expect(dismissButton).toBeVisible()
    expect(errorParagraph).toBeVisible()
  })

  test('Happy path: renders malformed text just fine', () => {
    render(
      <ToastTextToCadError
        toastId="test"
        newProjectName="newProject"
        projectName="currProject"
        method="whyDoWePassThisIn"
        prompt="Something complex like a tiger or a tree"
        message={testData.errorWithMalformedContent}
        key="testKey"
      />
    )

    // Locators and other constants
    const editPromptButton = screen.getByRole('button', {
      name: /edit prompt/i,
    })
    const dismissButton = screen.getByRole('button', { name: /dismiss/i })
    // If it renders the malformed link as a paragraph that's good
    const errorParagraph = screen.queryByText(/bad-link/, { exact: false })

    expect(editPromptButton).toBeVisible()
    expect(dismissButton).toBeVisible()
    expect(errorParagraph).toBeVisible()
  })
})
