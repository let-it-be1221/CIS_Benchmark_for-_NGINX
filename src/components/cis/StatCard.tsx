'use client';

import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: number;
  total: number;
  colorClass?: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
}

export function StatCard({ label, value, total, colorClass, icon, onClick, active }: StatCardProps) {
  const pct = total === 0 ? 0 : Math.round((value / total) * 100);
  const interactive = !!onClick;
  return (
    <Card
      onClick={onClick}
      className={cn(
        'transition-all',
        interactive && 'cursor-pointer hover:border-zinc-400 hover:shadow-md',
        active && 'ring-2 ring-zinc-400',
      )}
    >
      <CardContent className="p-4 flex items-center gap-3">
        {icon && (
          <div className={cn('flex size-10 items-center justify-center rounded-md', colorClass)}>
            {icon}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className={cn('text-2xl font-bold tabular-nums', colorClass?.replace('bg-', 'text-').replace('text-white', '').replace('hover:', 'hover:text-'))}>
              {value}
            </span>
            <span className="text-xs text-muted-foreground">/ {total}</span>
            <span className="text-xs text-muted-foreground ml-auto">{pct}%</span>
          </div>
          <div className="text-xs text-muted-foreground truncate mt-0.5">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}
