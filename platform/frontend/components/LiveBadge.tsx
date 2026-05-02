interface LiveBadgeProps {
  active: boolean;
}

export function LiveBadge({ active }: LiveBadgeProps) {
  if (!active) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-800">
      <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
      LIVE
    </span>
  );
}
