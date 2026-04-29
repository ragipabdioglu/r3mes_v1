import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

import { Navbar } from "@/components/navbar";
import { WalletProvider } from "@/components/wallet-provider";

import "./globals.css";
import "@mysten/dapp-kit/dist/index.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "R3MES — AI × Sui",
  description: "R3MES pazaryeri, studio ve çıkarım arayüzü",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr" className="dark">
      <body
        className={`${inter.variable} ${jetbrains.variable} min-h-screen font-sans`}
      >
        <WalletProvider>
          <Navbar />
          <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
        </WalletProvider>
      </body>
    </html>
  );
}
