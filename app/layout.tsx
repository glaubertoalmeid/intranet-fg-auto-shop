import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Intranet | FG Auto Shop",
  description: "Portal interno da equipe FG Auto Shop.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
