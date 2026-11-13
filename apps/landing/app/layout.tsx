import React from "react"
import type { Metadata } from 'next'
import { Instrument_Sans, Instrument_Serif, JetBrains_Mono, Poppins } from 'next/font/google'
import './globals.css'

const instrumentSans = Instrument_Sans({ 
  subsets: ["latin"],
  variable: '--font-instrument'
});

const instrumentSerif = Instrument_Serif({ 
  subsets: ["latin"],
  weight: "400",
  variable: '--font-instrument-serif'
});

const jetbrainsMono = JetBrains_Mono({ 
  subsets: ["latin"],
  variable: '--font-jetbrains'
});

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: '--font-poppins'
});

export const metadata: Metadata = {
  title: 'ChainPe — Pay any API, rate any agent, all on Avalanche',
  description: 'x402 payment + reputation infrastructure for the Avalanche agent economy. Monetize any HTTP API in USDC with one command. AI agents discover, pay for, and rate services autonomously.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${instrumentSans.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable} ${poppins.variable} font-sans antialiased`}>
        {children}
      </body>
    </html>
  )
}
