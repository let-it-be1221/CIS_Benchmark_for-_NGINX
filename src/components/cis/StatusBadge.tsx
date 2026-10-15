'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { CheckStatus } from '@/store/checklistStore';

const STATUS_CONFIG: Record<CheckStatus, {
  label: string;
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
  className?: string;
  icon?: string;
}> = {
  pass:    { label: 'Pass',    variant: 'default',     className: 'bg-emerald-600 hover:bg-emerald-600 text-white border-transparent' },
  fail:    { label: 'Fail',    variant: 'destructive', className: 'bg-red-600 hover:bg-red-600 text-white border-transparent' },
  manual:  { label: 'Manual',  variant: 'secondary',   className: 'bg-amber-500 hover:bg-amber-500 text-white border-transparent' },
  na:      { label: 'N/A',     variant: 'secondary',   className: 'bg-zinc-400 hover:bg-zinc-400 text-white border-transparent' },
  pending: { label: 'Pending', variant: 'outline',     className: 'text-zinc-500' },
};

export function StatusBadge({ status, className }: { status: CheckStatus; className?: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  return (
    <Badge variant={cfg.variant} className={cn(cfg.className, className)}>
      {cfg.label}
    </Badge>
  );
}

export function statusLabel(status: CheckStatus): string {
  return STATUS_CONFIG[status]?.label ?? 'Pending';
}
