/**
 * Report generator — produces downloadable compliance reports.
 * Supports JSON, CSV, Markdown, Excel (.xlsx), and PDF.
 *
 * All output formats are generated entirely in the browser; no data is sent
 * to a server.
 */

import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { ParsedBenchmark } from '@/lib/cisParser';
import type { CheckStatusEntry } from '@/store/checklistStore';

export interface ReportData {
  benchmarkTitle: string;
  benchmarkVersion: string;
  benchmarkDate: string;
  benchmarkType: string;
  fileName: string;
  generatedAt: string;
  totalChecks: number;
  autoEvaluatable: number;
  summary: {
    pass: number;
    fail: number;
    manual: number;
    pending: number;
    na: number;
    complianceScore: number;
  };
  bySection: Array<{
    section: number;
    sectionName: string;
    total: number;
    pass: number;
    fail: number;
    manual: number;
    pending: number;
    na: number;
  }>;
  checks: Array<{
    id: string;
    title: string;
    section: number;
    sectionName: string;
    subsection: string;
    profile: string;
    assessmentStatus: string;
    status: string;
    evaluatorMessage?: string;
    evaluatorEvidence?: string;
    evaluatorHints?: string[];
    notes?: string;
  }>;
}

export function buildReport(
  benchmark: ParsedBenchmark | null,
  statuses: Record<string, CheckStatusEntry>,
): ReportData {
  const bySectionMap = new Map<number, {
    section: number; sectionName: string; total: number;
    pass: number; fail: number; manual: number; pending: number; na: number;
  }>();

  const summary = {
    pass: 0, fail: 0, manual: 0, pending: 0, na: 0,
    complianceScore: 0,
  };

  if (!benchmark) {
    return {
      benchmarkTitle: 'No benchmark loaded',
      benchmarkVersion: '',
      benchmarkDate: '',
      benchmarkType: '',
      fileName: '',
      generatedAt: new Date().toISOString(),
      totalChecks: 0,
      autoEvaluatable: 0,
      summary,
      bySection: [],
      checks: [],
    };
  }

  for (const rec of benchmark.recommendations) {
    if (!bySectionMap.has(rec.section)) {
      bySectionMap.set(rec.section, {
        section: rec.section,
        sectionName: rec.sectionName,
        total: 0, pass: 0, fail: 0, manual: 0, pending: 0, na: 0,
      });
    }
    const s = bySectionMap.get(rec.section)!;
    s.total++;
    const entry = statuses[rec.id];
    const status = entry?.status ?? 'pending';
    if (status === 'pass') { s.pass++; summary.pass++; }
    else if (status === 'fail') { s.fail++; summary.fail++; }
    else if (status === 'manual') { s.manual++; summary.manual++; }
    else if (status === 'na') { s.na++; summary.na++; }
    else { s.pending++; summary.pending++; }
  }

  const denom = summary.pass + summary.fail;
  summary.complianceScore = denom === 0 ? 0 : Math.round((summary.pass / denom) * 100);

  const checks = benchmark.recommendations.map((c) => {
    const entry = statuses[c.id];
    return {
      id: c.id,
      title: c.title,
      section: c.section,
      sectionName: c.sectionName,
      subsection: c.subsection,
      profile: c.profile.join(', '),
      assessmentStatus: c.assessmentStatus,
      status: entry?.status ?? 'pending',
      evaluatorMessage: entry?.evaluatorMessage,
      evaluatorEvidence: entry?.evaluatorEvidence,
      evaluatorHints: entry?.evaluatorHints,
      notes: entry?.notes,
    };
  });

  // Count auto-evaluatable: for now, anything where we have an evaluator result
  // OR where the benchmark type is nginx (we know nginx has evaluators).
  // A more accurate count would require importing the evaluator registry.
  let autoEvaluatable = 0;
  for (const c of benchmark.recommendations) {
    if (statuses[c.id]?.evaluatorMessage) autoEvaluatable++;
  }

  return {
    benchmarkTitle: benchmark.title,
    benchmarkVersion: benchmark.version,
    benchmarkDate: benchmark.date,
    benchmarkType: benchmark.benchmarkType,
    fileName: benchmark.fileName,
    generatedAt: new Date().toISOString(),
    totalChecks: benchmark.recommendations.length,
    autoEvaluatable,
    summary,
    bySection: Array.from(bySectionMap.values()).sort((a, b) => a.section - b.section),
    checks,
  };
}

export function buildCsv(report: ReportData): string {
  const rows: string[][] = [];
  rows.push(['ID', 'Title', 'Section', 'Section Name', 'Subsection', 'Profile', 'Assessment', 'Status', 'Evaluator Message', 'Evaluator Evidence', 'Notes']);
  for (const c of report.checks) {
    rows.push([
      c.id, c.title, String(c.section), c.sectionName, c.subsection,
      c.profile, c.assessmentStatus, c.status,
      c.evaluatorMessage ?? '', c.evaluatorEvidence ?? '',
      c.notes ?? '',
    ]);
  }
  return rows.map((r) => r.map(csvEscape).join(',')).join('\n');
}

function csvEscape(v: string): string {
  if (/[",\n]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

export function buildMarkdown(report: ReportData): string {
  const lines: string[] = [];
  lines.push(`# ${report.benchmarkTitle} ${report.benchmarkVersion} — Compliance Report`);
  if (report.benchmarkDate) lines.push(`_Benchmark date: ${report.benchmarkDate}_`);
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- **Total checks:** ${report.totalChecks}`);
  lines.push(`- **Pass:** ${report.summary.pass}`);
  lines.push(`- **Fail:** ${report.summary.fail}`);
  lines.push(`- **Manual review required:** ${report.summary.manual}`);
  lines.push(`- **Not applicable:** ${report.summary.na}`);
  lines.push(`- **Pending:** ${report.summary.pending}`);
  lines.push(`- **Compliance score:** ${report.summary.complianceScore}%`);
  lines.push('');
  lines.push('## By Section');
  lines.push('');
  lines.push('| Section | Total | Pass | Fail | Manual | NA | Pending |');
  lines.push('|---------|-------|------|------|--------|----|---------|');
  for (const s of report.bySection) {
    lines.push(`| ${s.section}. ${s.sectionName} | ${s.total} | ${s.pass} | ${s.fail} | ${s.manual} | ${s.na} | ${s.pending} |`);
  }
  lines.push('');
  lines.push('## Per-Check Results');
  lines.push('');
  for (const c of report.checks) {
    const icon = c.status === 'pass' ? '✅' : c.status === 'fail' ? '❌' : c.status === 'manual' ? '⚠️' : c.status === 'na' ? '➖' : '⏳';
    lines.push(`### ${icon} ${c.id} — ${c.title}`);
    lines.push('');
    lines.push(`- **Section:** ${c.section}. ${c.sectionName}${c.subsection ? ` › ${c.subsection}` : ''}`);
    lines.push(`- **Status:** \`${c.status}\``);
    lines.push(`- **Assessment:** ${c.assessmentStatus}`);
    if (c.profile) lines.push(`- **Profile:** ${c.profile}`);
    if (c.evaluatorMessage) lines.push(`- **Evaluator message:** ${c.evaluatorMessage}`);
    if (c.evaluatorEvidence) {
      lines.push('');
      lines.push('```');
      lines.push(c.evaluatorEvidence);
      lines.push('```');
    }
    if (c.notes) lines.push(`- **Notes:** ${c.notes}`);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Build an Excel workbook with two sheets:
 *   1. "Summary"        — overall stats and per-section breakdown
 *   2. "Per-check detail" — one row per check with all fields
 */
export function buildXlsx(report: ReportData): ArrayBuffer {
  const wb = XLSX.utils.book_new();

  // Summary sheet
  const summaryRows: (string | number)[][] = [
    ['Field', 'Value'],
    ['Benchmark', `${report.benchmarkTitle} ${report.benchmarkVersion}`],
    ['Benchmark date', report.benchmarkDate || 'unknown'],
    ['Source file', report.fileName],
    ['Generated', report.generatedAt],
    [],
    ['Overall stats', ''],
    ['Total checks', report.totalChecks],
    ['Pass', report.summary.pass],
    ['Fail', report.summary.fail],
    ['Manual review required', report.summary.manual],
    ['Not applicable', report.summary.na],
    ['Pending', report.summary.pending],
    ['Compliance score (%)', report.summary.complianceScore],
    [],
    ['Per-section breakdown', ''],
    ['Section', 'Total', 'Pass', 'Fail', 'Manual', 'NA', 'Pending'],
    ...report.bySection.map((s) => [
      `${s.section}. ${s.sectionName}`,
      s.total, s.pass, s.fail, s.manual, s.na, s.pending,
    ] as (string | number)[]),
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = [
    { wch: 36 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 10 },
  ];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

  // Per-check sheet
  const detailRows: (string | number)[][] = [
    [
      'ID', 'Title', 'Section', 'Section Name', 'Subsection',
      'Profile', 'Assessment', 'Status',
      'Evaluator Message', 'Evaluator Evidence', 'Notes',
    ],
    ...report.checks.map((c) => [
      c.id, c.title, c.section, c.sectionName, c.subsection,
      c.profile, c.assessmentStatus, c.status,
      c.evaluatorMessage ?? '', c.evaluatorEvidence ?? '', c.notes ?? '',
    ] as (string | number)[]),
  ];
  const wsDetail = XLSX.utils.aoa_to_sheet(detailRows);
  wsDetail['!cols'] = [
    { wch: 10 }, { wch: 50 }, { wch: 8 }, { wch: 28 }, { wch: 22 },
    { wch: 32 }, { wch: 12 }, { wch: 10 },
    { wch: 50 }, { wch: 50 }, { wch: 40 },
  ];
  XLSX.utils.book_append_sheet(wb, wsDetail, 'Per-check detail');

  // Generate as array buffer
  const arr = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return arr.buffer;
}

/**
 * Build a multi-page PDF report:
 *   - Page 1: Cover page with benchmark title, version, date, summary stats
 *   - Page 2: Per-section breakdown table
 *   - Pages 3+: Per-check results table (auto-paginated)
 */
export function buildPdf(report: ReportData): ArrayBuffer {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;

  // ---- Page 1: Cover ----
  let y = 80;
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text(report.benchmarkTitle, pageWidth / 2, y, { align: 'center' });
  y += 24;
  doc.setFontSize(14);
  doc.setFont('helvetica', 'normal');
  doc.text(`Compliance Report ${report.benchmarkVersion}`, pageWidth / 2, y, { align: 'center' });
  y += 24;
  if (report.benchmarkDate) {
    doc.setFontSize(10);
    doc.text(`Benchmark date: ${report.benchmarkDate}`, pageWidth / 2, y, { align: 'center' });
    y += 16;
  }
  if (report.fileName) {
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.text(`Source: ${report.fileName}`, pageWidth / 2, y, { align: 'center' });
    y += 14;
    doc.text(`Generated: ${report.generatedAt}`, pageWidth / 2, y, { align: 'center' });
    doc.setTextColor(0, 0, 0);
  }

  y += 40;
  // Big compliance score
  const scoreColor = report.summary.complianceScore >= 80 ? [16, 185, 129]
    : report.summary.complianceScore >= 50 ? [245, 158, 11]
    : [220, 38, 38];
  doc.setFillColor(scoreColor[0], scoreColor[1], scoreColor[2]);
  doc.roundedRect(pageWidth / 2 - 120, y, 240, 100, 8, 8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(48);
  doc.setFont('helvetica', 'bold');
  doc.text(`${report.summary.complianceScore}%`, pageWidth / 2, y + 56, { align: 'center' });
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text('Compliance Score', pageWidth / 2, y + 80, { align: 'center' });
  doc.setTextColor(0, 0, 0);

  y += 130;
  // Stats row
  const stats: [string, number, [number, number, number]][] = [
    ['Passed', report.summary.pass, [16, 185, 129]],
    ['Failed', report.summary.fail, [220, 38, 38]],
    ['Manual', report.summary.manual, [245, 158, 11]],
    ['N/A', report.summary.na, [113, 113, 122]],
    ['Pending', report.summary.pending, [113, 113, 122]],
  ];
  const colW = (pageWidth - margin * 2) / stats.length;
  stats.forEach(([label, value, color], i) => {
    const x = margin + i * colW;
    doc.setFillColor(color[0], color[1], color[2]);
    doc.roundedRect(x + 4, y, colW - 8, 50, 4, 4, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text(String(value), x + colW / 2 - 4, y + 28, { align: 'center' });
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(label, x + colW / 2 - 4, y + 42, { align: 'center' });
  });
  doc.setTextColor(0, 0, 0);

  // ---- Page 2: Section breakdown ----
  doc.addPage();
  y = margin;
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('Section Breakdown', margin, y);
  y += 16;

  autoTable(doc, {
    startY: y,
    head: [['#', 'Section', 'Total', 'Pass', 'Fail', 'Manual', 'N/A', 'Pending', 'Score']],
    body: report.bySection.map((s) => {
      const denom = s.pass + s.fail;
      const score = denom === 0 ? '-' : `${Math.round((s.pass / denom) * 100)}%`;
      return [
        String(s.section),
        s.sectionName,
        String(s.total),
        String(s.pass),
        String(s.fail),
        String(s.manual),
        String(s.na),
        String(s.pending),
        score,
      ];
    }),
    headStyles: { fillColor: [24, 24, 27], textColor: 255, fontSize: 10 },
    bodyStyles: { fontSize: 9 },
    columnStyles: {
      0: { cellWidth: 25 },
      1: { cellWidth: 'auto' },
    },
    margin: { left: margin, right: margin },
  });

  // ---- Pages 3+: Per-check details ----
  y = (doc as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? margin;
  y += 24;
  if (y > pageHeight - 100) { doc.addPage(); y = margin; }
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('Per-Check Results', margin, y);
  y += 8;

  autoTable(doc, {
    startY: y + 8,
    head: [['ID', 'Title', 'Section', 'Status', 'Message']],
    body: report.checks.map((c) => [
      c.id,
      c.title.length > 80 ? c.title.slice(0, 80) + '…' : c.title,
      `${c.section}. ${c.sectionName}`,
      c.status.toUpperCase(),
      c.evaluatorMessage ? (c.evaluatorMessage.length > 100 ? c.evaluatorMessage.slice(0, 100) + '…' : c.evaluatorMessage) : (c.notes ?? ''),
    ]),
    headStyles: { fillColor: [24, 24, 27], textColor: 255, fontSize: 10 },
    bodyStyles: { fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 45 },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 90 },
      3: { cellWidth: 50, halign: 'center' },
      4: { cellWidth: 180 },
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 3) {
        const status = report.checks[data.row.index].status;
        if (status === 'pass') data.cell.styles.fillColor = [209, 250, 229];
        else if (status === 'fail') data.cell.styles.fillColor = [254, 226, 226];
        else if (status === 'manual') data.cell.styles.fillColor = [254, 243, 199];
      }
    },
    margin: { left: margin, right: margin },
  });

  // Footer page numbers
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(
      `${report.benchmarkTitle} ${report.benchmarkVersion} — Page ${i} of ${pageCount}`,
      pageWidth / 2, pageHeight - 20, { align: 'center' },
    );
    doc.setTextColor(0, 0, 0);
  }

  // Return as ArrayBuffer
  return doc.output('arraybuffer');
}

/** Trigger a browser download of the given content as a file. */
export function downloadFile(filename: string, content: string | ArrayBuffer, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
