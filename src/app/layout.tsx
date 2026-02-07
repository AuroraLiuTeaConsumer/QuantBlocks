import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QuantBlocks",
  description: "Strategy building + backtesting workspace for perpetual trading",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-950 text-gray-100">{children}</body>
    </html>
  );
}
