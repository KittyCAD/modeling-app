import { MlCopilotMode } from '@kittycad/lib/dist/types/src'
import type { Locator, Page } from '@playwright/test'

export class CopilotFixture {
  public page: Page

  conversationInput!: Locator
  submitButton!: Locator
  placeHolderResponse!: Locator
  thinkingView!: Locator
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

    this.modeButton = this.page.getByTestId('ml-copilot-efforts-button')
  }

  async setMode(mode: MlCopilotMode) {
    await this.modeButton.click()
    const modeOption = this.page.getByTestId(`ml-copilot-effort-button-${mode}`)
    await modeOption.click()
  }
}
