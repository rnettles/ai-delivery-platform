import type { WorkStatus } from "@/hooks/useProjectWork";

interface Props {
  status: WorkStatus | "done" | "pending";
}

const CONFIG: Record<string, { dot: string; label: string; text: string }> = {
  done:      { dot: "bg-green-500",               label: "Done",           text: "text-green-700" },
  current:   { dot: "bg-blue-500 animate-pulse",  label: "Active",         text: "text-blue-700" },
  pending:   { dot: "bg-gray-300",                label: "Pending",        text: "text-gray-500" },
  approval:  { dot: "bg-amber-400 animate-pulse", label: "Needs Approval", text: "text-amber-700" },
  pr_review: { dot: "bg-purple-400 animate-pulse",label: "PR Review",      text: "text-purple-700" },
};

export function WorkStatusBadge({ status }: Props) {
  const cfg = CONFIG[status] ?? CONFIG.pending;
  return (
    <span className={`flex items-center gap-1.5 text-xs font-medium ${cfg.text}`}>
      <span className={`inline-block h-2 w-2 flex-shrink-0 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}
