'use client';

import { useMemo, useState } from 'react';
import { useChecklistStore, computeOverallStats, filterChecks } from '@/store/checklistStore';
import { SectionSidebar } from '@/components/cis/SectionSidebar';
import { EnvironmentPanel } from '@/components/cis/EnvironmentPanel';
import { FilterBar } from '@/components/cis/FilterBar';
import { ChecklistItem } from '@/components/cis/ChecklistItem';
import { ExportMenu } from '@/components/cis/ExportMenu';
import { StatCard } from '@/components/cis/StatCard';
import { UploadPanel } from '@/components/cis/UploadPanel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ShieldCheck, ShieldAlert, AlertTriangle, MinusCircle, Clock, BookOpen, FileText, RefreshCw } from 'lucide-react';
import { Toaster } from 'sonner';

export default function Home() {
  const benchmark = useChecklistStore((s) => s.benchmark);
  const statuses = useChecklistStore((s) => s.statuses);
  const sectionFilter = useChecklistStore((s) => s.sectionFilter);
  const statusFilter = useChecklistStore((s) => s.statusFilter);
  const searchQuery = useChecklistStore((s) => s.searchQuery);
  const setBenchmark = useChecklistStore((s) => s.setBenchmark);

  const [showUpload, setShowUpload] = useState(false);

  const overall = useMemo(
    () => computeOverallStats(benchmark, statuses),
    [benchmark, statuses],
  );
  const filteredChecks = useMemo(
    () => filterChecks(benchmark, statuses, sectionFilter, statusFilter, searchQuery),
    [benchmark, statuses, sectionFilter, statusFilter, searchQuery],
  );

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950">
      <Toaster position="top-right" richColors />

      {/* Header */}
      <header className="border-b bg-white dark:bg-zinc-900 sticky top-0 z-30">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="size-9 rounded-md bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center">
              <ShieldCheck className="size-5 text-white dark:text-zinc-900" />
            </div>
            <div className="leading-tight">
              <div className="font-semibold text-base sm:text-lg">
                {benchmark ? benchmark.title : 'CIS Benchmark Scanner'}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {benchmark
                  ? `${benchmark.version}${benchmark.date ? ` — ${benchmark.date}` : ''} · ${benchmark.recommendationCount} recommendations`
                  : 'Upload a CIS Benchmark PDF to begin'}
              </div>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-4">
            {benchmark && (
              <div className="hidden md:flex flex-col items-end">
                <div className="text-[11px] text-muted-foreground">Compliance score</div>
                <div className="flex items-baseline gap-1.5">
                  <span className={
                    overall.complianceScore >= 80 ? 'text-emerald-600 text-2xl font-bold tabular-nums'
                    : overall.complianceScore >= 50 ? 'text-amber-600 text-2xl font-bold tabular-nums'
                    : 'text-red-600 text-2xl font-bold tabular-nums'
                  }>
                    {overall.complianceScore}%
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {overall.pass}/{overall.pass + overall.fail} audited
                  </span>
                </div>
              </div>
            )}
            {benchmark && (
              <Button variant="outline" size="sm" onClick={() => setShowUpload(true)}>
                <RefreshCw className="size-3.5" />
                Change benchmark
              </Button>
            )}
            {benchmark && <ExportMenu />}
          </div>
        </div>

        {/* Progress bar */}
        {benchmark && (
          <div className="h-1 bg-zinc-100 dark:bg-zinc-800 overflow-hidden flex">
            {overall.pass > 0 && (
              <div className="bg-emerald-500" style={{ width: `${(overall.pass / overall.total) * 100}%` }} />
            )}
            {overall.fail > 0 && (
              <div className="bg-red-500" style={{ width: `${(overall.fail / overall.total) * 100}%` }} />
            )}
            {overall.manual > 0 && (
              <div className="bg-amber-500" style={{ width: `${(overall.manual / overall.total) * 100}%` }} />
            )}
            {overall.na > 0 && (
              <div className="bg-zinc-400" style={{ width: `${(overall.na / overall.total) * 100}%` }} />
            )}
          </div>
        )}
      </header>

      {/* Body: upload landing OR sidebar + checklist */}
      {!benchmark || showUpload ? (
        <div className="flex-1 max-w-screen-md mx-auto w-full px-4 sm:px-6 py-12">
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <h1 className="text-3xl font-bold tracking-tight">
                {showUpload ? 'Upload a new benchmark' : 'CIS Benchmark Compliance Automation'}
              </h1>
              <p className="text-sm text-muted-foreground max-w-2xl mx-auto">
                Upload any official CIS Benchmark PDF (NGINX, Apache, Windows, Linux, Kubernetes, ...).
                The system extracts all recommendations, audit commands, and remediation steps, and dynamically
                builds an interactive checklist. Export results as Excel, PDF, CSV, JSON, or Markdown.
              </p>
            </div>
            <UploadPanel
              variant="landing"
              onLoaded={() => setShowUpload(false)}
            />
            <div className="grid sm:grid-cols-3 gap-4 text-sm">
              <FeatureCard
                icon={<FileText className="size-4 text-emerald-600" />}
                title="Dynamic parsing"
                description="Extracts recommendations, audit procedures, remediation steps, and section structure from any CIS PDF."
              />
              <FeatureCard
                icon={<ShieldCheck className="size-4 text-emerald-600" />}
                title="Auto-evaluation"
                description="For the NGINX benchmark, 35 checks are auto-evaluated from your `nginx -T` config dump. Other benchmarks fall back to manual checklist mode."
              />
              <FeatureCard
                icon={<BookOpen className="size-4 text-emerald-600" />}
                title="Multi-format export"
                description="Generate compliance reports in Excel (.xlsx), PDF, CSV, JSON, or Markdown — all client-side, no data leaves your browser."
              />
            </div>
            {showUpload && (
              <div className="text-center pt-4">
                <Button variant="ghost" onClick={() => setShowUpload(false)}>
                  ← Back to checklist
                </Button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 max-w-screen-2xl mx-auto w-full px-4 sm:px-6 py-4 flex gap-6">
          {/* Sidebar */}
          <aside className="hidden lg:block w-64 shrink-0">
            <div className="sticky top-[88px]">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-3">
                Sections
              </h2>
              <SectionSidebar />
              <div className="mt-6 p-3 rounded-md bg-white dark:bg-zinc-900 border text-xs space-y-1">
                <div className="flex items-center gap-1.5 font-medium mb-2">
                  <BookOpen className="size-3.5" />
                  About this benchmark
                </div>
                <p className="text-muted-foreground leading-relaxed">
                  Loaded <strong>{benchmark.title} {benchmark.version}</strong> with {benchmark.recommendationCount} recommendations across {benchmark.sections.length} sections.
                </p>
                <p className="text-muted-foreground leading-relaxed">
                  Detected type: <Badge variant="outline" className="text-[10px] py-0 capitalize ml-1">{benchmark.benchmarkType}</Badge>
                </p>
                {benchmark.warnings.length > 0 && (
                  <p className="text-amber-600 dark:text-amber-400 leading-relaxed mt-1">
                    ⚠ {benchmark.warnings.length} warning(s) during parse
                  </p>
                )}
              </div>
            </div>
          </aside>

          {/* Main */}
          <main className="flex-1 min-w-0 space-y-4">
            {/* KPI cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <StatCard
                label="Passed"
                value={overall.pass}
                total={overall.total}
                colorClass="bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300"
                icon={<ShieldCheck className="size-5" />}
                onClick={() => useChecklistStore.getState().setStatusFilter('pass')}
                active={statusFilter === 'pass'}
              />
              <StatCard
                label="Failed"
                value={overall.fail}
                total={overall.total}
                colorClass="bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300"
                icon={<ShieldAlert className="size-5" />}
                onClick={() => useChecklistStore.getState().setStatusFilter('fail')}
                active={statusFilter === 'fail'}
              />
              <StatCard
                label="Manual review"
                value={overall.manual}
                total={overall.total}
                colorClass="bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300"
                icon={<AlertTriangle className="size-5" />}
                onClick={() => useChecklistStore.getState().setStatusFilter('manual')}
                active={statusFilter === 'manual'}
              />
              <StatCard
                label="Not applicable"
                value={overall.na}
                total={overall.total}
                colorClass="bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                icon={<MinusCircle className="size-5" />}
                onClick={() => useChecklistStore.getState().setStatusFilter('na')}
                active={statusFilter === 'na'}
              />
              <StatCard
                label="Pending"
                value={overall.pending}
                total={overall.total}
                colorClass="bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                icon={<Clock className="size-5" />}
                onClick={() => useChecklistStore.getState().setStatusFilter('pending')}
                active={statusFilter === 'pending'}
              />
            </div>

            {/* Environment panel (only shown for nginx-type benchmarks) */}
            <EnvironmentPanel />

            {/* Filter bar */}
            <FilterBar />

            {/* Result count */}
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">
                Showing <span className="font-medium text-foreground">{filteredChecks.length}</span> of {benchmark.recommendations.length} recommendations
              </span>
              {sectionFilter !== 0 && (
                <Badge variant="outline" className="text-[10px]">
                  {benchmark.sections.find((s) => s.section === sectionFilter)?.sectionName}
                </Badge>
              )}
            </div>

            {/* Checklist items */}
            <div className="space-y-3">
              {filteredChecks.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  No recommendations match the current filters.
                </div>
              ) : (
                filteredChecks.map((check, i) => (
                  <ChecklistItem
                    key={check.id}
                    check={check}
                    index={i}
                    benchmarkType={benchmark.benchmarkType}
                  />
                ))
              )}
            </div>

            {/* Footer */}
            <footer className="mt-12 pt-6 border-t text-center text-xs text-muted-foreground">
              <p>
                {benchmark.title} {benchmark.version}
                {benchmark.date ? ` — ${benchmark.date}` : ''}
                {' '}-{benchmark.recommendationCount} recommendations across {benchmark.sections.length} sections.
              </p>
              <p className="mt-1">
                All assessment results are stored locally in your browser (no data is sent to a server).
              </p>
            </footer>
          </main>
        </div>
      )}
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="p-4 rounded-md border bg-white dark:bg-zinc-900">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="font-medium">{title}</span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
    </div>
  );
}
