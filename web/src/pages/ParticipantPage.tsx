import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../lib/useAuth';
import {
  demoteFromAdmin,
  listAdminPhoneNumbers,
  listPlayers,
  promoteToAdmin,
  resetParticipantPassword,
  updatePlayer,
} from '../lib/api';
import { PHONE_HINT, PHONE_PATTERN } from '../lib/phone';
import { BackLink } from '../components/BackLink';
import { ShareButton } from '../components/ShareButton';
import { formatPasswordResetShare } from '../lib/shareFormat';
import type { Player } from '../types/graphql';

const emptyForm = { displayName: '', phone: '', isAdmin: false };

// "Just the numbers" — strips anything a paste or autofill might add
// (spaces, dashes, a leading +) as the user types, rather than only
// validating on submit via PHONE_PATTERN.
function sanitizePhoneInput(value: string): string {
  return value.replace(/\D/g, '');
}

export function ParticipantPage() {
  const { playerId } = useParams<{ playerId: string }>();
  const { user } = useAuth();
  const idToken = user!.idToken;

  const [player, setPlayer] = useState<Player | null>(null);
  const [isRowAdmin, setIsRowAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState(emptyForm);
  // The admin status editForm.isAdmin started from — fixed at startEdit,
  // never touched by the checkbox afterward, so handleSaveEdit can tell
  // whether the checkbox actually changed rather than diffing a value
  // against itself.
  const [editingWasAdmin, setEditingWasAdmin] = useState(false);
  const [saving, setSaving] = useState(false);

  const [resetting, setResetting] = useState(false);
  // Deliberately component state only, never persisted — cleared on
  // dismiss or navigating away.
  const [resetPassword, setResetPassword] = useState<string | null>(null);

  async function refresh() {
    if (!playerId) return;
    setError(null);
    try {
      const [playerList, adminList] = await Promise.all([
        listPlayers(idToken),
        listAdminPhoneNumbers(idToken),
      ]);
      const found = playerList.find((p) => p.playerId === playerId) ?? null;
      setPlayer(found);
      setIsRowAdmin(!!found?.phone && adminList.includes(found.phone));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load participant');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId]);

  function startEdit() {
    if (!player) return;
    setEditForm({ displayName: player.displayName, phone: player.phone ?? '', isAdmin: isRowAdmin });
    setEditingWasAdmin(isRowAdmin);
    setEditing(true);
  }

  async function handleSaveEdit(event: FormEvent) {
    event.preventDefault();
    if (!playerId) return;
    setError(null);
    setSaving(true);
    try {
      await updatePlayer(idToken, {
        playerId,
        displayName: editForm.displayName,
        // Explicit null (not undefined) so blanking the field actually
        // clears it server-side — omitting the argument entirely means
        // "leave unchanged" (see infra/lambda/update-player).
        phone: editForm.phone || null,
      });
      if (editForm.isAdmin !== editingWasAdmin) {
        if (editForm.isAdmin) {
          await promoteToAdmin(idToken, playerId);
        } else {
          await demoteFromAdmin(idToken, playerId);
        }
      }
      setEditing(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  }

  async function handleResetPassword() {
    if (!playerId) return;
    setError(null);
    setResetting(true);
    try {
      const password = await resetParticipantPassword(idToken, playerId);
      setResetPassword(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password');
    } finally {
      setResetting(false);
    }
  }

  if (loading) return <p>Loading…</p>;
  if (!player) return <p className="form-error">{error ?? 'Participant not found.'}</p>;

  const isSelf = !!player.phone && player.phone === user!.username;

  return (
    <div>
      <BackLink to="/participants" label="Participants" />
      <h1>{player.displayName}</h1>
      {error && <p className="form-error">{error}</p>}

      {editing ? (
        <form onSubmit={handleSaveEdit} className="inline-form">
          <label>
            Name
            <input
              type="text"
              value={editForm.displayName}
              onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })}
              required
            />
          </label>
          <label>
            Phone
            <input
              type="tel"
              inputMode="numeric"
              value={editForm.phone}
              onChange={(e) => {
                const phone = sanitizePhoneInput(e.target.value);
                setEditForm({ ...editForm, phone, isAdmin: phone ? editForm.isAdmin : false });
              }}
              placeholder="Phone (blank for a guest)"
              pattern={PHONE_PATTERN}
              disabled={editingWasAdmin}
              title={
                editingWasAdmin
                  ? "Admins can't be renumbered here — remove admin status first, or use the AWS console."
                  : PHONE_HINT
              }
            />
          </label>
          {editingWasAdmin && <p>{PHONE_HINT}</p>}
          <label>
            <input
              type="checkbox"
              checked={editForm.isAdmin}
              disabled={!editForm.phone || (isSelf && editingWasAdmin)}
              title={
                !editForm.phone
                  ? 'Requires a phone number — that\'s what enables login.'
                  : isSelf && editingWasAdmin
                    ? "You can't remove your own admin status — ask another admin, or use the AWS console."
                    : undefined
              }
              onChange={(e) => setEditForm({ ...editForm, isAdmin: e.target.checked })}
            />
            Admin
          </label>
          <button type="submit" className="button-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <>
          <p>
            <strong>Phone:</strong> {player.phone ?? (player.isGuest ? 'Guest' : '—')}
          </p>
          {isRowAdmin && (
            <p>
              <span className="status-badge">Admin</span>
            </p>
          )}

          <div className="detail-actions">
            <button type="button" onClick={startEdit}>
              Edit
            </button>
            {!player.isGuest && (
              <button type="button" onClick={handleResetPassword} disabled={resetting}>
                {resetting ? 'Resetting…' : 'Reset password'}
              </button>
            )}
          </div>

          {resetPassword && (
            <div>
              <p>
                Temporary password: <strong>{resetPassword}</strong>
              </p>
              <ShareButton
                title="Popla Cup login"
                text={formatPasswordResetShare(player, resetPassword)}
                label="Share login"
              />{' '}
              <button type="button" onClick={() => setResetPassword(null)}>
                Dismiss
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
