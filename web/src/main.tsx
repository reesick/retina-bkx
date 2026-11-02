import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "framer-motion";
import App from "./App";
import "./index.css";
import { useReducedMotion } from "./lib/store";

const qc = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5000 },
  },
});

function Root() {
  const reduced = useReducedMotion();
  React.useEffect(() => {
    document.documentElement.classList.toggle("reduce-motion", reduced);
  }, [reduced]);
  return (
    <MotionConfig reducedMotion={reduced ? "always" : "never"}>
      <App />
    </MotionConfig>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Root />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
