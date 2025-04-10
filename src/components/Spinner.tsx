import type { SVGProps } from 'react'

export const Spinner = (props: SVGProps<SVGSVGElement>) => {
  return (
    <svg
      data-testid="spinner"
      viewBox="0 0 10 10"
      className={'w-8 h-8'}
      {...props}
    >
      <circle
        cx="5"
        cy="5"
        r="4"
        stroke="var(--primary)"
        fill="none"
        strokeDasharray="4, 4"
        className="animate-spin origin-center"
      />
    </svg>
  )
}
