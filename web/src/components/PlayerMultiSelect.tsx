import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Player } from '../types/graphql';

/**
 * A searchable multiselect combobox: selected players show as removable
 * pills, typing filters a dropdown of the rest. Replaces the raw
 * checkbox grid, which didn't scale well past a handful of names.
 * `players` must already be sorted (by name) — this component doesn't
 * re-sort.
 */
export function PlayerMultiSelect({
  players,
  selected,
  onToggle,
}: {
  players: Player[];
  selected: Set<string>;
  onToggle: (playerId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedPlayers = players.filter((p) => selected.has(p.playerId));
  const available = players.filter(
    (p) => !selected.has(p.playerId) && p.displayName.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function selectPlayer(playerId: string) {
    onToggle(playerId);
    setQuery('');
    inputRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, available.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (open && available[highlight]) selectPlayer(available[highlight].playerId);
    } else if (event.key === 'Backspace' && query === '' && selectedPlayers.length > 0) {
      onToggle(selectedPlayers[selectedPlayers.length - 1].playerId);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="multiselect" ref={containerRef}>
      <div
        className="multiselect-control"
        onClick={() => {
          setOpen(true);
          inputRef.current?.focus();
        }}
      >
        {selectedPlayers.map((player) => (
          <span key={player.playerId} className="multiselect-pill">
            {player.displayName}
            <button
              type="button"
              className="multiselect-pill-remove"
              onClick={(event) => {
                event.stopPropagation();
                onToggle(player.playerId);
              }}
              aria-label={`Remove ${player.displayName}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          className="multiselect-input"
          value={query}
          placeholder={selectedPlayers.length === 0 ? 'Search participants…' : ''}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
        />
      </div>
      {open && (
        <ul className="multiselect-dropdown" role="listbox">
          {available.length === 0 ? (
            <li className="multiselect-empty">No matching participants</li>
          ) : (
            available.map((player, index) => (
              <li
                key={player.playerId}
                role="option"
                aria-selected={false}
                className={`multiselect-option${index === highlight ? ' multiselect-option-highlighted' : ''}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  selectPlayer(player.playerId);
                }}
                onMouseEnter={() => setHighlight(index)}
              >
                {player.displayName}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
