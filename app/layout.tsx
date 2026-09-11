import type { ReactNode } from "react";

export const metadata = { title: "Dashboard Agent" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          margin: 0,
          padding: "2rem",
          maxWidth: 900,
        }}
      >
        {children}
      </body>
    </html>
  );
}
