// ===============================================
// vite.config.js — HTTPS local opcional + LAN + Render seguro
// ===============================================

import { defineConfig } from "vite";
import path from "path";
import fs from "fs";

const isDev = process.env.NODE_ENV !== "production";

// Función para configurar HTTPS solo en desarrollo y solo si existen los .pem
function getHttpsConfig() {
  if (!isDev) return undefined; // En Render (production) no tocamos nada

  const keyPath = path.resolve(__dirname, "localhost+2-key.pem");
  const certPath = path.resolve(__dirname, "localhost+2.pem");

  // Si no existen los archivos, seguimos con HTTP normal
  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    console.warn("[vite] Certificados HTTPS no encontrados, usando HTTP normal");
    return undefined;
  }

  console.log("[vite] Usando HTTPS local con certificados mkcert");
  return {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };
}

export default defineConfig({
  resolve: {
    alias: {
      "@router": path.resolve(__dirname, "src/router.js"),
      "@wan": path.resolve(__dirname, "src/net/index.js"),
      "@engine": path.resolve(__dirname, "src/shared/engineBridge.js"),
      "@rules": path.resolve(__dirname, "src/rules/index.js"),
    },
  },

  server: {
    https: getHttpsConfig(),

    host: true,
    port: 5173,
    strictPort: true,

    allowedHosts: true,

    // ✅ PROXY: /ai/* se redirige al backend FastAPI
    proxy: {
      "/ai": {
        target: "http://127.0.0.1:8001", // ✅ PUERTO REAL (según tu consola uvicorn)
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
