import type { WorkStatus } from "@/hooks/useProjectWork";

interface Props {
  status: WorkStatus | "done" | "pending";
}

type BadgeConfig = {
  pill: string;
  label: string;
  icon: React.ReactNode;
};

const CONFIG: Record<string, BadgeConfig> = {
  done: {
    pill: "bg-green-50 border-green-200 text-green-700",
    label: "Done",
    icon: <span className="text-green-500">✓</span>,
  },
  current: {
    pill: "bg-blue-50 border-blue-200 text-blue-700",
    label: "Current",
    icon: <span className="inline-block h-2 w-2 rounded-full bg-blue-500 animate-pulse" />,
  },
  pending: {
    pill: "bg-gray-50 border-gray-200 text-gray-400",
    label: "Pending",
    icon: null,
  },
  approval: {
    pill: "bg-amber-50 border-amber-200 text-amber-700",
    label: "Needs Approval",
    icon: <span>⚠</span>,
  },
  pr_review: {
    pill: "bg-purple-50 border-purple-200 text-purple-700",
    label: "PR Review",
    icon: <span className="inline-block h-2 w-2 rounded-full bg-purple-400 animate-pulse" />,
  },
};

export function WorkStatusBadge({ status }: Props) {
  const cfg = CONFIG[status] ?? CONFIG.pending;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold ${cfg.pill}`}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  );
}
