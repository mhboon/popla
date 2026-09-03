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
import type { Player } from '../types/graphql';

const emptyForm = { displayName: '', phone: '', email: '' };
const PHONE_HINT = 'Include the country code, e.g. +31612345678.';

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
  const [saving, setSaving] = useState(false);

  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

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
      await createPlayer(idToken, {
        displayName: registerForm.displayName,
        phone: registerForm.phone || undefined,
        email: registerForm.email || undefined,
      });
      setRegisterForm(emptyForm);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register participant');
    } finally {
      setRegistering(false);
    }
  }

  function startEdit(player: Player) {
    setEditingId(player.playerId);
    setEditForm({
      displayName: player.displayName,
      phone: player.phone ?? '',
      email: player.email ?? '',
    });
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
        email: editForm.email || null,
      });
      setEditingId(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  }

  async function handlePromote(playerId: string) {
    setError(null);
    setActionBusyId(playerId);
    try {
      await promoteToAdmin(idToken, playerId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to make this participant an admin');
    } finally {
      setActionBusyId(null);
    }
  }

  async function handleDemote(playerId: string) {
    setError(null);
    setActionBusyId(playerId);
    try {
      await demoteFromAdmin(idToken, playerId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove admin status');
    } finally {
      setActionBusyId(null);
    }
  }

  const editingPlayer = players.find((p) => p.playerId === editingId);
  const editingIsAdmin = !!editingPlayer?.phone && adminPhones.has(editingPlayer.phone);

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
            Phone (optional — enables login)
            <input
              type="tel"
              value={registerForm.phone}
              onChange={(e) => setRegisterForm({ ...registerForm, phone: e.target.value })}
              placeholder="+31612345678"
            />
          </label>
          <label>
            Email (optional)
            <input
              type="email"
              value={registerForm.email}
              onChange={(e) => setRegisterForm({ ...registerForm, email: e.target.value })}
            />
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
                  <th>Email</th>
                  <th>Admin</th>
                </tr>
              </thead>
              <tbody>
                {players.map((player) => {
                  const isRowAdmin = !!player.phone && adminPhones.has(player.phone);
                  // Login is only actually enabled once a phone is set —
                  // see infra/lambda/create-player and update-player,
                  // which keep cognitoSub in lockstep with phone.
                  const canPromote = !!player.phone && !isRowAdmin;
                  const isSelf = !!player.phone && player.phone === user!.username;
                  const busy = actionBusyId === player.playerId;

                  return editingId === player.playerId ? (
                    <tr key={player.playerId}>
                      <td colSpan={4}>
                        <form onSubmit={handleSaveEdit} className="inline-form">
                          <input
                            type="text"
                            value={editForm.displayName}
                            onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })}
                            required
                          />
                          <input
                            type="tel"
                            value={editForm.phone}
                            onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                            placeholder="Phone"
                            disabled={editingIsAdmin}
                            title={
                              editingIsAdmin
                                ? "Admins can't be renumbered here — use the AWS console, or remove admin status first."
                                : undefined
                            }
                          />
                          <input
                            type="email"
                            value={editForm.email}
                            onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                            placeholder="Email"
                          />
                          <button type="submit" className="button-primary" disabled={saving}>
                            {saving ? 'Saving…' : 'Save'}
                          </button>
                          <button type="button" onClick={() => setEditingId(null)}>
                            Cancel
                          </button>
                        </form>
                        {editingIsAdmin && <p>{PHONE_HINT}</p>}
                      </td>
                    </tr>
                  ) : (
                    <tr key={player.playerId} className="row-actionable">
                      <td
                        tabIndex={0}
                        role="button"
                        aria-label={`Edit ${player.displayName}`}
                        onClick={() => startEdit(player)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            startEdit(player);
                          }
                        }}
                      >
                        {player.displayName}
                      </td>
                      <td>{player.phone ?? '—'}</td>
                      <td>{player.email ?? '—'}</td>
                      <td>
                        {isRowAdmin && <span className="status-badge">Admin</span>}{' '}
                        {isRowAdmin ? (
                          <button
                            type="button"
                            disabled={busy || isSelf}
                            title={
                              isSelf
                                ? "You can't remove your own admin status — ask another admin, or use the AWS console."
                                : undefined
                            }
                            onClick={() => handleDemote(player.playerId)}
                          >
                            {busy ? 'Removing…' : 'Remove admin'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={busy || !canPromote}
                            title={canPromote ? undefined : 'Register a phone number first'}
                            onClick={() => handlePromote(player.playerId)}
                          >
                            {busy ? 'Promoting…' : 'Make admin'}
                          </button>
                        )}
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
