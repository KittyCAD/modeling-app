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
    <section className="flex flex-col gap-2 border-t border-chalkboard-20 pt-2 first:border-t-0 first:pt-0 dark:border-chalkboard-70">
      <div className="flex flex-col gap-0.5">
        <h3 className="my-0 text-[11px] font-semibold uppercase leading-tight text-chalkboard-70 dark:text-chalkboard-30">
          {title}
        </h3>
        {description && (
          <p className="my-0 text-[10px] leading-tight text-chalkboard-60 dark:text-chalkboard-40">
            {description}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-2.5">{children}</div>
    </section>
  )
}
