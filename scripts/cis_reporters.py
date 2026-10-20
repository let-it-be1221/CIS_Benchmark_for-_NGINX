#!/usr/bin/env python3
"""CIS Benchmark report generators.

Produces three report formats from a parsed benchmark + per-check results:

  - CSV   (csv module — no extra deps)
  - HTML  (self-contained file with embedded CSS, no external resources)
  - PDF   (reportlab — needs `pip install reportlab`)

All three can be generated in one go via `generate_all()`.
"""

from __future__ import annotations

import csv
import io
from datetime import datetime
from pathlib import Path
from typing import Optional

from jinja2 import Template

from cis_parser import ParsedBenchmark


# Status icon/color mapping used in HTML and PDF
STATUS_STYLE = {
    "pass":    {"icon": "✅", "color": "#10b981", "bg": "#ecfdf5", "label": "Pass"},
    "fail":    {"icon": "❌", "color": "#ef4444", "bg": "#fef2f2", "label": "Fail"},
    "manual":  {"icon": "⚠️", "color": "#f59e0b", "bg": "#fffbeb", "label": "Manual"},
    "na":      {"icon": "➖", "color": "#71717a", "bg": "#f4f4f5", "label": "N/A"},
    "pending": {"icon": "⏳", "color": "#71717a", "bg": "#f4f4f5", "label": "Pending"},
}


def build_summary(benchmark: ParsedBenchmark, results: dict) -> dict:
    """Compute overall + per-section summary stats."""
    summary = {"pass": 0, "fail": 0, "manual": 0, "na": 0, "pending": 0}
    for rec in benchmark.recommendations:
        r = results.get(rec.id)
        status = r.status if r else "pending"
        if status in summary:
            summary[status] += 1
    denom = summary["pass"] + summary["fail"]
    summary["compliance_score"] = round(summary["pass"] / denom * 100) if denom else 0
    summary["total"] = len(benchmark.recommendations)

    by_section: dict[int, dict] = {}
    for rec in benchmark.recommendations:
        if rec.section not in by_section:
            by_section[rec.section] = {
                "section": rec.section,
                "section_name": rec.section_name,
                "total": 0, "pass": 0, "fail": 0, "manual": 0,
                "na": 0, "pending": 0,
            }
        s = by_section[rec.section]
        s["total"] += 1
        r = results.get(rec.id)
        status = r.status if r else "pending"
        if status in s:
            s[status] += 1
    sections = sorted(by_section.values(), key=lambda x: x["section"])
    return {"summary": summary, "by_section": sections}


# -----------------------------------------------------------------------------
# CSV
# -----------------------------------------------------------------------------

def build_csv(benchmark: ParsedBenchmark, results: dict) -> str:
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow([
        "ID", "Title", "Section", "Section Name", "Subsection",
        "Profile", "Assessment", "Status",
        "Evaluator Message", "Evaluator Evidence", "Evaluator Hints",
        "Notes",
    ])
    for rec in benchmark.recommendations:
        r = results.get(rec.id)
        status = r.status if r else "pending"
        msg = r.message if r else ""
        ev = r.evidence if r else ""
        hints = " | ".join(r.hints) if r and r.hints else ""
        notes = getattr(r, "notes", "") if r else ""
        writer.writerow([
            rec.id, rec.title, rec.section, rec.section_name, rec.subsection,
            ", ".join(rec.profile), rec.assessment_status, status,
            msg, ev, hints, notes,
        ])
    return out.getvalue()


# -----------------------------------------------------------------------------
# HTML
# -----------------------------------------------------------------------------

HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{ benchmark.title }} {{ benchmark.version }} — Compliance Report</title>
<style>
  :root { --bg: #fafafa; --fg: #18181b; --muted: #71717a; --border: #e4e4e7; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    margin: 0; padding: 2rem; background: var(--bg); color: var(--fg);
    line-height: 1.5; max-width: 1100px; margin: 0 auto;
  }
  h1 { font-size: 1.75rem; margin: 0 0 0.25rem; }
  h2 { font-size: 1.25rem; margin: 2rem 0 0.5rem; border-bottom: 1px solid var(--border); padding-bottom: 0.25rem; }
  h3 { font-size: 1rem; margin: 1.25rem 0 0.5rem; }
  .meta { color: var(--muted); font-size: 0.85rem; margin-bottom: 1.5rem; }
  .score-banner {
    background: {{ score_color }};
    color: white; padding: 1.5rem 2rem; border-radius: 0.5rem;
    text-align: center; margin-bottom: 1.5rem;
  }
  .score-banner .score { font-size: 3rem; font-weight: bold; }
  .score-banner .label { font-size: 0.9rem; opacity: 0.9; }
  .stats-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 0.5rem; margin-bottom: 1.5rem; }
  .stat-card {
    padding: 0.75rem; border-radius: 0.375rem; color: white; text-align: center;
  }
  .stat-card .num { font-size: 1.5rem; font-weight: bold; }
  .stat-card .lbl { font-size: 0.75rem; opacity: 0.9; }
  .stat-pass { background: #10b981; }
  .stat-fail { background: #ef4444; }
  .stat-manual { background: #f59e0b; }
  .stat-na { background: #71717a; }
  .stat-pending { background: #a1a1aa; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; font-size: 0.85rem; }
  th, td { padding: 0.5rem; text-align: left; border-bottom: 1px solid var(--border); }
  th { background: #18181b; color: white; font-weight: 600; }
  .rec-card {
    border: 1px solid var(--border); border-radius: 0.375rem;
    margin-bottom: 0.75rem; overflow: hidden; background: white;
  }
  .rec-header {
    padding: 0.75rem 1rem; display: flex; align-items: center; gap: 0.5rem;
    border-bottom: 1px solid var(--border);
  }
  .rec-id { font-family: monospace; font-size: 0.8rem; color: var(--muted); }
  .rec-title { font-weight: 600; flex: 1; }
  .status-badge {
    padding: 0.15rem 0.5rem; border-radius: 0.25rem; font-size: 0.75rem;
    font-weight: 600; color: white;
  }
  .rec-body { padding: 0.75rem 1rem; font-size: 0.85rem; }
  .rec-evaluator { padding: 0.5rem 0.75rem; margin: 0.5rem 0; border-radius: 0.25rem; font-size: 0.85rem; }
  pre { background: #f4f4f5; padding: 0.5rem; border-radius: 0.25rem; font-size: 0.75rem; overflow-x: auto; }
  .meta-section { margin: 0.25rem 0; color: var(--muted); font-size: 0.75rem; }
  .meta-section strong { color: var(--fg); }
  footer { text-align: center; padding: 2rem 0; color: var(--muted); font-size: 0.75rem; }
  .hints { margin: 0.5rem 0 0 1.5rem; padding: 0; list-style: disc; }
  .hints li { font-size: 0.85rem; margin-bottom: 0.15rem; }
  .progress-bar { height: 6px; background: #e4e4e7; border-radius: 3px; overflow: hidden; display: flex; margin: 1rem 0; }
  .progress-bar > div { height: 100%; }
</style>
</head>
<body>
  <h1>{{ benchmark.title }} {{ benchmark.version }}</h1>
  <div class="meta">
    Compliance Report · Generated {{ generated_at }}
    {% if benchmark.date %} · Benchmark date {{ benchmark.date }}{% endif %}
    {% if benchmark.file_name %} · Source {{ benchmark.file_name }}{% endif %}
  </div>

  <div class="score-banner" style="background: {{ score_color }}">
    <div class="score">{{ summary.compliance_score }}%</div>
    <div class="label">Compliance Score ({{ summary.pass }} of {{ summary.pass + summary.fail }} audited)</div>
  </div>

  <div class="stats-row">
    <div class="stat-card stat-pass"><div class="num">{{ summary.pass }}</div><div class="lbl">Passed</div></div>
    <div class="stat-card stat-fail"><div class="num">{{ summary.fail }}</div><div class="lbl">Failed</div></div>
    <div class="stat-card stat-manual"><div class="num">{{ summary.manual }}</div><div class="lbl">Manual</div></div>
    <div class="stat-card stat-na"><div class="num">{{ summary.na }}</div><div class="lbl">N/A</div></div>
    <div class="stat-card stat-pending"><div class="num">{{ summary.pending }}</div><div class="lbl">Pending</div></div>
  </div>

  <div class="progress-bar">
    <div style="width: {{ (summary.pass / summary.total * 100) if summary.total else 0 }}%; background: #10b981;"></div>
    <div style="width: {{ (summary.fail / summary.total * 100) if summary.total else 0 }}%; background: #ef4444;"></div>
    <div style="width: {{ (summary.manual / summary.total * 100) if summary.total else 0 }}%; background: #f59e0b;"></div>
    <div style="width: {{ (summary.na / summary.total * 100) if summary.total else 0 }}%; background: #71717a;"></div>
  </div>

  <h2>Section Breakdown</h2>
  <table>
    <thead>
      <tr><th>#</th><th>Section</th><th>Total</th><th>Pass</th><th>Fail</th><th>Manual</th><th>N/A</th><th>Pending</th><th>Score</th></tr>
    </thead>
    <tbody>
      {% for s in by_section %}
      <tr>
        <td>{{ s.section }}</td>
        <td>{{ s.section_name }}</td>
        <td>{{ s.total }}</td>
        <td style="color: #10b981; font-weight: 600;">{{ s.pass }}</td>
        <td style="color: #ef4444; font-weight: 600;">{{ s.fail }}</td>
        <td style="color: #f59e0b;">{{ s.manual }}</td>
        <td>{{ s.na }}</td>
        <td>{{ s.pending }}</td>
        <td>{{ ((s.pass / (s.pass + s.fail)) * 100) | round(0) | int if (s.pass + s.fail) else '-' }}{{ '%' if (s.pass + s.fail) else '' }}</td>
      </tr>
      {% endfor %}
    </tbody>
  </table>

  <h2>Per-Check Results</h2>
  {% for rec in benchmark.recommendations %}
  {% set r = results.get(rec.id) %}
  {% set status = r.status if r else 'pending' %}
  {% set style = status_styles[status] %}
  <div class="rec-card">
    <div class="rec-header" style="background: {{ style.bg }}; border-left: 4px solid {{ style.color }};">
      <span class="rec-id">{{ rec.id }}</span>
      <span class="rec-title">{{ rec.title }}</span>
      <span class="status-badge" style="background: {{ style.color }}">{{ style.icon }} {{ style.label }}</span>
    </div>
    <div class="rec-body">
      <div class="meta-section"><strong>Section:</strong> {{ rec.section }}. {{ rec.section_name }}{% if rec.subsection %} › {{ rec.subsection }}{% endif %}</div>
      <div class="meta-section"><strong>Assessment:</strong> {{ rec.assessment_status }} · <strong>Profile:</strong> {{ ', '.join(rec.profile) }}</div>
      {% if r and r.message %}
      <div class="rec-evaluator" style="background: {{ style.bg }}; color: {{ style.color }};">
        <strong>Auto-evaluator:</strong> {{ r.message }}
        {% if r.evidence %}<pre>{{ r.evidence }}</pre>{% endif %}
        {% if r.hints %}<ul class="hints">{% for h in r.hints %}<li>{{ h }}</li>{% endfor %}</ul>{% endif %}
      </div>
      {% endif %}
      {% if rec.description %}
      <div class="meta-section"><strong>Description:</strong></div>
      <div>{{ rec.description }}</div>
      {% endif %}
      {% if rec.audit %}
      <div class="meta-section"><strong>Audit procedure:</strong></div>
      <pre>{{ rec.audit }}</pre>
      {% endif %}
      {% if rec.remediation %}
      <div class="meta-section"><strong>Remediation:</strong></div>
      <pre>{{ rec.remediation }}</pre>
      {% endif %}
    </div>
  </div>
  {% endfor %}

  <footer>
    Generated by CIS Benchmark Scanner CLI · {{ benchmark.title }} {{ benchmark.version }}
    {% if benchmark.date %} · {{ benchmark.date }}{% endif %}
    · {{ benchmark.recommendation_count }} recommendations across {{ benchmark.sections|length }} sections
  </footer>
</body>
</html>
"""


def build_html(benchmark: ParsedBenchmark, results: dict) -> str:
    data = build_summary(benchmark, results)
    score = data["summary"]["compliance_score"]
    score_color = "#10b981" if score >= 80 else ("#f59e0b" if score >= 50 else "#ef4444")
    template = Template(HTML_TEMPLATE)
    return template.render(
        benchmark=benchmark,
        results=results,
        summary=data["summary"],
        by_section=data["by_section"],
        generated_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        score_color=score_color,
        status_styles=STATUS_STYLE,
    )


# -----------------------------------------------------------------------------
# PDF (reportlab)
# -----------------------------------------------------------------------------

def build_pdf(benchmark: ParsedBenchmark, results: dict) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak,
    )
    from reportlab.lib.enums import TA_CENTER

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=15 * mm, rightMargin=15 * mm,
        topMargin=15 * mm, bottomMargin=15 * mm,
        title=f"{benchmark.title} {benchmark.version} — Compliance Report",
    )

    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(
        name="ScoreText", fontName="Helvetica-Bold", fontSize=48,
        alignment=TA_CENTER, textColor=colors.white,
    ))
    styles.add(ParagraphStyle(
        name="ScoreLabel", fontName="Helvetica", fontSize=11,
        alignment=TA_CENTER, textColor=colors.white,
    ))
    styles.add(ParagraphStyle(
        name="RecBody", fontName="Helvetica", fontSize=8,
        leading=10, textColor=colors.HexColor("#27272a"),
    ))
    styles.add(ParagraphStyle(
        name="MonoSmall", fontName="Courier", fontSize=7,
        leading=9, textColor=colors.HexColor("#27272a"),
    ))
    styles.add(ParagraphStyle(
        name="MetaLabel", fontName="Helvetica-Bold", fontSize=8,
        textColor=colors.HexColor("#71717a"),
    ))

    story = []

    # Title
    story.append(Paragraph(f"<b>{benchmark.title} {benchmark.version}</b>", ParagraphStyle(
        name="Title", fontName="Helvetica-Bold", fontSize=20,
        alignment=TA_CENTER, spaceAfter=6,
    )))
    story.append(Paragraph("Compliance Report", ParagraphStyle(
        name="Subtitle", fontName="Helvetica", fontSize=14,
        alignment=TA_CENTER, textColor=colors.HexColor("#52525b"),
        spaceAfter=10,
    )))
    if benchmark.date:
        story.append(Paragraph(f"Benchmark date: {benchmark.date}", ParagraphStyle(
            name="DateLine", fontName="Helvetica", fontSize=10,
            alignment=TA_CENTER, textColor=colors.HexColor("#71717a"),
        )))
    if benchmark.file_name:
        story.append(Paragraph(f"Source: {benchmark.file_name}", ParagraphStyle(
            name="SrcLine", fontName="Helvetica", fontSize=9,
            alignment=TA_CENTER, textColor=colors.HexColor("#a1a1aa"),
        )))
    story.append(Paragraph(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}", ParagraphStyle(
        name="GenLine", fontName="Helvetica", fontSize=9,
        alignment=TA_CENTER, textColor=colors.HexColor("#a1a1aa"),
        spaceAfter=18,
    )))

    # Score banner
    data = build_summary(benchmark, results)
    summary = data["summary"]
    score = summary["compliance_score"]
    score_color = colors.HexColor("#10b981" if score >= 80 else ("#f59e0b" if score >= 50 else "#ef4444"))
    score_table = Table(
        [[Paragraph(f"{score}%", styles["ScoreText"])],
         [Paragraph("Compliance Score", styles["ScoreLabel"])]],
        colWidths=[doc.width],
        rowHeights=[60, 20],
    )
    score_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), score_color),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(score_table)
    story.append(Spacer(1, 12))

    # Stats row
    stats_data = [
        [Paragraph(f"<b>{summary['pass']}</b>", ParagraphStyle(
            name="StatNum", fontName="Helvetica-Bold", fontSize=20,
            alignment=TA_CENTER, textColor=colors.white)),
         Paragraph(f"<b>{summary['fail']}</b>", ParagraphStyle(
            name="StatNum2", fontName="Helvetica-Bold", fontSize=20,
            alignment=TA_CENTER, textColor=colors.white)),
         Paragraph(f"<b>{summary['manual']}</b>", ParagraphStyle(
            name="StatNum3", fontName="Helvetica-Bold", fontSize=20,
            alignment=TA_CENTER, textColor=colors.white)),
         Paragraph(f"<b>{summary['na']}</b>", ParagraphStyle(
            name="StatNum4", fontName="Helvetica-Bold", fontSize=20,
            alignment=TA_CENTER, textColor=colors.white)),
         Paragraph(f"<b>{summary['pending']}</b>", ParagraphStyle(
            name="StatNum5", fontName="Helvetica-Bold", fontSize=20,
            alignment=TA_CENTER, textColor=colors.white))],
        [Paragraph("Passed", styles["ScoreLabel"]),
         Paragraph("Failed", styles["ScoreLabel"]),
         Paragraph("Manual", styles["ScoreLabel"]),
         Paragraph("N/A", styles["ScoreLabel"]),
         Paragraph("Pending", styles["ScoreLabel"])],
    ]
    col_w = doc.width / 5
    stats_table = Table(stats_data, colWidths=[col_w] * 5, rowHeights=[30, 16])
    stats_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#10b981")),
        ("BACKGROUND", (1, 0), (1, -1), colors.HexColor("#ef4444")),
        ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#f59e0b")),
        ("BACKGROUND", (3, 0), (3, -1), colors.HexColor("#71717a")),
        ("BACKGROUND", (4, 0), (4, -1), colors.HexColor("#a1a1aa")),
        ("TEXTCOLOR", (0, 0), (-1, -1), colors.white),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(stats_table)
    story.append(Spacer(1, 18))

    # Section breakdown table
    story.append(Paragraph("<b>Section Breakdown</b>", styles["Heading2"]))
    story.append(Spacer(1, 6))
    section_rows = [["#", "Section", "Total", "Pass", "Fail", "Manual", "N/A", "Pending", "Score"]]
    for s in data["by_section"]:
        denom = s["pass"] + s["fail"]
        score_str = f"{round(s['pass']/denom*100)}%" if denom else "-"
        section_rows.append([
            str(s["section"]), s["section_name"], str(s["total"]),
            str(s["pass"]), str(s["fail"]), str(s["manual"]),
            str(s["na"]), str(s["pending"]), score_str,
        ])
    section_table = Table(section_rows, colWidths=[
        20, doc.width - 20 - 35 - 35 - 35 - 35 - 35 - 35 - 40 - 35,
        35, 35, 35, 35, 35, 40, 35,
    ])
    section_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#18181b")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("FONTSIZE", (0, 0), (-1, 0), 8),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("ALIGN", (1, 1), (1, -1), "LEFT"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e4e4e7")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#fafafa")]),
    ]))
    story.append(section_table)
    story.append(PageBreak())

    # Per-check results
    story.append(Paragraph("<b>Per-Check Results</b>", styles["Heading2"]))
    story.append(Spacer(1, 6))

    per_check_rows = [["ID", "Title", "Section", "Status", "Message"]]
    for rec in benchmark.recommendations:
        r = results.get(rec.id)
        status = r.status if r else "pending"
        msg = (r.message if r else "") or ""
        if len(msg) > 80:
            msg = msg[:77] + "…"
        title = rec.title
        if len(title) > 70:
            title = title[:67] + "…"
        per_check_rows.append([
            rec.id, title, f"{rec.section}. {rec.section_name}",
            status.upper(), msg,
        ])
    per_check_table = Table(
        per_check_rows,
        colWidths=[45, doc.width - 45 - 90 - 50 - 200, 90, 50, 200],
        repeatRows=1,
    )
    # Color the status column based on each row's status
    style_cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#18181b")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, 0), 8),
        ("FONTSIZE", (0, 1), (-1, -1), 7),
        ("ALIGN", (3, 1), (3, -1), "CENTER"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e4e4e7")),
    ]
    status_colors = {
        "pass": colors.HexColor("#ecfdf5"),
        "fail": colors.HexColor("#fef2f2"),
        "manual": colors.HexColor("#fffbeb"),
        "na": colors.HexColor("#f4f4f5"),
        "pending": colors.HexColor("#f4f4f5"),
    }
    for i, rec in enumerate(benchmark.recommendations, start=1):
        r = results.get(rec.id)
        status = r.status if r else "pending"
        style_cmds.append(("BACKGROUND", (3, i), (3, i), status_colors.get(status, colors.white)))
    per_check_table.setStyle(TableStyle(style_cmds))
    story.append(per_check_table)

    # Build the PDF
    def _footer(canvas, doc_):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.HexColor("#a1a1aa"))
        canvas.drawCentredString(
            A4[0] / 2, 10 * mm,
            f"{benchmark.title} {benchmark.version} — Page {doc_.page}",
        )
        canvas.restoreState()

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return buf.getvalue()


# -----------------------------------------------------------------------------
# Top-level helper
# -----------------------------------------------------------------------------

def generate_all(
    benchmark: ParsedBenchmark,
    results: dict,
    output_dir: Path,
    base_name: Optional[str] = None,
) -> dict[str, Path]:
    """Generate CSV, HTML, and PDF reports in the given directory.

    Returns a dict mapping format -> file path.
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    if not base_name:
        base_name = f"cis-{benchmark.benchmark_type}-report-{datetime.now().strftime('%Y%m%d-%H%M%S')}"

    paths: dict[str, Path] = {}

    csv_path = output_dir / f"{base_name}.csv"
    csv_path.write_text(build_csv(benchmark, results), encoding="utf-8")
    paths["csv"] = csv_path

    html_path = output_dir / f"{base_name}.html"
    html_path.write_text(build_html(benchmark, results), encoding="utf-8")
    paths["html"] = html_path

    pdf_path = output_dir / f"{base_name}.pdf"
    pdf_path.write_bytes(build_pdf(benchmark, results))
    paths["pdf"] = pdf_path

    return paths
