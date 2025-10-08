import * as z from 'zod'
import { customIconMapKey } from '@src/components/CustomIcon'
import { areaTypeKey } from '@src/lib/layout/areaTypeRegistry'
import { actionRegistryKey } from '@src/lib/layout/actionTypeRegistry'

const IdAndLabelSchema = z.object({
  id: z.uuid(),
  label: z.string(),
})

export type Direction = 'horizontal' | 'vertical'
const OrientationSchema = z.enum(['inline', 'block'])
export type Orientation = z.infer<typeof OrientationSchema>
const StartEndSchema = z.enum(['start', 'end'])
export type StartEnd = z.infer<typeof StartEndSchema>
const SideSchema = z.templateLiteral([OrientationSchema, '-', StartEndSchema])
export type Side = z.infer<typeof SideSchema>

type ExplicitZodChildren = z.ZodArray<
  z.ZodLazy<
    z.ZodDiscriminatedUnion<
      [
        typeof SimpleSchema,
        typeof SplitSchema,
        typeof TabSchema,
        typeof PaneSchema,
      ]
    >
  >
>
const HasChildrenSchema = z.object({
  get children(): ExplicitZodChildren {
    return z.array(z.lazy(() => LayoutSchema))
  },
})

const SplitSchema = z
  .object({
    ...IdAndLabelSchema.shape,
    ...HasChildrenSchema.shape,
    sizes: z.array(z.number()),
    orientation: OrientationSchema,
    type: z.literal('splits'),
  })
  .refine(
    (data) => data.sizes.reduce((a: number, b: number) => a + b, 0) <= 100
  )
  .refine((data) => data.sizes.length === data.children.length)
export type SplitLayout = z.infer<typeof SplitSchema>

const TabSchema = z
  .object({
    ...IdAndLabelSchema.shape,
    ...HasChildrenSchema.shape,
    type: z.literal('tabs'),
    side: SideSchema,
    activeIndex: z.number(),
  })
  .refine(
    (data) => data.activeIndex > 0 && data.activeIndex < data.children.length
  )
export type TabLayout = z.infer<typeof TabSchema>

const IconSchema = z.enum(customIconMapKey)
const ActionSchema = z.object({
  ...IdAndLabelSchema.shape,
  icon: IconSchema,
  actionType: z.enum(actionRegistryKey),
})
export type Action = z.infer<typeof ActionSchema>

export type PaneLayout = z.infer<typeof PaneSchema>
const PaneSchema = z
  .object({
    ...IdAndLabelSchema.shape,
    ...HasChildrenSchema.shape,
    type: z.literal('panes'),
    sizes: z.array(z.number()),
    paneIcons: z.array(IconSchema),
    side: SideSchema,
    activeIndices: z.array(z.number()),
    splitOrientation: OrientationSchema,
    actions: z.optional(z.array(ActionSchema)),
    onExpandSize: z.optional(z.number()),
  })
  .refine((data) => data.activeIndices.length === data.sizes.length)
  .refine((data) => data.sizes.reduce((a, b) => a + b, 0) < 100)
  // GOTCHA: using data.children in any refinements other than the last one breaks the types due to circularity?
  .refine(
    (data) =>
      data.activeIndices.every((a) => a > 0 && a < data.children.length) &&
      data.paneIcons.length === data.children.length
  )

export interface Closeable {
  onClose: () => void
}
const SimpleSchema = z.object({
  ...IdAndLabelSchema.shape,
  type: z.literal('simple'),
  areaType: z.enum(areaTypeKey),
})
export type SimpleLayout = z.infer<typeof SimpleSchema>

const LayoutSchema = z.discriminatedUnion('type', [
  SimpleSchema,
  SplitSchema,
  TabSchema,
  PaneSchema,
])
export type Layout = z.infer<typeof LayoutSchema>

export const LayoutWithMetadataSchema = z.object({
  id: z.literal('v1'),
  layout: LayoutSchema,
})
