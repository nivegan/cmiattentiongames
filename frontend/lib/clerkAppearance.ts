// clerkAppearance.ts
// Shared Clerk `appearance` object that themes the sign-in/sign-up modals and the
// UserButton dropdown to the app's retro "cream paper" aesthetic (see the design
// tokens in CLAUDE.md): cream #FAF6F0 surfaces, maroon #8B2626 primary buttons,
// #232323 mono text, sharp corners, and hard 4px offset drop shadows.
//
// WHY A SHARED OBJECT (not a global ClerkProvider appearance)?
//   The global appearance would go on <ClerkProvider> in app/layout.tsx, which is
//   off-limits. Clerk supports per-component `appearance`, and for
//   <SignInButton mode="modal"> the appearance forwards to the modal it opens.
//   So every Clerk UI call site imports this object instead.
//
// FONT NOTE: the modal renders in a portal outside any `font-mono` wrapper, so
// the mono font is set explicitly via the --font-geist-mono CSS variable (defined
// on <html> in app/layout.tsx, therefore available inside portals too).

const clerkAppearance = {
  variables: {
    colorPrimary: "#8B2626",
    colorText: "#232323",
    colorBackground: "#FAF6F0",
    colorInputBackground: "#FAF6F0",
    colorInputText: "#232323",
    colorTextOnPrimaryBackground: "#FAF6F0",
    colorNeutral: "#232323",
    borderRadius: "0",
    fontFamily: "var(--font-geist-mono), monospace",
    fontFamilyButtons: "var(--font-geist-mono), monospace",
  },
  elements: {
    // ── Modal shell ────────────────────────────────────────────────────────
    card: "bg-[#FAF6F0] border-2 border-[#232323] shadow-[4px_4px_0px_#232323] rounded-none",
    headerTitle: "font-mono text-[#8B2626] uppercase tracking-wider",
    headerSubtitle: "font-mono text-[#232323]/70",

    // ── Form fields ────────────────────────────────────────────────────────
    formFieldLabel: "font-mono text-[#232323] uppercase tracking-wide text-xs",
    formFieldInput:
      "rounded-none border-2 border-[#232323] bg-[#FAF6F0] text-[#232323] font-mono focus:ring-0 focus:border-[#8B2626]",
    otpCodeFieldInput:
      "rounded-none border-2 border-[#232323] bg-[#FAF6F0] text-[#232323] font-mono",

    // ── Primary action ─────────────────────────────────────────────────────
    formButtonPrimary:
      "rounded-none bg-[#8B2626] text-[#FAF6F0] font-mono uppercase tracking-wider shadow-[3px_3px_0px_#232323] hover:bg-[#732020] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all",

    // ── Social / OAuth buttons ─────────────────────────────────────────────
    socialButtonsBlockButton:
      "rounded-none border-2 border-[#232323] bg-[#FAF6F0] hover:bg-[#232323]/5 font-mono",
    socialButtonsBlockButtonText: "font-mono text-[#232323]",

    // ── Dividers & footer ──────────────────────────────────────────────────
    dividerLine: "bg-[#232323]/20",
    dividerText: "font-mono text-[#232323]/50 uppercase",
    footerActionText: "font-mono text-[#232323]/70",
    footerActionLink: "font-mono text-[#8B2626] hover:text-[#732020]",
    identityPreviewText: "font-mono text-[#232323]",
    identityPreviewEditButton: "text-[#8B2626]",

    // ── UserButton dropdown ────────────────────────────────────────────────
    userButtonPopoverCard:
      "rounded-none border-2 border-[#232323] bg-[#FAF6F0] shadow-[4px_4px_0px_#232323]",
    userButtonPopoverActionButton:
      "font-mono text-[#232323] rounded-none hover:bg-[#232323]/5",
    userButtonPopoverActionButtonText: "font-mono text-[#232323]",
    userButtonPopoverActionButtonIcon: "text-[#232323]",
  },
};

export { clerkAppearance };
