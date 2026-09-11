import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Dashboard Agent",
  description:
    "Ask about advertising performance in plain English and get a number you can defend, with the plan, the SQL, the rows, and the data-quality caveats attached.",
};

/** Applied before first paint so a dark-mode reader never sees a white flash. */
const THEME_BOOT = `try{var t=localStorage.getItem("da.theme");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
