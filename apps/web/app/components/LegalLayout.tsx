import Link from "next/link";

export default function LegalLayout({
  title,
  lastUpdated,
  intro,
  children,
}: {
  title: string;
  lastUpdated?: string;
  intro?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{ background: "#FFFFFF", color: "#170B2E", minHeight: "100vh" }}
    >
      {/* Hero */}
      <div className="max-w-6xl mx-auto px-6 pt-28 pb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono mb-4 border" style={{ background: 'rgba(127,64,232,0.08)', borderColor: 'rgba(127,64,232,0.25)', color: '#6425C4' }}>
          <span className="w-1.5 h-1.5 rounded-full bg-[#7F40E8] animate-pulse" />
          Legal
        </div>
        <h1 className="font-bold text-[#170B2E] mb-3" style={{ fontSize: 'clamp(2rem, 4vw, 3rem)', letterSpacing: '-0.03em' }}>
          {title}
        </h1>
        {lastUpdated && (
          <p className="text-[#3D3650] text-sm mb-3">Last Updated: {lastUpdated}</p>
        )}
        {intro && (
          <p className="text-[#3D3650] text-base leading-relaxed max-w-2xl">{intro}</p>
        )}
      </div>

      {/* Body */}
      <div className="max-w-6xl mx-auto px-6 pb-24">
        <div
          className="rounded-2xl border border-[#E7DFF5] px-7 sm:px-10 py-9"
          style={{ background: "#FFFFFF" }}
        >
          <div className="space-y-8">{children}</div>
        </div>

        {/* Contact CTA */}
        <div className="mt-12 rounded-xl p-8 text-center border border-[#D6C4EE]" style={{ background: 'linear-gradient(135deg, rgba(127,64,232,0.06), rgba(65,6,134,0.04))' }}>
          <p className="font-bold text-[#170B2E] mb-2 text-lg">Questions about this policy?</p>
          <p className="text-[#3D3650] text-sm mb-6">
            Our engineers are one email away.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <a href="mailto:purplecallio@gmail.com" className="inline-flex items-center gap-2 text-white font-medium text-sm px-6 py-2.5 rounded-lg transition-all hover:opacity-90" style={{ background: 'linear-gradient(135deg, #7F40E8, #410686)' }}>
              purplecallio@gmail.com
            </a>
            <Link href="/" className="inline-flex items-center gap-2 text-[#3D3650] font-medium text-sm px-6 py-2.5 rounded-lg border border-[#E7DFF5] hover:border-[#D6C4EE] transition-all">
              Back to home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export function LegalSection({ num, title, children }: { num?: string; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-semibold text-[#170B2E] mb-3" style={{ fontSize: '1.15rem' }}>
        {num && (
          <span className="gradient-text font-mono text-xs tracking-widest uppercase mr-3">{num}</span>
        )}
        {title}
      </h2>
      <div className="text-[#3D3650] text-sm leading-relaxed space-y-3">{children}</div>
    </section>
  );
}

export function LegalBullets({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2 list-none">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2">
          <span className="text-[#7F40E8] mt-0.5 text-xs">•</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
