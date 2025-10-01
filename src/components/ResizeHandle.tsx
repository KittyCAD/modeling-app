import type { HTMLProps } from 'react'
import { CustomIcon } from '@src/components/CustomIcon'
import { Alignment } from '@src/components/ModelingSidebar/types'

export function ResizeHandle(
  props: HTMLProps<HTMLDivElement> & { alignment?: Alignment }
) {
  const oppositeAlignment =
    props.alignment === Alignment.Left ? Alignment.Right : Alignment.Left
  return (
    <div
      {...props}
      className={'group/grip absolute inset-0 ' + props.className}
    >
      <div
        className={`hidden group-hover/grip:block absolute bg-chalkboard-30 dark:bg-chalkboard-70 w-[1px] h-auto top-0 bottom-0`}
        style={{
          // Tailwind did not like trying to do computed class names here, so I've inlined the styles
          [oppositeAlignment]: 'auto',
          [props.alignment]: '50%',
        }}
      />
      <div
        className={`hidden group-hover/grip:block py-1 absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 rounded-sm w-fit group-hover/grip:bg-chalkboard-30 group-hover/grip:dark:bg-chalkboard-70 bg-transparent transition-colors border border-transparent group-hover/grip:border-chalkboard-40 dark:group-hover/grip:border-chalkboard-90 duration-75 transition-ease-out delay-100`}
      >
        <CustomIcon className="w-5 -mx-0.5 rotate-90" name="sixDots" />
      </div>
    </div>
  )
}
