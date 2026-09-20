import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../lib/useAuth';
import {
  createPlayer,
  demoteFromAdmin,
  listAdminPhoneNumbers,
  listPlayers,
  promoteToAdmin,
  updatePlayer,
} from '../lib/api';
import { sortByName } from '../lib/sort';
import { PHONE_HINT, PHONE_PATTERN } from '../lib/phone';
import type { Player } from '../types/graphql';

const emptyForm = { displayName: '', phone: '', isAdmin: false };

// "Just the numbers" — strips anything a paste or autofill might add
// (spaces, dashes, a leading +) as the user types, rather than only
// validating on submit via PHONE_PATTERN.
function sanitizePhoneInput(value: string): string {
  return value.replace(/\D/g, '');
}

export function ParticipantsPage() {
  const { user } = useAuth();
  const idToken = user!.idToken;

  const [players, setPlayers] = useState<Player[]>([]);
  const [adminPhones, setAdminPhones] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [registerForm, setRegisterForm] = useState(emptyForm);
  const [registering, setRegistering] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);
  // The admin status editForm.isAdmin started from — fixed at startEdit,
  // never touched by the checkbox afterward, so handleSaveEdit can tell
  // whether the checkbox actually changed rather than diffing a value
  // against itself.
  const [editingWasAdmin, setEditingWasAdmin] = useState(false);
  const [saving, setSaving] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const [playerList, adminList] = await Promise.all([
        listPlayers(idToken),
        listAdminPhoneNumbers(idToken),
      ]);
      setPlayers(sortByName(playerList));
      setAdminPhones(new Set(adminList));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load participants');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRegister(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setRegistering(true);
    try {
      const player = await createPlayer(idToken, {
        displayName: registerForm.displayName,
        phone: registerForm.phone || undefined,
      });
      // Two calls, not a single atomic one — createPlayer has no isAdmin
      // arg, and promoteToAdmin requires cognitoSub, which only exists
      // once the player row above is written. If this second call fails,
      // the participant is just left non-admin, visibly so — re-checking
      // the box on Edit retries it.
      if (registerForm.isAdmin && registerForm.phone) {
        await promoteToAdmin(idToken, player.playerId);
      }
      setRegisterForm(emptyForm);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register participant');
    } finally {
      setRegistering(false);
    }
  }

  function startEdit(player: Player, isAdmin: boolean) {
    setEditingId(player.playerId);
    setEditForm({
      displayName: player.displayName,
      phone: player.phone ?? '',
      isAdmin,
    });
    setEditingWasAdmin(isAdmin);
  }

  async function handleSaveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editingId) return;
    setError(null);
    setSaving(true);
    try {
      await updatePlayer(idToken, {
        playerId: editingId,
        displayName: editForm.displayName,
        // Explicit null (not undefined) so blanking the field actually
        // clears it server-side — omitting the argument entirely means
        // "leave unchanged" (see infra/lambda/update-player).
        phone: editForm.phone || null,
      });
      if (editForm.isAdmin !== editingWasAdmin) {
        if (editForm.isAdmin) {
          await promoteToAdmin(idToken, editingId);
        } else {
          await demoteFromAdmin(idToken, editingId);
        }
      }
      setEditingId(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1>Participants</h1>
      {error && <p className="form-error">{error}</p>}

      <section>
        <h2>Register participant</h2>
        <form onSubmit={handleRegister} className="inline-form">
          <label>
            Name
            <input
              type="text"
              value={registerForm.displayName}
              onChange={(e) => setRegisterForm({ ...registerForm, displayName: e.target.value })}
              required
            />
          </label>
          <label>
            Phone (optional — enables login; leave blank for a guest)
            <input
              type="tel"
              inputMode="numeric"
              value={registerForm.phone}
              onChange={(e) => {
                const phone = sanitizePhoneInput(e.target.value);
                setRegisterForm({ ...registerForm, phone, isAdmin: phone ? registerForm.isAdmin : false });
              }}
              placeholder="31612345678"
              pattern={PHONE_PATTERN}
              title={PHONE_HINT}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={registerForm.isAdmin}
              disabled={!registerForm.phone}
              title={
                registerForm.phone ? undefined : 'Requires a phone number — that\'s what enables login.'
              }
              onChange={(e) => setRegisterForm({ ...registerForm, isAdmin: e.target.checked })}
            />
            Admin
          </label>
          <button type="submit" className="button-primary" disabled={registering}>
            {registering ? 'Registering…' : 'Register'}
          </button>
        </form>
        <p>{PHONE_HINT}</p>
      </section>

      <section>
        <h2>All participants ({players.length})</h2>
        {loading ? (
          <p>Loading…</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Admin</th>
                </tr>
              </thead>
              <tbody>
                {players.map((player) => {
                  const isRowAdmin = !!player.phone && adminPhones.has(player.phone);
                  const isSelf = !!player.phone && player.phone === user!.username;

                  return editingId === player.playerId ? (
                    <tr key={player.playerId}>
                      <td colSpan={3}>
                        <form onSubmit={handleSaveEdit} className="inline-form">
                          <input
                            type="text"
                            value={editForm.displayName}
                            onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })}
                            required
                          />
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
                          <button type="button" onClick={() => setEditingId(null)}>
                            Cancel
                          </button>
                        </form>
                      </td>
                    </tr>
                  ) : (
                    <tr key={player.playerId}>
                      <td className={`name${isSelf ? ' self' : ''}`}>{player.displayName}</td>
                      <td>{player.phone ?? (player.isGuest ? 'Guest' : '—')}</td>
                      <td>
                        <button type="button" onClick={() => startEdit(player, isRowAdmin)}>
                          Edit
                        </button>{' '}
                        {isRowAdmin && <span className="status-badge">Admin</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
