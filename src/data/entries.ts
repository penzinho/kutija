import { z } from 'zod';
import raw from './entries.json';

// Text copied out of the jury PDF sometimes carries control characters
// (e.g. U+0002 where a hyphen was). Reject them so they never reach the page.
const text = z
  .string()
  .min(1)
  .refine((s) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(s), {
    message: 'contains a control character',
  });

export const STATUSES = ['awarded', 'finalist', 'eliminated', 'excluded'] as const;

const entrySchema = z
  .object({
    id: z.number().int().min(1).max(88),
    code: z.string().regex(/^[A-Z0-9]{9}$/),
    award: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).nullable(),
    status: z.enum(STATUSES),
    eliminatedInRound: z.number().int().min(1).max(6).nullable(),
    descriptionHr: text.nullable(),
    descriptionEn: text.nullable(),
    juryHr: z.array(text),
    juryEn: z.array(text),
    roundNoteHr: z.array(text),
    roundNoteEn: z.array(text),
    authors: z.array(text),
    country: z.string().regex(/^[A-Z]{2}$/).nullable(),
    images: z.array(z.string().regex(/^\d+-\d+\.jpg$/)), // files in src/assets/entries/
    pdf: z.url().nullable(),
  })
  .strict()
  .superRefine((e, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if ((e.status === 'awarded') !== (e.award !== null)) fail('award must be set exactly when status is "awarded"');
    if ((e.status === 'eliminated') !== (e.eliminatedInRound !== null))
      fail('eliminatedInRound must be set exactly when status is "eliminated"');
    if (e.status !== 'excluded' && e.descriptionHr === null) fail('descriptionHr is required unless excluded');
    for (const img of e.images) if (!img.startsWith(`${e.id}-`)) fail(`image "${img}" does not belong to entry ${e.id}`);
  });

const fileSchema = z
  .object({
    meta: z
      .object({
        source: text,
        sourceUrl: z.url(),
        total: z.number().int(),
        statuses: z.record(z.enum(STATUSES), text),
      })
      .strict(),
    entries: z.array(entrySchema),
  })
  .strict()
  .superRefine(({ meta, entries }, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (entries.length !== meta.total) fail(`expected ${meta.total} entries, got ${entries.length}`);
    // ids are used in URLs (/rad/1..88): contiguous, in order.
    entries.forEach((e, i) => {
      if (e.id !== i + 1) fail(`entry at index ${i} has id ${e.id}, expected ${i + 1}`);
    });
    const codes = new Set(entries.map((e) => e.code));
    if (codes.size !== entries.length) fail('entry codes must be unique');
    const awards = entries.flatMap((e) => (e.award === null ? [] : [e.award])).sort();
    if (awards.join() !== '1,2,3,4,5') fail(`expected awards 1–5 exactly once, got [${awards.join()}]`);
  });

export type Entry = z.infer<typeof entrySchema>;
export type Status = Entry['status'];
export type Award = NonNullable<Entry['award']>;

// Parsed at import time: invalid data throws and fails `astro build`.
const parsed = fileSchema.safeParse(raw);
if (!parsed.success) {
  throw new Error(`src/data/entries.json is invalid:\n${z.prettifyError(parsed.error)}`);
}

export const meta = parsed.data.meta;
export const entries: readonly Entry[] = parsed.data.entries;

const byId = new Map(entries.map((e) => [e.id, e]));

export function getEntry(id: number): Entry | undefined {
  return byId.get(id);
}

/** The five jury prizes, 1st to 5th. */
export const awarded: readonly Entry[] = entries
  .filter((e) => e.award !== null)
  .sort((a, b) => a.award! - b.award!);

/** Entries that can appear in duels (everything the jury accepted for judging). */
export const duelEligible: readonly Entry[] = entries.filter((e) => e.status !== 'excluded');

export function statusLabel(e: Entry): string {
  switch (e.status) {
    case 'awarded':
      return `${e.award}. nagrada žirija`;
    case 'finalist':
      return 'Finalist';
    case 'eliminated':
      return `Ispao u ${e.eliminatedInRound}. krugu`;
    case 'excluded':
      return 'Nije prihvaćen u ocjenjivanje';
  }
}
