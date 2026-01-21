import type { Object3D, Quaternion } from 'three'
import {
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Texture,
} from 'three'
import {
  type ImageManager,
  type ImageEntry,
  getImageFilePath,
} from '@src/clientSideScene/image/ImageManager'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { SKETCH_LAYER } from '@src/clientSideScene/sceneUtils'
import { ImageTransformHandler } from '@src/clientSideScene/image/ImageTransformHandler'
import { getEXTNoPeriod } from '@src/lib/paths'

export const IMAGE_RENDERER_GROUP = 'ImageRendererGroup'
const IMAGE_RENDER_ORDER_BASE = -1000

type ImageMesh = Mesh<PlaneGeometry, MeshBasicMaterial>

export class ImageRenderer {
  private readonly imageManager: ImageManager
  private readonly sceneInfra: SceneInfra
  public readonly transformHandler: ImageTransformHandler

  public readonly planeGeometry: PlaneGeometry
  public readonly group: Group
  private readonly loadedTextures: Map<string, Texture> = new Map()
  private readonly meshes: Map<string, ImageMesh> = new Map()

  constructor(imageManager: ImageManager, sceneInfra: SceneInfra) {
    this.imageManager = imageManager
    this.sceneInfra = sceneInfra

    this.group = new Group()
    this.group.name = IMAGE_RENDERER_GROUP
    this.group.layers.set(SKETCH_LAYER)
    this.sceneInfra.scene.add(this.group)
    this.planeGeometry = new PlaneGeometry()

    this.transformHandler = new ImageTransformHandler(imageManager, sceneInfra)

    imageManager.imagesChanged.subscribe(this.onImagesChanged)
    this.onImagesChanged()
  }

  private readonly onImagesChanged = () => {
    void this.updateImages()
  }

  private readonly updateImages = async () => {
    const images = this.imageManager.getImages()
    const imageList = images?.list || []
    if (images) {
      for (const [index, image] of imageList.entries()) {
        let mesh = this.meshes.get(image.fileName)
        if (!mesh) {
          mesh = this.createImageMesh(image, images.projectPath)
          if (mesh) {
            this.meshes.set(image.fileName, mesh)
            this.group.add(mesh)
          }
        }
        if (mesh) {
          mesh.userData.image = image
          mesh.visible = image.visible
          mesh.scale.set(image.width, image.height, 1)
          mesh.position.set(image.x, image.y, 0)
          mesh.rotation.z = image.rotation ?? 0
          mesh.renderOrder =
            IMAGE_RENDER_ORDER_BASE + (imageList.length - 1 - index)
        }
      }
    }

    const unusedMeshes = Array.from(this.meshes)
      .filter(([path]) => !imageList.some((image) => image.fileName === path))
      .map(([_path, mesh]) => mesh)
    this.disposeMeshes(unusedMeshes)
  }

  private createImageMesh(image: ImageEntry, projectPath: string): ImageMesh {
    const material = new MeshBasicMaterial({
      transparent: true,
      side: DoubleSide,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    })

    const mesh = new Mesh(this.planeGeometry, material)
    mesh.userData = {
      image,
    }
    mesh.name = `ReferenceImage_${image.fileName}`
    mesh.layers.set(SKETCH_LAYER)
    mesh.scale.set(image.width, image.height, 1)
    mesh.position.set(image.x, image.y, 0)
    mesh.rotation.z = image.rotation ?? 0

    const fullImagePath = getImageFilePath(projectPath, image.fileName)
    void this.setImageTexture(fullImagePath, image, material)

    return mesh
  }

  private async setImageTexture(
    fullImagePath: string,
    image: ImageEntry,
    material: MeshBasicMaterial
  ) {
    try {
      let texture = this.loadedTextures.get(image.fileName)
      if (!texture) {
        texture = await this.loadTexture(fullImagePath)
        this.loadedTextures.set(image.fileName, texture)
      }
      material.map = texture
      material.needsUpdate = true
    } catch (error) {
      console.error(`Failed to load image: ${image.fileName}`, error)
    }
  }

  private async loadTexture(path: string): Promise<Texture> {
    if (!window.electron) {
      return Promise.reject(new Error('Electron API not available'))
    }

    // Read the file as binary data and create a Blob URL
    const imageData = await window.electron.readFile(path)
    const extension = getEXTNoPeriod(path)?.toLowerCase() ?? 'png'
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

  setQuaternion(quaternion: Quaternion): void {
    this.group.setRotationFromQuaternion(quaternion)
  }

  private disposeMeshes(meshes: ImageMesh[]): void {
    for (const mesh of meshes) {
      this.group.remove(mesh)
      mesh.material.dispose()
      for (const [path, m] of this.meshes) {
        if (m === mesh) {
          this.meshes.delete(path)
          break
        }
      }
    }
  }

  public dispose() {
    this.sceneInfra.scene.remove(this.group)

    this.disposeMeshes(Array.from(this.meshes.values()))
    this.meshes.clear()
    for (const [, texture] of this.loadedTextures) {
      texture.dispose()
    }
    this.loadedTextures.clear()

    this.planeGeometry.dispose()
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
