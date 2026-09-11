const DATABASE = 'replay-recording-recovery';
let database;

function openDatabase() {
  if (database) return database;
  database = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('Local recording recovery is unavailable in this browser.'));
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('sessions', { keyPath: 'id' });
      const chunks = request.result.createObjectStore('chunks', { keyPath: ['sessionId', 'kind', 'index'] });
      chunks.createIndex('sessionId', 'sessionId');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(error => { database = null; throw error; });
  return database;
}

async function transaction(stores, mode, work) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Local storage transaction was interrupted.'));
    work(tx, value => { result = value; });
  });
}

export const saveRecordingSession = session => transaction(['sessions'], 'readwrite', tx => tx.objectStore('sessions').put(session));
export const saveRecordingChunk = chunk => transaction(['chunks'], 'readwrite', tx => tx.objectStore('chunks').put(chunk));
export const listRecordingSessions = () => transaction(['sessions'], 'readonly', (tx, set) => {
  tx.objectStore('sessions').getAll().onsuccess = event => set(event.target.result.sort((a, b) => b.createdAt - a.createdAt));
});
export const recoverRecordingSession = id => transaction(['chunks'], 'readonly', (tx, set) => {
  tx.objectStore('chunks').index('sessionId').getAll(id).onsuccess = event => {
    const grouped = {};
    for (const chunk of event.target.result) (grouped[chunk.kind] ||= []).push(chunk);
    const blobs = {};
    for (const [kind, chunks] of Object.entries(grouped)) {
      chunks.sort((a, b) => a.index - b.index);
      blobs[kind] = new Blob(chunks.map(chunk => chunk.data), { type: chunks[0].data.type || (kind === 'microphone' || kind === 'system' ? 'audio/webm' : 'video/webm') });
    }
    set(blobs);
  };
});
export const deleteRecordingSession = id => transaction(['sessions', 'chunks'], 'readwrite', tx => {
  tx.objectStore('sessions').delete(id);
  tx.objectStore('chunks').index('sessionId').openCursor(IDBKeyRange.only(id)).onsuccess = event => {
    const cursor = event.target.result;
    if (cursor) { cursor.delete(); cursor.continue(); }
  };
});

export function recordingMimeType(audioOnly = false) {
  const types = audioOnly
    ? ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
    : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  return types.find(type => MediaRecorder.isTypeSupported(type));
}

export function durationLabel(seconds) {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
