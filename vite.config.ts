import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: "prompt",
      includeAssets: [
        "favicon.ico",
        "apple-touch-icon.png",
        "icons/*.png",
        "qr/*.svg",
      ],
      manifest: {
        name: "Deac's Currency Converter",
        short_name: "Converter",
        description: "A fast fiat and cryptocurrency converter.",
        start_url: "/",
        display: "standalone",
        background_color: "#000000",
        theme_color: "#000000",
        orientation: "any",
        categories: ["finance", "utilities"],
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/icons/icon-192-maskable.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "/icons/icon-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.coinbase\.com\/v2\/exchange-rates/,
            handler: "NetworkFirst",
            options: {
              cacheName: "coinbase-rates",
              networkTimeoutSeconds: 6,
              expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    headers: {
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://api.coinbase.com; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    },
  },
});
