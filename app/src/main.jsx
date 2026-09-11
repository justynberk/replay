import React from "react";
import { createRoot } from "react-dom/client";
import OpenWatch from './components/OpenWatch.jsx';
import { App } from "./App.jsx";
import "./styles.css";
import "./theme.css";
import "./polish.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {new URLSearchParams(location.search).get('view') === 'watch' ? <OpenWatch /> : <App />}
  </React.StrictMode>,
);
