"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { activeSection, sectionTabs, type Section } from "../lib/navigation";

export function SectionTabLinks({ active = null }: { active?: Section | null }) {
  return (
    <nav className="k-tabs" aria-label="Sections">
      {sectionTabs.map((tab) => (
        <Link key={tab.id} href={tab.href} className="k-tab" aria-current={active === tab.id ? "page" : undefined}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

export function SectionTabs() {
  const pathname = usePathname();
  const params = useSearchParams();
  return <SectionTabLinks active={activeSection(pathname, { view: params.get("view"), status: params.get("status"), q: params.get("q") })} />;
}
