import Link from "next/link";
import { JsonLd } from "./JsonLd";
import { siteUrl } from "../../lib/seo";

export type Crumb = { label: string; href?: string };

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.label,
      item: new URL(item.href || "/", siteUrl).toString(),
    })),
  };
  return <>
    <JsonLd data={schema} />
    <nav aria-label="Breadcrumb" className="mb-8 text-sm text-[#3D3650]">
      <ol className="flex flex-wrap gap-2">
        {items.map((item, index) => <li key={item.label} className="flex gap-2">
          {index > 0 && <span aria-hidden="true">/</span>}
          {item.href && index < items.length - 1 ? <Link href={item.href} className="hover:text-[#170B2E]">{item.label}</Link> : <span className="text-[#3D3650]">{item.label}</span>}
        </li>)}
      </ol>
    </nav>
  </>;
}
