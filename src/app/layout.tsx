import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { RoleProvider } from "@/components/RoleContext";
import "./globals.css";
import "./landing-refresh.css";

export const metadata: Metadata = {
  title: "FinProof Agent",
  description: "AI 기반 금융 광고 심의 플랫폼"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>
        <RoleProvider>
          <Suspense fallback={null}>
            <AppShell>{children}</AppShell>
          </Suspense>
        </RoleProvider>
      </body>
    </html>
  );
}
