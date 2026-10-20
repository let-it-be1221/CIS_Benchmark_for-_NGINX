# CIS Benchmark Scanner

Upload any CIS Benchmark PDF (NGINX, Apache, Windows, Linux, Kubernetes, AWS, etc.), the app parses it dynamically and builds an interactive checklist. Run automated audits where supported, mark manual items, and export results to Excel, PDF, CSV, JSON, or Markdown.

Two ways to use this:

| Mode | Description | When to use |
|------|-------------|-------------|
| **Web app** | Interactive browser UI with drag-drop PDF upload, sample profiles, live auto-evaluators, downloadable Excel/PDF/CSV/JSON/MD reports | One-off audits, ad-hoc exploration, manual review with notes |
| **CLI scripts** | Standalone Python scripts (`scripts/cis_audit.py`) that parse PDFs and generate CSV/HTML/PDF reports from the terminal | CI/CD pipelines, scheduled scans, batch audits across many hosts |

Both modes use the same parser logic and NGINX auto-evaluators — pick whichever fits the task.

---

## Quick start (web app)

### 1. Prerequisites

| Tool | Why | Install |
|------|-----|---------|
| **Node.js 18+** | JS runtime | <https://nodejs.org> |
| **Bun** (recommended) or npm/yarn/pnpm | Package manager | `curl -fsSL https://bun.sh/install \| bash` |
| **poppler-utils** (optional) | Faster PDF extraction via `pdftotext` | see [below](#installing-poppler-utils) — if missing, the app auto-falls back to the pure-JS `unpdf` library |

### 2. Install & run

```bash
bun install
bun run dev
```

Open <http://localhost:3000>.

### 3. Use it

1. Drag a CIS Benchmark PDF onto the upload area (or click **Choose PDF file**).
2. The server extracts text (via `pdftotext` locally, or `unpdf` on serverless), parses recommendations, returns JSON.
3. The UI builds itself dynamically — sidebar shows sections, main area shows checklist cards.
4. For the **NGINX** benchmark specifically, 35 checks can be auto-evaluated:
   - Pick a sample profile ("Non-compliant", "Partial compliance", or "Fully hardened"), OR
   - Paste your own `nginx -T` and `nginx -V` output into the textareas.
   - Click **Run all auto-audits**.
5. For all other benchmarks (Apache, Windows, etc.), the UI runs in manual mode — review each recommendation by hand and mark it Pass / Fail / Manual / N/A.
6. Click **Export report** to download results as Excel, PDF, CSV, JSON, or Markdown.

---

## Quick start (CLI)

The CLI runs as standalone Python scripts — no browser or server needed.

### 1. Install prerequisites

```bash
# System: pdftotext (from poppler-utils)
brew install poppler              # macOS
sudo apt-get install -y poppler-utils  # Ubuntu/Debian
sudo dnf install -y poppler-utils      # Fedora/RHEL

# Python deps
pip install -r scripts/requirements.txt
```

### 2. Run your first audit

```bash
# Just parse the PDF and emit JSON to stdout
python scripts/cis_audit.py --pdf CIS_NGINX_Benchmark_v3.0.0.pdf

# Generate CSV, HTML, and PDF reports to a directory
python scripts/cis_audit.py \
  --pdf CIS_NGINX_Benchmark_v3.0.0.pdf \
  --output-dir reports/
```

### 3. Run NGINX auto-evaluators

```bash
# Capture the config from your NGINX host
ssh user@nginx-host 'nginx -T 2>/dev/null' > /tmp/nginx_t.txt
ssh user@nginx-host 'nginx -V 2>&1'        > /tmp/nginx_v.txt

# Run the audit with auto-evaluation
python scripts/cis_audit.py \
  --pdf CIS_NGINX_Benchmark_v3.0.0.pdf \
  --nginx-t /tmp/nginx_t.txt \
  --nginx-v /tmp/nginx_v.txt \
  --output-dir reports/ \
  --base-name nginx-prod-$(date +%Y%m%d)
```

This produces three files in `reports/`:
- `nginx-prod-YYYYMMDD.csv` — machine-readable spreadsheet (open in Excel/Google Sheets)
- `nginx-prod-YYYYMMDD.html` — styled, self-contained HTML report (open in any browser)
- `nginx-prod-YYYYMMDD.pdf` — formatted multi-page PDF document (cover + section breakdown + per-check table)

See [`scripts/README.md`](scripts/README.md) for full CLI documentation including usage, exit codes, CI/CD examples, and troubleshooting.

---

## Deploy to Vercel (web app)

The web app is Vercel-ready out of the box.

### Option A — One-click deploy via dashboard

1. Push this project to a GitHub/GitLab/Bitbucket repo.
2. Go to <https://vercel.com/new> and import the repo.
3. Vercel auto-detects Next.js — leave the defaults.
4. Click **Deploy**. The first build takes ~2 minutes.
5. Visit the deployment URL, upload a CIS Benchmark PDF, and start scanning.

### Option B — Deploy via Vercel CLI

```bash
npm i -g vercel
vercel            # preview deployment
vercel --prod     # production deployment
```

### Environment variables

None required for the core app. The Prisma SQLite path defaults to `file:./db/custom.db` which works on Vercel's writable `/tmp` directory at runtime.

### Function configuration

A `vercel.json` is included with sensible defaults (60s `maxDuration` for the PDF parser).

### What works on Vercel vs local

| Feature | Local | Vercel |
|---------|-------|--------|
| PDF upload + parsing | ✅ via `pdftotext` | ✅ via `unpdf` fallback |
| Auto-evaluators (NGINX) | ✅ | ✅ |
| Excel / PDF / CSV / JSON / MD export | ✅ | ✅ |
| Sample profile selector | ✅ | ✅ |
| Browser state persistence (localStorage) | ✅ | ✅ |
| Server-side SQLite persistence | ✅ | ❌ (filesystem is read-only at runtime) |

---

## Installing poppler-utils

| OS | Command |
|----|---------|
| macOS | `brew install poppler` |
| Ubuntu / Debian | `sudo apt-get install -y poppler-utils` |
| Fedora / RHEL | `sudo dnf install -y poppler-utils` |
| Alpine | `apk add --no-cache poppler-utils` |
| Windows (Scoop) | `scoop install poppler` |
| Windows (Chocolatey) | `choco install poppler` |

Verify it's installed:

```bash
pdftotext -v
```

---

## Project structure

```
.
├── src/                                   ← Web app (Next.js 16)
│   ├── app/
│   │   ├── api/parse-cis-pdf/route.ts     ← POST endpoint (pdftotext → unpdf fallback)
│   │   ├── page.tsx                       ← Main UI (landing + checklist)
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── components/
│   │   ├── ui/                            ← shadcn/ui primitives (pre-installed)
│   │   └── cis/                           ← App-specific components
│   │       ├── UploadPanel.tsx            ← Drag-and-drop PDF upload
│   │       ├── ChecklistItem.tsx          ← One recommendation card
│   │       ├── EnvironmentPanel.tsx       ← Sample profile selector + custom paste
│   │       ├── SectionSidebar.tsx
│   │       ├── FilterBar.tsx
│   │       ├── StatCard.tsx
│   │       ├── StatusBadge.tsx
│   │       └── ExportMenu.tsx
│   ├── data/
│   │   ├── cis_checks.ts                  ← Static NGINX data (fallback / lint)
│   │   └── sampleNginx.ts                 ← 3 sample nginx -T/-V profiles
│   ├── lib/
│   │   ├── cisParser.ts                   ← Generic CIS PDF parser (TS)
│   │   ├── nginxParser.ts                 ← Helpers for parsing nginx -T config text
│   │   ├── evaluators.ts                  ← 35 NGINX-specific auto-evaluators + registry
│   │   ├── reportGenerator.ts             ← JSON / CSV / Markdown / Excel / PDF report builders
│   │   └── utils.ts
│   ├── store/
│   │   └── checklistStore.ts              ← Zustand store (persisted to localStorage)
│   └── hooks/
├── scripts/                               ← CLI scripts (Python)
│   ├── cis_audit.py                       ← Main CLI entry point
│   ├── cis_parser.py                      ← Generic CIS PDF parser (Python port)
│   ├── cis_evaluators.py                  ← 35 NGINX evaluators (Python port)
│   ├── cis_reporters.py                   ← CSV / HTML / PDF report generators
│   ├── extract_checks.py                  ← Original dev tool (kept for reference)
│   ├── gen_ts_data.py                     ← Generates src/data/cis_checks.ts
│   ├── cis_checks.json                    ← Extracted JSON (sample output)
│   ├── requirements.txt                   ← Python deps (reportlab, jinja2)
│   └── README.md                          ← Full CLI docs (usage, CI/CD, troubleshooting)
├── prisma/
│   └── schema.prisma
├── public/
├── vercel.json                            ← Vercel deployment config
├── package.json
├── next.config.ts
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.mjs
├── components.json                        ← shadcn/ui config
└── eslint.config.mjs
```

## Tech stack

**Web app:**
- Next.js 16 (App Router, API routes)
- TypeScript 5
- Tailwind CSS 4 + shadcn/ui component library
- Zustand for client state (persisted to localStorage)
- xlsx (SheetJS) for Excel export
- jsPDF + jspdf-autotable for PDF export
- pdftotext (Poppler) for fast PDF extraction locally; unpdf as serverless-friendly fallback

**CLI scripts:**
- Python 3.9+
- pdftotext (system binary) for PDF text extraction
- Jinja2 for HTML report templating
- ReportLab for PDF report generation
- Standard library `csv` module for CSV

## Adding support for new benchmarks

Both the web app and CLI already work in manual-checklist mode for any CIS Benchmark PDF. To add **auto-evaluators** for another benchmark (e.g. Apache, Windows):

1. **Web app**: Edit `src/lib/evaluators.ts` — add a new entry to `EVALUATOR_REGISTRY`.
2. **CLI**: Edit `scripts/cis_evaluators.py` — add a new dict + register evaluators.

Both files use the same logic and the same check IDs, so evaluators port directly between TS and Python.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `pdftotext: command not found` (local) | Install poppler-utils (above). The web app will still work via the `unpdf` fallback, just slower. The CLI requires poppler. |
| Upload returns 500 on Vercel | Check the Vercel function logs. The most likely cause is hitting the function duration limit — increase `maxDuration` in `vercel.json`. |
| `ImportError: cannot import name 'X' from 'reportlab'` (CLI) | `pip install --upgrade reportlab` (need >= 4.0). |
| Excel/PDF export produces a corrupt file | Check the browser console — make sure no ad blocker is intercepting Blob downloads. |
| Page shows "No benchmark loaded" after refresh | localStorage might be disabled in private mode — use a normal browser window. |

## License

This project bundles recommendations extracted from the official CIS NGINX Benchmark v3.0.0 PDF for non-commercial assessment use, per the CIS Terms of Use (<https://www.cisecurity.org/cis-securesuite/cis-securesuite-membership-terms-of-use/>).
