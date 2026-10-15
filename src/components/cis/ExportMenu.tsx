'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Download, FileJson, FileSpreadsheet, FileText, RotateCcw, Loader2, FileDown } from 'lucide-react';
import { useChecklistStore } from '@/store/checklistStore';
import { buildReport, buildCsv, buildMarkdown, buildXlsx, buildPdf, downloadFile } from '@/lib/reportGenerator';
import { toast } from 'sonner';

type ExportFormat = 'json' | 'csv' | 'md' | 'xlsx' | 'pdf';

export function ExportMenu() {
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const benchmark = useChecklistStore((s) => s.benchmark);
  const statuses = useChecklistStore((s) => s.statuses);
  const resetAll = useChecklistStore((s) => s.resetAll);

  if (!benchmark) return null;

  const handleExport = (format: ExportFormat) => {
    if (!benchmark) return;
    setBusy(format);
    setTimeout(() => {
      try {
        const report = buildReport(benchmark, statuses);
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const baseName = benchmark.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        const version = benchmark.version.replace(/[^\d.]/g, '');
        const fileName = `cis-${baseName}-${version}-report-${stamp}`;

        if (format === 'json') {
          downloadFile(`${fileName}.json`, JSON.stringify(report, null, 2), 'application/json');
        } else if (format === 'csv') {
          downloadFile(`${fileName}.csv`, buildCsv(report), 'text/csv');
        } else if (format === 'md') {
          downloadFile(`${fileName}.md`, buildMarkdown(report), 'text/markdown');
        } else if (format === 'xlsx') {
          const buf = buildXlsx(report);
          downloadFile(`${fileName}.xlsx`, buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        } else if (format === 'pdf') {
          const buf = buildPdf(report);
          downloadFile(`${fileName}.pdf`, buf, 'application/pdf');
        }
        toast.success(`Exported ${format.toUpperCase()} report`);
      } catch (e) {
        toast.error('Export failed: ' + (e as Error).message);
      } finally {
        setBusy(null);
      }
    }, 50);
  };

  const handleReset = () => {
    if (confirm('Reset all checklist statuses to pending? This cannot be undone.')) {
      resetAll();
      toast.success('Checklist reset');
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={handleReset}>
        <RotateCcw className="size-3.5" />
        Reset
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" disabled={busy !== null}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
            Export report
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel>Download compliance report</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => handleExport('xlsx')} disabled={busy !== null}>
            <FileSpreadsheet className="size-4 mr-2 text-emerald-600" />
            <div className="flex flex-col">
              <span>Excel (.xlsx)</span>
              <span className="text-[10px] text-muted-foreground">Two sheets: summary + per-check</span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleExport('pdf')} disabled={busy !== null}>
            <FileDown className="size-4 mr-2 text-red-600" />
            <div className="flex flex-col">
              <span>PDF report</span>
              <span className="text-[10px] text-muted-foreground">Formatted multi-page document</span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => handleExport('csv')} disabled={busy !== null}>
            <FileSpreadsheet className="size-4 mr-2" />
            <div className="flex flex-col">
              <span>CSV spreadsheet</span>
              <span className="text-[10px] text-muted-foreground">Open in Excel / Google Sheets</span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleExport('json')} disabled={busy !== null}>
            <FileJson className="size-4 mr-2" />
            <div className="flex flex-col">
              <span>JSON report</span>
              <span className="text-[10px] text-muted-foreground">Machine-readable, all fields</span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleExport('md')} disabled={busy !== null}>
            <FileText className="size-4 mr-2" />
            <div className="flex flex-col">
              <span>Markdown report</span>
              <span className="text-[10px] text-muted-foreground">Human-readable summary</span>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
