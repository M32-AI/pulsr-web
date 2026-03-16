import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Pulsr — AI-Powered Time Tracking",
  description:
    "Pulsr automatically tracks your work using AI screenshot analysis. Download for macOS, Windows, or Linux.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <Script
          id="feedbucket"
          strategy="afterInteractive"
          data-feedbucket="PcuM73bWVVqTrDPJqi6z"
          src="https://cdn.feedbucket.app/assets/feedbucket.js"
        />
      </body>
    </html>
  );
}
