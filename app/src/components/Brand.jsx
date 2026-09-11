import { Play } from '@phosphor-icons/react';

export default function Brand({ className = '', onClick }) {
  return <button className={`replay-brand ${className}`} onClick={onClick} aria-label="Replay library">
    <span className="replay-brand-mark" aria-hidden="true"><Play size={17} weight="fill" /></span>
    <span className="replay-brand-name">Replay</span>
  </button>;
}
