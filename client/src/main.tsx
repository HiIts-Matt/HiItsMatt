// Fraunces' optical-size axis is what makes the huge hero setting look like a
// display face rather than scaled-up body text; the default Fontsource export
// ships weight only, so the axis has to be requested explicitly.
import "@fontsource-variable/fraunces/opsz.css";
import "@fontsource-variable/inter";
import "./styles/global.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";

const container = document.getElementById("root");
if (!container) throw new Error("index.html is missing the #root mount point");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
