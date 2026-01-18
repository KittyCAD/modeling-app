import {
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Texture,
} from 'three'
import type {
  ImageManager,
  ImageEntry,
} from '@src/clientSideScene/image/ImageManager'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'

const IMAGE_RENDERER_GROUP = 'ImageRendererGroup'

type ImageMesh = Mesh<PlaneGeometry, MeshBasicMaterial>

export class ImageRenderer {
  private readonly imageManager: ImageManager
  private readonly sceneInfra: SceneInfra

  private readonly group: Group
  private readonly geometry: PlaneGeometry
  private readonly loadedTextures: Map<string, Texture> = new Map()
  private readonly meshes: Map<string, ImageMesh> = new Map()

  constructor(imageManager: ImageManager, sceneInfra: SceneInfra) {
    this.imageManager = imageManager
    this.sceneInfra = sceneInfra

    this.group = new Group()
    this.group.name = IMAGE_RENDERER_GROUP
    this.sceneInfra.scene.add(this.group)
    this.geometry = new PlaneGeometry()

    imageManager.imagesChanged.subscribe(this.onImagesChanged)
    this.onImagesChanged()
  }

  private readonly onImagesChanged = () => {
    void this.updateImages()
  }

  private readonly updateImages = async () => {
    const images = await this.imageManager.getImages()

    for (const image of images) {
      let mesh = this.meshes.get(image.path)
      if (!mesh) {
        mesh = await this.addImageMesh(image)
        if (mesh) {
          this.meshes.set(image.path, mesh)
          this.group.add(mesh)
        }
      }
      if (mesh) {
        mesh.visible = image.visible
        mesh.scale.set(image.width, image.height, 1)
        mesh.position.set(image.x, image.y, 0)
      }
    }

    const unusedMeshes = Array.from(this.meshes)
      .filter(([path]) => !images.some((image) => image.path === path))
      .map(([_path, mesh]) => mesh)
    this.disposeMeshes(unusedMeshes)
  }

  async render(): Promise<void> {
    const images = await this.imageManager.getImages()
    const visibleImages = images.filter((img) => img.visible !== false)

    // Remove meshes for images that are no longer visible
    for (const [path, mesh] of this.meshes) {
      if (!visibleImages.find((img) => img.path === path)) {
        this.group.remove(mesh)
        mesh.geometry.dispose()
        if (mesh.material instanceof MeshBasicMaterial) {
          mesh.material.dispose()
        }
        this.meshes.delete(path)
      }
    }

    // Add or update meshes for visible images
    for (const image of visibleImages) {
      if (!this.meshes.has(image.path)) {
        await this.addImageMesh(image)
      }
    }
  }

  private async addImageMesh(
    image: ImageEntry
  ): Promise<ImageMesh | undefined> {
    const fullPath = await this.imageManager.getImageFullPath(image.path)

    try {
      let texture = this.loadedTextures.get(image.path)
      if (!texture) {
        texture = await this.loadTexture(fullPath)
        this.loadedTextures.set(image.path, texture)
      }

      const material = new MeshBasicMaterial({
        map: texture,
        transparent: true,
      })

      const mesh = new Mesh(this.geometry, material)
      mesh.name = `ReferenceImage_${image.path}`
      mesh.scale.set(image.width, image.height, 1)
      mesh.position.set(image.x, image.y, -0.1)

      return mesh
    } catch (error) {
      console.error(`Failed to load image: ${image.path}`, error)
      return undefined
    }
  }

  private async loadTexture(path: string): Promise<Texture> {
    if (!window.electron) {
      return Promise.reject(new Error('Electron API not available'))
    }

    // Read the file as binary data and create a Blob URL
    const imageData = await window.electron.readFile(path)
    const extension = path.split('.').pop()?.toLowerCase() ?? 'png'
    const mimeType = getMimeType(extension)
    const blob = new Blob([new Uint8Array(imageData)], { type: mimeType })
    const blobUrl = URL.createObjectURL(blob)

    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        const texture = new Texture(img)
        texture.needsUpdate = true
        URL.revokeObjectURL(blobUrl)
        resolve(texture)
      }
      img.onerror = () => {
        URL.revokeObjectURL(blobUrl)
        reject(new Error(`Failed to load image: ${path}`))
      }
      img.src = blobUrl
    })
  }

  setImageVisibility(imagePath: string, visible: boolean): void {
    const mesh = this.meshes.get(imagePath)
    if (mesh) {
      mesh.visible = visible
    }
  }

  private disposeMeshes(meshes: ImageMesh[]): void {
    for (const mesh of meshes) {
      this.group.remove(mesh)
      mesh.material.dispose()
    }
    this.meshes.clear()

    this.sceneInfra.scene.remove(this.group)
  }

  public dispose() {
    this.disposeMeshes(Array.from(this.meshes.values()))
    for (const [, texture] of this.loadedTextures) {
      texture.dispose()
    }
    this.loadedTextures.clear()
    this.sceneInfra.scene.remove(this.group)
    this.geometry.dispose()
  }
}


  function getMimeType(extension: string): string {
    const mimeTypes: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      svg: 'image/svg+xml',
      webp: 'image/webp',
    }
    return mimeTypes[extension] ?? 'image/png'
  }