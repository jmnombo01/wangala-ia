type BrandMarkProps = {
  size?: number
  className?: string
}

export default function BrandMark({ size = 42, className }: BrandMarkProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      height={size}
      viewBox="0 0 48 48"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="48" height="48" rx="15" fill="#0F5A43" />
      <path d="M8 12.5H40" stroke="#E3AD3D" strokeWidth="3" strokeLinecap="round" />
      <circle cx="24" cy="13" r="4.25" fill="#E3AD3D" />
      <path
        d="M9.5 20L16.8 35L24 23.2L31.2 35L38.5 20"
        fill="none"
        stroke="#FFF8E9"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M14 40H34" stroke="#B73532" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
