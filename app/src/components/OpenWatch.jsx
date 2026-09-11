import { useEffect, useState } from 'react';
import { api } from '../lib.js';

// Legacy owner URLs hand off to the isolated viewer app before loading the library.
export default function OpenWatch() {
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const id = new URLSearchParams(location.search).get('asset');
    api(`/assets/${encodeURIComponent(id || '')}/watch`, { method: 'POST', body: {} })
      .then(share => { if (active) location.replace(share.url); })
      .catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, []);
  return <main style={{ padding: 40 }}><h1>{error ? 'Watch page unavailable' : 'Opening watch page'}</h1><p role="status">{error || 'Preparing the viewer link...'}</p></main>;
}
