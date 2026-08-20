import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../lib/useAuth';
import { createPlayer, listPlayers, updatePlayer } from '../lib/api';
import { sortByName } from '../lib/sort';
import type { Player } from '../types/graphql';

const emptyForm = { displayName: '', phone: '', email: '' };

export function ParticipantsPage() {
  const { user } = useAuth();
  const idToken = user!.idToken;

  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [registerForm, setRegisterForm] = useState(emptyForm);
  const [registering, setRegistering] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      setPlayers(sortByName(await listPlayers(idToken)));
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
        phone: editForm.phone || undefined,
        email: editForm.email || undefined,
      });
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
            Phone (optional)
            <input
              type="text"
              value={registerForm.phone}
              onChange={(e) => setRegisterForm({ ...registerForm, phone: e.target.value })}
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
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {players.map((player) =>
                  editingId === player.playerId ? (
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
                            type="text"
                            value={editForm.phone}
                            onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                            placeholder="Phone"
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
                      </td>
                    </tr>
                  ) : (
                    <tr key={player.playerId}>
                      <td>{player.displayName}</td>
                      <td>{player.phone ?? '—'}</td>
                      <td>{player.email ?? '—'}</td>
                      <td>
                        <button type="button" onClick={() => startEdit(player)}>
                          Edit
                        </button>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
