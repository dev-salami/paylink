/** Notify only when crossing the threshold; passive listener with full cleanup. */
export function watchLandingScroll(view: Pick<Window, "scrollY" | "addEventListener" | "removeEventListener">, onChange: (scrolled: boolean) => void) {
  let previous: boolean | undefined;
  const update = () => {
    const scrolled = view.scrollY > 8;
    if (scrolled !== previous) { previous = scrolled; onChange(scrolled); }
  };
  update();
  view.addEventListener("scroll", update, { passive: true });
  return () => view.removeEventListener("scroll", update);
}
