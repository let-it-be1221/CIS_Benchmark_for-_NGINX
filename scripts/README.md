# CIS Benchmark Scanner — CLI Scripts

Standalone Python scripts for running CIS Benchmark compliance audits from the command line. No browser or server needed — perfect for CI pipelines, scheduled scans, or batch audits across many hosts.

These scripts are the CLI companion to the web app. Both use the same parser and evaluator logic — pick whichever workflow fits the task.

## Quick start

### 1. Install prerequisites

**System:** `pdftotext` (from poppler-utils)

| OS | Command |
|---|---|
| macOS | `brew install poppler` |
| Ubuntu / Debian | `sudo apt-get install -y poppler-utils` |
| Fedora / RHEL | `sudo dnf install -y poppler-utils` |
| Windows (Scoop) | `scoop install poppler` |
| Windows (Chocolatey) | `choco install poppler` |

**Python packages:**

```bash
pip install -r scripts/requirements.txt
# or just: pip install reportlab jinja2
```

### 2. Run your first audit

```bash
cd /path/to/repo

# Just parse the PDF and emit JSON to stdout
python scripts/cis_audit.py --pdf path/to/CIS_NGINX_Benchmark_v3.0.0.pdf

# Generate CSV, HTML, and PDF reports to a directory
python scripts/cis_audit.py \
  --pdf path/to/CIS_NGINX_Benchmark_v3.0.0.pdf \
  --output-dir reports/
```

### 3. Run NGINX auto-evaluators

The NGINX benchmark has 35 built-in auto-evaluators that check your live `nginx -T` config against the recommendations.

```bash
# Capture the config from your NGINX host
ssh user@nginx-host 'nginx -T 2>/dev/null' > /tmp/nginx_t.txt
ssh user@nginx-host 'nginx -V 2>&1'        > /tmp/nginx_v.txt

# Run the audit with auto-evaluation
python scripts/cis_audit.py \
  --pdf path/to/CIS_NGINX_Benchmark_v3.0.0.pdf \
  --nginx-t /tmp/nginx_t.txt \
  --nginx-v /tmp/nginx_v.txt \
  --output-dir reports/ \
  --base-name nginx-prod-$(date +%Y%m%d)
```

This produces three files in `reports/`:
- `nginx-prod-YYYYMMDD.csv` — machine-readable spreadsheet (open in Excel/Google Sheets)
- `nginx-prod-YYYYMMDD.html` — styled, self-contained HTML report (open in any browser)
- `nginx-prod-YYYYMMDD.pdf` — formatted multi-page PDF document (cover + section breakdown + per-check table)

## Usage

```
usage: cis_audit.py [-h] --pdf PDF [--nginx-t NGINX_T] [--nginx-v NGINX_V]
                    [--output-dir OUTPUT_DIR] [--base-name BASE_NAME]
                    [--json] [--quiet] [--version]

Run CIS Benchmark compliance audits from the CLI. Parses any CIS Benchmark
PDF and generates CSV/HTML/PDF reports.

options:
  --pdf PDF              Path to the CIS Benchmark PDF file
  --nginx-t NGINX_T      Path to file containing `nginx -T` output, or '-' for stdin
  --nginx-v NGINX_V      Path to file containing `nginx -V` output, or '-' for stdin
  --output-dir, -o DIR   Directory to write reports to (omitted = print JSON to stdout)
  --base-name NAME       Base filename for reports (default: cis-{type}-report-{timestamp})
  --json                 Also emit a JSON report alongside CSV/HTML/PDF
  --quiet, -q            Suppress progress messages on stderr
  --version              Print version and exit
```

### Examples

```bash
# 1. Parse a benchmark PDF and pretty-print JSON to stdout
python scripts/cis_audit.py --pdf CIS_NGINX_Benchmark_v3.0.0.pdf

# 2. Save reports to a directory
python scripts/cis_audit.py --pdf CIS_NGINX_Benchmark.pdf --output-dir reports/

# 3. Run NGINX auto-evaluators with config from files
python scripts/cis_audit.py \
    --pdf CIS_NGINX_Benchmark.pdf \
    --nginx-t nginx_t.txt \
    --nginx-v nginx_v.txt \
    --output-dir reports/

# 4. Pipe nginx -T over SSH directly into the auditor
ssh user@host 'nginx -T 2>/dev/null' | \
    python scripts/cis_audit.py \
        --pdf CIS_NGINX_Benchmark.pdf \
        --nginx-t - \
        --output-dir reports/

# 5. Add JSON output alongside CSV/HTML/PDF
python scripts/cis_audit.py \
    --pdf CIS_NGINX_Benchmark.pdf \
    --nginx-t nginx_t.txt \
    --nginx-v nginx_v.txt \
    --output-dir reports/ \
    --json

# 6. Use a custom report name
python scripts/cis_audit.py \
    --pdf CIS_NGINX_Benchmark.pdf \
    --output-dir reports/ \
    --base-name prod-nginx-2026-10-20

# 7. Quiet mode (for cron jobs / CI)
python scripts/cis_audit.py \
    --pdf CIS_NGINX_Benchmark.pdf \
    --nginx-t nginx_t.txt \
    --output-dir reports/ \
    --quiet && echo "Reports generated successfully"
```

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | At least one check passed |
| `1` | No checks passed (or audit produced no pass results) |
| `2` | Argument / usage error |
| `3` | System error (missing `pdftotext`, parse failure, etc.) |

Use this in CI pipelines:

```bash
python scripts/cis_audit.py \
    --pdf benchmark.pdf --nginx-t config.txt \
    --output-dir reports/

if [ $? -ne 0 ]; then
    echo "Audit failed — see reports/ for details"
    exit 1
fi
```

## Files

| File | Purpose |
|------|---------|
| `cis_audit.py` | Main CLI entry point. Run this. |
| `cis_parser.py` | Generic CIS Benchmark PDF parser. Also runnable standalone to emit JSON. |
| `cis_evaluators.py` | Per-check evaluator functions. NGINX has 35 registered. |
| `cis_reporters.py` | CSV / HTML / PDF report generators. |
| `requirements.txt` | Python dependencies (reportlab, jinja2). |

## How it works

```
CIS Benchmark PDF
        │
        ▼
   pdftotext          (binary from poppler-utils)
        │
        ▼
   cis_parser.py     (extracts 44 recommendations with all fields)
        │
        ▼
   ┌─────────────────────────────────┐
   │  cis_evaluators.py              │
   │  (if --nginx-t/-v provided)    │
   │  NGINX: 35 auto-evaluators     │
   └─────────────────────────────────┘
        │
        ▼
   cis_reporters.py
   ├── CSV   (csv module — no deps)
   ├── HTML  (jinja2 templating, self-contained)
   └── PDF   (reportlab — cover, tables, per-check)
```

## CI/CD examples

### GitHub Actions

```yaml
name: Daily CIS Benchmark audit
on:
  schedule:
    - cron: '0 6 * * *'   # 6 AM daily
  workflow_dispatch:

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: sudo apt-get update && sudo apt-get install -y poppler-utils
      - run: pip install -r scripts/requirements.txt
      - run: |
          # Pull the live nginx -T output from your prod host
          ssh -o StrictHostKeyChecking=no ${{ secrets.SSH_HOST }} 'nginx -T 2>/dev/null' > nginx_t.txt
          ssh -o StrictHostKeyChecking=no ${{ secrets.SSH_HOST }} 'nginx -V 2>&1'        > nginx_v.txt
        env:
          SSH_HOST: ${{ secrets.SSH_HOST }}
      - run: |
          python scripts/cis_audit.py \
            --pdf CIS_NGINX_Benchmark_v3.0.0.pdf \
            --nginx-t nginx_t.txt \
            --nginx-v nginx_v.txt \
            --output-dir reports/ \
            --base-name prod-$(date +%Y-%m-%d)
      - uses: actions/upload-artifact@v4
        with:
          name: cis-reports-${{ github.run_id }}
          path: reports/
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: cis-reports-FAILED-${{ github.run_id }}
          path: reports/
```

### Cron job

```bash
# /etc/cron.d/cis-benchmark-audit
0 6 * * *  root  /opt/cis-audit/scripts/cis_audit.py \
  --pdf /opt/cis-audit/CIS_NGINX_Benchmark.pdf \
  --nginx-t /var/cache/nginx-t.txt \
  --nginx-v /var/cache/nginx-v.txt \
  --output-dir /var/log/cis-audit/ \
  --base-name prod-$(date +\%Y-\%m-\%d) \
  --quiet \
  > /var/log/cis-audit/cron.log 2>&1
```

## Adding support for new benchmarks

The CLI already works in manual-checklist mode for any CIS Benchmark PDF. To add **auto-evaluators** for another benchmark (e.g. Apache, Windows):

1. Open `scripts/cis_evaluators.py`.
2. Add a new evaluator function with `@register("X.Y.Z")` decorator.
3. Add the registry entry at the bottom:

```python
APACHE_EVALUATORS: dict[str, Evaluator] = {}

@register_apache("1.1.1")
def apache_1_1_1(ctx: AuditContext) -> CheckResult:
    ...

EVALUATOR_REGISTRY = {
    "nginx": NGINX_EVALUATORS,
    "apache": APACHE_EVALUATORS,
}
```

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `pdftotext: command not found` | Install poppler-utils (see table above). |
| `ImportError: cannot import name 'X' from 'reportlab'` | `pip install --upgrade reportlab` (need >= 4.0). |
| `ERROR: parse failed: pdftotext produced empty output` | The PDF may be a scanned image. Install `ocrmypdf` and re-export, or use a text-based PDF. |
| Generated PDF is missing or 0 bytes | Re-run with `--quiet` off to see the error; likely a reportlab import issue. |
| High compliance score on a clearly misconfigured host | The evaluator only checks what's in `nginx -T`. Verify you captured the full config (sometimes include directives pull from other paths). |
