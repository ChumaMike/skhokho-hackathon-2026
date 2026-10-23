import type { Metadata } from "next";
import { Archivo, Archivo_Black, Space_Mono } from "next/font/google";
import "./globals.css";

// Reads the theme cookie and stamps data-theme before first paint, entirely
// client-side and synchronously (blocks rendering until it runs, same as
// libraries like next-themes) — deliberately NOT a server-side cookies()
// read in this layout, which would force every page in the app out of
// static generation (a real regression: "/", "/showcase" and "/not-found"
// were prerendered static HTML before this feature existed, and a server
// cookie read here would make them per-request dynamic for everyone, not
// just the handful of people who've actually changed their theme).
const THEME_INIT_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )skhokho-theme=([^;]*)/);var v=m&&decodeURIComponent(m[1]);if(v==="light"||v==="dark"){document.documentElement.setAttribute("data-theme",v);}}catch(e){}})();`;

// Self-hosted at build time (next/font/google downloads + serves the font
// files from this origin) — a strict CSP forbids requests to Google Fonts.
const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-archivo",
  display: "swap",
});

const archivoBlack = Archivo_Black({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-archivo-black",
  display: "swap",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-space-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Skhokho — get your business online",
  description:
    "Register your business and start tracking your customers and loyalty.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en-ZA"
      className={`${archivo.variable} ${archivoBlack.variable} ${spaceMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
