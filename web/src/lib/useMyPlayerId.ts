import { useEffect, useState } from 'react';
import { getMyPlayer } from './api';

/**
 * The Player linked to the caller's own login — null for a bare console
 * admin with no linked Player, or while still loading. Used to bold
 * "yourself" in any list of participants (rosters, matches, rankings),
 * since people generally look for themselves first.
 */
export function useMyPlayerId(idToken: string): string | null {
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);

  useEffect(() => {
    getMyPlayer(idToken)
      .then((player) => setMyPlayerId(player?.playerId ?? null))
      .catch(() => {});
  }, [idToken]);

  return myPlayerId;
}
