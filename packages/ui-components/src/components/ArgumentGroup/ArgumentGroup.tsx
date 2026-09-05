import type { ReactNode } from 'react'

export type ArgumentGroupProps = {
  title: ReactNode
  description?: ReactNode
  children: ReactNode
}

export function ArgumentGroup({
  title,
  description,
  children,
}: ArgumentGroupProps) {
  return (
    <section className="flex flex-col gap-2.5 border-chalkboard-20 border-t pt-2.5 first:border-t-0 first:pt-0 dark:border-chalkboard-80">
      <div className="flex flex-col gap-0.5">
        <h3 className="my-0 text-xs font-medium leading-tight text-chalkboard-70 dark:text-chalkboard-30">
          {title}
        </h3>
        {description && (
          <p className="my-0 text-[11px] leading-tight text-chalkboard-60 dark:text-chalkboard-40">
            {description}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-2.5">{children}</div>
    </section>
  )
}
