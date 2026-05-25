import { defineConfig } from "astro/config";
import defuss from "defuss-astro";
import node from "@astrojs/node";
import tailwindcss from "@tailwindcss/vite";
import { defussRpc } from "defuss-rpc/astro.js";
import RpcApi from "./src/rpc.js";

const chatPort = parseInt(process.env.CHAT_PORT || "8015", 10);

export default defineConfig({
  integrations: [
    defuss({
      include: ["src/**/*.tsx"],
    }),
    defussRpc({
      api: RpcApi,
      port: chatPort + 100,
      watch: ["src/rpc/**/*.ts", "src/lib/**/*.ts"],
    }),
  ],
  server: {
    host: "127.0.0.1",
    port: chatPort,
  },
  vite: {
    ssr: {
      noExternal: ["astro"],
      external: ["defuss-rpc", "defuss-env", "defuss-openai"],
    },
    plugins: [tailwindcss() as any],
  },
  adapter: node({
    mode: "standalone",
  }),
});
