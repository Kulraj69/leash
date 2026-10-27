import type { Metadata } from "next";
import { IBM_Plex_Mono, VT323 } from "next/font/google";
import "./globals.css";
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});
const terminal = VT323({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-terminal",
  display: "swap",
});
export const metadata: Metadata = {
  title: "LEASH 5150 — A spending firewall for AI agents",
  description:
    "Compile spending rules, inspect NEAR access keys, and jailbreak a simulated shopping agent. Every action meets a deterministic firewall. Built at NEAR HACKATHON.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${mono.variable} ${terminal.variable}`}>
        {children}
      </body>
    </html>
  );
}
