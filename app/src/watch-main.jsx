import React from 'react';
import '@fontsource-variable/inter';
import { createRoot } from 'react-dom/client';
import WatchPage from './components/WatchPage.jsx';
import './styles.css';
import './theme.css';
import './polish.css';

createRoot(document.getElementById('root')).render(<React.StrictMode><WatchPage /></React.StrictMode>);
