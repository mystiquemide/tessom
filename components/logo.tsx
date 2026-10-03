export function LogoMark({size = 28}: {size?: number}) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" className="shrink-0">
      <rect width="32" height="32" rx="7" fill="#000000" />
      <rect x="7" y="8" width="18" height="6" rx="1" fill="#fdfcf5" />
      <rect x="13" y="16" width="6" height="9" rx="1" fill="#fdfcf5" />
    </svg>
  );
}

export function Logo({size = 28}: {size?: number}) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={size} />
      <span className="font-serif text-[22px] leading-none text-ink">Tessom</span>
    </span>
  );
}
