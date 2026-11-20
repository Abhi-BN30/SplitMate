import { requireUser, json, errorResponse } from '@/lib/http';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';

// This endpoint only stores the original receipt. OCR runs locally in the browser
// using Tesseract.js, so no paid OCR provider or API key is required.
export async function POST(req: Request) {
  try {
    await requireUser();
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return json({ error: 'Choose a bill image or PDF.' }, 400);
    if (file.size > 12 * 1024 * 1024) return json({ error: 'File must be smaller than 12 MB.' }, 400);
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowed.includes(file.type)) return json({ error: 'Supported formats: JPG, PNG, WEBP and PDF.' }, 400);
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : file.type === 'application/pdf' ? 'pdf' : 'jpg';
    const bytes = Buffer.from(await file.arrayBuffer());
    const uploadDir = path.join(process.cwd(), 'public', 'uploads');
    await mkdir(uploadDir, { recursive: true });
    const filename = `${randomUUID()}.${ext}`;
    await writeFile(path.join(uploadDir, filename), bytes);
    return json({ receiptUrl: `/uploads/${filename}` });
  } catch (e) {
    return errorResponse(e);
  }
}
