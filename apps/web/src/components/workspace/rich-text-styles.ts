import { cn } from '@/lib/utils/cn';

/**
 * How a rich-text body looks, in the editor and on the printed page alike.
 *
 * One list rather than two so that what an author arranges is what prints:
 * a table that fits the editor fits the page, a heading keeps its weight, a
 * resized picture keeps its width. Table headers take the yellow the BPM's
 * "Detail | Flow" and "Keterangan" bars have always had.
 */
export const RICH_TEXT_BODY_CLASS = cn(
  '[&_h1]:mt-3 [&_h1]:text-[1.6em] [&_h1]:font-bold',
  '[&_h2]:mt-3 [&_h2]:text-[1.35em] [&_h2]:font-semibold',
  '[&_h3]:mt-3 [&_h3]:text-[1.15em] [&_h3]:font-semibold',
  '[&_h4]:mt-2 [&_h4]:font-semibold',
  '[&_ul]:list-disc [&_ul]:pl-[1.4em] [&_ol]:list-decimal [&_ol]:pl-[1.6em]',
  '[&_ol[type=a]]:list-[lower-alpha]',
  '[&_[data-indent="1"]]:ml-[2em] [&_[data-indent="2"]]:ml-[4em]',
  '[&_[data-indent="3"]]:ml-[6em] [&_[data-indent="4"]]:ml-[8em]',
  '[&_blockquote]:border-l-2 [&_blockquote]:border-slate-300 [&_blockquote]:pl-3 [&_blockquote]:text-slate-600',
  '[&_pre]:rounded [&_pre]:bg-slate-100 [&_pre]:p-2 [&_pre]:text-[0.9em]',
  '[&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:text-[0.9em]',
  '[&_hr]:my-3 [&_hr]:border-slate-300',
  '[&_a]:text-sky-700 [&_a]:underline',
  '[&_mark]:bg-yellow-200',
  '[&_p]:leading-relaxed',
  // Pictures: never wider than the column, and a set width keeps its ratio.
  '[&_img]:inline-block [&_img]:h-auto [&_img]:max-w-full',
  // Tables, bordered like the rest of the sheet.
  '[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table]:table-fixed',
  '[&_td]:border [&_td]:border-slate-900 [&_td]:px-[0.5em] [&_td]:py-[0.25em] [&_td]:align-top',
  '[&_th]:border [&_th]:border-slate-900 [&_th]:bg-[#ffff99] [&_th]:px-[0.5em] [&_th]:py-[0.25em] [&_th]:text-center [&_th]:font-bold',
  '[&_td_p]:my-0 [&_th_p]:my-0',
  // TipTap marks the cells a drag has selected; show the selection.
  '[&_.selectedCell]:bg-sky-100',
);
