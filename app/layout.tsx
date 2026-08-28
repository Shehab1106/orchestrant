import type { ReactNode } from "react"

export const metadata = {
  title: "orchestrant",
  description: "Framework-agnostic payment orchestration engine",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
