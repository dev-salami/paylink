export function QrCard({
  src,
  title = "Solana Pay",
  caption,
}: {
  src: string | null;
  title?: string;
  caption: string;
}) {
  if (!src) {
    return <p className="t-small text-muted">Issue this invoice to create a pay link.</p>;
  }
  return (
    <figure className="qr-card">
      <div className="qr-frame">
        <span className="qr-corner tl" />
        <span className="qr-corner tr" />
        <span className="qr-corner bl" />
        <span className="qr-corner br" />
        <img src={src} alt="Solana Pay QR code" />
      </div>
      <figcaption className="text-center">
        <p className="t-micro text-accent">{title}</p>
        <p className="t-small mt-1 text-muted">{caption}</p>
      </figcaption>
    </figure>
  );
}
