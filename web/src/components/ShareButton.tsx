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
      <button type="button" onClick={handleClick}>
        {label}
      </button>
      {feedback && <span className="share-feedback">{feedback}</span>}
    </span>
  );
}
