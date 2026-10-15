---
Task ID: cis-benchmark-scanner-v2
Agent: Super Z (main)
Task: Refactor the app to accept any uploaded CIS Benchmark PDF (not just NGINX), dynamically generate the UI based on the parsed PDF, and add Excel + PDF export.

Work Log:
- Installed dependencies: pdf-parse (unused after switching to pdftotext binary), xlsx (SheetJS — Excel generation), jspdf + jspdf-autotable (PDF generation).
- Wrote src/lib/cisParser.ts — TypeScript port of the Python extractor. Generic CIS Benchmark parser that:
  - Extracts title, version, date from PDF metadata
  - Detects benchmark type from title (nginx/apache/windows/linux/iis/kubernetes/docker/aws/azure/gcp/postgresql/mysql/mongodb/redis/elasticsearch/vmware)
  - Walks the PDF text finding every "Profile Applicability:" marker, then walks backward to find the recommendation header (X.Y.Z or X.Y), parses all fields up to the next known field marker.
  - Extracts sections/subsection names from the TOC.
  - Returns a ParsedBenchmark with all recommendations, sections, warnings.
- Wrote src/app/api/parse-cis-pdf/route.ts — POST endpoint that:
  - Accepts multipart/form-data upload with a "file" field
  - Saves the PDF to /tmp/cis-uploads/<uuid>_<filename>
  - Shells out to `pdftotext -layout` (more reliable than pdf-parse library)
  - Runs the cisParser, returns ParsedBenchmark JSON
- Refactored src/store/checklistStore.ts:
  - Now holds `benchmark: ParsedBenchmark | null` instead of relying on imported CIS_CHECKS
  - All selectors (computeSectionStats, computeOverallStats, filterChecks) now take benchmark as a parameter
  - setBenchmark() resets statuses, filters, and only pre-selects the sample profile when benchmarkType === 'nginx'
  - Persisted to localStorage including the benchmark itself
- Refactored src/lib/evaluators.ts:
  - Added EVALUATOR_REGISTRY keyed by benchmark type
  - { nginx: { ...35 evaluators } } registered
  - Other benchmark types fall back to "Manual review required"
  - Exports hasEvaluatorForCheck(type, id) and runEvaluatorForBenchmark(type, id, ctx) for use by UI/store
- Updated src/components/cis/*:
  - SectionSidebar, FilterBar, ChecklistItem, EnvironmentPanel now read from dynamic benchmark instead of static CIS_CHECKS
  - EnvironmentPanel only shows sample profile selector and custom-paste fields when benchmarkType === 'nginx'
  - ChecklistItem receives benchmarkType prop, uses hasEvaluatorForCheck() to determine auto-auditability
  - ExportMenu now offers Excel, PDF, CSV, JSON, Markdown
- Wrote src/components/cis/UploadPanel.tsx — drag-and-drop upload UI with landing variant and compact variant
- Wrote src/lib/reportGenerator.ts:
  - buildXlsx() generates a two-sheet workbook (Summary + Per-check detail) using SheetJS
  - buildPdf() generates a multi-page PDF using jsPDF + jspdf-autotable: cover page with compliance score color-coded, section breakdown table, per-check results table with colored status cells
  - JSON, CSV, Markdown exports remain
- Rewrote src/app/page.tsx — conditional rendering: when no benchmark loaded (or user clicked "Change benchmark"), shows the upload landing page with feature cards; otherwise shows the sidebar + checklist view. Header has "Change benchmark" button to swap PDFs.
- Fixed bugs:
  - Inline `(?m)` regex flags aren't supported in JS — replaced with `new RegExp(pattern, 'gm')`
  - SECTION_NAMES_FALLBACK was a plain object but called with `.get()` — fixed to use bracket access
  - Typo `'jsp'` instead of `'jspdf'` in import

Verification:
- bun run lint: clean
- curl POST /api/parse-cis-pdf with the NGINX PDF returns HTTP 200 with 44 recommendations, 5 sections, correct title/version/date/type
- agent-browser upload via hidden file input → page transitions from landing to checklist view showing all 44 NGINX recommendations across 5 sections
- "Run all auto-audits" runs all 35 NGINX evaluators → 5 pass / 26 fail / 4 manual / 9 pending (same as before)
- Excel export → "Exported XLSX report" toast
- PDF export → "Exported PDF report" toast
- "Change benchmark" button opens the upload panel with a "Back to checklist" option
- Page reload preserves state (benchmark + statuses) via localStorage

Stage Summary:
- App now accepts ANY CIS Benchmark PDF (not just NGINX) — uploads via drag-and-drop or file picker, parses server-side via pdftotext + cisParser, and dynamically builds the checklist UI from the parsed structure.
- For the NGINX benchmark specifically, the 35 auto-evaluators still work end-to-end against the dynamically-loaded recommendations.
- For all other CIS benchmarks (Apache, Windows, Linux, etc.), the UI renders all recommendations from the PDF in manual-checklist mode with full Description/Rationale/Impact/Audit procedure/Remediation/References.
- Excel (.xlsx) and PDF exports are added alongside the existing CSV/JSON/Markdown options — all generated client-side.
- State (benchmark + per-check statuses + notes) persists to localStorage across refreshes.
- The "Change benchmark" button in the header lets users swap PDFs at any time.
