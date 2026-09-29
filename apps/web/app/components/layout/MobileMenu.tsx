"use client";

import Link from "next/link";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import NavLinks from "./NavLinks";
import { useAuthStore } from "../../store/auth.store";
import logo from "../../assets/images/logo.webp";

export default function MobileMenu({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const token = useAuthStore((state) => state?.token ?? null);
  const logout = useAuthStore((state) => state?.logout);
  const isLoggedIn = !!token;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          />

          {/* Drawer */}
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{
              duration: 0.35,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="fixed right-0 top-0 z-50 flex h-screen w-[320px] max-w-[85vw] flex-col border-l border-[#E7DFF5] bg-white/98 backdrop-blur-xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[#E7DFF5] px-6 py-5">
              <Image src={logo} alt="PurpleCallio" width={156} height={38} className="h-auto w-[136px] object-contain" />

              <button
                onClick={onClose}
                aria-label="Close menu"
                className="rounded-lg p-2 text-[#3D3650] transition hover:bg-[#7F40E8]/5 hover:text-[#170B2E]"
              >
                <X size={22} />
              </button>
            </div>

            {/* Navigation */}
            <div className="flex-1 px-6 py-8">
              <nav className="flex flex-col gap-2">
                <NavLinks mobile onClick={onClose} />
              </nav>
            </div>

            {/* Footer Actions */}
            <div className="border-t border-[#E7DFF5] p-6">
              <div className="flex flex-col gap-3">
                {isLoggedIn ? (
                  <Link
                    href="/dashboard"
                    onClick={onClose}
                    className="btn-primary rounded-lg py-3 text-center text-sm font-medium text-white transition hover:opacity-90"
                  >
                    Dashboard
                  </Link>
                ) : null}

                {isLoggedIn ? (
                  <button
                    onClick={() => {
                      onClose();
                      logout?.();
                      window.location.href = "/";
                    }}
                    className="rounded-lg border border-[#E7DFF5] py-3 text-center text-sm text-[#3D3650] transition hover:border-[#D6C4EE] hover:text-[#170B2E]"
                  >
                    Logout
                  </button>
                ) : (
                  <Link
                    href="/login"
                    onClick={onClose}
                    className="btn-primary rounded-lg py-3 text-center text-sm font-medium text-white transition hover:opacity-90"
                  >
                    Get Started
                  </Link>
                )}
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
