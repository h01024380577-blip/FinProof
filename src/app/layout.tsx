import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { RoleProvider } from "@/components/RoleContext";
import "./globals.css";

export const metadata: Metadata = {
  title: "FinProof Agent",
  description: "Evidence-based financial advertising review workspace"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>
        <RoleProvider>
          <AppShell>{children}</AppShell>
        </RoleProvider>
      </body>
    </html>
  );
}
