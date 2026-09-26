'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import Konva from 'konva';
import {
  ChevronLeft,
  ChevronRight,
  Eraser,
  Pen,
  Save,
  Signature as SignatureIcon,
  Type,
  Undo2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image as KonvaImage, Layer, Line, Stage, Text as KonvaText } from 'react-konva';
import type { UserSignatureView } from '@dtrace/shared';
import { ApiClientError, clientFetch } from '@/lib/api/client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SelectControl, TextField } from '@/components/ui/field';
import { cn } from '@/lib/utils/cn';
import { renderAnnotationLayer, type Annotation, type AnnotationsByPage } from './annotation-shapes';

type Tool = 'pen' | 'text' | 'signature';

const COLORS = [
  { value: '#dc2626', label: 'Merah' },
  { value: '#1d4ed8', label: 'Biru' },
  { value: '#0f172a', label: 'Hitam' },
];

/** Rendered at twice CSS size so the flattened layer is not soft when printed. */
const SCALE = 2;

const fileUrl = (id: string) => `/api/bff/workspace/files/${id}/download`;

interface PageImage {
  url: string;
  width: number;
  height: number;
}

/**
 * A PDF with a drawing layer over it.
 *
 * The page is rendered by PDF.js onto a canvas and Konva draws on top at the
 * same size — an overlay is only possible because the page is a canvas we own.
 * The browser's own viewer could not be annotated this way: an iframe's
 * internals are not addressable from outside it, which is why this component
 * replaces the frame rather than sitting on it.
 *
 * Saving does not modify the original. The layer is flattened onto a copy and
 * uploaded as a **new file** on the same document, so what was signed and what
 * was sent stay distinguishable.
 */
export function PdfAnnotator({
  documentId,
  fileId,
  fileName,
  onSaved,
}: {
  documentId: string;
  fileId: string;
  fileName: string;
  onSaved: () => void;
}) {
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [pageImage, setPageImage] = useState<PageImage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(COLORS[0]!.value);
  const [textValue, setTextValue] = useState('');
  const [annotations, setAnnotations] = useState<AnnotationsByPage>({});

  const drawing = useRef(false);
  const bitmap = useRef<HTMLImageElement | null>(null);
  const [bitmapReady, setBitmapReady] = useState(false);
  const signatureImage = useRef<HTMLImageElement | null>(null);

  const current = annotations[page] ?? [];

  const { data: signature } = useQuery({
    queryKey: ['me', 'signature'],
    queryFn: () => clientFetch<UserSignatureView | null>('/auth/me/signature'),
    staleTime: 5 * 60_000,
  });

  const signatureSrc = signature?.data?.kind === 'DRAWN' ? signature.data.data : null;

  /* ---------------------------------------------------------------------- */
  /* Rendering the page                                                      */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        // Imported inside the effect: pdf.js reaches for `DOMMatrix` at module
        // scope, which does not exist while Next renders this on the server.
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url,
        ).toString();

        const response = await fetch(fileUrl(fileId), { credentials: 'same-origin' });
        if (!response.ok) throw new Error('Berkas tidak dapat diambil');
        const bytes = await response.arrayBuffer();

        const pdf = await pdfjs.getDocument({ data: bytes }).promise;
        if (cancelled) return;
        setPageCount(pdf.numPages);

        const target = await pdf.getPage(Math.min(page, pdf.numPages));
        const viewport = target.getViewport({ scale: SCALE });

        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas tidak tersedia');

        await target.render({ canvas, canvasContext: context, viewport }).promise;
        if (cancelled) return;

        setPageImage({ url: canvas.toDataURL(), width: viewport.width, height: viewport.height });
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : 'PDF gagal dimuat');
        }
      }
    }

    void render();
    return () => {
      cancelled = true;
    };
  }, [fileId, page]);

  // Konva draws an HTMLImageElement, not a URL, so the rendered page has to be
  // turned back into one before it can go under the annotation layer.
  useEffect(() => {
    if (!pageImage) return;

    setBitmapReady(false);
    const image = new Image();
    image.onload = () => {
      bitmap.current = image;
      setBitmapReady(true);
    };
    image.src = pageImage.url;
  }, [pageImage]);

  useEffect(() => {
    if (!signatureSrc) return;
    const image = new Image();
    image.onload = () => {
      signatureImage.current = image;
    };
    image.src = signatureSrc;
  }, [signatureSrc]);

  /* ---------------------------------------------------------------------- */
  /* Drawing                                                                 */
  /* ---------------------------------------------------------------------- */

  const push = useCallback(
    (annotation: Annotation) => {
      setAnnotations((all) => ({ ...all, [page]: [...(all[page] ?? []), annotation] }));
    },
    [page],
  );

  function pointerDown(event: Konva.KonvaEventObject<PointerEvent>) {
    const position = event.target.getStage()?.getPointerPosition();
    if (!position) return;

    if (tool === 'pen') {
      drawing.current = true;
      push({ kind: 'line', points: [position.x, position.y], color, width: 3 });
      return;
    }

    if (tool === 'text') {
      if (!textValue.trim()) return;
      push({ kind: 'text', x: position.x, y: position.y, text: textValue.trim(), color, size: 22 });
      return;
    }

    const image = signatureImage.current;
    if (!image) return;

    // Kept to a sane width; the height follows so the signature is not stretched.
    const width = 220;
    push({
      kind: 'image',
      x: position.x,
      y: position.y,
      width,
      height: (image.height / image.width) * width,
      src: image.src,
    });
  }

  function pointerMove(event: Konva.KonvaEventObject<PointerEvent>) {
    if (!drawing.current || tool !== 'pen') return;

    const position = event.target.getStage()?.getPointerPosition();
    if (!position) return;

    setAnnotations((all) => {
      const list = all[page] ?? [];
      const last = list.at(-1);
      if (!last || last.kind !== 'line') return all;

      const updated: Annotation = { ...last, points: [...last.points, position.x, position.y] };
      return { ...all, [page]: [...list.slice(0, -1), updated] };
    });
  }

  const stopDrawing = () => {
    drawing.current = false;
  };

  function undo() {
    setAnnotations((all) => ({ ...all, [page]: (all[page] ?? []).slice(0, -1) }));
  }

  function clearPage() {
    setAnnotations((all) => ({ ...all, [page]: [] }));
  }

  /* ---------------------------------------------------------------------- */
  /* Saving                                                                  */
  /* ---------------------------------------------------------------------- */

  const save = useMutation({
    mutationFn: async () => {
      const { PDFDocument } = await import('pdf-lib');

      const response = await fetch(fileUrl(fileId), { credentials: 'same-origin' });
      const pdf = await PDFDocument.load(await response.arrayBuffer());

      for (const [key, list] of Object.entries(annotations)) {
        if (list.length === 0) continue;

        const index = Number(key) - 1;
        const target = pdf.getPage(index);
        const { width, height } = target.getSize();

        // The overlay was drawn in canvas pixels; the page is in PDF points.
        // Stamping it across the whole page is what puts every mark back where
        // it was drawn, without converting each shape's coordinates by hand.
        const layer = await renderAnnotationLayer(list, width * SCALE, height * SCALE);
        if (!layer) continue;

        const png = await pdf.embedPng(layer);
        target.drawImage(png, { x: 0, y: 0, width, height });
      }

      const bytes = await pdf.save();
      const form = new FormData();
      const stamped = fileName.replace(/\.pdf$/i, '') + ' (annotated).pdf';
      form.append('file', new File([bytes as BlobPart], stamped, { type: 'application/pdf' }));

      return clientFetch(`/workspace/documents/${documentId}/files`, {
        method: 'POST',
        body: form,
      });
    },
    onSuccess: () => {
      setAnnotations({});
      onSaved();
    },
  });

  const hasMarks = Object.values(annotations).some((list) => list.length > 0);
  const saveError =
    save.error instanceof ApiClientError
      ? save.error.message
      : save.error
        ? 'Anotasi gagal disimpan.'
        : null;

  if (loadError) return <Alert tone="danger">{loadError}</Alert>;

  return (
    <div className="space-y-3">
      {saveError && <Alert tone="danger">{saveError}</Alert>}

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
        <ToolButton active={tool === 'pen'} onClick={() => setTool('pen')} label="Coret">
          <Pen className="h-4 w-4" aria-hidden />
        </ToolButton>
        <ToolButton active={tool === 'text'} onClick={() => setTool('text')} label="Teks">
          <Type className="h-4 w-4" aria-hidden />
        </ToolButton>
        <ToolButton
          active={tool === 'signature'}
          onClick={() => setTool('signature')}
          label="Tanda tangan"
          disabled={!signatureSrc}
          title={
            signatureSrc
              ? 'Klik di halaman untuk menempel tanda tangan'
              : 'Simpan dulu tanda tangan gambar di halaman Akun Saya'
          }
        >
          <SignatureIcon className="h-4 w-4" aria-hidden />
        </ToolButton>

        <div className="w-32">
          <SelectControl
            aria-label="Warna"
            className="h-8"
            value={color}
            onValueChange={(value) => value && setColor(value)}
            options={COLORS}
          />
        </div>

        {tool === 'text' && (
          <TextField
            label="Isi teks"
            name="annotation-text"
            className="h-8 w-56"
            placeholder="Ketik lalu klik di halaman"
            value={textValue}
            onChange={(event) => setTextValue(event.target.value)}
          />
        )}

        <span className="mx-1 h-8 w-px bg-slate-300" aria-hidden />

        <Button variant="ghost" size="sm" onClick={undo} disabled={current.length === 0}
          leftIcon={<Undo2 className="h-4 w-4" aria-hidden />}>
          Batalkan
        </Button>
        <Button variant="ghost" size="sm" onClick={clearPage} disabled={current.length === 0}
          leftIcon={<Eraser className="h-4 w-4" aria-hidden />}>
          Bersihkan halaman
        </Button>

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Halaman sebelumnya"
            disabled={page <= 1}
            onClick={() => setPage((value) => value - 1)}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
          <span className="text-sm text-slate-600">
            {page} / {pageCount || '…'}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Halaman berikutnya"
            disabled={page >= pageCount}
            onClick={() => setPage((value) => value + 1)}
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>

          <Button
            leftIcon={<Save className="h-4 w-4" aria-hidden />}
            loading={save.isPending}
            disabled={!hasMarks || save.isPending}
            onClick={() => save.mutate()}
          >
            Simpan sebagai berkas baru
          </Button>
        </div>
      </div>

      <div className="overflow-auto rounded-lg border border-slate-200 bg-slate-100 p-4">
        {!pageImage || !bitmapReady ? (
          <p className="py-20 text-center text-sm text-slate-500">Memuat halaman…</p>
        ) : (
          <div
            className={cn('mx-auto bg-white shadow', tool === 'pen' ? 'cursor-crosshair' : 'cursor-copy')}
            style={{ width: pageImage.width / SCALE, height: pageImage.height / SCALE }}
          >
            <Stage
              width={pageImage.width}
              height={pageImage.height}
              scaleX={1}
              scaleY={1}
              // Drawn at 2x for print quality, shown at 1x to fit the screen.
              style={{ transform: `scale(${1 / SCALE})`, transformOrigin: 'top left' }}
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={stopDrawing}
              onPointerLeave={stopDrawing}
            >
              <Layer listening={false}>
                <KonvaImage
                  image={bitmap.current ?? undefined}
                  width={pageImage.width}
                  height={pageImage.height}
                />
              </Layer>

              <Layer>
                {current.map((annotation, index) => {
                  if (annotation.kind === 'line') {
                    return (
                      <Line
                        key={index}
                        points={annotation.points}
                        stroke={annotation.color}
                        strokeWidth={annotation.width}
                        lineCap="round"
                        lineJoin="round"
                        tension={0.3}
                      />
                    );
                  }

                  if (annotation.kind === 'text') {
                    return (
                      <KonvaText
                        key={index}
                        x={annotation.x}
                        y={annotation.y}
                        text={annotation.text}
                        fill={annotation.color}
                        fontSize={annotation.size}
                        fontFamily="Inter, sans-serif"
                      />
                    );
                  }

                  return (
                    <KonvaImage
                      key={index}
                      image={signatureImage.current ?? undefined}
                      x={annotation.x}
                      y={annotation.y}
                      width={annotation.width}
                      height={annotation.height}
                    />
                  );
                })}
              </Layer>
            </Stage>
          </div>
        )}
      </div>
    </div>
  );
}

function ToolButton({
  active,
  onClick,
  label,
  disabled,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant={active ? 'default' : 'outline'}
      size="sm"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      leftIcon={children}
    >
      {label}
    </Button>
  );
}
