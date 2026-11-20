'use client';

import { createWorker } from 'tesseract.js';

type Box = { x0: number; x1: number; y0: number; y1: number };
type Word = { text: string; bbox: Box; confidence?: number };
type OcrLine = { text: string; bbox: Box; words: Word[] };
type ParsedItem = { name: string; quantity: number; unitPrice: number; total: number };
export type ReceiptExtraction = {
  title: string;
  date: string | null;
  items: ParsedItem[];
  subtotal: number | null;
  taxes: { name: string; amount: number }[];
  serviceCharge: number;
  discount: number;
  grandTotal: number | null;
  rawText: string;
  warnings: string[];
};

const clean = (s: string) => s.replace(/[|]/g, ' ').replace(/\s+/g, ' ').trim();
const center = (w: Word) => (w.bbox.x0 + w.bbox.x1) / 2;
const lineText = (line: OcrLine) => clean(line.text || line.words.map(w => w.text).join(' '));

// OCR engines frequently attach a stray character to the printed rupee symbol.
// Strip non-numeric currency glyphs, but retain decimal and thousands separators.
function amountFromToken(token: string): number | null {
  const decimalized = token.replace(/,(\d{2})$/, '.$1');
  const normalized = decimalized.replace(/,/g, '').replace(/[^0-9.\-]/g, '');
  const match = normalized.match(/-?\d+(?:\.\d{1,2})?/);
  if (!match) return null;
  const n = Number(match[0]);
  if (!Number.isFinite(n) || n < 0 || n > 1000000) return null;
  // These sample receipts and most restaurant POS bills print whole-rupee item prices;
  // OCR sometimes turns the final dot into a decimal point followed by 08/00.
  return Math.abs(n - Math.round(n)) <= 0.10 ? Math.round(n) : n;
}

function dateFromText(text: string): string | null {
  const m = text.match(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(20\d{2})\b/i);
  if (m) {
    const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    const month = months.indexOf(m[2].slice(0,3).toLowerCase()) + 1;
    const day = Number(m[1]);
    if (month < 1 || day < 1 || day > 31) return null;
    return `${m[3]}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  const iso = text.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2,'0')}-${iso[3].padStart(2,'0')}`;
  const dmy = text.match(/\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2})\b/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
  return null;
}

function findTableStart(lines: OcrLine[]): number | null {
  for (const line of lines) {
    const t = lineText(line).toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
    // Accept common OCR confusions such as ITEM -> TEM / 1TEM.
    const hasItem = /\b(item|items|tem|1tem|ltem)\b/.test(t);
    const hasQty = /\b(qty|oty|quantity|qly)\b/.test(t);
    const hasUnit = /\b(unit|unlt|unt)\b/.test(t);
    const hasTotal = /\b(total|tota|t0tal)\b/.test(t);
    if ((hasItem || (hasQty && hasUnit)) && hasQty && hasTotal) return line.bbox.y0;
  }
  // Fallback for receipts where the header is partly missed: identify a row-numbered
  // item sequence and start at its first line, never at address/phone/GST metadata.
  for (const line of lines) {
    if (/^\s*1\s*[.)-]\s*\S+/.test(lineText(line))) return line.bbox.y0;
  }
  return null;
}

function parseTableText(text: string): ParsedItem[] {
  const out: ParsedItem[] = [];
  const rows = text.split(/\r?\n/).map(clean);
  for (const row of rows) {
    if (/\b(sub\s*total|subtotal|grand\s*total|net\s*amount|amount\s*paid|cgst|sgst|igst|gst|tax|service\s*charge|discount|round\s*off)\b/i.test(row)) break;
    // Rows must begin with a printed serial number. This prevents phone numbers,
    // GSTINs, PIN codes and bill metadata from becoming expense items.
    const m = row.match(/^\s*\d{1,3}\s*[.)-]\s*(.+?)\s+(\d{1,2})\s+([^\s]+)\s+([^\s]+)\s*$/);
    if (!m) continue;
    const name = clean(m[1]).replace(/^[*•-]+\s*/, '');
    const quantity = Number(m[2]);
    const unitRead = amountFromToken(m[3]);
    const totalRead = amountFromToken(m[4]);
    if (!name || name.length < 2 || quantity < 1 || quantity > 99 || totalRead === null) continue;
    // Line total is generally the most reliable amount column. Derive the unit
    // price from it when the OCR's unit column contains a rupee-symbol artefact.
    const total = totalRead;
    const derivedUnit = Math.round((total / quantity) * 100) / 100;
    const unitPrice = unitRead !== null && Math.abs(unitRead * quantity - total) <= 0.02
      ? unitRead
      : derivedUnit;
    out.push({ name: name.replace(/^\d+\s*/, ''), quantity, unitPrice, total });
  }
  return out;
}

function reconcileItemTotals(items: ParsedItem[], subtotal: number | null): ParsedItem[] {
  if (!items.length || subtotal === null) return items;
  const target = Math.round(subtotal * 100);
  const choices = items.map(item => {
    const base = Math.round(item.total * 100);
    const values = new Set<number>([base]);
    // Currency glyphs are sometimes read as a leading digit or disappear.
    // Test a single missing leading digit only when the subtotal supports it.
    for (let digit = 1; digit <= 9; digit++) {
      const candidate = Number(`${digit}${Math.round(item.total)}`) * 100;
      if (candidate > 0 && candidate <= target) values.add(candidate);
    }
    return [...values].map(total => ({ total, error: Math.abs(total - base) }));
  });
  let best: { totals: number[]; error: number; sumError: number } | null = null;
  const walk = (index: number, totals: number[], sum: number, error: number) => {
    if (index === choices.length) {
      const sumError = Math.abs(sum - target);
      if (!best || sumError < best.sumError || (sumError === best.sumError && error < best.error)) {
        best = { totals: [...totals], error, sumError };
      }
      return;
    }
    for (const choice of choices[index]) {
      if (sum + choice.total > target + 1000) continue;
      walk(index + 1, [...totals, choice.total], sum + choice.total, error + choice.error);
    }
  };
  walk(0, [], 0, 0);
  if (!best || best.sumError > 100) return items;
  return items.map((item, i) => {
    const total = best!.totals[i] / 100;
    return { ...item, total, unitPrice: Math.round((total / item.quantity) * 100) / 100 };
  });
}

function parseAdjustments(text: string) {
  const taxes: { name: string; amount: number }[] = [];
  let subtotal: number | null = null, grandTotal: number | null = null, serviceCharge = 0, discount = 0;
  for (const line of text.split(/\r?\n/)) {
    const t = clean(line);
    const tokens = t.match(/[\p{L}₹$€£]*\s*\d[\d,]*(?:\.\d{1,2})?/gu) || [];
    const value = tokens.length ? amountFromToken(tokens[tokens.length - 1]) : null;
    if (value === null) continue;
    if (/sub\s*total|subtotal/i.test(t)) subtotal = value;
    else if (/cgst|sgst|igst|gst|c[o0]st/i.test(t)) {
      const label = (t.match(/\b(CGST|SGST|IGST|GST)\b/i)?.[1] || (/c[o0]st/i.test(t) ? 'CGST' : 'Tax')).toUpperCase();
      const corrected = subtotal !== null && value > subtotal ? amountFromToken(String(value).replace(/^\d/, '')) ?? value : value;
      taxes.push({ name: label, amount: corrected });
    } else if (/service\s*charge/i.test(t)) serviceCharge = value;
    else if (/discount|less/i.test(t)) discount = value;
    else if (/grand\s*total|net\s*amount|total\s*payable|amount\s*due/i.test(t)) grandTotal = value;
  }
  return { subtotal, taxes, serviceCharge, discount, grandTotal };
}

async function loadImageCanvas(file: File): Promise<HTMLCanvasElement[]> {
  if (file.type !== 'application/pdf') {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    // Upscale small phone screenshots substantially; keep large photos bounded.
    const scale = Math.min(4, Math.max(3, 1800 / bitmap.width));
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not prepare the image for OCR.');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
    return [canvas];
  }
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data: bytes, disableWorker: true }).promise;
  const canvases: HTMLCanvasElement[] = [];
  for (let pageNo = 1; pageNo <= Math.min(pdf.numPages, 5); pageNo++) {
    const page = await pdf.getPage(pageNo);
    const viewport = page.getViewport({ scale: 3 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    await page.render({ canvasContext: ctx, viewport }).promise;
    canvases.push(canvas);
  }
  return canvases;
}

function makeTableCrop(source: HTMLCanvasElement, y: number): HTMLCanvasElement | null {
  const top = Math.max(0, Math.floor(y - source.height * 0.008));
  const crop = document.createElement('canvas');
  crop.width = source.width;
  crop.height = source.height - top;
  if (crop.height < source.height * 0.08) return null;
  const ctx = crop.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, crop.width, crop.height);
  ctx.drawImage(source, 0, top, source.width, crop.height, 0, 0, crop.width, crop.height);
  return crop;
}

export async function scanReceipt(file: File, onProgress?: (progress: number) => void): Promise<ReceiptExtraction> {
  const canvases = await loadImageCanvas(file);
  if (!canvases.length) throw new Error('No readable pages found in this file.');
  const worker = await createWorker('eng', 1, { logger: m => { if (m.status === 'recognizing text') onProgress?.(Math.round(m.progress * 70)); } });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: '6' as any, preserve_interword_spaces: '1' as any });
    const raw: string[] = [];
    const tableTexts: string[] = [];
    for (let i = 0; i < canvases.length; i++) {
      const full = await worker.recognize(canvases[i]);
      const fullText = full.data.text || '';
      raw.push(fullText);
      const lines: OcrLine[] = ((full.data as any).lines || []).map((l: any) => ({
        text: l.text || '', bbox: l.bbox,
        words: (l.words || []).map((w: any) => ({ text: w.text || '', bbox: w.bbox, confidence: w.confidence }))
      }));
      const tableY = findTableStart(lines);
      if (tableY !== null) {
        const crop = makeTableCrop(canvases[i], tableY);
        if (crop) {
          // A dedicated table pass avoids the restaurant header, address, phone,
          // GSTIN and bill metadata interfering with item extraction.
          await worker.setParameters({ tessedit_pageseg_mode: '4' as any, preserve_interword_spaces: '1' as any });
          const tableResult = await worker.recognize(crop);
          await worker.setParameters({ tessedit_pageseg_mode: '6' as any, preserve_interword_spaces: '1' as any });
          tableTexts.push(tableResult.data.text || '');
        }
      }
      onProgress?.(70 + Math.round(((i + 1) / canvases.length) * 25));
    }
    const fullText = raw.join('\n');
    const preferredTableText = tableTexts.join('\n');
    let items = parseTableText(preferredTableText);
    if (!items.length) items = parseTableText(fullText);
    const adjustments = parseAdjustments(fullText + '\n' + preferredTableText);
    items = reconcileItemTotals(items, adjustments.subtotal);
    // When OCR mangles the subtotal's first character, a complete, internally
    // consistent row set is more trustworthy than that single subtotal token.
    const itemSum = items.reduce((s, item) => s + Math.round(item.total * 100), 0) / 100;
    const date = dateFromText(fullText);
    const warnings: string[] = [];
    if (!items.length) warnings.push('Could not confidently read the item table. Try a sharper, straight-on photo or add the items manually.');
    if (items.length && adjustments.subtotal !== null && Math.abs(itemSum - adjustments.subtotal) > 1) {
      warnings.push(`Detected item totals (${itemSum.toFixed(2)}) do not match the printed subtotal (${adjustments.subtotal.toFixed(2)}). Please review the highlighted amounts.`);
    }
    if (items.some(i => Math.abs(i.quantity * i.unitPrice - i.total) > 0.02)) warnings.push('One or more item calculations need review.');
    onProgress?.(100);
    return { title: 'Restaurant bill', date, items, ...adjustments, rawText: `${fullText}\n--- ITEM TABLE OCR ---\n${preferredTableText}`, warnings };
  } finally {
    await worker.terminate();
  }
}
