import QRCode from "qrcode";

export async function qrDataUrl(value: string): Promise<string> {
  return QRCode.toDataURL(value, {
    margin: 1,
    width: 320,
    errorCorrectionLevel: "M",
    color: { dark: "#2a1248", light: "#ffffff" },
  });
}
