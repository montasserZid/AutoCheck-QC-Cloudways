import type { Metadata } from "next";
import "./globals.css";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";

export const metadata: Metadata = {
  title: {
    default: "AutoCheck QC - Used-Car Pre-Screening in Montreal",
    template: "%s | AutoCheck QC",
  },
  icons: {
    icon: "/favicon.svg",
  },
  description:
    "Used-car listing pre-screening and inspection preparation for Montreal and Quebec buyers.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-CA" data-scroll-behavior="smooth">
      <body>
        <Header />
        <div id="main-content" tabIndex={-1}>
          {children}
        </div>
        <Footer />
      </body>
    </html>
  );
}
