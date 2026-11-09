"use client";

import { useEffect, useState, type ReactNode } from "react";
import { watchLandingScroll } from "../lib/landing-scroll";

export function LandingHeader({ children }: { children: ReactNode }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => watchLandingScroll(window, setScrolled), []);
  return (
    <header className="landing-header" data-scrolled={scrolled}>
      <div className="landing-header-inner">{children}</div>
    </header>
  );
}
