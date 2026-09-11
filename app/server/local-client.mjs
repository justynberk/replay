import express from 'express';
import path from 'node:path';

export function mountLocalClient(app, directory) {
  // Only built public files are served. Never serve the project or data folder.
  app.use(express.static(directory, { dotfiles: 'deny', index: 'index.html' }));
  app.get('/', (req, res) => res.sendFile(path.join(directory, 'index.html')));
}
