import Link from "next/link";
import { Breadcrumbs, type Crumb } from "../seo/Breadcrumbs";

export function PublicPage({ eyebrow, title, intro, crumbs, children }: { eyebrow: string; title: string; intro: string; crumbs: Crumb[]; children: React.ReactNode }) {
  return <main className="min-h-screen bg-white px-6 pb-24 pt-28 text-[#3D3650]">
    <div className="mx-auto max-w-5xl">
      <Breadcrumbs items={crumbs} />
      <p className="mb-4 font-mono text-xs uppercase tracking-widest text-[#6425C4]">{eyebrow}</p>
      <h1 className="max-w-4xl text-4xl font-bold tracking-tight text-[#170B2E] md:text-5xl">{title}</h1>
      <p className="mt-6 max-w-3xl text-lg leading-8 text-[#3D3650]">{intro}</p>
      <div className="mt-14 space-y-14">{children}</div>
      <section className="mt-16 rounded-2xl border border-[#D6C4EE] bg-[#7F40E8]/5 p-8">
        <h2 className="text-2xl font-bold text-[#170B2E]">Build with PurpleCallio</h2>
        <p className="mt-3 max-w-2xl text-[#3D3650]">Explore the documentation to choose hosted UI, React components, or the headless SDK for your integration.</p>
        <div className="mt-6 flex flex-wrap gap-3"><Link href="/docs/quickstart" className="btn-primary rounded-lg px-5 py-3 text-sm font-medium text-white">Read the quickstart</Link><Link href="/signup" className="rounded-lg border border-[#D6C4EE] px-5 py-3 text-sm font-medium text-[#3D3650]">Create an account</Link></div>
      </section>
    </div>
  </main>;
}

export function ContentSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><h2 className="text-2xl font-bold text-[#170B2E]">{title}</h2><div className="mt-4 max-w-4xl space-y-4 leading-7 text-[#3D3650]">{children}</div></section>;
}
