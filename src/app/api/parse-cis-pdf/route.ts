/**
 * POST /api/parse-cis-pdf
 *
 * Accepts a multipart/form-data upload with a single PDF file.
 * Extracts text and runs the generic CIS Benchmark parser. Returns
 * a ParsedBenchmark JSON object.
 *
 * Text extraction strategy:
 *   1. Try the system `pdftotext` binary (faster, preserves layout —
 *      works on local dev, Docker, fly.io, Railway, etc.).
 *   2. Fall back to the pure-JS `unpdf` library (works on Vercel and
 *      any serverless runtime that doesn't have poppler installed).
 *
 * Both paths feed the same cisParser logic, so results are identical.
 */

import { NextRequest, NextResponse } from 'next/server';
import { writeFile, readFile, mkdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import path from 'path';
import { parseCisBenchmark } from '@/lib/cisParser';

const execFileAsync = promisify(execFile);

const TMP_DIR = '/tmp/cis-uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Attempt to extract text using the system `pdftotext` binary.
 * Throws if `pdftotext` is not installed or returns empty output.
 */
async function extractWithPdftotext(pdfPath: string): Promise<string> {
  // Try `pdftotext -layout` first (preserves layout, works best with the parser)
  const outPath = pdfPath + '.txt';
  try {
    await execFileAsync('pdftotext', ['-layout', pdfPath, outPath], {
      maxBuffer: 256 * 1024 * 1024,
      timeout: 30000,
    });
    const text = await readFile(outPath, 'utf-8');
    await unlink(outPath).catch(() => {});
    if (text && text.length > 100) {
      return text;
    }
  } catch (_e) {
    // fall through
  }

  // Fallback: plain pdftotext (no layout)
  try {
    const { stdout } = await execFileAsync('pdftotext', [pdfPath, '-'], {
      maxBuffer: 256 * 1024 * 1024,
      timeout: 30000,
    });
    if (stdout && stdout.length > 100) {
      return stdout;
    }
  } catch (e) {
    throw new Error(`pdftotext failed: ${(e as Error).message}`);
  }

  throw new Error('pdftotext produced empty output');
}

/**
 * Pure-JS fallback using `unpdf` (a serverless-friendly wrapper around pdf.js).
 * Works on Vercel and any runtime without poppler installed.
 */
async function extractWithUnpdf(pdfPath: string): Promise<string> {
  const { getDocumentProxy } = await import('unpdf');
  const bytes = await readFile(pdfPath);
  const pdf = await getDocumentProxy(new Uint8Array(bytes));

  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    for (const item of content.items) {
      // item has shape { str: string, hasEOL: boolean, ... }
      const typed = item as { str: string; hasEOL?: boolean };
      text += typed.str;
      text += typed.hasEOL ? '\n' : ' ';
    }
    text += '\n';
  }
  return text;
}

/**
 * Try pdftotext first; fall back to unpdf if it's not available or fails.
 * Returns the extracted text or throws the underlying error.
 */
async function extractPdfText(pdfPath: string): Promise<string> {
  // Try pdftotext first
  try {
    return await extractWithPdftotext(pdfPath);
  } catch (e) {
    const msg = (e as Error).message || '';
    // If it's a "command not found" / "ENOENT" type error, fall back to unpdf.
    // Other errors (empty output, parse failures) also fall back.
    if (msg.includes('not found') || msg.includes('ENOENT') || msg.includes('spawn') || msg.includes('empty output') || msg.includes('pdftotext failed')) {
      // fall through to unpdf
    } else {
      // Unknown error — try unpdf anyway
    }
    return await extractWithUnpdf(pdfPath);
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: 'No file uploaded. Use multipart/form-data with a "file" field.' },
        { status: 400 },
      );
    }

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json({ error: 'Only PDF files are accepted.' }, { status: 400 });
    }

    if (file.size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large. Max 50 MB.' }, { status: 413 });
    }

    // Save uploaded bytes to a temp file so we can pass to both extractors
    if (!existsSync(TMP_DIR)) {
      await mkdir(TMP_DIR, { recursive: true });
    }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const tmpPath = path.join(TMP_DIR, `${randomUUID()}_${safeName}`);
    const bytes = Buffer.from(await file.arrayBuffer());
    await writeFile(tmpPath, bytes);

    try {
      const text = await extractPdfText(tmpPath);
      const benchmark = parseCisBenchmark(text, file.name);
      return NextResponse.json(benchmark);
    } finally {
      await unlink(tmpPath).catch(() => {});
    }
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: `Failed to parse PDF: ${msg}` }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: 'POST /api/parse-cis-pdf',
    usage: 'Send a multipart/form-data POST with a "file" field containing the CIS Benchmark PDF.',
    maxSize: '50MB',
    acceptedTypes: ['application/pdf'],
    extractors: ['pdftotext (preferred)', 'unpdf (fallback for serverless)'],
  });
}
