"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function UnauthorizedPage() {
  const router = useRouter();

    useEffect(() => {
      const timer = setTimeout(async () => {
        // Optionally, clear any local/session storage/auth tokens here
        if (typeof window !== "undefined") {
          // Example: remove supabase tokens, could be customized as needed
          localStorage.clear();
        }
        router.replace("/login");
      }, 10000);

      return () => clearTimeout(timer);
    }, [router]);
  return (
    <div className="relative min-h-screen bg-black flex items-center justify-center overflow-hidden">
      {/* Dashed grid lines */}
      <div
        className="absolute inset-x-0 pointer-events-none"
        style={{ top: "26%", borderTop: "1px dashed rgba(255,255,255,0.1)" }}
      />
      <div
        className="absolute inset-x-0 pointer-events-none"
        style={{ top: "74%", borderTop: "1px dashed rgba(255,255,255,0.1)" }}
      />
      <div
        className="absolute inset-y-0 pointer-events-none"
        style={{ left: "37%", borderLeft: "1px dashed rgba(255,255,255,0.1)" }}
      />
      <div
        className="absolute inset-y-0 pointer-events-none"
        style={{ left: "63%", borderLeft: "1px dashed rgba(255,255,255,0.1)" }}
      />

      {[
        { top: "26%", left: "37%" },
        { top: "26%", left: "63%" },
        { top: "74%", left: "37%" },
        { top: "74%", left: "63%" },
      ].map((pos, i) => (
        <div
          key={i}
          className="absolute w-9 h-9 rounded-full border border-dashed pointer-events-none"
          style={{
            top: pos.top,
            left: pos.left,
            transform: "translate(-50%, -50%)",
            borderColor: "rgba(255,255,255,0.13)",
          }}
        />
      ))}

      <main className="relative z-10 flex flex-col items-center text-center px-6 max-w-2xl mx-auto">
        <p className="text-xs font-mono text-zinc-500 tracking-widest uppercase mb-8">
          pulsr
        </p>

        <h1 className="text-5xl sm:text-6xl font-black text-white tracking-tight leading-tight mb-6">
          Unauthorised.
        </h1>

        <p className="text-base text-zinc-400 max-w-sm mb-10 leading-relaxed">
          You don&apos;t have permission to view this page. Contact your administrator if you think this is a mistake.
        </p>

        <Link
          href="/download"
          className="flex items-center gap-2 h-11 px-6 rounded-xl bg-white text-black text-sm font-medium hover:bg-zinc-100 transition-all duration-150 active:scale-[0.98]"
        >
          Go to Download
        </Link>
      </main>
    </div>
  );
}
