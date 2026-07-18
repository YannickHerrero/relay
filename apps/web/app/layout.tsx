import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Relay",
    template: "%s · Relay",
  },
  description: "Manage autonomous coding agents through a controlled delivery workflow.",
  applicationName: "Relay",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Relay",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#f8fafc",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
