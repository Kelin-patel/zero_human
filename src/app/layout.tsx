import type { Metadata } from "next";
import Link from "next/link";
import { IBM_Plex_Mono, Inter, Inter_Tight } from "next/font/google";
import "./globals.css";

const interTight = Inter_Tight({
  variable: "--font-inter-tight",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  weight: ["400", "500"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Second Instance — independent review of AI refund decisions",
  description:
    "Independent human review, with the power to correct an AI decision. When a support AI denies a refund, independent people re-check it against the store's own policy and the evidence.",
};

const NAV = [
  { href: "/#how", label: "How it works" },
  { href: "/#product", label: "Product" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/ledger", label: "Ledger" },
];

const FOOTER_COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/#how", label: "How it works" },
      { href: "/#pricing", label: "Pricing" },
      { href: "/refund", label: "Try the demo" },
    ],
  },
  {
    title: "Transparency",
    links: [
      { href: "/ledger", label: "Public ledger" },
      { href: "/#measured", label: "Evaluation" },
    ],
  },
];

function Logo() {
  return (
    <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="Second Instance home">
      <span className="flex h-[22px] w-[22px] items-center justify-center rounded-[5px] bg-ink font-display text-[10px] font-semibold text-white">
        SI
      </span>
      <span className="font-display text-[15px] font-semibold tracking-tight text-ink">Second Instance</span>
    </Link>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${interTight.variable} ${inter.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-paper font-sans text-ink antialiased">
        <header className="border-b border-rule bg-card">
          <div className="container-page flex h-16 items-center justify-between gap-4">
            <div className="flex items-center gap-10">
              <Logo />
              <nav className="hidden items-center gap-7 md:flex" aria-label="Primary">
                {NAV.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="text-sm text-ink-2 transition-colors duration-150 hover:text-ink"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>
            <Link href="/refund" className="btn-primary">
              Try the demo
            </Link>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <footer className="border-t border-rule bg-card">
          <div className="container-page grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
            <div className="flex max-w-sm flex-col gap-3">
              <Logo />
              <p className="text-sm leading-relaxed text-ink-2">
                Independent human review of AI refund decisions, with the power to correct them.
              </p>
              <p className="text-sm leading-relaxed text-ink-3">
                Operated by an AI agent. Demo cases use a fictional store; sandbox transactions are labelled.
              </p>
            </div>
            {FOOTER_COLUMNS.map((col) => (
              <div key={col.title} className="flex flex-col gap-3">
                <p className="text-sm font-medium text-ink">{col.title}</p>
                <ul className="flex flex-col gap-2">
                  {col.links.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href} className="text-sm text-ink-2 transition-colors duration-150 hover:text-ink">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium text-ink">Built with</p>
              <p className="text-sm leading-relaxed text-ink-2">Whop · Terac · Exa · Solari · Claude</p>
            </div>
          </div>
          <div className="border-t border-rule">
            <div className="container-page flex h-14 items-center text-xs text-ink-3">© 2026 Second Instance</div>
          </div>
        </footer>
      </body>
    </html>
  );
}
