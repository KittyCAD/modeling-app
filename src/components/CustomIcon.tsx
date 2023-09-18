export type CustomIconName =
  | 'equal'
  | 'exit'
  | 'extrude'
  | 'horizontal'
  | 'line'
  | 'move'
  | 'parallel'
  | 'sketch'
  | 'vertical'

export const CustomIcon = ({
  name,
  ...props
}: {
  name: CustomIconName
} & React.SVGProps<SVGSVGElement>) => {
  switch (name) {
    case 'equal':
      return (
        <svg
          {...props}
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M5 8.78V7H14.52V8.78H5ZM5 13.02V11.24H14.52V13.02H5Z"
            fill="currentColor"
          />
        </svg>
      )
    case 'exit':
      return (
        <svg
          {...props}
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M17 10L3 10M3 10L6.5 6.5M3 10L6.5 13.5"
            stroke="currentColor"
          />
        </svg>
      )

    case 'extrude':
      return (
        <svg
          {...props}
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fill-rule="evenodd"
            clip-rule="evenodd"
            d="M10 3L10.3536 3.35355L12.3536 5.35355L11.6465 6.06066L10.5 4.91421V11.5854C11.0826 11.7913 11.5 12.3469 11.5 13C11.5 13.8284 10.8284 14.5 10 14.5C9.17157 14.5 8.5 13.8284 8.5 13C8.5 12.3469 8.91741 11.7913 9.5 11.5854V4.91421L8.35356 6.06066L7.64645 5.35355L9.64645 3.35355L10 3ZM1.95887 12.3282L8 8.63644V9.80838L2.91773 12.9142L10 17.2423L17.0823 12.9142L12 9.80838V8.63644L18.0411 12.3282L19 12.9142L19 14.9683H18V13.5253L10.5 18.1087V19.9683H9.5V18.1087L2 13.5253V14.9683H1L1 12.9142L1.95887 12.3282Z"
            fill="currentColor"
          />
        </svg>
      )
    case 'horizontal':
      return (
        <svg
          {...props}
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fill-rule="evenodd"
            clip-rule="evenodd"
            d="M4 9.5H16V11.5H4V9.5Z"
            fill="currentColor"
          />
        </svg>
      )
    case 'line':
      return (
        <svg
          {...props}
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fill-rule="evenodd"
            clip-rule="evenodd"
            d="M15.5 6C16.3284 6 17 5.32843 17 4.5C17 3.67157 16.3284 3 15.5 3C14.6716 3 14 3.67157 14 4.5C14 4.73107 14.0522 4.94993 14.1456 5.14543L5.14543 14.1456C4.94993 14.0522 4.73107 14 4.5 14C3.67157 14 3 14.6716 3 15.5C3 16.3284 3.67157 17 4.5 17C5.32843 17 6 16.3284 6 15.5C6 15.2679 5.94729 15.0482 5.8532 14.852L14.852 5.8532C15.0482 5.94729 15.2679 6 15.5 6Z"
            fill="currentColor"
          />
        </svg>
      )
    case 'move':
      return (
        <svg
          {...props}
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fill-rule="evenodd"
            clip-rule="evenodd"
            d="M10 2.29289L10.3536 2.64645L12.3536 4.64645L11.6465 5.35355L10.5 4.20711V8V9.50001H12L15.7929 9.50001L14.6465 8.35356L15.3536 7.64645L17.3536 9.64645L17.7071 10L17.3536 10.3536L15.3536 12.3536L14.6465 11.6465L15.7929 10.5H12H10.5V12V15.7929L11.6465 14.6464L12.3536 15.3536L10.3536 17.3536L10 17.7071L9.64645 17.3536L7.64645 15.3536L8.35356 14.6464L9.50001 15.7929V12V10.5H8.00001H4.20712L5.35357 11.6465L4.64646 12.3536L2.64646 10.3536L2.29291 10L2.64646 9.64645L4.64646 7.64645L5.35357 8.35356L4.20712 9.50001H8.00001H9.50001V8V4.20711L8.35356 5.35355L7.64645 4.64645L9.64645 2.64645L10 2.29289Z"
            fill="currentColor"
          />
        </svg>
      )
    case 'parallel':
      return (
        <svg
          {...props}
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fill-rule="evenodd"
            clip-rule="evenodd"
            d="M8 16V4H6V16H8ZM14 16V4H12V16H14Z"
            fill="currentColor"
          />
        </svg>
      )
    case 'sketch':
      return (
        <svg
          {...props}
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fill-rule="evenodd"
            clip-rule="evenodd"
            d="M14.8037 13.4035L15.5509 14.1635L16.3682 16.8386L13.5521 16.1346L12.8186 15.3885L14.8037 13.4035ZM14.1025 12.6903L12.1175 14.6754L3.48609 5.89624C2.94588 5.34678 2.94963 4.46456 3.49448 3.91971C4.04591 3.36828 4.94112 3.37208 5.48786 3.92817L14.1025 12.6903ZM6.20094 3.22709L16.4357 13.6371L17.5003 17.1216L17.8412 18.2376L16.7091 17.9546L13.0364 17.0364L2.77301 6.59732C1.84793 5.6564 1.85434 4.14564 2.78737 3.2126C3.73167 2.2683 5.26468 2.27481 6.20094 3.22709Z"
            fill="currentColor"
          />
        </svg>
      )
    case 'vertical':
      return (
        <svg
          {...props}
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fill-rule="evenodd"
            clip-rule="evenodd"
            d="M11 4V16H9V4H11Z"
            fill="currentColor"
          />
        </svg>
      )
  }
}
