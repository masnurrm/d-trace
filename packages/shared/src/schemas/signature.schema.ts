import { z } from 'zod';

/**
 * A person's signature, in one of three forms.
 *
 * The three are not styles of one thing — they are three different claims. A
 * drawn mark is the person's own hand; a typed name is a declaration that they
 * signed; a code is a pointer back to this system so a reader can check. Which
 * one is acceptable is a policy question for whoever approves the document, so
 * the kind is stored and shown rather than flattened into one image.
 */

export const SIGNATURE_KINDS = ['DRAWN', 'TYPED', 'BARCODE'] as const;
export type SignatureKind = (typeof SIGNATURE_KINDS)[number];

export const SIGNATURE_KIND_LABELS: Record<SignatureKind, string> = {
  DRAWN: 'Tanda tangan digital',
  TYPED: 'Ketik nama',
  BARCODE: 'Barcode',
};

/** The script faces a typed signature may use. A closed list, so a stored
 *  signature renders the same on every machine that has these installed. */
export const SIGNATURE_FONTS = ['CURSIVE', 'SERIF', 'MONO'] as const;
export type SignatureFont = (typeof SIGNATURE_FONTS)[number];

export const SIGNATURE_FONT_LABELS: Record<SignatureFont, string> = {
  CURSIVE: 'Tulisan tangan',
  SERIF: 'Klasik',
  MONO: 'Mesin tik',
};

/**
 * Ceiling for the drawn PNG, in characters of data URL.
 *
 * 256 KB of base64 is roughly a 190 KB image — far more than a signature pad
 * ever produces, and small enough that a hostile client cannot use this column
 * as free file storage.
 */
export const SIGNATURE_DATA_MAX = 256 * 1024;

const dataUrlPng = z
  .string()
  .max(SIGNATURE_DATA_MAX, 'Gambar tanda tangan terlalu besar')
  .refine((value) => value.startsWith('data:image/png;base64,'), {
    message: 'Tanda tangan harus berupa gambar PNG',
  });

/**
 * Discriminated on `kind`, so each form is validated by its own rules rather
 * than by one loose shape with everything optional. A typed signature with no
 * text and a drawn one with no image are both nonsense, and this is where they
 * are refused.
 */
export const saveSignatureSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('DRAWN'),
    data: dataUrlPng,
  }),
  z.object({
    kind: z.literal('TYPED'),
    data: z.string().trim().min(2, 'Tulis minimal 2 karakter').max(80),
    font: z.enum(SIGNATURE_FONTS).default('CURSIVE'),
  }),
  z.object({
    // Nothing to send: the code is the server's to mint, once, and a client
    // that could choose it could claim someone else's.
    kind: z.literal('BARCODE'),
  }),
]);

export type SaveSignatureInput = z.infer<typeof saveSignatureSchema>;

export interface UserSignatureView {
  kind: SignatureKind;
  /** The PNG data URL or the typed text; null for a barcode. */
  data: string | null;
  font: SignatureFont | null;
  /** The value encoded in the barcode; null for the other two kinds. */
  code: string | null;
  updatedAt: string;
}
