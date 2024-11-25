import type { Page, Locator } from '@playwright/test'
import { expect } from '@playwright/test'

interface ProjectCardState {
  title: string
  fileCount: number
  folderCount: number
}

interface HomePageState {
  projectCards: ProjectCardState[]
  sortBy: 'last-modified-desc' | 'last-modified-asc' | 'name-asc' | 'name-desc'
}

export class HomePageFixture {
  public page: Page

  projectCard!: Locator
  projectCardTitle!: Locator
  projectCardFile!: Locator
  projectCardFolder!: Locator
  sortByDateBtn!: Locator
  sortByNameBtn!: Locator

  constructor(page: Page) {
    this.page = page
    this.reConstruct(page)
  }
  reConstruct = (page: Page) => {
    this.page = page

    this.projectCard = this.page.getByTestId('project-link')
    this.projectCardTitle = this.page.getByTestId('project-title')
    this.projectCardFile = this.page.getByTestId('project-file-count')
    this.projectCardFolder = this.page.getByTestId('project-folder-count')

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
      const [title, fileCount, folderCount] = await Promise.all([
        (await projectCard.locator(this.projectCardTitle).textContent()) || '',
        Number(await projectCard.locator(this.projectCardFile).textContent()),
        Number(await projectCard.locator(this.projectCardFolder).textContent()),
      ])
      projectCardStates.push({
        title: title,
        fileCount,
        folderCount,
      })
    }
    return projectCardStates
  }

  /**
   * Date is excluded from expectState, since it changes
   * Maybe there a good sanity check we can do each time?
   */
  expectState = async (expectedState: HomePageState) => {
    await expect
      .poll(async () => {
        const [projectCards, sortBy] = await Promise.all([
          this._serialiseProjectCards(),
          this._serialiseSortBy(),
        ])
        return {
          projectCards,
          sortBy,
        }
      })
      .toEqual(expectedState)
  }

  openProject = async (projectTitle: string) => {
    const projectCard = this.projectCard.locator(
      this.page.getByText(projectTitle)
    )
    await projectCard.click()
  }
}
