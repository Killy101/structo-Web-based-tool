/**
 * Structo brand eye icon — Document Intelligence Platform
 *
 * Design: clean minimal geometry
 *   • Blue gradient background square (brand blue #1a8fd1 → #0d5f8f)
 *   • White almond eye shape with subtle fill
 *   • White iris ring
 *   • Orange pupil accent (#d4862e)
 */

interface StructoLogoProps {
  size?: number;
  className?: string;
}

export function StructoLogo({ size = 32, className }: StructoLogoProps) {
  // Use a per-instance ID prefix to avoid SVG gradient ID collisions
  // when this component is rendered multiple times on the same page.
  const gradId = `structo-bg-${size}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Structo"
      role="img"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1a8fd1" />
          <stop offset="1" stopColor="#0d5f8f" />
        </linearGradient>
      </defs>

      {/* Background rounded square */}
      <rect width="32" height="32" rx="7" fill={`url(#${gradId})`} />

      {/* Eye outer shape — almond / vesica-piscis */}
      <path
        d="M5 16C7.5 10.5 11.2 8 16 8C20.8 8 24.5 10.5 27 16C24.5 21.5 20.8 24 16 24C11.2 24 7.5 21.5 5 16Z"
        fill="white"
        fillOpacity="0.12"
        stroke="white"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />

      {/* Iris ring */}
      <circle cx="16" cy="16" r="4" stroke="white" strokeWidth="1.5" />

      {/* Pupil — orange accent */}
      <circle cx="16" cy="16" r="2" fill="#d4862e" />

      {/* Specular highlight */}
      <circle cx="17.2" cy="14.8" r="0.8" fill="white" fillOpacity="0.6" />
    </svg>
  );
}

// Backward-compatible alias
export { StructoLogo as IdafLogo };
