import type { Locator, Page } from '@playwright/test'

export class CopilotFixture {
  public page: Page

  conversationInput!: Locator
  submitButton!: Locator
  placeHolderResponse!: Locator

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
  }
}
