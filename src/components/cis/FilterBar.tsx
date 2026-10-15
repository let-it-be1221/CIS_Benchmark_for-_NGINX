'use client';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, Filter } from 'lucide-react';
import { useChecklistStore, type CheckStatus } from '@/store/checklistStore';

const STATUS_OPTIONS: { value: CheckStatus | 'all'; label: string }[] = [
  { value: 'all',     label: 'All statuses' },
  { value: 'pass',    label: 'Pass' },
  { value: 'fail',    label: 'Fail' },
  { value: 'manual',  label: 'Manual review' },
  { value: 'na',      label: 'Not applicable' },
  { value: 'pending', label: 'Pending' },
];

export function FilterBar() {
  const benchmark = useChecklistStore((s) => s.benchmark);
  const searchQuery = useChecklistStore((s) => s.searchQuery);
  const setSearchQuery = useChecklistStore((s) => s.setSearchQuery);
  const statusFilter = useChecklistStore((s) => s.statusFilter);
  const setStatusFilter = useChecklistStore((s) => s.setStatusFilter);
  const sectionFilter = useChecklistStore((s) => s.sectionFilter);
  const setSectionFilter = useChecklistStore((s) => s.setSectionFilter);

  if (!benchmark) return null;

  const sections = benchmark.sections;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
      <div className="relative flex-1">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search recommendations (id, title, description, audit, remediation)..."
          className="pl-8"
        />
      </div>
      <Select value={String(sectionFilter)} onValueChange={(v) => setSectionFilter(Number(v))}>
        <SelectTrigger className="w-full sm:w-56">
          <Filter className="size-3.5 text-muted-foreground mr-1.5" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Section</SelectLabel>
            <SelectItem value="0">All sections ({benchmark.recommendations.length})</SelectItem>
            {sections.map((sec) => (
              <SelectItem key={sec.section} value={String(sec.section)}>
                {sec.section}. {sec.sectionName} ({sec.recommendationCount})
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as CheckStatus | 'all')}>
        <SelectTrigger className="w-full sm:w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {(searchQuery || statusFilter !== 'all' || sectionFilter !== 0) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { setSearchQuery(''); setStatusFilter('all'); setSectionFilter(0); }}
        >
          Clear
        </Button>
      )}
    </div>
  );
}
