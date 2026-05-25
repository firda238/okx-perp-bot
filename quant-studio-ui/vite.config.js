import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("/react/") || id.includes("/react-dom/")) return "react";
          if (id.includes("/recharts/")) return "charts";
          if (id.includes("/lucide-react/")) return "icons";
          return "vendor";
        },
      },
    },
  },
});
