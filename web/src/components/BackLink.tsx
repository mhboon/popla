import { Link, useNavigate } from 'react-router-dom';

/**
 * A "← Back" link. Pass `to` for a page with one fixed parent route —
 * renders a real link (keyboard focus, cmd/ctrl-click to open in a new
 * tab). Omit it for a page reachable from several different places,
 * where there's no single fixed parent to link to — falls back to
 * browser history instead.
 */
export function BackLink({ to, label = 'Back' }: { to?: string; label?: string }) {
  const navigate = useNavigate();

  if (to) {
    return (
      <Link to={to} className="back-link">
        ← {label}
      </Link>
    );
  }
  return (
    <button type="button" className="back-link" onClick={() => navigate(-1)}>
      ← {label}
    </button>
  );
}
