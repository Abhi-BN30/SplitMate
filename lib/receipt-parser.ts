export type ParsedReceipt = {
  title: string;
  date: string | null;
  items: { name: string; quantity: number; unitPrice: number; total: number }[];
  subtotal: number | null;
  taxes: { name: string; amount: number }[];
  serviceCharge: number;
  discount: number;
  grandTotal: number | null;
  rawText: string;
  warnings: string[];
};

const money = (value: string) => {
  const n = Number(value.replace(/[₹,\s]/g, '').replace(/^(?:rs\.?|inr)/i, ''));
  return Number.isFinite(n) ? n : null;
};
const amountAtEnd = (line: string) => {
  const match = line.match(/(?:₹\s*|\bRs\.?\s*|\bINR\s*)?(-?\d[\d,]*(?:\.\d{1,2})?)\s*$/i);
  return match ? money(match[1]) : null;
};

export function parseReceiptText(rawText: string): ParsedReceipt {
  const lines = rawText.split(/\r?\n/).map(s => s.replace(/[|]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const warnings: string[] = [];
  const taxes: { name: string; amount: number }[] = [];
  const items: ParsedReceipt['items'] = [];
  let subtotal: number | null = null, grandTotal: number | null = null;
  let serviceCharge = 0, discount = 0;
  let date: string | null = null;
  const dateMatch = rawText.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})\b/);
  if (dateMatch) {
    const day = Number(dateMatch[1]), month = Number(dateMatch[2]), yearRaw = Number(dateMatch[3]);
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    const d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day) date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  for (const line of lines) {
    const lower = line.toLowerCase();
    const amount = amountAtEnd(line);
    if (amount === null) continue;
    if (/sub\s*total|item\s*total/.test(lower)) { subtotal = amount; continue; }
    if (/grand\s*total|net\s*amount|amount\s*payable|total\s*payable|bill\s*total|\btotal\b/.test(lower)) { grandTotal = amount; continue; }
    if (/service\s*(?:charge|chg)|\bsvc\b/.test(lower)) { serviceCharge += Math.abs(amount); continue; }
    if (/discount|offer|less\s*:/.test(lower)) { discount += Math.abs(amount); continue; }
    if (/\b(cgst|sgst|igst|gst|vat|tax)\b/.test(lower)) {
      const label = (line.match(/(CGST|SGST|IGST|GST|VAT|Tax(?:es)?)/i)?.[0] || 'Tax').toUpperCase();
      taxes.push({ name: label, amount: Math.abs(amount) }); continue;
    }
  }

  const summaryPattern = /grand\s*total|net\s*amount|amount\s*payable|total\s*payable|bill\s*total|\btotal\b|sub\s*total|item\s*total|service\s*(?:charge|chg)|\bsvc\b|discount|offer|less\s*:|\b(cgst|sgst|igst|gst|vat|tax)\b|invoice|receipt|table\s*no|order\s*no|date\s*:/i;
  for (const line of lines) {
    if (summaryPattern.test(line) || line.length < 3) continue;
    const tokens = line.match(/\d[\d,]*(?:\.\d{1,2})?/g);
    if (!tokens?.length) continue;
    const last = money(tokens[tokens.length - 1]);
    if (last === null || last <= 0) continue;
    // Item rows commonly end in: quantity unit-price line-total.
    const quantityRow = line.match(/^(.*?)\s+(\d+(?:\.\d+)?)\s+(?:₹\s*)?([\d,]+(?:\.\d{1,2})?)\s+(?:₹\s*)?([\d,]+(?:\.\d{1,2})?)\s*$/);
    if (quantityRow) {
      const name = quantityRow[1].trim().replace(/[₹:.-]+$/, '').trim();
      const qty = Number(quantityRow[2]);
      const unit = money(quantityRow[3]);
      const total = money(quantityRow[4]);
      if (name.length >= 2 && qty > 0 && qty <= 100 && unit !== null && total !== null && Math.abs(qty * unit - total) <= Math.max(2, total * 0.03)) {
        items.push({ name, quantity: qty, unitPrice: unit, total }); continue;
      }
    }
    // Otherwise treat the final amount as a line total with quantity 1.
    const trailing = line.match(/(?:₹\s*|\bRs\.?\s*|\bINR\s*)?(-?\d[\d,]*(?:\.\d{1,2})?)\s*$/i);
    const name = line.slice(0, trailing?.index ?? line.length).trim().replace(/[₹:.-]+$/, '').trim();
    if (name.length >= 2 && !/^[\d\s.,-]+$/.test(name) && !/^(phone|gstin|fssai|cash|card|upi|change|balance)/i.test(name)) {
      items.push({ name, quantity: 1, unitPrice: last, total: last });
    }
  }

  const title = lines.find(l => l.length > 2 && l.length < 55 && !summaryPattern.test(l) && !/\d{5,}/.test(l)) || 'Restaurant bill';
  if (!items.length) warnings.push('No line items could be confidently identified. Enter the items manually or try a clearer, straight-on photo.');
  if (grandTotal === null) warnings.push('Grand total was not confidently identified. Check the printed bill and enter the correct amount.');
  else { const calculated = items.reduce((sum, item) => sum + item.total, 0) + taxes.reduce((sum, tax) => sum + tax.amount, 0) + serviceCharge - discount; if (items.length && Math.abs(calculated - grandTotal) > 2) warnings.push(`The extracted line items and adjustments total ₹${calculated.toFixed(2)}, but the printed grand total appears to be ₹${grandTotal.toFixed(2)}. Check the bill carefully.`); }
  return { title, date, items, subtotal, taxes, serviceCharge, discount, grandTotal, rawText, warnings };
}
