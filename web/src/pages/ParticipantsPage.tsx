import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/useAuth';
import { createPlayer, listAdminPhoneNumbers, listPlayers, promoteToAdmin } from '../lib/api';
import { sortByName } from '../lib/sort';
import { PHONE_HINT, PHONE_PATTERN } from '../lib/phone';
import { ClickableRow } from '../components/ClickableRow';
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

                  return (
                    <ClickableRow key={player.playerId} to={`/participants/${player.playerId}`}>
                      <td className={`name${isSelf ? ' self' : ''}`}>
                        <Link to={`/participants/${player.playerId}`} className="row-link">
                          {player.displayName}
                        </Link>
                      </td>
                      <td>{player.phone ?? (player.isGuest ? 'Guest' : '—')}</td>
                      <td>{isRowAdmin && <span className="status-badge">Admin</span>}</td>
                    </ClickableRow>
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
