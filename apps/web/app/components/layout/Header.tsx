"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Image from "next/image";
import { ChevronDown, Menu } from "lucide-react";
import logo from "../../assets/images/logo.webp";
import NavLinks from "./NavLinks";
import MobileMenu from "./MobileMenu";
import { useAuthStore } from "../../store/auth.store";

export default function Header() {
  // Select fields independently so the marketing shell remains safe during
  // server prerendering before persisted browser state is available.
  const token = useAuthStore((state) => state?.token ?? null);
  const user = useAuthStore((state) => state?.user ?? null);
  const logout = useAuthStore((state) => state?.logout);
  const pathname = usePathname();
  const router = useRouter();

  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

const isLoggedIn = !!token;
  const displayName = user?.name || user?.email || 'Account';
  const avatarUrl = user?.avatarUrl || '';
// /call is a full-screen meeting page — hide the marketing nav there.
  const isCallPage = pathname?.startsWith("/call") ?? false;
  // Dashboard has its own app layout with a sidebar — hide the marketing nav.
  const isAppPage =
    pathname?.startsWith("/dashboard") ?? false;
  // Login/signup are auth pages — hide the marketing nav there too.
  const isAuthPage =
    pathname?.startsWith("/login") || pathname?.startsWith("/signup") || false;

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };

    handleScroll();

    window.addEventListener("scroll", handleScroll);

    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const closeProfileMenu = (event: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) setProfileOpen(false);
    };
    document.addEventListener("mousedown", closeProfileMenu);
    return () => document.removeEventListener("mousedown", closeProfileMenu);
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";

    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
      }
    };

    window.addEventListener("keydown", handleEsc);

    return () => window.removeEventListener("keydown", handleEsc);
  }, []);

if (isCallPage || isAppPage || isAuthPage) {
    return null;
  }

  return (
    <>
      <header
        className={`
          fixed
          top-0
          left-0
          right-0
          z-40
          transition-all
          duration-300
          ${
            scrolled
              ? "border-b border-[#E7DFF5] bg-white/85 backdrop-blur-xl shadow-sm"
              : "bg-transparent"
          }
        `}
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 lg:px-8">
          {/* Logo */}

          <Link href="/" className="flex items-center">
            <Image
              src={logo}
              alt="PurpleCallio"
              width={156}
              height={38}
              className="h-auto w-[132px] object-contain sm:w-[156px]"
            />
          </Link>

          {/* Desktop Navigation */}

          <nav className="hidden items-center gap-8 lg:flex">
            <NavLinks />
          </nav>

          {/* Desktop Actions */}

          <div className="hidden items-center gap-3 lg:flex">
{isLoggedIn ? (
              <div ref={profileMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setProfileOpen((open) => !open)}
                  aria-expanded={profileOpen}
                  aria-haspopup="menu"
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-[#3D3650] transition hover:bg-[#7F40E8]/5 hover:text-[#170B2E] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7F40E8]"
                >
                  {avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={avatarUrl}
                      alt={displayName}
                      className="w-7 h-7 rounded-full object-cover"
                    />
                  ) : (
                    <span
                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                      style={{ background: 'linear-gradient(135deg, #7F40E8, #410686)' }}
                    >
                      {(displayName || 'U')[0].toUpperCase()}
                    </span>
                  )}
                  <ChevronDown size={15} className={`transition ${profileOpen ? "rotate-180" : ""}`} aria-hidden="true" />
                </button>
                {profileOpen && <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-44 rounded-xl border border-[#E7DFF5] bg-white p-1.5 shadow-xl shadow-black/10">
                  <Link href="/dashboard" role="menuitem" onClick={() => setProfileOpen(false)} className="block rounded-lg px-3 py-2 text-sm text-[#3D3650] transition hover:bg-[#7F40E8]/5 hover:text-[#170B2E]">Dashboard</Link>
                  <button type="button" role="menuitem" onClick={() => { setProfileOpen(false); logout?.(); router.push("/"); }} className="w-full rounded-lg px-3 py-2 text-left text-sm text-[#3D3650] transition hover:bg-[#7F40E8]/5 hover:text-[#170B2E]">Log out</button>
                </div>}
              </div>
            ) : (
              <Link href="/login" className="btn-primary rounded-lg px-5 py-2 text-sm font-medium text-white transition hover:opacity-90">Get Started</Link>
            )}
          </div>

          {/* Mobile Hamburger */}

          <button
            onClick={() => setMenuOpen(true)}
            className="group flex h-11 w-11 items-center justify-center rounded-lg border border-[#E7DFF5] transition hover:border-[#D6C4EE] lg:hidden"
            aria-label="Open Menu"
          >
            <Menu
              size={22}
              className="text-[#3D3650] transition group-hover:text-[#170B2E]"
            />
          </button>
        </div>
      </header>

      <MobileMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
      />
    </>
  );
}
