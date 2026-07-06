import { TRIM_PREVIEW_LINE_WIDTH_PX } from '@src/lib/constants'

export const getTrimPreviewLineWidth = (pixelRatio: number) =>
  TRIM_PREVIEW_LINE_WIDTH_PX * pixelRatio
