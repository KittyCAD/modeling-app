export type CustomIconName =
  | 'arrowDown'
  | 'arrowLeft'
  | 'arrowRight'
  | 'arrowUp'
  | 'checkmark'
  | 'clipboardPlus'
  | 'clipboardCheckmark'
  | 'close'
  | 'equal'
  | 'extrude'
  | 'file'
  | 'filePlus'
  | 'folder'
  | 'folderPlus'
  | 'gear'
  | 'horizontal'
  | 'horizontalDash'
  | 'line'
  | 'move'
  | 'network'
  | 'networkCrossedOut'
  | 'parallel'
  | 'plus'
  | 'search'
  | 'sketch'
  | 'vertical'

export const CustomIcon = ({
  name,
  ...props
}: {
  name: CustomIconName
} & React.SVGProps<SVGSVGElement>) => {
  switch (name) {
    case 'arrowDown':
      return (
        <svg
          {...props}
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M10 17.7071L9.64648 17.3535L6.14648 13.8535L6.85359 13.1464L9.50004 15.7929V2.99997H10.5V15.7929L13.1465 13.1464L13.8536 13.8535L10.3536 17.3535L10 17.7071Z"
            fill="currentColor"
          />
        </svg>
      )
    case 'arrowLeft':
      return (
        <svg
          {...props}
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M2.29291 10L2.64646 9.64645L6.14646 6.14645L6.85357 6.85356L4.20712 9.50001L17 9.50001V10.5L4.20712 10.5L6.85357 13.1465L6.14646 13.8536L2.64646 10.3536L2.29291 10Z"
            fill="currentColor"
          />
        </svg>
      )
    case 'arrowRight':
      return (
        <svg
          {...props}
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M17.7071 10L17.3536 10.3536L13.8536 13.8536L13.1464 13.1465L15.7929 10.5H3V9.50001H15.7929L13.1464 6.85356L13.8536 6.14645L17.3536 9.64645L17.7071 10Z"
            fill="currentColor"
          />
        </svg>
      )
    case 'arrowUp':
      return (
        <svg
          {...props}
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M10 2.29288L10.3536 2.64643L13.8536 6.14643L13.1465 6.85354L10.5 4.20709V17H9.50004V4.20709L6.85359 6.85354L6.14648 6.14643L9.64648 2.64643L10 2.29288Z"
            fill="currentColor"
          />
        </svg>
      )
    case 'checkmark':
      return (
        <svg
          {...props}
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M8.29956 13.5388L13.9537 6L14.7537 6.6L8.75367 14.6L8.00012 14.6536L5 11.6536L5.70709 10.9465L8.29956 13.5388Z"
            fill="currentColor"
          />
        </svg>
      )
    case 'clipboardCheckmark':
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
            d="M6.5 3H7L13 3L13.5 3V3.5V4.00001L15.5 4.00002L16 4.00002V4.50002V10.0351C15.6905 9.85609 15.3548 9.71733 15 9.62602V5.00002L13.5 5.00001V6.50001V7.00001L13 7.00001L7 7.00001L6.5 7.00001V6.50001V5.00001L5 5.00001V16H10.8773C11.2024 16.4055 11.6047 16.7463 12.062 17H4.5H4V16.5V4.50001V4.00001L4.5 4.00001L6.5 4.00001V3.5V3ZM15.938 17C15.9588 16.9885 15.9794 16.9768 16 16.9649V17H15.938ZM7.5 4V4.50001V6.00001L12.5 6.00001V4.50001V4L7.5 4ZM13 9H7V8H13V9ZM15.6855 11.5L13.2101 14.8005L12.2071 13.7975L11.5 14.5046L12.9107 15.9153L13.6642 15.8617L16.4855 12.1L15.6855 11.5Z"
            fill="currentColor"
          />
        </svg>
      )
    case 'clipboardPlus':
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
            d="M6.5 3H7L13 3L13.5 3V3.5V4.00001L15.5 4.00002L16 4.00002V4.50002V10.0351C15.6905 9.85609 15.3548 9.71733 15 9.62602V5.00002L13.5 5.00001V6.50001V7.00001L13 7.00001L7 7.00001L6.5 7.00001V6.50001V5.00001L5 5.00001V16H10.8773C11.2024 16.4055 11.6047 16.7463 12.062 17H4.5H4V16.5V4.50001V4.00001L4.5 4.00001L6.5 4.00001V3.5V3ZM15.938 17C15.9588 16.9885 15.9794 16.9768 16 16.9649V17H15.938ZM7.5 4V4.50001V6.00001L12.5 6.00001V4.50001V4L7.5 4ZM13 9H7V8H13V9ZM13.5 11V13H11.5V14H13.5V16H14.5V14H16.5V13H14.5V11H13.5Z"
            fill="currentColor"
          />
        </svg>
      )
    case 'close':
      return (
        <svg
          {...props}
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M9.2929 10L6.46448 7.17158L7.17158 6.46448L10 9.2929L12.8284 6.46448L13.5355 7.17158L10.7071 10L13.5355 12.8284L12.8284 13.5355L10 10.7071L7.17158 13.5355L6.46448 12.8284L9.2929 10Z"
            fill="currentColor"
          />
        </svg>
      )
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
    case 'extrude':
      return (
        <svg
          {...props}
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M10 3L10.3536 3.35355L12.3536 5.35355L11.6465 6.06066L10.5 4.91421V11.5854C11.0826 11.7913 11.5 12.3469 11.5 13C11.5 13.8284 10.8284 14.5 10 14.5C9.17157 14.5 8.5 13.8284 8.5 13C8.5 12.3469 8.91741 11.7913 9.5 11.5854V4.91421L8.35356 6.06066L7.64645 5.35355L9.64645 3.35355L10 3ZM1.95887 12.3282L8 8.63644V9.80838L2.91773 12.9142L10 17.2423L17.0823 12.9142L12 9.80838V8.63644L18.0411 12.3282L19 12.9142L19 14.9683H18V13.5253L10.5 18.1087V19.9683H9.5V18.1087L2 13.5253V14.9683H1L1 12.9142L1.95887 12.3282Z"
            fill="currentColor"
          />
        </svg>
      )
    case 'file':
      return (
        <svg
          {...props}
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M4 3H4.5H11H11.2071L11.3536 3.14645L15.8536 7.64646L16 7.7929V8.00001V16.5V17H15.5H4.5H4V16.5V3.5V3ZM5 4V16H15V8.50001H11H10.5V8.00001V4H5ZM11.5 4.70711L14.2929 7.50001H11.5V4.70711Z"
            fill="currentColor"
          />
        </svg>
      )
    case 'filePlus':
      return (
        <svg
          {...props}
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M4 3H4.5H11H11.2071L11.3536 3.14645L15.8536 7.64646L16 7.7929V8.00001V11.3773C15.6992 11.1362 15.3628 10.9376 15 10.7908V8.50001H11H10.5V8.00001V4H5V16H9.79076C9.93763 16.3628 10.1362 16.6992 10.3773 17H4.5H4V16.5V3.5V3ZM11.5 4.70711L14.2929 7.50001H11.5V4.70711ZM13 12V14H11V15H13V17H14V15H16V14H14V12H13Z"
            fill="currentColor"
          />
        </svg>
      )
    case 'folder':
      return (
        <svg
          {...props}
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M3.5 3.5H4H7H7.16667L7.3 3.6L9.16667 5H16H16.5V5.5V7.5V16V16.5H16H4H3.5V16V7.5V4V3.5ZM4.5 4.5V7H15.5V6H9H8.83333L8.7 5.9L6.83333 4.5H4.5ZM15.5 8H4.5V15.5H15.5V8Z"
            fill="currentColor"
          />
        </svg>
      )
    case 'folderPlus':
      return (
        <svg
          {...props}
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M3.5 3.5H4H7H7.16667L7.3 3.6L9.16667 5H16H16.5V5.5V7.5V10.3773C16.1992 10.1362 15.8628 9.93763 15.5 9.79076V8H4.5V15.5H10.5351C10.7529 15.8764 11.0302 16.2141 11.3542 16.5H4H3.5V16V7.5V4V3.5ZM4.5 4.5V7H15.5V6H9H8.83333L8.7 5.9L6.83333 4.5H4.5ZM13.5 11V13H11.5V14H13.5V16H14.5V14H16.5V13H14.5V11H13.5Z"
            fill="currentColor"
          />
        </svg>
      )
    case 'gear':
      return (
        <svg
          {...props}
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M8.61477 3.0884L5.87402 4.67077L6.50004 5.75505L5.25004 7.92011H4.0047V11.07H5.25004L6.50004 13.2351L5.86973 14.3268L8.62776 15.9191L9.24503 14.85H11.745L12.3647 15.9234L15.1416 14.3202L14.5151 13.2351L15.7651 11.07H16.9951V7.92011H15.7651L14.5151 5.75505L15.1373 4.67741L12.3778 3.08423L11.7451 4.18012H9.24508L8.61477 3.0884ZM10.4999 13C12.4329 13 13.9999 11.433 13.9999 9.50003C13.9999 7.56703 12.4329 6.00003 10.4999 6.00003C8.56687 6.00003 6.99986 7.56703 6.99986 9.50003C6.99986 11.433 8.56687 13 10.4999 13Z"
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
            fillRule="evenodd"
            clipRule="evenodd"
            d="M4 9.5H16V11.5H4V9.5Z"
            fill="currentColor"
          />
        </svg>
      )
    case 'horizontalDash':
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
            d="M14 10.5H6V9.5H14V10.5Z"
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
            fillRule="evenodd"
            clipRule="evenodd"
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
            fillRule="evenodd"
            clipRule="evenodd"
            d="M10 2.29289L10.3536 2.64645L12.3536 4.64645L11.6465 5.35355L10.5 4.20711V8V9.50001H12L15.7929 9.50001L14.6465 8.35356L15.3536 7.64645L17.3536 9.64645L17.7071 10L17.3536 10.3536L15.3536 12.3536L14.6465 11.6465L15.7929 10.5H12H10.5V12V15.7929L11.6465 14.6464L12.3536 15.3536L10.3536 17.3536L10 17.7071L9.64645 17.3536L7.64645 15.3536L8.35356 14.6464L9.50001 15.7929V12V10.5H8.00001H4.20712L5.35357 11.6465L4.64646 12.3536L2.64646 10.3536L2.29291 10L2.64646 9.64645L4.64646 7.64645L5.35357 8.35356L4.20712 9.50001H8.00001H9.50001V8V4.20711L8.35356 5.35355L7.64645 4.64645L9.64645 2.64645L10 2.29289Z"
            fill="currentColor"
          />
        </svg>
      )
    case 'network':
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
            d="M18 9.64741C17.1925 8.24871 16.0344 7.08457 14.6399 6.26971C13.2455 5.45486 11.6628 5.01742 10.0478 5.00051C8.4328 4.9836 6.84127 5.38779 5.43006 6.17326C4.01884 6.95873 2.83666 8.09837 2 9.47985L2.76881 9.94546C3.52456 8.69756 4.59243 7.66813 5.86718 6.95862C7.14193 6.2491 8.57955 5.88399 10.0384 5.89927C11.4972 5.91455 12.9269 6.30968 14.1865 7.04574C15.4461 7.7818 16.4922 8.83337 17.2216 10.0968L18 9.64741ZM15.2155 11.0953C14.6772 10.1628 13.9051 9.3867 12.9755 8.84347C12.0459 8.30023 10.9907 8.00861 9.91406 7.99733C8.8374 7.98606 7.77638 8.25552 6.83557 8.77917C5.89476 9.30281 5.10664 10.0626 4.54887 10.9836L5.34391 11.4651C5.81802 10.6822 6.48792 10.0364 7.28761 9.59132C8.0873 9.14622 8.98916 8.91718 9.90432 8.92676C10.8195 8.93635 11.7164 9.18423 12.5065 9.64598C13.2967 10.1077 13.953 10.7674 14.4106 11.56L15.2155 11.0953ZM10 14C10.8284 14 11.5 13.3284 11.5 12.5C11.5 11.6716 10.8284 11 10 11C9.17157 11 8.5 11.6716 8.5 12.5C8.5 13.3284 9.17157 14 10 14Z"
            fill="currentColor"
          />
        </svg>
      )
    case 'networkCrossedOut':
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
            d="M4.35352 5.39647L14.253 15.296L14.9601 14.5889L5.06062 4.68936L4.35352 5.39647ZM12.5065 9.64599C11.9609 9.32713 11.3643 9.11025 10.746 9.00341L9.74058 7.99796C9.79835 7.99694 9.85618 7.99674 9.91406 7.99735C10.9907 8.00862 12.0459 8.30025 12.9755 8.84348C13.9051 9.38672 14.6772 10.1628 15.2155 11.0953L14.4106 11.56C13.953 10.7674 13.2967 10.1077 12.5065 9.64599ZM6.48788 8.98789L7.16295 9.66297C6.41824 10.1045 5.79317 10.7233 5.34391 11.4651L4.54887 10.9836C5.03646 10.1785 5.70009 9.49656 6.48788 8.98789ZM10.0384 5.89928C9.3134 5.89169 8.59366 5.97804 7.89655 6.15392L7.16867 5.42605C8.09637 5.13507 9.06776 4.99026 10.0478 5.00052C11.6628 5.01744 13.2455 5.45488 14.6399 6.26973C16.0344 7.08458 17.1925 8.24872 18 9.64742L17.2216 10.0968C16.4922 8.83338 15.4461 7.78181 14.1865 7.04575C12.9269 6.3097 11.4972 5.91456 10.0384 5.89928ZM5.00782 7.50783L4.36522 6.86524C3.42033 7.57557 2.61639 8.46208 2 9.47986L2.76881 9.94547C3.34775 8.98952 4.10986 8.16177 5.00782 7.50783ZM10 14C10.4142 14 10.7892 13.8321 11.0607 13.5607L8.93934 11.4394C8.66789 11.7108 8.5 12.0858 8.5 12.5C8.5 13.3284 9.17157 14 10 14Z"
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
            fillRule="evenodd"
            clipRule="evenodd"
            d="M8 16V4H6V16H8ZM14 16V4H12V16H14Z"
            fill="currentColor"
          />
        </svg>
      )
    case 'plus':
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
            d="M9.5 9.5V5.5H10.5V9.5H14.5V10.5H10.5V14.5H9.5V10.5H5.5V9.5H9.5Z"
            fill="currentColor"
          />
        </svg>
      )
    case 'search':
      return (
        <svg
          {...props}
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M14.016 9.00482C14.016 10.662 12.6731 12.0048 11.0172 12.0048C9.3613 12.0048 8.01841 10.662 8.01841 9.00482C8.01841 7.34768 9.3613 6.00482 11.0172 6.00482C12.6731 6.00482 14.016 7.34768 14.016 9.00482ZM15.016 9.00482C15.016 11.214 13.2257 13.0048 11.0172 13.0048C10.082 13.0048 9.22178 12.6837 8.54074 12.1456L5.6912 14.9952L4.98409 14.2881L7.83921 11.433C7.32431 10.7597 7.01841 9.91799 7.01841 9.00482C7.01841 6.79568 8.80873 5.00482 11.0172 5.00482C13.2257 5.00482 15.016 6.79568 15.016 9.00482Z"
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
            fillRule="evenodd"
            clipRule="evenodd"
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
            fillRule="evenodd"
            clipRule="evenodd"
            d="M11 4V16H9V4H11Z"
            fill="currentColor"
          />
        </svg>
      )
  }
}
