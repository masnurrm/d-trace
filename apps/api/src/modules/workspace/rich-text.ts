import sanitizeHtml from 'sanitize-html';
import {
  DOCUMENT_IMAGE_SRC_PATTERN,
  RICH_TEXT_ALLOWED_ATTRIBUTES,
  RICH_TEXT_ALLOWED_SCHEMES,
  RICH_TEXT_ALLOWED_STYLES,
  RICH_TEXT_ALLOWED_TAGS,
  type DocumentContent,
  type TemplateSectionView,
} from '@dtrace/shared';

/**
 * Strips everything a document body has no business containing.
 *
 * The editor's own schema already refuses most of this, but the editor is in
 * the browser and the browser is not where a rule is enforced. A document is
 * written by one person and read by the one approving it, so an unsanitised
 * body is a script that runs in the approver's session — the most valuable
 * session in the app. This runs on every save, including the ones a future
 * code path forgets to think about.
 */
export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [...RICH_TEXT_ALLOWED_TAGS],
    allowedAttributes: RICH_TEXT_ALLOWED_ATTRIBUTES as Record<string, string[]>,

    // `style` survives as an attribute, but only these properties and only
    // with these values — everything else in the declaration is dropped. This
    // is what makes alignment and font size expressible without handing a
    // document body the ability to position itself over the page.
    allowedStyles: { '*': RICH_TEXT_ALLOWED_STYLES },

    // Bounded by scheme rather than by pattern: `javascript:` and `data:` are
    // absent, so a link that runs on click cannot be stored.
    allowedSchemes: [...RICH_TEXT_ALLOWED_SCHEMES],
    allowedSchemesAppliedToAttributes: ['href'],

    transformTags: {
      // A document is read by people who did not write it. An outbound link
      // opens away from the app, and `noopener` keeps the new tab from
      // reaching back into this one.
      a: sanitizeHtml.simpleTransform('a', {
        target: '_blank',
        rel: 'noopener noreferrer nofollow',
      }),
      // Attributes are allowed by name above; here their *values* are checked,
      // since sanitize-html has no per-value pattern of its own.
      img: (tagName, attribs) => ({
        tagName,
        attribs: pick(attribs, {
          src: (value) => DOCUMENT_IMAGE_SRC_PATTERN.test(value),
          alt: (value) => value.length <= 200,
          width: isSmallInt(4000),
          height: isSmallInt(4000),
        }),
      }),
      ol: (tagName, attribs) => ({
        tagName,
        attribs: pick(attribs, {
          start: isSmallInt(9999),
          type: (value) => value === '1' || value === 'a',
          style: () => true,
        }),
      }),
      p: indentTransform,
      h1: indentTransform,
      h2: indentTransform,
      h3: indentTransform,
      h4: indentTransform,
      td: cellTransform,
      th: cellTransform,
    },

    // An image that is not one of this document's own files is dropped whole:
    // anything else is a request the reader's browser makes to a third party
    // the moment the document opens.
    exclusiveFilter: (frame) =>
      frame.tag === 'img' && !DOCUMENT_IMAGE_SRC_PATTERN.test(frame.attribs['src'] ?? ''),

    // Text inside a dropped tag is kept; deleting somebody's paragraph because
    // they pasted it inside a <div> would be worse than dropping the <div>.
    disallowedTagsMode: 'discard',
  });
}

const cellTransform: sanitizeHtml.Transformer = (tagName, attribs) => ({
  tagName,
  attribs: pick(attribs, {
    colspan: isSmallInt(50),
    rowspan: isSmallInt(200),
    colwidth: (value) => /^\d{1,4}(,\d{1,4}){0,49}$/.test(value),
    style: () => true, // narrowed by allowedStyles like every other element
  }),
});

const indentTransform: sanitizeHtml.Transformer = (tagName, attribs) => ({
  tagName,
  attribs: pick(attribs, {
    'data-indent': (value) => /^[1-4]$/.test(value),
    style: () => true,
  }),
});

function isSmallInt(max: number): (value: string) => boolean {
  return (value) => /^\d{1,4}$/.test(value) && Number(value) >= 1 && Number(value) <= max;
}

/** Keeps only the attributes whose value passes its check. */
function pick(
  attribs: sanitizeHtml.Attributes,
  checks: Record<string, (value: string) => boolean>,
): sanitizeHtml.Attributes {
  const kept: sanitizeHtml.Attributes = {};
  for (const [name, check] of Object.entries(checks)) {
    const value = attribs[name];
    if (typeof value === 'string' && check(value)) kept[name] = value;
  }
  return kept;
}

/**
 * Sanitises every rich-text section of a document, leaving the rest untouched.
 *
 * Driven by the template's section types rather than by looking for anything
 * that smells like HTML: a table cell holding the characters `<b>` is a table
 * cell, and rewriting it would be this function inventing formatting nobody
 * asked for.
 */
export function sanitizeDocumentContent(
  sections: Pick<TemplateSectionView, 'key' | 'type'>[],
  content: DocumentContent,
): DocumentContent {
  const sanitized: DocumentContent = { ...content };

  for (const section of sections) {
    if (section.type !== 'TEXT') continue;

    const value = sanitized[section.key] as { text?: string } | undefined;
    if (!value || typeof value.text !== 'string') continue;

    sanitized[section.key] = { ...value, text: sanitizeRichText(value.text) };
  }

  return sanitized;
}
