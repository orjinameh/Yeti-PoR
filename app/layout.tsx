import type { ReactNode } from "react";
export const metadata = { title: "Yeti Proof-of-Run", description: "A Lofi Yeti runner whose score is replay-verified in Move on Sui." };
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0b1020", color: "#e8f0ff", fontFamily: "system-ui, sans-serif" }}>{children}</body>
    </html>
  );
}
