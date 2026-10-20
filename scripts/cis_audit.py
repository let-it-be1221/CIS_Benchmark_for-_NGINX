#!/usr/bin/env python3
"""CIS Benchmark Scanner — CLI

Run automated compliance audits against any CIS Benchmark PDF
from the command line. Generates CSV, HTML, and PDF reports.

This is the CLI companion to the web app. It uses the same parser
and evaluators, but runs entirely on your local machine — no browser
or server needed. Great for CI pipelines, scheduled scans, or
batch audits.

REQUIREMENTS
------------
- Python 3.9+
- poppler-utils (`pdftotext`) — install via:
    macOS:   brew install poppler
    Ubuntu:  sudo apt-get install -y poppler-utils
    Fedora:  sudo dnf install -y poppler-utils
    Windows: scoop install poppler  (or  choco install poppler)
- Python packages (install via pip install -r requirements.txt):
    reportlab  jinja2  pyyaml
  (or: pip install reportlab jinja2)

QUICK START
-----------
  # 1. Parse a benchmark PDF and print JSON to stdout
  python cis_audit.py --pdf CIS_NGINX_Benchmark_v3.0.0.pdf

  # 2. Same, but save reports to disk (CSV + HTML + PDF)
  python cis_audit.py --pdf CIS_NGINX_Benchmark_v3.0.0.pdf --output-dir reports/

  # 3. Run NGINX auto-evaluators against your own config
  #    (pipe output of `nginx -T` and `nginx -V` into the tool)
  nginx -T > /tmp/nginx_t.txt
  nginx -V 2>&1 > /tmp/nginx_v.txt
  python cis_audit.py --pdf CIS_NGINX_Benchmark.pdf \\
      --nginx-t /tmp/nginx_t.txt \\
      --nginx-v /tmp/nginx_v.txt \\
      --output-dir reports/

  # 4. Or read the config from stdin (handy for SSH)
  ssh user@host 'nginx -T 2>/dev/null' | \\
      python cis_audit.py --pdf CIS_NGINX_Benchmark.pdf \\
          --nginx-t - --output-dir reports/

EXIT CODES
----------
  0 — at least one check passed
  1 — no checks passed (or audit could not be performed)
  2 — argument / usage error
  3 — system error (missing pdftotext, parse failure, etc.)
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Optional

# Allow running both as a script (python cis_audit.py) and as a module
# (python -m cis_audit) — adjust sys.path so we can find sibling modules.
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from cis_parser import ParsedBenchmark, parse_pdf_file, to_dict  # noqa: E402
from cis_evaluators import (  # noqa: E402
    AuditContext, CheckResult, has_evaluators_for_benchmark,
    run_evaluator,
)
from cis_reporters import build_summary, generate_all  # noqa: E402


@dataclass
class AuditResult:
    benchmark: ParsedBenchmark
    results: dict[str, CheckResult]


def run_audit(
    pdf_path: Path,
    nginx_t_path: Optional[Path] = None,
    nginx_v_path: Optional[Path] = None,
) -> AuditResult:
    """Parse the PDF and run auto-evaluators (where available)."""
    benchmark = parse_pdf_file(pdf_path)

    # Read nginx -T / -V if provided
    nginx_t = ""
    nginx_v = ""
    if nginx_t_path:
        nginx_t = read_text_or_stdin(nginx_t_path)
    if nginx_v_path:
        nginx_v = read_text_or_stdin(nginx_v_path)

    ctx = AuditContext(nginx_t=nginx_t, nginx_v=nginx_v)
    has_nginx_data = bool(nginx_t) or bool(nginx_v)

    results: dict[str, CheckResult] = {}
    has_evaluators = has_evaluators_for_benchmark(benchmark.benchmark_type)

    for rec in benchmark.recommendations:
        if not has_evaluators or not has_nginx_data:
            # No evaluators registered for this benchmark type, OR
            # no config provided — leave as pending/manual
            results[rec.id] = CheckResult(
                status="manual" if has_evaluators and not has_nginx_data else "pending",
                message=(
                    "Manual review required — no auto-evaluators registered for "
                    f"benchmark type '{benchmark.benchmark_type}'."
                    if not has_evaluators
                    else "No nginx -T / -V output provided. Run again with --nginx-t and --nginx-v to enable auto-evaluation."
                ) if has_evaluators else "",
            )
            continue

        # Try to run the evaluator
        result = run_evaluator(benchmark.benchmark_type, rec.id, ctx)
        if result is None:
            # No specific evaluator for this check id — manual
            results[rec.id] = CheckResult(
                status="manual",
                message=f"No auto-evaluator registered for check {rec.id}. Manual review required.",
            )
        else:
            results[rec.id] = result

    return AuditResult(benchmark=benchmark, results=results)


def read_text_or_stdin(path_or_dash: Path) -> str:
    """Read text from a file path, or from stdin if path is '-'."""
    if str(path_or_dash) == "-":
        return sys.stdin.read()
    return Path(path_or_dash).read_text(encoding="utf-8", errors="replace")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        prog="cis_audit",
        description="Run CIS Benchmark compliance audits from the CLI. "
        "Parses any CIS Benchmark PDF and generates CSV/HTML/PDF reports.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="See README.md for full documentation and examples.",
    )
    p.add_argument(
        "--pdf", required=True, type=Path,
        help="Path to the CIS Benchmark PDF file (e.g. CIS_NGINX_Benchmark_v3.0.0.pdf)",
    )
    p.add_argument(
        "--nginx-t", type=str, default=None,
        help="Path to file containing `nginx -T` output, or '-' for stdin. "
        "Required for NGINX auto-evaluators.",
    )
    p.add_argument(
        "--nginx-v", type=str, default=None,
        help="Path to file containing `nginx -V` output, or '-' for stdin. "
        "Required for NGINX auto-evaluators.",
    )
    p.add_argument(
        "--output-dir", "-o", type=Path, default=None,
        help="Directory to write reports to. If omitted, prints JSON to stdout. "
        "Generates {base}.csv, {base}.html, {base}.pdf.",
    )
    p.add_argument(
        "--base-name", default=None,
        help="Base filename for reports (default: cis-{type}-report-{timestamp}). "
        "Do not include the extension.",
    )
    p.add_argument(
        "--json", action="store_true",
        help="Also emit a machine-readable JSON report alongside CSV/HTML/PDF "
        "(only when --output-dir is given).",
    )
    p.add_argument(
        "--quiet", "-q", action="store_true",
        help="Suppress progress messages on stderr (errors still printed).",
    )
    p.add_argument(
        "--version", action="version", version="cis_audit 1.0.0",
    )

    args = p.parse_args(argv)

    if not args.pdf.exists():
        print(f"ERROR: PDF file not found: {args.pdf}", file=sys.stderr)
        return 3

    # Parse + audit
    try:
        if not args.quiet:
            print(f"Parsing {args.pdf.name}...", file=sys.stderr)
        audit = run_audit(
            args.pdf,
            Path(args.nginx_t) if args.nginx_t else None,
            Path(args.nginx_v) if args.nginx_v else None,
        )
    except FileNotFoundError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 3
    except Exception as e:
        print(f"ERROR: parse failed: {e}", file=sys.stderr)
        return 3

    benchmark = audit.benchmark
    results = audit.results

    if not args.quiet:
        print(f"  Title: {benchmark.title} {benchmark.version}", file=sys.stderr)
        print(f"  Recommendations: {benchmark.recommendation_count}", file=sys.stderr)
        print(f"  Sections: {len(benchmark.sections)}", file=sys.stderr)
        print(f"  Type: {benchmark.benchmark_type}", file=sys.stderr)
        if benchmark.warnings:
            print(f"  Warnings: {len(benchmark.warnings)}", file=sys.stderr)
            for w in benchmark.warnings:
                print(f"    - {w}", file=sys.stderr)

    # Summary
    summary = build_summary(benchmark, results)["summary"]
    if not args.quiet:
        print("", file=sys.stderr)
        print(f"  Pass: {summary['pass']}  Fail: {summary['fail']}  "
              f"Manual: {summary['manual']}  N/A: {summary['na']}  "
              f"Pending: {summary['pending']}", file=sys.stderr)
        print(f"  Compliance score: {summary['compliance_score']}%", file=sys.stderr)

    # Output
    if args.output_dir:
        if not args.quiet:
            print(f"\nGenerating reports in {args.output_dir}...", file=sys.stderr)
        try:
            paths = generate_all(benchmark, results, args.output_dir, args.base_name)
        except ImportError as e:
            print(f"ERROR: missing Python dependency for report generation: {e}", file=sys.stderr)
            print("Install with: pip install reportlab jinja2", file=sys.stderr)
            return 3

        for fmt, path in paths.items():
            print(f"  {fmt.upper():5s}  {path}", file=sys.stderr)

        if args.json:
            json_path = args.output_dir / (Path(paths["csv"]).stem + ".json")
            data = to_dict(benchmark)
            data["results"] = {rid: asdict(r) for rid, r in results.items()}
            data["summary"] = summary
            json_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
            print(f"  JSON  {json_path}", file=sys.stderr)
    else:
        # Print JSON to stdout
        data = to_dict(benchmark)
        data["results"] = {rid: asdict(r) for rid, r in results.items()}
        data["summary"] = summary
        print(json.dumps(data, indent=2, ensure_ascii=False))

    # Exit code: 0 if at least one pass, 1 if no passes (manual/pending only)
    return 0 if summary["pass"] > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
