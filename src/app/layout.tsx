import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { RoleProvider } from "@/components/RoleContext";
import "./globals.css";
import "./landing-refresh.css";

export const metadata: Metadata = {
  title: "FinProof Agent",
  description: "검토는 빠르게, 판단은 정확하게. Review Faster. Decide Smarter."
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
