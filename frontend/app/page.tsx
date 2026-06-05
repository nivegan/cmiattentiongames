// app/page.tsx
// The home page — currently just a top navigation bar.
// This is a Server Component (no "use client" directive), which means it renders
// on the server and sends HTML to the browser. Clerk's <Show> component reads
// the session server-side so the right auth buttons appear without a layout flash.

import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarTrigger,
} from "@/components/ui/menubar"; // shadcn/ui menu bar (auto-generated — do not edit)
import Link from "next/link"; // Next.js Link does client-side navigation (no full page reload)
import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";

const HomePage = () => {
  return (
    // Full-width flex row: nav links on the left, auth buttons on the right
    <div className="flex items-center justify-between w-full border-b px-4">

      {/* Left: History, Settings links + "Play" dropdown */}
      <Menubar className="border-none shadow-none">
        <MenubarMenu>
          {/* asChild tells the trigger to render as its child element (<Link>) instead of a <button> */}
          <MenubarTrigger asChild>
            <Link href="/history">History</Link>
          </MenubarTrigger>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger asChild>
            <Link href="/settings">Settings</Link>
          </MenubarTrigger>
        </MenubarMenu>

        <MenubarMenu>
          {/* "Play" is a dropdown — clicking it reveals links to all available game modes */}
          <MenubarTrigger>Play</MenubarTrigger>

          <MenubarContent>
            <MenubarItem asChild>
              <Link href="/play/gut_check">Gut Check</Link>
            </MenubarItem>

            <MenubarItem asChild>
              <Link href="/play/extract_facts">Extract Facts</Link>
            </MenubarItem>

            <MenubarItem asChild>
              <Link href="/play/steady_gaze">Steady Gaze</Link>
            </MenubarItem>

            <MenubarItem asChild>
              <Link href="/play/clear_the_air">Clear the Air</Link>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>

      {/* Right: Clerk auth UI — different elements shown depending on session state */}
      <div className="flex items-center">
        {/* <Show when="signed-out"> only renders its children when there is NO active session */}
        <Show when="signed-out">
          <Menubar className="border-none shadow-none">
            <MenubarMenu>
              {/* mode="modal" opens the Clerk sign-in overlay instead of navigating away from the page */}
              <SignInButton mode="modal">
                <MenubarTrigger className="cursor-pointer">
                  Sign In
                </MenubarTrigger>
              </SignInButton>
            </MenubarMenu>
            <MenubarMenu>
              <SignUpButton mode="modal">
                <MenubarTrigger className="cursor-pointer">
                  Sign Up
                </MenubarTrigger>
              </SignUpButton>
            </MenubarMenu>
          </Menubar>
        </Show>

        {/* <Show when="signed-in"> only renders its children when a session IS active */}
        <Show when="signed-in">
          {/* UserButton renders the Clerk user avatar with a dropdown for managing the account */}
          <div className="px-3 py-1 flex items-center justify-center">
            <UserButton />
          </div>
        </Show>
      </div>
    </div>
  );
};

export default HomePage;
