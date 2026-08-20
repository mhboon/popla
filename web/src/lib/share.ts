export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'unavailable';

/**
 * navigator.share opens the OS share sheet (WhatsApp, Messages, etc. on
 * mobile) — the whole point of this feature. Desktop browsers mostly don't
 * implement it, so we fall back to copying the text to the clipboard.
 */
export async function shareText(title: string, text: string): Promise<ShareOutcome> {
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      // Any other failure (e.g. a share target rejecting it) — fall through to clipboard.
    }
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return 'copied';
  }
  return 'unavailable';
}
