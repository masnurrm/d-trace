'use client';

import { useMutation } from '@tanstack/react-query';
import { Eraser, QrCode, Save, Signature, Trash2 } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  SIGNATURE_FONTS,
  SIGNATURE_KINDS,
  SIGNATURE_FONT_LABELS,
  SIGNATURE_KIND_LABELS,
  type SignatureFont,
  type SignatureKind,
  type UserSignatureView,
} from '@dtrace/shared';
import { ApiClientError, clientFetch } from '@/lib/api/client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { SelectControl, TextField } from '@/components/ui/field';
import { Tabs, TabPanel } from '@/components/ui/tabs';
import { cn } from '@/lib/utils/cn';

const TABS = SIGNATURE_KINDS.map((kind) => ({
  id: kind,
  label: SIGNATURE_KIND_LABELS[kind],
}));

/** The three faces a typed signature may wear, as real CSS stacks. */
const FONT_STACK: Record<SignatureFont, string> = {
  CURSIVE: '"Segoe Script", "Brush Script MT", cursive',
  SERIF: 'Georgia, "Times New Roman", serif',
  MONO: 'ui-monospace, "Courier New", monospace',
};

const PAD_WIDTH = 640;
const PAD_HEIGHT = 200;

/**
 * Where a person sets the mark that goes on documents they sign.
 *
 * Three kinds, three different claims — a drawn mark is their own hand, a typed
 * name is a declaration, a barcode is a pointer back here to be checked — so
 * the editor keeps them apart rather than pretending they are styles of one
 * thing. Only one is stored at a time: a person has one signature.
 */
export function SignatureCard({
  signature,
  verifyBase,
}: {
  signature: UserSignatureView | null;
  verifyBase: string;
}) {
  const [kind, setKind] = useState<SignatureKind>(signature?.kind ?? 'DRAWN');
  const [typed, setTyped] = useState(signature?.kind === 'TYPED' ? (signature.data ?? '') : '');
  const [font, setFont] = useState<SignatureFont>(signature?.font ?? 'CURSIVE');
  const [drawn, setDrawn] = useState<string | null>(
    signature?.kind === 'DRAWN' ? signature.data : null,
  );
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      clientFetch<UserSignatureView>('/auth/me/signature', { method: 'PUT', body }),
    onSuccess: () => setSaved(true),
  });

  const remove = useMutation({
    mutationFn: () => clientFetch('/auth/me/signature', { method: 'DELETE' }),
    onSuccess: () => {
      setDrawn(null);
      setTyped('');
      setSaved(false);
    },
  });

  const busy = save.isPending || remove.isPending;
  const failure = save.error ?? remove.error;
  const error =
    failure instanceof ApiClientError
      ? failure.message
      : failure
        ? 'Tanda tangan gagal disimpan.'
        : null;

  function submit() {
    setSaved(false);
    if (kind === 'DRAWN') {
      if (!drawn) return;
      save.mutate({ kind: 'DRAWN', data: drawn });
      return;
    }
    if (kind === 'TYPED') {
      save.mutate({ kind: 'TYPED', data: typed.trim(), font });
      return;
    }
    save.mutate({ kind: 'BARCODE' });
  }

  const canSave =
    !busy && ((kind === 'DRAWN' && Boolean(drawn)) || (kind === 'TYPED' && typed.trim().length >= 2) || kind === 'BARCODE');

  return (
    <Card>
      <CardHeader
        title="Tanda tangan"
        description="Dipakai saat Anda menandatangani dokumen. Hanya satu yang tersimpan."
        icon={<Signature className="h-4 w-4" aria-hidden />}
        tinted
        action={
          signature ? (
            <Button
              variant="outline"
              size="sm"
              leftIcon={<Trash2 className="h-4 w-4" aria-hidden />}
              loading={remove.isPending}
              onClick={() => remove.mutate()}
            >
              Hapus
            </Button>
          ) : undefined
        }
      />
      <CardBody className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {saved && <Alert tone="success">Tanda tangan tersimpan.</Alert>}

        <Tabs tabs={TABS} active={kind} onChange={(id) => setKind(id as SignatureKind)} />

        <TabPanel id="DRAWN" active={kind}>
          <SignaturePad value={drawn} onChange={setDrawn} />
        </TabPanel>

        <TabPanel id="TYPED" active={kind}>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Nama pada tanda tangan"
                name="signature-text"
                maxLength={80}
                placeholder="Nama lengkap Anda"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
              />
              <div>
                <span className="mb-1.5 block text-sm font-medium text-slate-700">Gaya tulisan</span>
                <SelectControl
                  aria-label="Gaya tulisan"
                  value={font}
                  onValueChange={(value) => value && setFont(value as SignatureFont)}
                  options={SIGNATURE_FONTS.map((value) => ({
                    value,
                    label: SIGNATURE_FONT_LABELS[value],
                  }))}
                />
              </div>
            </div>

            <Preview label="Pratinjau">
              <span
                className="text-3xl text-slate-900"
                style={{ fontFamily: FONT_STACK[font] }}
              >
                {typed.trim() || 'Nama Anda'}
              </span>
            </Preview>
          </div>
        </TabPanel>

        <TabPanel id="BARCODE" active={kind}>
          <BarcodePanel code={signature?.kind === 'BARCODE' ? signature.code : null} verifyBase={verifyBase} />
        </TabPanel>

        <div className="flex justify-end">
          <Button
            leftIcon={<Save className="h-4 w-4" aria-hidden />}
            loading={save.isPending}
            disabled={!canSave}
            onClick={submit}
          >
            Simpan tanda tangan
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function Preview({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs text-slate-500">{label}</p>
      <div className="flex min-h-28 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white p-4">
        {children}
      </div>
    </div>
  );
}

/**
 * A canvas you draw on with a mouse, a finger or a stylus.
 *
 * Pointer events rather than separate mouse and touch handlers: one code path
 * covers all three, and `setPointerCapture` keeps a stroke attached to the pad
 * when the hand runs off its edge mid-signature.
 */
function SignaturePad({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(Boolean(value));

  // Restore a saved signature onto the pad so "edit" means edit, not start over.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !value) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    const image = new Image();
    image.onload = () => context.drawImage(image, 0, 0, PAD_WIDTH, PAD_HEIGHT);
    image.src = value;
  }, [value]);

  function pointAt(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    // The canvas is drawn at a fixed resolution but displayed responsively, so
    // a click has to be scaled back into canvas space.
    return {
      x: ((event.clientX - rect.left) / rect.width) * PAD_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * PAD_HEIGHT,
    };
  }

  function start(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    canvas.setPointerCapture(event.pointerId);
    drawing.current = true;

    const { x, y } = pointAt(event);
    context.lineWidth = 2.5;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = '#0f172a';
    context.beginPath();
    context.moveTo(x, y);
  }

  function move(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;

    const { x, y } = pointAt(event);
    context.lineTo(x, y);
    context.stroke();
    setHasInk(true);
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    const canvas = canvasRef.current;
    if (canvas && hasInk) onChange(canvas.toDataURL('image/png'));
  }

  function clear() {
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, PAD_WIDTH, PAD_HEIGHT);
    setHasInk(false);
    onChange(null);
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        width={PAD_WIDTH}
        height={PAD_HEIGHT}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        aria-label="Area tanda tangan"
        className={cn(
          'w-full rounded-lg border border-dashed border-slate-300 bg-white',
          // Without this the browser scrolls the page instead of drawing.
          'touch-none',
        )}
        style={{ aspectRatio: `${PAD_WIDTH} / ${PAD_HEIGHT}` }}
      />
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          Tanda tangani dengan mouse, jari, atau stylus di area di atas.
        </p>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<Eraser className="h-4 w-4" aria-hidden />}
          onClick={clear}
        >
          Bersihkan
        </Button>
      </div>
    </div>
  );
}

/**
 * The scannable form.
 *
 * The code is minted by the server once and never re-minted, so a barcode
 * already printed on a document keeps resolving to the same person. Until the
 * first save there is nothing to draw, which the panel says rather than
 * showing an empty square.
 */
function BarcodePanel({ code, verifyBase }: { code: string | null; verifyBase: string }) {
  const [image, setImage] = useState<string | null>(null);

  useEffect(() => {
    if (!code) {
      setImage(null);
      return;
    }

    let cancelled = false;
    QRCode.toDataURL(`${verifyBase}/verifikasi/${code}`, { margin: 1, width: 220 })
      .then((url) => {
        if (!cancelled) setImage(url);
      })
      .catch(() => {
        if (!cancelled) setImage(null);
      });

    return () => {
      cancelled = true;
    };
  }, [code, verifyBase]);

  return (
    <div className="space-y-3">
      <Preview label="Pratinjau">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element -- a data URL has
          // no remote origin for next/image to optimise.
          <img src={image} alt={`Barcode tanda tangan ${code}`} className="h-40 w-40" />
        ) : (
          <span className="text-sm text-slate-500">
            <QrCode className="mx-auto mb-2 h-6 w-6 text-slate-400" aria-hidden />
            Simpan dulu untuk membuat kode Anda.
          </span>
        )}
      </Preview>

      {code && (
        <p className="text-center font-mono text-xs text-slate-500">{code}</p>
      )}

      <p className="text-xs text-slate-500">
        Kode dibuat sekali dan tidak pernah berubah, supaya barcode yang sudah tercetak di dokumen
        lama tetap menunjuk ke Anda.
      </p>
    </div>
  );
}
