import Link from "next/link";
import { cookies } from "next/headers";
import { ThemeToggle } from "@/components/theme-toggle";
import { resourcePrice } from "@/lib/env";
import { LandingHeader } from "@/components/landing-header";
import { ACCESS_COOKIE, accessGateEnabled, sessionSecret } from "@/lib/access";
import { merchantAccessState } from "@/lib/access-view";

export const dynamic = "force-dynamic";

const nav = [
  { label: "Product", href: "#product" },
  { label: "How it works", href: "#how" },
  { label: "Pricing", href: "#pricing" },
  { label: "Docs", href: "https://github.com/dev-salami/181hacks" },
];

const steps = [
  { n: "01", title: "Describe the invoice", body: "Say the work and the amount in a normal sentence. PayLink shows a review before saving a draft." },
  { n: "02", title: "Issue a payment link", body: "When you issue the draft, your client gets the pay page for the network you selected. Issuing does not send email by itself." },
  { n: "03", title: "Record verified payment", body: "PayLink marks the invoice paid only after the USDC payment is verified, then keeps the receipt with the invoice." },
];

export default async function HomePage() {
  const jar = await cookies();
  const { unlocked } = await merchantAccessState({ token: jar.get(ACCESS_COOKIE)?.value, secret: sessionSecret(), enabled: accessGateEnabled() });
  const dashboardHref = unlocked ? "/dashboard" : "/access";
  const pdf = resourcePrice("pdf");
  const reminder = resourcePrice("reminder");

  return (
    <div className="min-h-screen bg-bg">
      {/* floating pill nav */}
      <LandingHeader>
        <Link href="/" className="flex items-center gap-2 text-lg">
          <span className="k-logo h-9 w-9 text-sm">P</span>
          <span className="bold hidden sm:inline">PayLink</span>
        </Link>
        <nav className="hidden items-center gap-1 rounded-2xl bg-paper p-1.5 text-sm md:flex" aria-label="Site">
          {nav.map((item) => (
            <a key={item.label} href={item.href} className="rounded-xl px-4 py-2 text-ink hover:bg-elev">
              {item.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link href={dashboardHref} className="btn btn-primary btn-small px-5">
            {unlocked ? "Open dashboard" : "Log in"}
          </Link>
        </div>
      </LandingHeader>

      {/* hero */}
      <section id="product" className="relative mx-auto grid max-w-6xl items-center gap-4 px-5 pb-10 pt-10 lg:grid-cols-[1fr_1fr] lg:pt-16">
        <div className="relative z-10">
          <span className="eyebrow">USDC payments for your business</span>
          <h1 className="t-display mt-5">
            Invoice clearly. <span className="bold">Get paid</span> in USDC.
          </h1>
          <ul className="checks mt-7 grid gap-2.5 text-muted">
            <li>Create and share invoices in one place</li>
            <li>Receive USDC on Solana mainnet, with devnet also available</li>
            <li>Track verified payments and receipts</li>
          </ul>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href={unlocked ? "/dashboard" : "/chat"} className="btn btn-primary px-6">
              {unlocked ? "Open dashboard ↗" : "Create an invoice ↗"}
            </Link>
          </div>
        </div>
        <div className="relative mx-auto w-full max-w-[560px]">
          <img src="/art/statue-coin.webp" alt="A marble statue holding a silver coin" className="art-light floaty-slow w-full dark:hidden" />
          <img src="/art/statue-dark.webp" alt="" aria-hidden className="art-dark floaty-slow hidden w-full dark:block" />
          <div className="card floaty absolute left-0 top-[16%] w-[190px] p-4 shadow-[0_24px_60px_rgba(24,28,37,0.10)] sm:-left-6">
            <p className="text-xs text-muted">You set the amount</p>
            <p className="mt-1 text-2xl">USDC</p>
            <span className="delta flat mt-2">Solana invoice</span>
          </div>
          <div className="card-dark floaty-slow absolute bottom-[12%] right-0 w-[200px] p-4 sm:-right-4">
            <p className="text-xs text-[#9a9ea8]">Invoice documents</p>
            <p className="mt-1 text-xl">Branded PDF</p>
            <p className="mt-1 text-sm"><span className="text-[#71FC8F]">●</span> {pdf} USDC · per document</p>
          </div>
        </div>
      </section>

      {/* how it works */}
      <section id="how" className="mx-auto max-w-6xl px-5 pb-16">
        <div className="grid gap-3 md:grid-cols-3">
          {steps.map((step) => (
            <article key={step.n} className="card p-6">
              <p className="text-sm text-muted">{step.n}</p>
              <h3 className="mt-8 text-xl">{step.title}</h3>
              <p className="mt-2 text-sm text-muted">{step.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* dark section with overlapping ledger */}
      <section className="relative mx-3 overflow-hidden rounded-[28px] bg-[#181C25] px-5 pb-48 pt-16 text-[#f4f5f7] sm:mx-5">
        <div className="mx-auto grid max-w-6xl items-center gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <span className="eyebrow text-[#9a9ea8]">The books</span>
            <h2 className="mt-4 text-[clamp(2.2rem,4.6vw,3.8rem)] leading-[0.98]">
              Every invoice, <span className="bold">reconciled</span> against the chain.
            </h2>
            <p className="mt-5 max-w-md text-[#9a9ea8]">
              Paid means verified. Track outstanding balances and keep the payment record alongside every invoice.
            </p>
            <Link href={dashboardHref} className="btn btn-mint mt-8 px-6">{unlocked ? "Open dashboard ↗" : "Open the books ↗"}</Link>
          </div>
          <img src="/art/armillary-dark.webp" alt="A silver ring sculpture" className="art-dark floaty-slow mx-auto w-full max-w-[420px]" />
        </div>
      </section>
      <section className="relative z-10 mx-auto -mt-36 max-w-5xl px-5">
        <div className="card p-6 shadow-[0_30px_80px_rgba(24,28,37,0.14)] sm:p-8">
          <p className="text-lg">Your invoices live in the workspace</p>
          <p className="mt-3 max-w-2xl text-sm text-muted">The dashboard lists invoices you save. It does not show example customers. A draft stays unpaid until you issue it, and paid means the USDC payment was verified.</p>
          <Link href={dashboardHref} className="btn btn-primary mt-6">{unlocked ? "Open dashboard" : "Log in"}</Link>
        </div>
      </section>

      {/* pricing */}
      <section id="pricing" className="mx-auto max-w-6xl px-5 py-20">
        <div className="max-w-xl">
          <span className="eyebrow">Pay-as-you-go tools</span>
          <h2 className="mt-4 text-[clamp(2rem,4vw,3.2rem)] leading-[1]">
            The follow-up is <span className="bold">paid per call.</span>
          </h2>
          <p className="mt-4 text-muted">Pay for reminders and documents from your agent wallet on Solana devnet. Set spending limits and choose when approval is required. Devnet USDC has no monetary value.</p>
        </div>
        <div className="mt-10 grid gap-3 md:grid-cols-3">
          <Price name="Invoices & pay links" price="0" unit="free" items={["Solana Pay link + QR", "On-chain confirmation", "Receipt page"]} />
          <Price name="Payment reminder" price={reminder} unit="USDC / reminder" items={["Emails the client after you confirm", "Requires a client email and Resend", "Your spending limits apply"]} />
          <Price dark name="Branded PDF" price={pdf} unit="USDC / document" items={["Invoice document", "Approval above your limit", "Solana devnet payments"]} />
        </div>
      </section>

      {/* footer */}
      <footer className="mx-3 mb-3 rounded-[28px] bg-[#181C25] px-6 pb-8 pt-16 text-[#f4f5f7] sm:mx-5">
        <div className="mx-auto max-w-6xl">
          <h2 className="max-w-3xl text-[clamp(2.2rem,5vw,4.4rem)] leading-[0.98]">
            Send the link. <span className="bold">Keep the work moving.</span>
          </h2>
           <Link href={unlocked ? "/dashboard" : "/chat"} className="btn btn-mint mt-8 px-6">{unlocked ? "Open dashboard ↗" : "Start invoicing ↗"}</Link>
          <div className="mt-16 flex flex-wrap justify-between gap-4 border-t border-[#2c3240] pt-6 text-sm text-[#9a9ea8]">
            <span>PayLink · USDC invoicing · Check the network before you pay</span>
            <span className="flex gap-5">
              <Link href="/dashboard">Books</Link>
              <Link href="/activity">Activity</Link>
              <Link href="/wallet">Wallet</Link>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Price({ name, price, unit, items, dark = false }: { name: string; price: string; unit: string; items: string[]; dark?: boolean }) {
  return (
    <article className={`${dark ? "card-dark" : "card"} flex flex-col p-6`}>
      <p className={dark ? "text-[#9a9ea8]" : "text-muted"}>{name}</p>
      <p className="mt-6 text-5xl">
        {price === "0" ? "Free" : <>{price}</>}
        {price === "0" ? null : <span className={`ml-2 text-base ${dark ? "text-[#9a9ea8]" : "text-muted"}`}>{unit}</span>}
      </p>
      <ul className="checks mt-6 grid gap-2">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </article>
  );
}
