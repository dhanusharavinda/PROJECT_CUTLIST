import type { Metadata, Viewport } from "next";
import { ToastHost } from "@/components/ui";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Cutlist: hand off an edit in the time it takes to watch it",
    template: "%s · Cutlist",
  },
  description:
    "Creators talk over their footage. Cutlist transcribes it, turns it into a timestamped cut list, and hands the editor a shared workspace instead of a wall of notes.",
  applicationName: "Cutlist",
};

export const viewport: Viewport = {
  themeColor: "#06070a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        {/* Loaded over a link rather than next/font so a build never depends on
            reaching Google. Every family has a real fallback in globals.css. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;450;500;600;700&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        <ToastHost>{children}</ToastHost>
      </body>
    </html>
  );
}
