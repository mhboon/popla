import { useNavigate } from 'react-router-dom';
import type { MouseEvent, ReactNode } from 'react';

/**
 * A <tr> that navigates to `to` on click anywhere in the row. Replaces
 * the previous approach — a real link in one cell, stretched across the
 * whole row via an absolutely-positioned ::after scoped to the <tr> by
 * `position: relative` — which doesn't reliably size/clip to the row's
 * actual rendered bounds in every browser (notably Safari/iOS), and
 * could end up capturing clicks meant for a different row entirely.
 * Clicking the row's own real link/button (kept for keyboard focus and
 * cmd/ctrl-click) still navigates via its native behavior first; this
 * only handles clicks on the rest of the row.
 */
export function ClickableRow({
  to,
  children,
}: {
  to: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();

  function handleClick(event: MouseEvent<HTMLTableRowElement>) {
    if ((event.target as HTMLElement).closest('a, button')) return;
    navigate(to);
  }

  return (
    <tr className="row-clickable" onClick={handleClick}>
      {children}
    </tr>
  );
}
