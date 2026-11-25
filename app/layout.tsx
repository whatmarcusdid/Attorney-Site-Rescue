import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PRODUCT_NAME } from "@/lib/identity";
import "./globals.css";

export const metadata: Metadata = {
  title: PRODUCT_NAME,
  description: "Placeholder page. The audit product is not available here yet.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
