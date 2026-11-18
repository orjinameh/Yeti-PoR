import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Yeti Proof-of-Run",
  description: "A yeti runner whose score is replay-verified in Move on Sui. Daily challenge + ghost racing.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Press+Start+2P&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
