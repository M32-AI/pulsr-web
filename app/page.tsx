import downloadsData from "@/data/downloads.json";

const { version, downloads } = downloadsData;

const platforms = [
  {
    key: "macos",
    label: "Download for macOS",
    arch: downloads.macos.arch,
    url: downloads.macos.url,
    primary: true,
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="w-4 h-4 shrink-0"
      >
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
      </svg>
    ),
  },
  {
    key: "windows",
    label: "Download for Windows",
    arch: downloads.windows.arch,
    url: downloads.windows.url,
    primary: false,
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="w-4 h-4 shrink-0"
      >
        <path d="M3 12V6.75l6-1.32v6.57H3zm17 0V5l-9 1.98V12h9zm-17 1h6v6.57L3 18.19V13zm17 0h-9v5.02L20 20V13z" />
      </svg>
    ),
  },
  // {
  //   key: "linux",
  //   label: "Download for Linux",
  //   arch: downloads.linux.arch,
  //   url: downloads.linux.url,
  //   primary: false,
  //   icon: (
  //     <svg
  //       xmlns="http://www.w3.org/2000/svg"
  //       viewBox="0 0 24 24"
  //       fill="currentColor"
  //       className="w-4 h-4 shrink-0"
  //     >
  //       <path d="M12 2a5 5 0 0 1 5 5c0 1.86-.97 3.52-2.44 4.47.23.36.44.74.44 1.53v3c0 1.1-.9 2-2 2h-2c-1.1 0-2-.9-2-2v-3c0-.79.21-1.17.44-1.53A5 5 0 0 1 12 2m0 2a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3m-1 8v3h2v-3h-2m-4 6c0-1.1.9-2 2-2h6c1.1 0 2 .9 2 2v1H7v-1z" />
  //     </svg>
  //   ),
  // },
];

export default function Home() {
  return (
    <div className="relative min-h-screen bg-black flex items-center justify-center overflow-hidden">
      {/* Dashed grid lines */}
      <div
        className="absolute inset-x-0 pointer-events-none"
        style={{
          top: "26%",
          borderTop: "1px dashed rgba(255,255,255,0.1)",
        }}
      />
      <div
        className="absolute inset-x-0 pointer-events-none"
        style={{
          top: "74%",
          borderTop: "1px dashed rgba(255,255,255,0.1)",
        }}
      />
      <div
        className="absolute inset-y-0 pointer-events-none"
        style={{
          left: "37%",
          borderLeft: "1px dashed rgba(255,255,255,0.1)",
        }}
      />
      <div
        className="absolute inset-y-0 pointer-events-none"
        style={{
          left: "63%",
          borderLeft: "1px dashed rgba(255,255,255,0.1)",
        }}
      />

      {/* Decorative circles at grid intersections */}
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

      {/* Main content */}
      <main className="relative z-10 flex flex-col items-center text-center px-6 max-w-4xl mx-auto py-24">
        <p className="text-xs font-mono text-zinc-500 tracking-widest uppercase mb-8">
          pulsr
        </p>

        <h1 className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-black text-white tracking-tight leading-[1.02] mb-8">
          AI-powered time tracking, on autopilot.
        </h1>

        <p className="text-base sm:text-lg text-zinc-400 max-w-xl mb-12 leading-relaxed">
          Pulsr captures and analyzes your screen activity using{" "}
          <strong className="text-zinc-100 font-semibold">
            AI vision
          </strong>{" "}
          — so you always know where your time went, without lifting a finger.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 items-center">
          {platforms.map((platform) => (
            <a
              key={platform.key}
              href={platform.url}
              className={`
                flex flex-col items-center justify-center gap-0.5
                h-16 w-52 rounded-xl text-sm font-medium
                transition-all duration-150
                ${
                  platform.primary
                    ? "bg-white text-black hover:bg-zinc-100 active:scale-[0.98]"
                    : "border border-zinc-700 text-white hover:border-zinc-500 hover:bg-zinc-900 active:scale-[0.98]"
                }
              `}
            >
              <span className="flex items-center gap-2">
                {platform.icon}
                {platform.label}
              </span>
              <span
                className={`text-xs ${
                  platform.primary ? "text-zinc-500" : "text-zinc-600"
                }`}
              >
                {platform.arch}
              </span>
            </a>
          ))}
        </div>

        <p className="mt-10 text-xs text-zinc-700 font-mono tracking-wide">
          v{version} &mdash; out now
        </p>
      </main>
    </div>
  );
}
