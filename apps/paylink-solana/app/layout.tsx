import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Degular Display, the Unimart font. Only the Regular cut exists, so bolder
// weights are synthesized by the browser.
const sans = localFont({
  src: "./fonts/DegularDisplay-Regular.ttf",
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "PayLink — USDC invoicing and payments",
  description: "Create invoices, share payment links and track verified USDC payments on Solana. Keep receipts and outstanding balances in one place.",
};

const themeScript = `try{var t=localStorage.getItem('paylink-theme');var d=t==='dark';if(d)document.documentElement.classList.add('dark')}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
