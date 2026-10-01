"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ArrowUpRight, Menu, ShieldCheck, X } from "lucide-react";
import { Container } from "./Container";
export function Header() {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  return (
    <header className="site-header">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <Container className="header-inner">
        <Link
          className="brand"
          href="/"
          onClick={() => setOpen(false)}
          aria-label="AutoCheck QC home"
        >
          <span className="brand-mark">
            <ShieldCheck size={26} aria-hidden="true" />
          </span>
          <span>
            <strong>
              AutoCheck <b>QC</b>
            </strong>
            <small>Know more. Buy better.</small>
          </span>
        </Link>
        <nav
          id="primary-nav"
          className={`nav ${open ? "open" : ""}`}
          aria-label="Primary navigation"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              document.getElementById("menu-toggle")?.focus();
            }
          }}
        >
          {[
            ["/example-report", "Example Report"],
            ["/pricing", "Pricing"],
            ["/faq", "FAQ"],
            ["/contact", "Contact"],
          ].map(([href, label]) => (
            <Link
              key={href}
              href={href}
              aria-current={path === href ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="header-actions">
          <Link
            className="button button-primary"
            href="/check"
            onClick={() => setOpen(false)}
          >
            Check This Car
            <ArrowUpRight size={17} aria-hidden="true" />
          </Link>
          <button
            id="menu-toggle"
            className="icon-button menu-toggle"
            aria-controls="primary-nav"
            aria-expanded={open}
            aria-label={open ? "Close navigation" : "Open navigation"}
            title={open ? "Close navigation" : "Open navigation"}
            onClick={() => setOpen(!open)}
          >
            {open ? <X /> : <Menu />}
          </button>
        </div>
      </Container>
    </header>
  );
}
