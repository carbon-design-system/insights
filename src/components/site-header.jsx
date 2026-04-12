"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Header,
  HeaderName,
  HeaderNavigation,
  HeaderMenuItem,
} from "@carbon/react";

const navigationItems = [
  {
    href: "/issue-viewer",
    label: "Issue viewer",
  },
];

function isCurrentPath(pathname, href) {
  return pathname === href || pathname.endsWith(`${href}/`) || pathname.endsWith(href);
}

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <Header aria-label="Carbon Insights">
      <HeaderName as={Link} href="/" prefix="Carbon">
        Insights
      </HeaderName>
      <HeaderNavigation aria-label="Carbon Insights sections">
        {navigationItems.map((item) => (
          <HeaderMenuItem
            key={item.href}
            as={Link}
            href={item.href}
            isCurrentPage={isCurrentPath(pathname, item.href)}
          >
            {item.label}
          </HeaderMenuItem>
        ))}
      </HeaderNavigation>
    </Header>
  );
}
