'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  ChevronRight,
  ChevronDown,
  Play,
  Check,
  X,
  AlertTriangle,
  MinusCircle,
  Clock,
  Info,
  Shield,
  Lightbulb,
  Wrench,
  FileText,
} from 'lucide-react';
import type { ParsedRecommendation } from '@/lib/cisParser';
import { useChecklistStore, type CheckStatus } from '@/store/checklistStore';
import { hasEvaluatorForCheck } from '@/lib/evaluators';
import { StatusBadge } from './StatusBadge';
import { cn } from '@/lib/utils';

const STATUS_ACTIONS: { value: CheckStatus; icon: React.ReactNode; label: string; activeClass: string }[] = [
  { value: 'pass',    icon: <Check className="size-3.5" />,        label: 'Pass',    activeClass: 'bg-emerald-600 text-white hover:bg-emerald-600' },
  { value: 'fail',    icon: <X className="size-3.5" />,            label: 'Fail',    activeClass: 'bg-red-600 text-white hover:bg-red-600' },
  { value: 'manual',  icon: <AlertTriangle className="size-3.5" />, label: 'Manual', activeClass: 'bg-amber-500 text-white hover:bg-amber-500' },
  { value: 'na',      icon: <MinusCircle className="size-3.5" />, label: 'N/A',     activeClass: 'bg-zinc-500 text-white hover:bg-zinc-500' },
  { value: 'pending', icon: <Clock className="size-3.5" />,       label: 'Reset',   activeClass: 'bg-zinc-200 text-zinc-700 hover:bg-zinc-200' },
];

interface ChecklistItemProps {
  check: ParsedRecommendation;
  index: number;
  benchmarkType: string;
}

export function ChecklistItem({ check, index, benchmarkType }: ChecklistItemProps) {
  const entry = useChecklistStore((s) => s.statuses[check.id]);
  const expanded = useChecklistStore((s) => s.expandedCheckIds[check.id] ?? false);
  const setExpanded = useChecklistStore((s) => s.setExpanded);
  const setStatus = useChecklistStore((s) => s.setStatus);
  const updateNotes = useChecklistStore((s) => s.updateNotes);
  const runEvaluatorFor = useChecklistStore((s) => s.runEvaluatorFor);

  const [localNotes, setLocalNotes] = useState(entry?.notes ?? '');
  const isAutoEvaluatable = hasEvaluatorForCheck(benchmarkType, check.id);

  const status: CheckStatus = entry?.status ?? 'pending';
  const borderClass =
    status === 'pass' ? 'border-l-emerald-500'
    : status === 'fail' ? 'border-l-red-500'
    : status === 'manual' ? 'border-l-amber-500'
    : status === 'na' ? 'border-l-zinc-400'
    : 'border-l-zinc-200';

  const handleRunSingle = () => {
    runEvaluatorFor(check.id);
  };

  return (
    <Card className={cn('border-l-4 transition-all', borderClass)}>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="size-7 p-0 mt-0.5 shrink-0"
            onClick={() => setExpanded(check.id, !expanded)}
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-xs font-mono text-muted-foreground tabular-nums">
                {String(index + 1).padStart(2, '0')}.
              </span>
              <span className="text-xs font-mono text-muted-foreground tabular-nums">{check.id}</span>
              <h3 className="text-base font-semibold leading-tight">{check.title}</h3>
              <StatusBadge status={status} className="ml-auto" />
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              <Badge variant="outline" className="text-[10px] py-0">
                {check.sectionName}
              </Badge>
              {check.subsection && (
                <Badge variant="outline" className="text-[10px] py-0">
                  {check.subsection}
                </Badge>
              )}
              {check.profile.some((p) => p.startsWith('Level 1')) && (
                <Badge variant="outline" className="text-[10px] py-0 bg-zinc-50">
                  Level 1
                </Badge>
              )}
              {check.profile.some((p) => p.startsWith('Level 2')) && (
                <Badge variant="outline" className="text-[10px] py-0 bg-amber-50 text-amber-700 border-amber-200">
                  Level 2
                </Badge>
              )}
              <Badge variant="outline" className="text-[10px] py-0">
                {check.profile.length} profile{check.profile.length > 1 ? 's' : ''}
              </Badge>
              {check.assessmentStatus && (
                <Badge variant="outline" className="text-[10px] py-0 bg-zinc-50 text-zinc-600 border-zinc-200">
                  {check.assessmentStatus}
                </Badge>
              )}
              {isAutoEvaluatable ? (
                <Badge variant="outline" className="text-[10px] py-0 bg-emerald-50 text-emerald-700 border-emerald-200">
                  <Play className="size-2.5 mr-0.5" /> Auto-auditable
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] py-0 bg-zinc-50 text-zinc-600 border-zinc-200">
                  Manual only
                </Badge>
              )}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-3">
        {/* Evaluator message (if any) */}
        {entry?.evaluatorMessage && (
          <div className={cn(
            'rounded-md p-3 text-sm border flex gap-2',
            status === 'pass' ? 'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100 dark:border-emerald-800'
            : status === 'fail' ? 'bg-red-50 border-red-200 text-red-900 dark:bg-red-950 dark:text-red-100 dark:border-red-800'
            : status === 'manual' ? 'bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950 dark:text-amber-100 dark:border-amber-800'
            : 'bg-zinc-50 border-zinc-200 text-zinc-700',
          )}>
            <Shield className="size-4 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="font-medium mb-1">Auto-evaluator result</div>
              <div className="text-sm">{entry.evaluatorMessage}</div>
              {entry.evaluatorEvidence && (
                <pre className="mt-2 text-[11px] font-mono bg-white dark:bg-zinc-950 border rounded p-2 overflow-x-auto whitespace-pre-wrap">
                  {entry.evaluatorEvidence}
                </pre>
              )}
            </div>
          </div>
        )}

        {/* Action row */}
        <div className="flex flex-wrap items-center gap-2">
          {isAutoEvaluatable && (
            <Button size="sm" variant="outline" onClick={handleRunSingle}>
              <Play className="size-3.5" />
              Run audit
            </Button>
          )}
          <div className="flex items-center gap-1 ml-auto">
            <span className="text-xs text-muted-foreground mr-1">Set status:</span>
            {STATUS_ACTIONS.map((opt) => (
              <Button
                key={opt.value}
                size="sm"
                variant={status === opt.value ? 'default' : 'outline'}
                onClick={() => setStatus(check.id, opt.value)}
                className={cn(
                  'h-7 gap-1 text-xs px-2',
                  status === opt.value && opt.activeClass,
                  status === opt.value && 'border-transparent',
                )}
                title={opt.label}
              >
                {opt.icon}
                <span className="hidden sm:inline">{opt.label}</span>
              </Button>
            ))}
          </div>
        </div>

        {/* Detail panel */}
        <Collapsible open={expanded} onOpenChange={(o) => setExpanded(check.id, o)}>
          <CollapsibleContent>
            <div className="border-t pt-3 mt-3 space-y-3">
              <DetailSection icon={<Info className="size-3.5" />} title="Description">
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{check.description}</p>
              </DetailSection>
              <DetailSection icon={<Lightbulb className="size-3.5" />} title="Rationale">
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{check.rationale}</p>
              </DetailSection>
              {check.impact && (
                <DetailSection icon={<AlertTriangle className="size-3.5" />} title="Impact">
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{check.impact}</p>
                </DetailSection>
              )}
              <DetailSection icon={<Shield className="size-3.5" />} title="Audit procedure">
                <pre className="text-xs font-mono whitespace-pre-wrap bg-zinc-50 dark:bg-zinc-900 border rounded p-3 overflow-x-auto">
                  {check.audit}
                </pre>
              </DetailSection>
              {check.remediation && (
                <DetailSection icon={<Wrench className="size-3.5" />} title="Remediation">
                  <pre className="text-xs font-mono whitespace-pre-wrap bg-zinc-50 dark:bg-zinc-900 border rounded p-3 overflow-x-auto">
                    {check.remediation}
                  </pre>
                </DetailSection>
              )}
              {check.defaultValue && (
                <DetailSection icon={<FileText className="size-3.5" />} title="Default value">
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{check.defaultValue}</p>
                </DetailSection>
              )}
              {check.references && (
                <DetailSection icon={<FileText className="size-3.5" />} title="References">
                  <pre className="text-xs whitespace-pre-wrap">{check.references}</pre>
                </DetailSection>
              )}

              {/* Notes */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Auditor notes</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-xs"
                    onClick={() => { updateNotes(check.id, localNotes); }}
                  >
                    Save notes
                  </Button>
                </div>
                <Textarea
                  value={localNotes}
                  onChange={(e) => setLocalNotes(e.target.value)}
                  placeholder="Add your own observations, exceptions, or follow-up actions..."
                  className="text-sm min-h-[60px]"
                />
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

function DetailSection({
  icon, title, children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {icon}
        {title}
      </div>
      <div className="pl-5">{children}</div>
    </div>
  );
}
