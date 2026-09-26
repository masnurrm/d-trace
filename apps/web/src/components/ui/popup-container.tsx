'use client';

import { createContext, useContext } from 'react';

/**
 * Where a floating popup should be portalled.
 *
 * A popup normally goes to `document.body`, which is right almost everywhere.
 * It is wrong inside a native `<dialog>`: `showModal()` puts the dialog in the
 * browser's **top layer**, which paints above the entire normal layer no
 * matter what z-index anything in it carries. A dropdown portalled to the body
 * from inside a modal dialog therefore renders *behind* the dialog that opened
 * it, visible only where the dialog does not cover it.
 *
 * So the dialog announces itself here, and popups inside it portal into the
 * dialog instead — the top layer, where their trigger already is.
 */
const PopupContainerContext = createContext<HTMLElement | null>(null);

export const PopupContainerProvider = PopupContainerContext.Provider;

/** Null means "the default", which is the body. */
export function usePopupContainer(): HTMLElement | null {
  return useContext(PopupContainerContext);
}
