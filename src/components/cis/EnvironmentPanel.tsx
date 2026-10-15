'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, ChevronUp, Play, Server, Terminal, FileText, Upload, RotateCcw, Loader2, Info } from 'lucide-react';
import { useChecklistStore } from '@/store/checklistStore';
import { SAMPLE_PROFILES } from '@/data/sampleNginx';
import { hasEvaluatorsForBenchmark } from '@/lib/evaluators';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export function EnvironmentPanel() {
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const benchmark = useChecklistStore((s) => s.benchmark);
  const activeProfileId = useChecklistStore((s) => s.activeProfileId);
  const customNginxT = useChecklistStore((s) => s.customNginxT);
  const customNginxV = useChecklistStore((s) => s.customNginxV);
  const setActiveProfile = useChecklistStore((s) => s.setActiveProfile);
  const setCustomNginx = useChecklistStore((s) => s.setCustomNginx);
  const runAllEvaluators = useChecklistStore((s) => s.runAllEvaluators);

  const [customT, setCustomT] = useState(customNginxT);
  const [customV, setCustomV] = useState(customNginxV);

  if (!benchmark) return null;

  const isNginx = benchmark.benchmarkType === 'nginx';
  const hasAutoEvaluators = hasEvaluatorsForBenchmark(benchmark.benchmarkType);

  const handleApplyCustom = () => {
    if (!customT.trim() && !customV.trim()) {
      toast.error('Paste your nginx -T output first');
      return;
    }
    setCustomNginx(customT, customV);
    toast.success('Custom configuration applied');
  };

  const handleRunAll = () => {
    if (!activeProfileId && !customT && !customV) {
      toast.error('Select a sample profile or paste your own nginx -T output first');
      return;
    }
    setBusy(true);
    setTimeout(() => {
      runAllEvaluators();
      setBusy(false);
      toast.success('Auto-evaluation complete');
    }, 50);
  };

  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="size-4 text-zinc-500" />
              Audit Environment
              <Badge variant="outline" className="text-[10px] py-0 ml-1 capitalize">
                {benchmark.benchmarkType}
              </Badge>
            </CardTitle>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="size-7 p-0">
                {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              </Button>
            </CollapsibleTrigger>
          </div>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="space-y-4">
            {!hasAutoEvaluators && (
              <div className="flex items-start gap-2 text-sm bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-100 p-3 rounded-md">
                <Info className="size-4 shrink-0 mt-0.5" />
                <div>
                  <div className="font-medium mb-1">No auto-evaluators available for this benchmark</div>
                  <div className="text-xs">
                    The CIS NGINX Benchmark has built-in evaluators that automatically check configuration against the recommendations.
                    For <strong className="capitalize">{benchmark.benchmarkType}</strong> benchmarks, only manual checklist mode is available —
                    review each item by hand and mark it as Pass / Fail / Manual / N/A.
                  </div>
                </div>
              </div>
            )}

            {isNginx && (
              <div>
                <Label className="text-xs text-muted-foreground">Sample NGINX configuration profiles</Label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
                  {SAMPLE_PROFILES.map((p) => {
                    const active = activeProfileId === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() => setActiveProfile(p.id)}
                        className={cn(
                          'text-left p-3 rounded-md border transition-all',
                          active
                            ? 'border-zinc-900 dark:border-zinc-100 bg-zinc-100 dark:bg-zinc-800'
                            : 'hover:border-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900',
                        )}
                      >
                        <div className="text-sm font-medium">{p.name}</div>
                        <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{p.description}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {isNginx && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Or paste your own NGINX output</Label>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="nginx-t" className="text-xs flex items-center gap-1">
                      <Terminal className="size-3" />
                      nginx -T output (full config dump)
                    </Label>
                    <Textarea
                      id="nginx-t"
                      value={customT}
                      onChange={(e) => setCustomT(e.target.value)}
                      placeholder={'# Paste the output of `nginx -T` here...\n# This includes your full nginx.conf and any included files.'}
                      className="font-mono text-xs mt-1 min-h-[100px] max-h-72 overflow-y-auto"
                    />
                  </div>
                  <div>
                    <Label htmlFor="nginx-v" className="text-xs flex items-center gap-1">
                      <Terminal className="size-3" />
                      nginx -V output (version info)
                    </Label>
                    <Textarea
                      id="nginx-v"
                      value={customV}
                      onChange={(e) => setCustomV(e.target.value)}
                      placeholder={'# Paste the output of `nginx -V` here...\n# e.g. "nginx version: nginx/1.28.0"'}
                      className="font-mono text-xs mt-1 min-h-[100px] max-h-72 overflow-y-auto"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button size="sm" onClick={handleApplyCustom} variant="outline">
                    <Upload className="size-3.5" />
                    Apply custom config
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setCustomT(''); setCustomV(''); setCustomNginx('', ''); }}>
                    <RotateCcw className="size-3.5" />
                    Clear custom input
                  </Button>
                </div>
              </div>
            )}

            {hasAutoEvaluators && (
              <div className="border-t pt-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <FileText className="size-3.5" />
                  {activeProfileId
                    ? `Active: ${SAMPLE_PROFILES.find((p) => p.id === activeProfileId)?.name ?? 'Unknown'}`
                    : customT || customV
                      ? 'Active: custom pasted configuration'
                      : 'No configuration selected'}
                </div>
                <Button onClick={handleRunAll} disabled={busy}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                  Run all auto-audits
                </Button>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
