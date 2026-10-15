# CIS Benchmark Scanner

Upload any CIS Benchmark PDF (NGINX, Apache, Windows, Linux, Kubernetes, AWS, etc.), the app parses it dynamically and builds an interactive checklist. Run automated audits where supported, mark manual items, and export results to Excel, PDF, CSV, JSON, or Markdown.

## Quick start (local)

### 1. Prerequisites

| Tool | Why | Install |
|------|-----|---------|
| **Node.js 18+** | JS runtime | <https://nodejs.org> |
| **Bun** (recommended) or npm/yarn/pnpm | Package manager | `curl -fsSL https://bun.sh/install \| bash` |
| **poppler-utils** (optional) | Faster PDF extraction via `pdftotext` | see below — if missing, the app auto-falls back to the pure-JS `unpdf` library |

**Install poppler-utils** (optional, recommended for local dev):

| OS | Command |
|----|---------|
| macOS | `brew install poppler` |
| Ubuntu / Debian | `sudo apt-get install -y poppler-utils` |
| Fedora / RHEL | `sudo dnf install -y poppler-utils` |
| Windows (Scoop) | `scoop install poppler` |
| Windows (Chocolatey) | `choco install poppler` |

> Note: on Vercel and most serverless platforms, `pdftotext` isn't installed. The app automatically falls back to the pure-JS `unpdf` extractor in that case — no extra configuration needed.

### 2. Install & run

```bash
bun install
bun run dev
```

Open <http://localhost:3000>.

## Deploy to Vercel

The app is Vercel-ready out of the box.

### Option A — One-click deploy via dashboard

1. Push this project to a GitHub/GitLab/Bitbucket repo.
2. Go to <https://vercel.com/new> and import the repo.
3. Vercel auto-detects Next.js — leave the defaults.
4. Click **Deploy**. The first build takes ~2 minutes.
5. Visit the deployment URL, upload a CIS Benchmark PDF, and start scanning.

### Option B — Deploy via Vercel CLI

```bash
# Install the Vercel CLI (one-time)
npm i -g vercel

# From the project root
vercel            # preview deployment
vercel --prod     # production deployment
```

### Environment variables

None required for the core app. The Prisma SQLite path defaults to `file:./db/custom.db` which works on Vercel's writable `/tmp` directory at runtime. If you want to use a real database later, set `DATABASE_URL` in the Vercel project settings (Dashboard → Project → Settings → Environment Variables).

### Function configuration

A `vercel.json` is included with sensible defaults:

```json
{
  "framework": "nextjs",
  "buildCommand": "bun run build",
  "installCommand": "bun install",
  "functions": {
    "src/app/api/parse-cis-pdf/route.ts": {
      "maxDuration": 60
    }
  }
}
```

- `maxDuration: 60` gives the PDF parser up to 60s to process large benchmarks (the default is 10s on Hobby / 60s on Pro).
- Vercel's free Hobby plan supports up to 60s function duration, so no upgrade needed.

### Bundle size

The API route lazily imports `unpdf` (pure-JS pdf.js wrapper) only when `pdftotext` is unavailable. Total bundle size is well within Vercel's 50 MB Pro limit and 250 MB Hobby limit (compressed).

### What works on Vercel vs local

| Feature | Local | Vercel |
|---------|-------|--------|
| PDF upload + parsing | ✅ via `pdftotext` | ✅ via `unpdf` fallback |
| Auto-evaluators (NGINX) | ✅ | ✅ |
| Excel / PDF / CSV / JSON / MD export | ✅ | ✅ |
| Sample profile selector | ✅ | ✅ |
| Browser state persistence (localStorage) | ✅ | ✅ |
| Server-side SQLite persistence | ✅ | ❌ (filesystem is read-only at runtime) |

> The app uses browser localStorage for all checklist state, so server-side persistence is not needed — Vercel's read-only filesystem is fine.

## Usage

1. Drag any CIS Benchmark PDF onto the upload area (or click **Choose PDF file**).
2. The server extracts text (via `pdftotext` locally, or `unpdf` on serverless), parses the recommendations, and returns JSON.
3. The UI builds itself dynamically — sidebar shows sections, main area shows checklist cards.
4. For the **NGINX** benchmark specifically, 35 checks can be auto-evaluated:
   - Pick a sample profile ("Non-compliant", "Partial compliance", or "Fully hardened"), OR
   - Paste your own `nginx -T` and `nginx -V` output into the textareas.
   - Click **Run all auto-audits**.
5. For all other benchmarks (Apache, Windows, etc.), the UI runs in manual mode — review each recommendation by hand and mark it Pass / Fail / Manual / N/A.
6. Click **Export report** to download results as Excel, PDF, CSV, JSON, or Markdown.

## Project structure

```
.
├── src/
│   ├── app/
│   │   ├── api/parse-cis-pdf/route.ts   ← POST endpoint (pdftotext → unpdf fallback)
│   │   ├── page.tsx                     ← Main UI (landing + checklist)
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── components/
│   │   ├── ui/                          ← shadcn/ui primitives (pre-installed)
│   │   └── cis/                         ← App-specific components
│   │       ├── UploadPanel.tsx          ← Drag-and-drop PDF upload
│   │       ├── ChecklistItem.tsx        ← One recommendation card
│   │       ├── EnvironmentPanel.tsx     ← Sample profile selector + custom paste
│   │       ├── SectionSidebar.tsx
│   │       ├── FilterBar.tsx
│   │       ├── StatCard.tsx
│   │       ├── StatusBadge.tsx
│   │       └── ExportMenu.tsx
│   ├── data/
│   │   ├── cis_checks.ts               ← Static NGINX data (used by the linter / fallback)
│   │   └── sampleNginx.ts              ← 3 sample nginx -T/-V profiles
│   ├── lib/
│   │   ├── cisParser.ts                 ← Generic CIS PDF parser (TS port of Python script)
│   │   ├── nginxParser.ts               ← Helpers for parsing nginx -T config text
│   │   ├── evaluators.ts                ← 35 NGINX-specific auto-evaluators + registry
│   │   ├── reportGenerator.ts           ← JSON / CSV / Markdown / Excel / PDF report builders
│   │   └── utils.ts
│   ├── store/
│   │   └── checklistStore.ts            ← Zustand store (persisted to localStorage)
│   └── hooks/
├── prisma/
│   └── schema.prisma
├── scripts/
│   ├── extract_checks.py               ← Original PDF parser (dev tool)
│   └── gen_ts_data.py                   ← Generates src/data/cis_checks.ts
├── public/
├── vercel.json                          ← Vercel deployment config
├── package.json
├── next.config.ts
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.mjs
├── components.json                     ← shadcn/ui config
└── eslint.config.mjs
```

## Tech stack

- **Next.js 16** (App Router, API routes)
- **TypeScript 5**
- **Tailwind CSS 4** + **shadcn/ui** component library
- **Zustand** for client state (persisted to localStorage)
- **xlsx (SheetJS)** for Excel export
- **jsPDF + jspdf-autotable** for PDF export
- **pdftotext** (Poppler) for fast PDF extraction locally; **unpdf** as serverless-friendly fallback

## Adding support for new benchmarks

The app already works in manual-checklist mode for any CIS Benchmark PDF. To add **auto-evaluators** for another benchmark (e.g. Apache, Windows):

1. Open `src/lib/evaluators.ts`.
2. Add a new entry to `EVALUATOR_REGISTRY`:

```ts
export const EVALUATOR_REGISTRY = {
  nginx: { ...EVALUATORS },
  apache: {
    '1.1.1': (ctx) => { /* your evaluator */ },
    // ...
  },
};
```

3. Optionally add sample configurations in `src/data/sampleApache.ts` and load them conditionally in `EnvironmentPanel.tsx` when `benchmarkType === 'apache'`.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `pdftotext: command not found` (local) | Install poppler-utils (above). The app will still work via the `unpdf` fallback, just slower. |
| Upload returns 500 on Vercel | Check the Vercel function logs. The most likely cause is hitting the function duration limit — increase `maxDuration` in `vercel.json`. |
| `ENOENT ... custom.db` | Run `bun run db:push` to create the SQLite file locally. On Vercel this isn't needed — the app uses localStorage. |
| Excel/PDF export produces a corrupt file | Check the browser console — make sure no ad blocker is intercepting Blob downloads. |
| Page shows "No benchmark loaded" after refresh | localStorage might be disabled in private mode — use a normal browser window. |

## License

This project bundles recommendations extracted from the official CIS NGINX Benchmark v3.0.0 PDF for non-commercial assessment use, per the CIS Terms of Use (<https://www.cisecurity.org/cis-securesuite/cis-securesuite-membership-terms-of-use/>).
