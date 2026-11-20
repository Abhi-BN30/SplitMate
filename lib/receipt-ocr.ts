'use client';

import { createWorker, PSM } from 'tesseract.js';

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
  const validDate = (year: number, month: number, day: number) => {
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  };
  const m = text.match(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(20\d{2})\b/i);
  if (m) {
    const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    const month = months.indexOf(m[2].slice(0,3).toLowerCase()) + 1;
    const day = Number(m[1]);
    if (month < 1 || !validDate(Number(m[3]), month, day)) return null;
    return `${m[3]}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  const iso = text.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (iso && validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))) return `${iso[1]}-${iso[2].padStart(2,'0')}-${iso[3].padStart(2,'0')}`;
  const dmy = text.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})\b/);
  if (dmy) {
    const year = Number(dmy[3]) < 100 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
    if (validDate(year, Number(dmy[2]), Number(dmy[1]))) return `${year}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
  }
  return null;
}

function titleFromText(text: string): string {
  const excluded = /\b(invoice|receipt|bill|gstin|fssai|phone|mobile|address|customer|cashier|table|order|date|time|tax)\b/i;
  return text.split(/\r?\n/).map(clean).find(line => {
    const letters = line.match(/[a-z]/gi)?.length || 0;
    return line.length >= 3 && line.length <= 60 && letters >= 3 && !/\d{5,}/.test(line) && !excluded.test(line);
  }) || 'Restaurant bill';
}

function findTableStart(lines: OcrLine[]): number | null {
  for (const line of lines) {
    const t = lineText(line).toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
    // Accept common OCR confusions such as ITEM -> TEM / 1TEM.
    const hasItem = /\b(item|items|tem|1tem|ltem)\b/.test(t);
    const hasQty = /\b(qty|oty|quantity|qly)\b/.test(t);
    const hasUnit = /\b(unit|unlt|unt|rate|price)\b/.test(t);
    const hasTotal = /\b(total|tota|t0tal|amount|amt)\b/.test(t);
    if ((hasItem || (hasQty && hasUnit)) && hasQty && (hasTotal || hasUnit)) return line.bbox.y0;
  }
  // Fallback for receipts where the header is partly missed: identify a row-numbered
  // item sequence and start at its first line, never at address/phone/GST metadata.
  for (const line of lines) {
    if (/^\s*1\s*[.)-]\s*\S+/.test(lineText(line))) return line.bbox.y0;
  }
  return null;
}

function parseTableText(text: string, allowUnnumbered = false): ParsedItem[] {
  const out: ParsedItem[] = [];
  const rows = text.split(/\r?\n/).map(clean);
  for (const row of rows) {
    if (/\b(sub\s*total|subtotal|grand\s*total|net\s*amount|amount\s*paid|cgst|sgst|igst|gst|tax|service\s*charge|discount|round\s*off)\b/i.test(row)) break;
    const normalized = row.replace(/(₹|Rs\.?|INR)\s+(?=\d)/gi, '$1');
    const numbered = normalized.match(/^\s*\d{1,3}\s*[.)-]\s*(.+?)\s+(\d{1,3}(?:\.\d{1,2})?)\s+([^\s]+)\s+([^\s]+)\s*$/i);
    const rowMatch = numbered || (allowUnnumbered
      ? normalized.match(/^\s*(.+?)\s+(\d{1,3}(?:\.\d{1,2})?)\s+([^\s]+)\s+([^\s]+)\s*$/i)
      : null);
    if (!rowMatch) continue;
    let name = clean(rowMatch[1]).replace(/^[*•-]+\s*/, '');
    if (allowUnnumbered) name = name.replace(/^\d{1,3}\s+(?=[^\d])/u, '');
    const quantity = Number(rowMatch[2]);
    const unitRead = amountFromToken(rowMatch[3]);
    const totalRead = amountFromToken(rowMatch[4]);
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
    if (Math.abs(item.total - Math.round(item.total)) < 0.01) {
      for (let digit = 1; digit <= 9; digit++) {
        const candidate = Number(`${digit}${Math.round(item.total)}`) * 100;
        if (candidate > 0 && candidate <= target) values.add(candidate);
      }
    }
    return [...values].map(total => ({ total, error: Math.abs(total - base) }));
  });
  let states = new Map<number, { totals: number[]; error: number }>([[0, { totals: [], error: 0 }]]);
  for (let index = 0; index < choices.length; index++) {
    const next = new Map<number, { totals: number[]; error: number }>();
    for (const [sum, state] of states) {
      for (const choice of choices[index]) {
        const nextSum = sum + choice.total;
        if (nextSum > target + 1000) continue;
        const error = state.error + choice.error;
        const previous = next.get(nextSum);
        if (!previous || error < previous.error) {
          next.set(nextSum, { totals: [...state.totals, choice.total], error });
        }
      }
    }
    const remainingBase = choices.slice(index + 1).reduce((sum, itemChoices) => sum + itemChoices[0].total, 0);
    states = next.size > 10000
      ? new Map([...next.entries()]
        .sort((a, b) => Math.abs(a[0] + remainingBase - target) - Math.abs(b[0] + remainingBase - target) || a[1].error - b[1].error)
        .slice(0, 10000))
      : next;
  }
  let best: { totals: number[]; error: number; sumError: number } | null = null;
  for (const [sum, state] of states) {
    const sumError = Math.abs(sum - target);
    if (!best || sumError < best.sumError || (sumError === best.sumError && state.error < best.error)) {
      best = { totals: state.totals, error: state.error, sumError };
    }
  }
  if (!best || best.sumError > 100) return items;
  return items.map((item, i) => {
    const total = best.totals[i] / 100;
    return { ...item, total, unitPrice: Math.round((total / item.quantity) * 100) / 100 };
  });
}

function enhanceForOcr(source: HTMLCanvasElement): HTMLCanvasElement {
  const enhanced = document.createElement('canvas');
  enhanced.width = source.width;
  enhanced.height = source.height;
  const ctx = enhanced.getContext('2d', { willReadFrequently: true });
  if (!ctx) return source;
  ctx.drawImage(source, 0, 0);
  const image = ctx.getImageData(0, 0, enhanced.width, enhanced.height);
  for (let i = 0; i < image.data.length; i += 4) {
    const luminance = image.data[i] * 0.299 + image.data[i + 1] * 0.587 + image.data[i + 2] * 0.114;
    const gray = Math.round(Math.pow(luminance / 255, 1.35) * 255);
    image.data[i] = image.data[i + 1] = image.data[i + 2] = gray;
  }
  ctx.putImageData(image, 0, 0);
  return enhanced;
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
    const largestSide = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(3, 4200 / largestSide, Math.sqrt(12_000_000 / (bitmap.width * bitmap.height)));
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      bitmap.close();
      throw new Error('Could not prepare the image for OCR.');
    }
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
    return [canvas];
  }
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).toString();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  const canvases: HTMLCanvasElement[] = [];
  try {
    for (let pageNo = 1; pageNo <= Math.min(pdf.numPages, 5); pageNo++) {
      const page = await pdf.getPage(pageNo);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(3, 3600 / Math.max(base.width, base.height), Math.sqrt(10_000_000 / (base.width * base.height)));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      await page.render({ canvasContext: ctx, viewport }).promise;
      canvases.push(canvas);
    }
  } finally {
    await pdf.destroy();
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
  const supportedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (!supportedTypes.includes(file.type)) throw new Error('Supported formats: JPG, PNG, WEBP and PDF.');
  if (file.size > 20 * 1024 * 1024) throw new Error('Choose a bill smaller than 20 MB.');
  if (file.type === 'application/pdf' && file.size > 4 * 1024 * 1024) {
    throw new Error('PDF receipts must be smaller than 4 MB to upload reliably.');
  }
  const canvases = await loadImageCanvas(file);
  if (!canvases.length) throw new Error('No readable pages found in this file.');
  const worker = await createWorker('eng', 1, { logger: m => { if (m.status === 'recognizing text') onProgress?.(Math.round(m.progress * 70)); } });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: '1' });
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
          await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_COLUMN, preserve_interword_spaces: '1' });
          const tableResult = await worker.recognize(crop);
          let selectedTableText = tableResult.data.text || '';
          let selectedConfidence = tableResult.data.confidence || 0;
          if (parseTableText(selectedTableText, true).length < 2) {
            const enhanced = enhanceForOcr(crop);
            await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: '1' });
            const enhancedResult = await worker.recognize(enhanced);
            const enhancedText = enhancedResult.data.text || '';
            const itemCount = parseTableText(enhancedText, true).length;
            const selectedCount = parseTableText(selectedTableText, true).length;
            if (itemCount > selectedCount || (itemCount === selectedCount && (enhancedResult.data.confidence || 0) > selectedConfidence)) {
              selectedTableText = enhancedText;
              selectedConfidence = enhancedResult.data.confidence || 0;
            }
          }
          await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: '1' });
          tableTexts.push(selectedTableText);
        }
      }
      onProgress?.(70 + Math.round(((i + 1) / canvases.length) * 25));
    }
    const fullText = raw.join('\n');
    const preferredTableText = tableTexts.join('\n');
    let items = parseTableText(preferredTableText, true);
    if (!items.length) items = parseTableText(fullText);
    const adjustments = parseAdjustments(fullText);
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
    return { title: titleFromText(fullText), date, items, ...adjustments, rawText: `${fullText}\n--- ITEM TABLE OCR ---\n${preferredTableText}`, warnings };
  } finally {
    await worker.terminate();
  }
}
