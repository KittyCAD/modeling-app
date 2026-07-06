import type { MlCopilotMode } from '@kittycad/lib/dist/types/src'
import type { Locator, Page } from '@playwright/test'

export class CopilotFixture {
  public page: Page

  conversationInput!: Locator
  submitButton!: Locator
  placeHolderResponse!: Locator
  thinkingView!: Locator
  cancelButton!: Locator
  clearChatButton!: Locator
  welcomeSection!: Locator
  modeButton!: Locator

  constructor(page: Page) {
    this.page = page

    this.conversationInput = this.page.getByTestId(
      'ml-ephant-conversation-input'
    )
    this.submitButton = this.page.getByTestId(
      'ml-ephant-conversation-input-button'
    )
    this.placeHolderResponse = this.page.getByTestId(
      'ml-response-chat-bubble-thinking'
    )
    this.thinkingView = this.page.getByTestId('ml-response-thinking-view')
    this.cancelButton = this.page.getByTestId(
      'ml-ephant-conversation-cancel-button'
    )
    this.clearChatButton = this.page.getByRole('button', { name: 'Clear chat' })
    this.welcomeSection = this.page.getByTestId(
      'ml-ephant-conversation-welcome-section'
    )

    this.modeButton = this.page.getByTestId('ml-copilot-efforts-button')
  }

  async setMode(mode: MlCopilotMode) {
    await this.modeButton.click()
    const modeOption = this.page.getByTestId(`ml-copilot-effort-button-${mode}`)
    await modeOption.click()
  }
}
