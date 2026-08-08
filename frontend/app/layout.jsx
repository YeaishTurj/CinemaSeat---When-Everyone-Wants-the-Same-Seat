import "./globals.css";

export const metadata = {
  title: "CinemaSeat",
  description: "When everyone wants the same seat.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
