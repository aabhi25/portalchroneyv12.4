import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import EmbedChat from "./pages/EmbedChat";
import "./index.css";
import 'katex/dist/katex.min.css';

function EmbedApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <EmbedChat />
      <Toaster />
    </QueryClientProvider>
  );
}

createRoot(document.getElementById("root")!).render(<EmbedApp />);
