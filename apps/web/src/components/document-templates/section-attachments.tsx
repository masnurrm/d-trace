import { templateAssetUrl, type TemplateAttachment, type TemplateImageWidth } from '@dtrace/shared';
import { cn } from '@/lib/utils/cn';

const WIDTH_CLASS: Record<TemplateImageWidth, string> = {
  small: 'w-1/3',
  medium: 'w-2/3',
  full: 'w-full',
};

/**
 * The images a template printed under a section.
 *
 * One renderer for both the builder's preview and the filled document, so the
 * picture a designer placed is the picture a reader gets — same width, same
 * caption, same order.
 */
export function SectionAttachments({ attachments }: { attachments: TemplateAttachment[] }) {
  if (attachments.length === 0) return null;

  return (
    <div className="mt-[7px] space-y-2">
      {attachments.map((attachment) => (
        <figure
          key={attachment.assetId}
          className={cn('mx-auto', WIDTH_CLASS[attachment.width])}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- served by the BFF
              per user with no-store; next/image's optimiser would cache it. */}
          <img
            src={templateAssetUrl(attachment.assetId)}
            alt={attachment.caption || attachment.fileName || 'Lampiran gambar'}
            loading="lazy"
            className="block h-auto w-full border border-slate-300"
          />
          {attachment.caption && (
            <figcaption className="mt-1 text-center text-[9px] italic text-slate-600">
              {attachment.caption}
            </figcaption>
          )}
        </figure>
      ))}
    </div>
  );
}
