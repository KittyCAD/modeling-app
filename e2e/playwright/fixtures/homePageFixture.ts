import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'

interface ProjectCardState {
  title: string
  fileCount: number
}

interface HomePageState {
  projectCards: ProjectCardState[]
  sortBy: 'last-modified-desc' | 'last-modified-asc' | 'name-asc' | 'name-desc'
}

export class HomePageFixture {
  public page: Page

  projectSection!: Locator
  projectCard!: Locator
  projectCardTitle!: Locator
  projectCardFile!: Locator
  projectCardFolder!: Locator
  projectButtonNew!: Locator
  projectButtonContinue!: Locator
  projectTextName!: Locator
  sortByDateBtn!: Locator
  sortByNameBtn!: Locator

  constructor(page: Page) {
    this.page = page

    this.projectSection = this.page.getByTestId('home-section')

    this.projectCard = this.page.getByTestId('project-link')
    this.projectCardTitle = this.page.getByTestId('project-title')
    this.projectCardFile = this.page.getByTestId('project-file-count')
    this.projectCardFolder = this.page.getByTestId('project-folder-count')

    this.projectButtonNew = this.page.getByTestId('home-new-file')
    this.projectTextName = this.page.getByTestId('cmd-bar-arg-value')
    this.projectButtonContinue = this.page.getByRole('button', {
      name: 'Continue',
    })

    this.sortByDateBtn = this.page.getByTestId('home-sort-by-modified')
    this.sortByNameBtn = this.page.getByTestId('home-sort-by-name')
  }

  private _serialiseSortBy = async (): Promise<
    HomePageState['sortBy'] | null
  > => {
    const [dateBtnDesc, dateBtnAsc, nameBtnDesc, nameBtnAsc] =
      await Promise.all([
        this.sortByDateBtn.getByLabel('arrow down').isVisible(),
        this.sortByDateBtn.getByLabel('arrow up').isVisible(),
        this.sortByNameBtn.getByLabel('arrow down').isVisible(),
        this.sortByNameBtn.getByLabel('arrow up').isVisible(),
      ])
    if (dateBtnDesc) return 'last-modified-desc'
    if (dateBtnAsc) return 'last-modified-asc'
    if (nameBtnDesc) return 'name-desc'
    if (nameBtnAsc) return 'name-asc'
    return null
  }

  private _serialiseProjectCards = async (): Promise<
    Array<ProjectCardState>
  > => {
    const projectCards = await this.projectCard.all()
    const projectCardStates: Array<ProjectCardState> = []
    for (const projectCard of projectCards) {
      const [title, fileCount] = await Promise.all([
        (await projectCard.locator(this.projectCardTitle).textContent()) || '',
        Number(await projectCard.locator(this.projectCardFile).textContent()),
      ])
      projectCardStates.push({
        title: title,
        fileCount,
      })
    }
    return projectCardStates
  }

  /**
   * Date is excluded from expectState, since it changes
   * Maybe there a good sanity check we can do each time?
   */
  expectState = async (expectedState: HomePageState) => {
    await expect.poll(this._serialiseSortBy).toEqual(expectedState.sortBy)

    for (const projectCard of expectedState.projectCards) {
      await expect.poll(this._serialiseProjectCards).toContainEqual(projectCard)
    }
  }

  projectsLoaded = async () => {
    await expect(this.projectSection).not.toHaveText('Loading your Projects...')
  }

  createAndGoToProject = async (projectTitle = 'untitled') => {
    await this.projectsLoaded()
    await this.projectButtonNew.click()
    await this.projectTextName.click()
    await this.projectTextName.fill(projectTitle)
    await this.projectButtonContinue.click()
  }

  openProject = async (projectTitle: string) => {
    const projectCard = this.projectCard.locator(
      this.page.getByText(projectTitle)
    )
    await projectCard.click()
  }

  goToModelingScene = async (name: string = 'testDefault') => {
    // On web this is a no-op. There is no project view.
    if (process.env.PLATFORM === 'web') return

    await this.createAndGoToProject(name)
  }
}
