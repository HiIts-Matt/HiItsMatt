import { BrowserRouter, Route, Routes } from "react-router";

import { Landing } from "./routes/Landing";
import { NotFound } from "./routes/NotFound";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
