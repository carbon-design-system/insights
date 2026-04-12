import "@/app/globals.scss";
import { AppShell } from "@/components/app-shell";

export const metadata = {
  title: "Carbon Insights",
  description:
    "Surfacing issues and metrics not available through GitHub's interface.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
