import { BrowserRouter, Route, Routes } from "react-router";

import { MAINTENANCE } from "./features";
import { Landing } from "./routes/Landing";
import { Maintenance } from "./routes/Maintenance";
import { NotFound } from "./routes/NotFound";
import { SECTIONS, pagePath } from "./sections/sections";

export function App() {
  // No router at all: every URL is this one screen, so no path leads anywhere.
  if (MAINTENANCE) return <Maintenance />;

  return (
    <BrowserRouter>
      <Routes>
        {/*
          One page stack behind every page's URL. The paths are children of a
          single layout route, so moving between them keeps Landing mounted:
          changing page is a handover inside the stack, never a remount.
        */}
        <Route element={<Landing />}>
          {SECTIONS.map((section) => (
            <Route key={section.id} path={pagePath(section.id)} />
          ))}
          <Route path="/projects/:slug" />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
