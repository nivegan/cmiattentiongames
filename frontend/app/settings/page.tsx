"use client";

import { useAuth } from "@clerk/nextjs";
import { SignInButton } from "@clerk/nextjs";
import Link from "next/link";

const SettingsPage = () => {
  const { isSignedIn, isLoaded } = useAuth();

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-[#FAF6F0] font-mono flex items-center justify-center">
        <p className="text-[#232323]">Loading...</p>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="min-h-screen bg-[#FAF6F0] font-mono flex flex-col items-center justify-center p-8">
        <div className="border-2 border-[#232323] shadow-[4px_4px_0px_#232323] p-8 max-w-md w-full bg-white text-center">
          <h2 className="text-xl font-bold text-[#232323] mb-4 tracking-widest uppercase">
            Settings
          </h2>
          <p className="text-[#232323] mb-6 leading-relaxed text-sm">
            Create an account to access settings and save your data permanently.
          </p>
          <div className="flex gap-3 justify-center">
            <SignInButton mode="modal">
              <button className="bg-[#8B2626] text-white px-6 py-2 shadow-[4px_4px_0px_#232323] border-2 border-[#232323] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_#232323] transition-all font-mono uppercase tracking-wider text-sm cursor-pointer">
                Create Account
              </button>
            </SignInButton>
            <Link
              href="/"
              className="bg-white text-[#232323] px-6 py-2 shadow-[4px_4px_0px_#232323] border-2 border-[#232323] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_#232323] transition-all font-mono uppercase tracking-wider text-sm"
            >
              Back
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAF6F0] font-mono p-8">
      <h1 className="text-2xl font-bold text-[#232323] mb-6 tracking-widest uppercase border-b-2 border-[#232323] pb-2">
        Settings
      </h1>
      <p className="text-[#232323] opacity-60 text-sm">Settings coming soon.</p>
    </div>
  );
};

export default SettingsPage;
