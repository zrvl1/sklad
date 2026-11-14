import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Склад",
  description: "Товари, прихід, комірки та цінники для SalesDrive",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk">
      <body>{children}</body>
    </html>
  );
}
