import type { Metadata } from "next";
import { Caveat, Kalam, Patrick_Hand, Cormorant_Garamond, Hanken_Grotesk, Newsreader } from "next/font/google";
import "./globals.css";
import { TrpcProvider } from "@/lib/trpc/Provider";
import { GlobalOverlays } from "@/components/GlobalOverlays";

// Paper-theme fonts. next/font downloads + self-hosts these at build time, so
// they work offline in the Tauri shell (no Google CDN at runtime). Each exposes
// a CSS variable that globals.css references from the paper themes' --font-body.
const caveat = Caveat({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-caveat" });
const kalam = Kalam({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-kalam" });
const patrickHand = Patrick_Hand({ subsets: ["latin"], weight: "400", variable: "--font-patrick" });
const cormorant = Cormorant_Garamond({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-cormorant" });
// Body type for the Clean Modern theme. globals.css points --font-body at it under
// html[data-theme="clean-modern"]; inert in every other theme.
const hanken = Hanken_Grotesk({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-hanken" });
// Serif for reading surfaces (journal entries, distilled docs) in the Clean
// Modern theme. globals.css exposes it as --font-serif under html[data-theme="clean-modern"].
const newsreader = Newsreader({ subsets: ["latin"], weight: ["400", "500", "600", "700"], style: ["normal", "italic"], variable: "--font-newsreader" });

export const metadata: Metadata = {
  title: "Life OS",
  description: "Local-first life management dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // data-theme + data-mode drive the theme-token system in globals.css.
  // Defaults to the calm-light "Clean Modern" theme (light mode) — the redesign default.
  // The persisted theme switcher (later step) updates these at runtime, and the
  // anti-flash script below restores any saved preference before first paint, so
  // a user who picked another theme keeps it; this only sets the first-run default.
  // The font-variable classes make --font-caveat/kalam/patrick/cormorant
  // available to every theme (the paper themes opt into them in globals.css).
  const fontVars = `${caveat.variable} ${kalam.variable} ${patrickHand.variable} ${cormorant.variable} ${hanken.variable} ${newsreader.variable}`;
  // Anti-flash: before the page paints, read the cached theme preference from
  // localStorage and apply it to <html>. SQLite (AppSetting) stays the source of
  // truth — the ThemeSwitcher reconciles from it on mount — but this avoids a
  // flash of the default dark theme on launch. Mirrors next-themes' approach.
  const antiFlash = `try{var p=JSON.parse(localStorage.getItem('uiThemePref')||'{}');var d=document.documentElement;if(p.theme)d.setAttribute('data-theme',p.theme);if(p.mode)d.setAttribute('data-mode',p.mode);}catch(e){}`;
  return (
    <html lang="en" data-theme="clean-modern" data-mode="light" className={fontVars} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: antiFlash }} />
      </head>
      <body className="antialiased">
        <TrpcProvider>
          {children}
          {/* Global overlays: PromptModal + Focus / Break / Launch boxes */}
          <GlobalOverlays />
        </TrpcProvider>
      </body>
    </html>
  );
}
