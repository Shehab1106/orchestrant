import type { ReactNode } from "react"
import { Manrope, JetBrains_Mono } from "next/font/google"
import "./globals.css"

const sans = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
})

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-jb",
  display: "swap",
})

export const metadata = {
  title: "orchestrant",
  description: "Framework-agnostic payment orchestration engine",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
