import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarTrigger,
} from "@/components/ui/menubar";
import Link from "next/link";
import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";

const HomePage = () => {
  return (
    <div className="flex items-center justify-between w-full border-b px-4">
      {/* Left and Center Navigation Items */}
      <Menubar className="border-none shadow-none">
        <MenubarMenu>
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
          </MenubarContent>
        </MenubarMenu>
      </Menubar>

      {/* Right Aligned Clerk Auth State Elements */}
      <div className="flex items-center">
        {/* Rendered when the user is anonymous/not signed in */}
        <Show when="signed-out">
          <Menubar className="border-none shadow-none">
            <MenubarMenu>
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

        {/* Rendered when a valid authenticated user session is active */}
        <Show when="signed-in">
          <div className="px-3 py-1 flex items-center justify-center">
            <UserButton />
          </div>
        </Show>
      </div>
    </div>
  );
};

export default HomePage;
