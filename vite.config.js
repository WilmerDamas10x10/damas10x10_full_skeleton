// ===============================================
// vite.config.js — HTTPS + LAN + Cloudflare listo
// ===============================================

import { defineConfig } from "vite";
import path from "path";
import fs from "fs";

export default defineConfig({
  resolve: {
    alias: {
      // Rutas existentes
      "@router": path.resolve(__dirname, "src/router.js"),
      "@wan": path.resolve(__dirname, "src/net/index.js"),

      // 🔽 Motor único expuesto solo aquí
      "@engine": path.resolve(__dirname, "src/shared/engineBridge.js"),

      // 🔽 Barril “puro” de reglas (SIN pasar por engineBridge)
      "@rules": path.resolve(__dirname, "src/rules/index.js"),
      // (eliminado) '@rulesParallel': path.resolve(__dirname, 'src/rules_parallel/index.js'),
    },
  },

  // ============================================================
  // 🔧 Servidor local — HTTPS + LAN + Cloudflare + móvil
  // ============================================================
  server: {
    // 🔒 HTTPS LOCAL (necesario para cámara/micrófono)
    https: {
      key: fs.readFileSync("./localhost+2-key.pem"),
      cert: fs.readFileSync("./localhost+2.pem"),
    },

    // 🌐 Permite acceso desde celular/tablet/otros dispositivos
    host: true,

    // 📌 Puerto fijo
    port: 5173,
    strictPort: true,

    // 🔓 Permitir dominios externos como trycloudflare.com
    allowedHosts: true,

    // Si quieres restringirlo solo al túnel, habilita:
    // allowedHosts: ['pools-overnight-conditions-division.trycloudflare.com'],
  },
});
