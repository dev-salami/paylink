import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LandingHeader } from "../components/landing-header";
import { watchLandingScroll } from "./landing-scroll";

describe("landing header frosted scroll state", () => {
  it("starts transparent in SSR and leaves children visible", () => {
    const html = renderToStaticMarkup(createElement(LandingHeader, null, "Navigation"));
    expect(html).toContain('data-scrolled="false"');
    expect(html).toContain("Navigation");
  });
  it("switches above 8px only, handles restored scroll, and removes its passive listener", () => {
    let listener: (() => void) | undefined;
    const view = {
      scrollY: 0,
      addEventListener: vi.fn((_event: string, callback: unknown) => { listener = callback as () => void; }),
      removeEventListener: vi.fn(),
    };
    const changed = vi.fn();
    const stop = watchLandingScroll(view, changed);
    expect(changed.mock.calls).toEqual([[false]]);
    expect(view.addEventListener).toHaveBeenCalledWith("scroll", expect.any(Function), { passive: true });
    view.scrollY = 8;
    listener?.();
    expect(changed).toHaveBeenCalledTimes(1);
    view.scrollY = 9;
    listener?.();
    view.scrollY = 300;
    listener?.();
    view.scrollY = 0;
    listener?.();
    expect(changed.mock.calls).toEqual([[false], [true], [false]]);
    stop();
    expect(view.removeEventListener).toHaveBeenCalledWith("scroll", listener);
    view.scrollY = 200;
    const restored = vi.fn();
    watchLandingScroll(view, restored)();
    expect(restored).toHaveBeenCalledWith(true);
  });
  it("keeps header geometry stable with frosted light/dark styles and WebKit support", () => {
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    expect(css).toContain("background: transparent; border-bottom: 1px solid transparent");
    expect(css).toContain("backdrop-filter: blur(14px) saturate(140%)");
    expect(css).toContain("-webkit-backdrop-filter: blur(14px) saturate(140%)");
    expect(css).toContain('.dark .landing-header[data-scrolled="true"]');
    expect(css).toContain("rgba(24, 28, 37, 0.72)");
    expect(css).toContain("z-index: 30");
  });
});
