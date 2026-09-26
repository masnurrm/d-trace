import Konva from 'konva';

/**
 * What a person can put on top of a page.
 *
 * Deliberately a small, serialisable set rather than "whatever Konva can
 * draw": these shapes are held per page, rebuilt off-screen at save time, and
 * eventually flattened into the PDF. Anything that could not survive that
 * round trip has no business being in here.
 */
export type Annotation =
  | { kind: 'line'; points: number[]; color: string; width: number }
  | { kind: 'text'; x: number; y: number; text: string; color: string; size: number }
  | { kind: 'image'; x: number; y: number; width: number; height: number; src: string };

/** Annotations per page number, 1-based to match how PDFs count. */
export type AnnotationsByPage = Record<number, Annotation[]>;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Gambar tanda tangan gagal dimuat'));
    image.src = src;
  });
}

/**
 * Rasterises one page's annotations to a transparent PNG.
 *
 * Built in a detached container rather than from the visible stage, because
 * saving must cover **every** page that was drawn on — not only the one the
 * reader happens to be looking at. Flipping through the pages to capture each
 * one would work and would also be visible flicker for no reason.
 *
 * The result is an image, not vector instructions. For a signature or a
 * scribbled note that is exactly right; it also means an annotation cannot be
 * edited again once saved, which is the honest behaviour for something stamped
 * onto a document somebody else will approve.
 */
export async function renderAnnotationLayer(
  annotations: Annotation[],
  width: number,
  height: number,
): Promise<string | null> {
  if (annotations.length === 0) return null;

  const container = document.createElement('div');
  const stage = new Konva.Stage({ container, width, height });
  const layer = new Konva.Layer();
  stage.add(layer);

  try {
    for (const annotation of annotations) {
      if (annotation.kind === 'line') {
        layer.add(
          new Konva.Line({
            points: annotation.points,
            stroke: annotation.color,
            strokeWidth: annotation.width,
            lineCap: 'round',
            lineJoin: 'round',
            tension: 0.3,
          }),
        );
        continue;
      }

      if (annotation.kind === 'text') {
        layer.add(
          new Konva.Text({
            x: annotation.x,
            y: annotation.y,
            text: annotation.text,
            fill: annotation.color,
            fontSize: annotation.size,
            fontFamily: 'Inter, sans-serif',
          }),
        );
        continue;
      }

      layer.add(
        new Konva.Image({
          image: await loadImage(annotation.src),
          x: annotation.x,
          y: annotation.y,
          width: annotation.width,
          height: annotation.height,
        }),
      );
    }

    layer.draw();
    return stage.toDataURL({ mimeType: 'image/png' });
  } finally {
    // The stage holds a canvas and its own event listeners; leaving it around
    // once the PNG is out would leak one per save.
    stage.destroy();
  }
}
