import type { PipelineStepRecord, PipelineRole } from './pipeline';

export type UIStepStatus = 'running' | 'complete' | 'failed' | 'skipped' | 'pending';

export interface UIStepGroup {
  role: PipelineRole;
  iteration: number;           // 1-based index within same role
  status: UIStepStatus;
  record: PipelineStepRecord;  // original record for detail rendering
}

export interface UITimeline {
  groups: UIStepGroup[];
}
