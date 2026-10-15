'use client';

import { useCallback, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useChecklistStore } from '@/store/checklistStore';
import { UploadCloud, FileText, Loader2, AlertCircle, FileUp, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface UploadPanelProps {
  /** Called after a successful upload + parse. */
  onLoaded?: () => void;
  variant?: 'landing' | 'compact';
}

export function UploadPanel({ onLoaded, variant = 'landing' }: UploadPanelProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const uploadInProgress = useChecklistStore((s) => s.uploadInProgress);
  const uploadError = useChecklistStore((s) => s.uploadError);
  const setBenchmark = useChecklistStore((s) => s.setBenchmark);
  const setUploadInProgress = useChecklistStore((s) => s.setUploadInProgress);
  const setUploadError = useChecklistStore((s) => s.setUploadError);

  const handleFile = useCallback(async (file: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setUploadError('Only PDF files are accepted.');
      toast.error('Only PDF files are accepted.');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setUploadError('File too large. Max 50 MB.');
      toast.error('File too large. Max 50 MB.');
      return;
    }

    setUploadInProgress(true);
    setUploadError(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const resp = await fetch('/api/parse-cis-pdf', {
        method: 'POST',
        body: formData,
      });
      if (!resp.ok) {
        let msg = `Server error (${resp.status})`;
        try {
          const body = await resp.json();
          if (body.error) msg = body.error;
        } catch {
          // ignore
        }
        throw new Error(msg);
      }
      const data = await resp.json();
      setBenchmark(data);
      toast.success(`Loaded "${data.title} ${data.version}" with ${data.recommendationCount} recommendations`);
      if (data.warnings && data.warnings.length > 0) {
        data.warnings.forEach((w: string) => toast.warning(w));
      }
      onLoaded?.();
    } catch (e) {
      const msg = (e as Error).message;
      setUploadError(msg);
      toast.error(`Upload failed: ${msg}`);
    } finally {
      setUploadInProgress(false);
    }
  }, [setBenchmark, setUploadInProgress, setUploadError, onLoaded]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const isLanding = variant === 'landing';

  return (
    <Card
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        'transition-all',
        dragging && 'border-zinc-900 dark:border-zinc-100 ring-2 ring-zinc-900/20 dark:ring-zinc-100/20',
        isLanding && 'border-2 border-dashed',
      )}
    >
      {isLanding ? (
        <CardContent className="p-8 sm:p-12 flex flex-col items-center text-center gap-4">
          <div className="size-16 rounded-full bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center">
            {uploadInProgress ? (
              <Loader2 className="size-7 text-white dark:text-zinc-900 animate-spin" />
            ) : (
              <UploadCloud className="size-7 text-white dark:text-zinc-900" />
            )}
          </div>
          <div className="space-y-1.5">
            <h2 className="text-xl font-semibold">Upload a CIS Benchmark PDF</h2>
            <p className="text-sm text-muted-foreground max-w-md">
              Drag &amp; drop the benchmark PDF here, or click to browse. The system will parse the document and dynamically build a checklist for you.
            </p>
          </div>
          <Button
            onClick={() => inputRef.current?.click()}
            disabled={uploadInProgress}
            size="lg"
          >
            {uploadInProgress ? (
              <><Loader2 className="size-4 animate-spin" /> Parsing PDF...</>
            ) : (
              <><FileUp className="size-4" /> Choose PDF file</>
            )}
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Max 50MB · Accepts any CIS Benchmark (NGINX, Apache, Windows, Linux, Kubernetes, ...)
          </p>
          {uploadError && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-3 py-2 rounded-md">
              <AlertCircle className="size-4 shrink-0" />
              <span>{uploadError}</span>
            </div>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              // Reset so the same file can be selected again
              e.target.value = '';
            }}
          />
          <div className="mt-6 pt-6 border-t w-full max-w-md">
            <p className="text-xs text-muted-foreground mb-3">
              Don&apos;t have one handy? The tool works with any official CIS Benchmark PDF.
              Here&apos;s what gets extracted automatically:
            </p>
            <div className="grid grid-cols-2 gap-2 text-left">
              <Feature icon={<ShieldCheck className="size-3.5" />} label="Recommendations" />
              <Feature icon={<FileText className="size-3.5" />} label="Audit commands" />
              <Feature icon={<FileText className="size-3.5" />} label="Remediation steps" />
              <Feature icon={<FileText className="size-3.5" />} label="Section structure" />
            </div>
          </div>
        </CardContent>
      ) : (
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileUp className="size-4 text-zinc-500" />
            Upload a different benchmark
          </CardTitle>
          <CardDescription>
            Load a new CIS Benchmark PDF. This will replace the currently loaded benchmark and reset all statuses.
          </CardDescription>
        </CardHeader>
      )}
      {!isLanding && (
        <CardContent className="pt-0">
          <Button
            onClick={() => inputRef.current?.click()}
            disabled={uploadInProgress}
            variant="outline"
            size="sm"
          >
            {uploadInProgress ? (
              <><Loader2 className="size-3.5 animate-spin" /> Parsing...</>
            ) : (
              <><UploadCloud className="size-3.5" /> Choose PDF</>
            )}
          </Button>
          {uploadError && (
            <div className="flex items-center gap-2 text-sm text-red-600 mt-2">
              <AlertCircle className="size-4 shrink-0" />
              <span>{uploadError}</span>
            </div>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = '';
            }}
          />
        </CardContent>
      )}
    </Card>
  );
}

function Feature({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {icon}
      {label}
    </div>
  );
}
