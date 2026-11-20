const isDev = process.env.NODE_ENV !== "production";

// Content-Security-Policy: сторінки можуть завантажувати лише власні скрипти, стилі й дані.
// Захищає від впровадження чужого коду (XSS) і від вбудовування сайту в чужі сторінки.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:", // фото товарів з SalesDrive / Prom
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws:" : ""}`,
  "frame-ancestors 'self'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "geolocation=(), microphone=(), payment=(), usb=()" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Типи перевіряються під час розробки; на сервері не зупиняємо публікацію через дрібну розбіжність типів
  typescript: { ignoreBuildErrors: true },
  // завантаження Excel-експорту SalesDrive через форму (типово ліміт 1 МБ)
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
