import { joinOSPaths } from '@src/lib/paths'

const IMAGES_FOLDER = 'zoo_images'
const CONTENT_FILE = 'content.json'
const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'svg',
  'webp',
])

interface ImageEntry {
  path: string
}

interface ImageContent {
  images: ImageEntry[]
}

export class ImageManager {
  private readonly projectPath: string

  constructor(projectPath: string) {
    this.projectPath = projectPath
  }

  private get imagesFolderPath(): string {
    return joinOSPaths(this.projectPath, IMAGES_FOLDER)
  }

  private get contentFilePath(): string {
    return joinOSPaths(this.imagesFolderPath, CONTENT_FILE)
  }

  static isSupportedImageFile(file: File): boolean {
    const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
    return SUPPORTED_IMAGE_EXTENSIONS.has(extension)
  }

  async ensureImagesFolderExists(): Promise<void> {
    if (!window.electron) return
    await window.electron.mkdir(this.imagesFolderPath, { recursive: true })
  }

  async readContentFile(): Promise<ImageContent> {
    if (!window.electron) return { images: [] }

    try {
      const content = await window.electron.readFile(
        this.contentFilePath,
        'utf-8'
      )
      return JSON.parse(content) as ImageContent
    } catch {
      return { images: [] }
    }
  }

  async writeContentFile(content: ImageContent): Promise<void> {
    if (!window.electron) return
    const jsonString = JSON.stringify(content, null, 2)
    await window.electron.writeFile(this.contentFilePath, jsonString)
  }

  async addImage(file: File): Promise<void> {
    if (!window.electron) return

    await this.ensureImagesFolderExists()

    const arrayBuffer = await file.arrayBuffer()
    const destinationPath = joinOSPaths(this.imagesFolderPath, file.name)
    await window.electron.writeFile(
      destinationPath,
      new Uint8Array(arrayBuffer)
    )

    // add to JSON
    const content = await this.readContentFile()
    const existingIndex = content.images.findIndex(
      (img) => img.path === file.name
    )
    if (existingIndex === -1) {
      content.images.push({ path: file.name })
      await this.writeContentFile(content)
    }
  }
}
