import { SiteHeader } from "@/components/site-header";

export function AppShell({ children }) {
  return (
    <>
      <SiteHeader />
      <main>{children}</main>
    </>
  );
}
