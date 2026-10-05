import type { Metadata } from "next";
import { Lato, Saira } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CurrentProjectProvider } from "@/lib/current-project";
import { PropertyDraftProvider } from "@/lib/property-drafts";
import { GatewaySessionProvider } from "@/lib/gateway-session";
import { WorkspaceChromeProvider } from "@/lib/workspace-chrome";

const lato = Lato({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-lato",
  display: "swap",
  preload: true,
});

const saira = Saira({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-saira",
  display: "swap",
  preload: true,
});

// Keep the console font local: Turbopack can reject the Google Fonts CSS
// during production builds ("next/font/google queries have exactly one entry").
const jetBrainsMono = localFont({
  src: "./fonts/jetbrains-mono.woff2",
  weight: "400 600",
  variable: "--font-jetbrains-mono",
  display: "swap",
  preload: true,
});

export const metadata: Metadata = {
  title: "MAPS Web",
  description: "Configuration tool for Intesis gateways",
  icons: { icon: { url: "/maps-icon.svg", type: "image/svg+xml" } },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${lato.variable} ${saira.variable} ${jetBrainsMono.variable}`}>
      <body>
        <CurrentProjectProvider>
          <PropertyDraftProvider>
          <GatewaySessionProvider>
            <WorkspaceChromeProvider>
              <TooltipProvider delayDuration={300}>
                <AppShell>{children}</AppShell>
              </TooltipProvider>
            </WorkspaceChromeProvider>
          </GatewaySessionProvider>
          </PropertyDraftProvider>
        </CurrentProjectProvider>
      </body>
    </html>
  );
}
