'use client';

import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { OrderedList } from '@tiptap/extension-list';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import { Color, FontSize, TextStyle } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  Columns3,
  Eraser,
  Grid2x2X,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Highlighter,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Merge,
  Minus,
  PanelTop,
  Quote,
  Redo2,
  Rows3,
  Strikethrough,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Table as TableIcon,
  Underline as UnderlineIcon,
  Undo2,
  Unlink,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  RICH_TEXT_ALLOWED_SCHEMES,
  RICH_TEXT_FONT_SIZES,
  looksLikeHtml,
  plainTextToHtml,
} from '@dtrace/shared';
import { SelectControl } from '@/components/ui/field';
import { cn } from '@/lib/utils/cn';
import { RICH_TEXT_BODY_CLASS } from './rich-text-styles';

/** The palette offered for text colour. Hex only — the sanitiser accepts nothing else. */
const TEXT_COLORS = [
  { value: '', label: 'Otomatis', dot: '' },
  { value: '#111827', label: 'Hitam', dot: 'bg-slate-900' },
  { value: '#dc2626', label: 'Merah', dot: 'bg-red-600' },
  { value: '#ea580c', label: 'Oranye', dot: 'bg-orange-600' },
  { value: '#16a34a', label: 'Hijau', dot: 'bg-green-600' },
  { value: '#0284c7', label: 'Biru', dot: 'bg-sky-600' },
  { value: '#7c3aed', label: 'Ungu', dot: 'bg-violet-600' },
  { value: '#64748b', label: 'Abu-abu', dot: 'bg-slate-500' },
] as const;

const MAX_INDENT = 4;

const IndentAttribute = Extension.create({
  name: 'indentAttribute',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element) => Math.min(MAX_INDENT, Number(element.dataset['indent']) || 0),
            renderHTML: ({ indent }) =>
              indent > 0 ? { 'data-indent': String(Math.min(MAX_INDENT, indent)) } : {},
          },
        },
      },
    ];
  },
});

const StyledOrderedList = OrderedList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      type: {
        default: '1',
        parseHTML: (element) => (element.getAttribute('type') === 'a' ? 'a' : '1'),
        renderHTML: ({ type }) => (type === 'a' ? { type: 'a' } : {}),
      },
    };
  },
});

/**
 * The rich-text body of a document section.
 *
 * TipTap, which is free and MIT-licensed — the paid part of that project is a
 * hosted collaboration service this app does not use.
 *
 * The extension set below *is* the format: TipTap parses pasted HTML into its
 * own schema and drops anything it has no node for, so a pasted `<script>` or
 * a tracking pixel never survives being typed. That is not the security
 * boundary though — the API sanitises the same allow-list on save, because a
 * rule enforced only in the browser is a rule enforced nowhere. Alignment,
 * font size and colour reach the server as `style`, and the sanitiser keeps
 * only those three properties with values it has matched against a pattern.
 */
export function RichTextEditor({
  value,
  onChange,
  disabled,
  placeholder,
  minRows = 4,
  label,
  onUploadImage,
}: {
  value: string;
  onChange: (html: string) => void;
  disabled: boolean;
  placeholder?: string;
  minRows?: number;
  label: string;
  /**
   * Stores a picture and answers with the URL to embed. Absent means this
   * body cannot hold pictures, and the toolbar does not offer them.
   */
  onUploadImage?: (file: File) => Promise<string>;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Headings are capped at four: a section inside a document is already
        // two levels deep, and h5 in a printed page is smaller than the body.
        heading: { levels: [1, 2, 3, 4] },
        orderedList: false,
      }),
      StyledOrderedList,
      IndentAttribute,
      Underline,
      TextStyle,
      FontSize,
      Color,
      Highlight,
      Subscript,
      Superscript,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        // The same schemes the sanitiser will accept. Letting the editor
        // produce a `javascript:` href that the API then silently strips would
        // teach people the link worked.
        protocols: [...RICH_TEXT_ALLOWED_SCHEMES],
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
      }),
      // Pictures come only from the upload button: pasted or dropped `data:`
      // images and hot-linked URLs are refused here and stripped on save, so
      // a picture in the editor is always one the document owns.
      Image.configure({
        inline: false,
        allowBase64: false,
        resize: { enabled: true, alwaysPreserveAspectRatio: true, minWidth: 60, minHeight: 40 },
      }),
      // Column dragging writes pixel widths the sanitiser would have to trust;
      // a fixed layout with equal columns prints predictably instead.
      TableKit.configure({ table: { resizable: false } }),
    ],
    editable: !disabled,
    // Documents written before this editor hold bare text with newlines in it.
    // Handing that to TipTap as HTML would swallow every line break, so it is
    // converted rather than assumed.
    content: value && !looksLikeHtml(value) ? plainTextToHtml(value) : value,
    // Next renders this on the server first; without the flag React warns that
    // the editor's DOM does not match.
    immediatelyRender: false,
    onUpdate: ({ editor: instance }) => {
      const html = instance.getHTML();
      // TipTap represents "nothing" as an empty paragraph. Storing that would
      // make an untouched section look answered.
      onChange(html === '<p></p>' ? '' : html);
    },
    editorProps: {
      attributes: {
        'aria-label': label,
        class: cn('prose-sm max-w-none px-3 py-2 text-sm focus:outline-none', RICH_TEXT_BODY_CLASS),
        style: `min-height: ${minRows * 1.75}rem`,
      },
    },
  });

  // `editable` is set once at creation; a section that becomes read-only while
  // open — the document reached FINAL in another tab — has to be told.
  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  if (!editor) {
    return (
      <div
        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-400"
        style={{ minHeight: `${minRows * 1.75}rem` }}
      >
        Memuat editor…
      </div>
    );
  }

  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border border-slate-300 bg-white',
        'focus-within:outline-2 focus-within:outline-sky-500',
        disabled && 'opacity-60',
      )}
    >
      {!disabled && <Toolbar editor={editor} onUploadImage={onUploadImage} />}
      <EditorContent editor={editor} />
      {placeholder && editor.isEmpty && (
        <p className="pointer-events-none -mt-8 px-3 pb-2 text-sm text-slate-400">{placeholder}</p>
      )}
    </div>
  );
}

function Toolbar({
  editor,
  onUploadImage,
}: {
  editor: Editor;
  onUploadImage?: (file: File) => Promise<string>;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const inTable = editor.isActive('table');

  async function insertImage(file: File | undefined) {
    if (!file || !onUploadImage) return;
    setUploadError(null);
    setUploading(true);
    try {
      const src = await onUploadImage(file);
      editor.chain().focus().setImage({ src, alt: file.name.replace(/.[^.]+$/, '') }).run();
    } catch (caught) {
      setUploadError(caught instanceof Error ? caught.message : 'Gambar gagal diunggah.');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  /** The size on the current selection, or '' when it is whatever the body is. */
  const currentSize = String(editor.getAttributes('textStyle')['fontSize'] ?? '').replace(
    'px',
    '',
  );
  const currentColor = String(editor.getAttributes('textStyle')['color'] ?? '');

  function setOrderedListType(type: '1' | 'a') {
    const currentType = String(editor.getAttributes('orderedList')['type'] ?? '1');
    if (!editor.isActive('orderedList')) {
      editor.chain().focus().toggleOrderedList().updateAttributes('orderedList', { type }).run();
    } else if (currentType === type) {
      editor.chain().focus().toggleOrderedList().run();
    } else {
      editor.chain().focus().updateAttributes('orderedList', { type }).run();
    }
  }

  function changeIndent(delta: -1 | 1) {
    if (editor.isActive('listItem')) {
      const chain = editor.chain().focus();
      if (delta > 0) chain.sinkListItem('listItem').run();
      else chain.liftListItem('listItem').run();
      return;
    }

    const nodeType = editor.isActive('heading') ? 'heading' : 'paragraph';
    const current = Number(editor.getAttributes(nodeType)['indent'] ?? 0);
    editor
      .chain()
      .focus()
      .updateAttributes(nodeType, { indent: Math.max(0, Math.min(MAX_INDENT, current + delta)) })
      .run();
  }

  function setLink() {
    const previous = String(editor.getAttributes('link')['href'] ?? '');
    const href = window.prompt('Alamat tautan', previous || 'https://');
    // Cancelled — leave whatever is there. Empty string is a different answer:
    // it means "remove the link", which is what unsetLink does.
    if (href === null) return;

    if (href.trim() === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run();
  }

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-slate-50 px-1.5 py-1">
      {/* Inline marks */}
      <ToolbarButton
        label="Tebal"
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="h-3.5 w-3.5" aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label="Miring"
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className="h-3.5 w-3.5" aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label="Garis bawah"
        active={editor.isActive('underline')}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <UnderlineIcon className="h-3.5 w-3.5" aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label="Coret"
        active={editor.isActive('strike')}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough className="h-3.5 w-3.5" aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label="Sorot"
        active={editor.isActive('highlight')}
        onClick={() => editor.chain().focus().toggleHighlight().run()}
      >
        <Highlighter className="h-3.5 w-3.5" aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label="Kode sebaris"
        active={editor.isActive('code')}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <Code className="h-3.5 w-3.5" aria-hidden />
      </ToolbarButton>

      <Divider />

      {/* Size and colour — the two that travel as `style`. */}
      <SelectControl
        aria-label="Ukuran huruf"
        className="h-7 w-24 text-xs"
        placeholder="Ukuran"
        value={currentSize}
        options={RICH_TEXT_FONT_SIZES.map((size) => ({
          value: String(size),
          label: `${size} px`,
        }))}
        onValueChange={(next) => {
          // Cleared means "whatever the body is", which is the absence of the
          // mark rather than a size of its own.
          if (next === '') editor.chain().focus().unsetFontSize().run();
          else editor.chain().focus().setFontSize(`${next}px`).run();
        }}
      />

      <SelectControl
        aria-label="Warna teks"
        className="h-7 w-28 text-xs"
        placeholder="Warna"
        value={currentColor}
        options={TEXT_COLORS.map((color) => ({
          value: color.value,
          label: color.label,
          ...(color.dot ? { dot: color.dot } : {}),
        }))}
        onValueChange={(next) => {
          if (next === '') editor.chain().focus().unsetColor().run();
          else editor.chain().focus().setColor(next).run();
        }}
      />

      <Divider />

      {/* Headings */}
      {([1, 2, 3, 4] as const).map((level) => {
        const Icon = { 1: Heading1, 2: Heading2, 3: Heading3, 4: Heading4 }[level];
        return (
          <ToolbarButton
            key={level}
            label={`Judul ${level}`}
            active={editor.isActive('heading', { level })}
            onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
          </ToolbarButton>
        );
      })}

      <Divider />

      {/* Alignment */}
      {(
        [
          { value: 'left', label: 'Rata kiri', Icon: AlignLeft },
          { value: 'center', label: 'Rata tengah', Icon: AlignCenter },
          { value: 'right', label: 'Rata kanan', Icon: AlignRight },
          { value: 'justify', label: 'Rata kiri-kanan', Icon: AlignJustify },
        ] as const
      ).map(({ value, label, Icon }) => (
        <ToolbarButton
          key={value}
          label={label}
          active={editor.isActive({ textAlign: value })}
          onClick={() => editor.chain().focus().setTextAlign(value).run()}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </ToolbarButton>
      ))}

      <Divider />

      {/* Blocks */}
      <ToolbarButton
        label="Daftar poin"
        active={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className="h-3.5 w-3.5" aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label="Daftar bernomor"
        active={editor.isActive('orderedList') && editor.getAttributes('orderedList')['type'] !== 'a'}
        onClick={() => setOrderedListType('1')}
      >
        <ListOrdered className="h-3.5 w-3.5" aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label="Daftar huruf (a, b, c)"
        active={editor.isActive('orderedList') && editor.getAttributes('orderedList')['type'] === 'a'}
        onClick={() => setOrderedListType('a')}
      >
        <span className="block h-3.5 min-w-3.5 text-center text-[11px] font-semibold leading-[14px]" aria-hidden>
          a.
        </span>
      </ToolbarButton>
      <ToolbarButton
        label="Kurangi inden"
        onClick={() => changeIndent(-1)}
      >
        <IndentDecrease className="h-3.5 w-3.5" aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label="Tambah inden"
        onClick={() => changeIndent(1)}
      >
        <IndentIncrease className="h-3.5 w-3.5" aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label="Kutipan"
        active={editor.isActive('blockquote')}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote className="h-3.5 w-3.5" aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label="Garis pemisah"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      >
        <Minus className="h-3.5 w-3.5" aria-hidden />
      </ToolbarButton>

      <Divider />

      {/* Script and links */}
      <ToolbarButton
        label="Subskrip"
        active={editor.isActive('subscript')}
        onClick={() => editor.chain().focus().toggleSubscript().run()}
      >
        <SubscriptIcon className="h-3.5 w-3.5" aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label="Superskrip"
        active={editor.isActive('superscript')}
        onClick={() => editor.chain().focus().toggleSuperscript().run()}
      >
        <SuperscriptIcon className="h-3.5 w-3.5" aria-hidden />
      </ToolbarButton>
      <ToolbarButton label="Tautan" active={editor.isActive('link')} onClick={setLink}>
        <LinkIcon className="h-3.5 w-3.5" aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label="Hapus tautan"
        disabled={!editor.isActive('link')}
        onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}
      >
        <Unlink className="h-3.5 w-3.5" aria-hidden />
      </ToolbarButton>

      <Divider />

      {/* Pictures and tables */}
      {onUploadImage && (
        <>
          <ToolbarButton
            label={uploading ? 'Mengunggah gambar…' : 'Sisipkan gambar'}
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
          >
            <ImagePlus className="h-3.5 w-3.5" aria-hidden />
          </ToolbarButton>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            onChange={(event) => void insertImage(event.target.files?.[0])}
          />
        </>
      )}
      <ToolbarButton
        label="Sisipkan tabel"
        disabled={inTable}
        onClick={() =>
          editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        }
      >
        <TableIcon className="h-3.5 w-3.5" aria-hidden />
      </ToolbarButton>

      {inTable && (
        <>
          <ToolbarButton label="Tambah baris" onClick={() => editor.chain().focus().addRowAfter().run()}>
            <Rows3 className="h-3.5 w-3.5" aria-hidden />
          </ToolbarButton>
          <ToolbarButton label="Tambah kolom" onClick={() => editor.chain().focus().addColumnAfter().run()}>
            <Columns3 className="h-3.5 w-3.5" aria-hidden />
          </ToolbarButton>
          <ToolbarButton label="Hapus baris" onClick={() => editor.chain().focus().deleteRow().run()}>
            <span className="text-[10px] font-semibold leading-none">−B</span>
          </ToolbarButton>
          <ToolbarButton label="Hapus kolom" onClick={() => editor.chain().focus().deleteColumn().run()}>
            <span className="text-[10px] font-semibold leading-none">−K</span>
          </ToolbarButton>
          <ToolbarButton
            label="Gabung / pisah sel"
            onClick={() => editor.chain().focus().mergeOrSplit().run()}
          >
            <Merge className="h-3.5 w-3.5" aria-hidden />
          </ToolbarButton>
          <ToolbarButton
            label="Baris judul (kuning)"
            active={editor.isActive('tableHeader')}
            onClick={() => editor.chain().focus().toggleHeaderRow().run()}
          >
            <PanelTop className="h-3.5 w-3.5" aria-hidden />
          </ToolbarButton>
          <ToolbarButton label="Hapus tabel" onClick={() => editor.chain().focus().deleteTable().run()}>
            <Grid2x2X className="h-3.5 w-3.5" aria-hidden />
          </ToolbarButton>
        </>
      )}

      {uploadError && <span className="px-1 text-[11px] text-red-600">{uploadError}</span>}

      <Divider />

      <ToolbarButton
        label="Bersihkan format"
        onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
      >
        <Eraser className="h-3.5 w-3.5" aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label="Batalkan"
        disabled={!editor.can().undo()}
        onClick={() => editor.chain().focus().undo().run()}
      >
        <Undo2 className="h-3.5 w-3.5" aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label="Ulangi"
        disabled={!editor.can().redo()}
        onClick={() => editor.chain().focus().redo().run()}
      >
        <Redo2 className="h-3.5 w-3.5" aria-hidden />
      </ToolbarButton>
    </div>
  );
}

function Divider() {
  return <span aria-hidden className="mx-1 h-4 w-px bg-slate-300" />;
}

function ToolbarButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded p-1.5 text-slate-600 transition-colors disabled:opacity-40',
        active ? 'bg-sky-100 text-sky-700' : 'hover:bg-slate-200 hover:text-slate-900',
      )}
    >
      {children}
    </button>
  );
}
