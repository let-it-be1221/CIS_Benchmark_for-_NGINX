'use client';

import { useChecklistStore, computeSectionStats } from '@/store/checklistStore';
import { cn } from '@/lib/utils';
import { Check, AlertTriangle, Clock, X, HelpCircle } from 'lucide-react';

export function SectionSidebar() {
  const benchmark = useChecklistStore((s) => s.benchmark);
  const statuses = useChecklistStore((s) => s.statuses);
  const sectionFilter = useChecklistStore((s) => s.sectionFilter);
  const setSectionFilter = useChecklistStore((s) => s.setSectionFilter);

  const stats = computeSectionStats(benchmark, statuses);

  if (!benchmark) return null;

  return (
    <nav className="flex flex-col gap-1">
      <button
        onClick={() => setSectionFilter(0)}
        className={cn(
          'flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors',
          sectionFilter === 0
            ? 'bg-zinc-900 text-white'
            : 'hover:bg-zinc-100 dark:hover:bg-zinc-800',
        )}
      >
        <span className="font-medium">All sections</span>
        <span className="text-xs tabular-nums opacity-70">
          {stats.reduce((acc, s) => acc + s.total, 0)}
        </span>
      </button>

      {stats.map((s) => {
        const isActive = sectionFilter === s.section;
        const totalDone = s.pass + s.fail + s.na;
        const pct = s.total === 0 ? 0 : Math.round((totalDone / s.total) * 100);
        return (
          <button
            key={s.section}
            onClick={() => setSectionFilter(s.section)}
            className={cn(
              'group flex flex-col gap-1 px-3 py-2 rounded-md text-sm transition-colors text-left',
              isActive
                ? 'bg-zinc-900 text-white'
                : 'hover:bg-zinc-100 dark:hover:bg-zinc-800',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium leading-tight">
                <span className="text-xs opacity-60 mr-1">{s.section}.</span>
                {s.sectionName}
              </span>
              <span className="text-xs tabular-nums opacity-70 shrink-0">
                {totalDone}/{s.total}
              </span>
            </div>
            <div className="h-1 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden flex">
              {s.pass > 0 && <div className="bg-emerald-500" style={{ width: `${(s.pass / s.total) * 100}%` }} />}
              {s.fail > 0 && <div className="bg-red-500" style={{ width: `${(s.fail / s.total) * 100}%` }} />}
              {s.manual > 0 && <div className="bg-amber-500" style={{ width: `${(s.manual / s.total) * 100}%` }} />}
              {s.na > 0 && <div className="bg-zinc-400" style={{ width: `${(s.na / s.total) * 100}%` }} />}
            </div>
            <div className="flex items-center gap-2 text-[10px] opacity-70 tabular-nums">
              {s.pass > 0 && <span className="flex items-center gap-0.5"><Check className="size-2.5" />{s.pass}</span>}
              {s.fail > 0 && <span className="flex items-center gap-0.5"><X className="size-2.5" />{s.fail}</span>}
              {s.manual > 0 && <span className="flex items-center gap-0.5"><AlertTriangle className="size-2.5" />{s.manual}</span>}
              {s.pending > 0 && <span className="flex items-center gap-0.5"><Clock className="size-2.5" />{s.pending}</span>}
              {s.na > 0 && <span className="flex items-center gap-0.5"><HelpCircle className="size-2.5" />{s.na}</span>}
              <span className="ml-auto">{pct}%</span>
            </div>
          </button>
        );
      })}
    </nav>
  );
}
