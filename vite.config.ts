import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // Gör även icke-VITE_-variabler tillgängliga för serverfunktioner.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));
  return {
    resolve: { tsconfigPaths: true },
    plugins: [tailwindcss(), tanstackStart(), nitro({ preset: "node-server" }), viteReact()],
  };
});
