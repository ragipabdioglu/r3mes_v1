import type { Metadata } from "next";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";

import { Navbar } from "@/components/navbar";
import { WalletProvider } from "@/components/wallet-provider";

import "./globals.css";
import "@mysten/dapp-kit/dist/index.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-r3mes-sans",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-r3mes-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "R3MES — Knowledge OS",
  description: "R3MES knowledge-first RAG studio ve sohbet arayüzü",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr" className="dark">
      <body
        className={`${spaceGrotesk.variable} ${jetbrains.variable} min-h-screen font-sans`}
      >
        <WalletProvider>
          <Navbar />
          <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">{children}</main>
        </WalletProvider>
      </body>
    </html>
  );
}
