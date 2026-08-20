import { useState } from 'react';
import { shareText } from '../lib/share';

export function ShareButton({ title, text, label = 'Share' }: { title: string; text: string; label?: string }) {
  const [feedback, setFeedback] = useState<string | null>(null);

  async function handleClick() {
    const outcome = await shareText(title, text);
    if (outcome === 'copied') setFeedback('Copied to clipboard');
    else if (outcome === 'unavailable') setFeedback('Sharing not supported on this device');
    else return;
    setTimeout(() => setFeedback(null), 2500);
  }

  return (
    <span className="share-button">
      <button type="button" className="share-icon-button" onClick={handleClick} aria-label={label} title={label}>
        <ShareIcon />
      </button>
      {feedback && <span className="share-feedback">{feedback}</span>}
    </span>
  );
}

function ShareIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}
