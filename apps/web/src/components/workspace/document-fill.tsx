'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { renderPlaceholders, type DocumentContext } from '@dtrace/shared';

type Fill = (text: string | null | undefined) => string;

/** Without a provider a binding stays visible as written, which is honest. */
const FillContext = createContext<Fill>((text) => text ?? '');

/**
 * Resolves `{{project.name}}`-style bindings against this document's project.
 *
 * Every section renderer reads it from here rather than taking the context as
 * a prop, so a section type added later cannot forget to pass it along. In a
 * real document an unknown binding renders blank — the reader of a printed
 * BPM should see an empty cell, not template syntax.
 */
export function DocumentFillProvider({
  context,
  children,
}: {
  context: DocumentContext;
  children: ReactNode;
}) {
  const fill = useMemo<Fill>(
    () => (text) =>
      text ? renderPlaceholders(text, context as unknown as Record<string, unknown>, 'blank') : '',
    [context],
  );
  return <FillContext.Provider value={fill}>{children}</FillContext.Provider>;
}

export function useFill(): Fill {
  return useContext(FillContext);
}
