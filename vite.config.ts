import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    watch: {
      ignored: [
        "**/.tools/**",
        "**/.cache/**",
        "**/target/**",
        "**/src-tauri/**",
        "**/crates/**",
        "**/docs/**",
        "**/tests/**",
      ],
    },
    fs: {
      deny: [
        ".env",
        ".env.*",
        "*.{crt,pem,key}",
        "**/.git/**",
        "**/.tools/**",
        "**/.cache/**",
        "**/target/**",
      ],
    },
  },
  clearScreen: false,
  build: { target: "es2022" },
  test: { include: ["tests/**/*.test.ts"] },
});
