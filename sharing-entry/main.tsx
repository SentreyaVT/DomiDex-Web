import React from 'react';
import { createRoot } from 'react-dom/client';
import { SharedBinderViewer } from '../components/shared-binder-viewer';
import './reset.css';

// The same reviewed read-only viewer as /share/[token]; no private app/auth shell.
const token = window.location.pathname.match(/^\/share\/([A-Za-z0-9_-]{43})\/?$/)?.[1];
const root = createRoot(document.getElementById('root')!);
root.render(token ? <SharedBinderViewer token={token} /> : <main>Freigabe nicht verfügbar.</main>);
