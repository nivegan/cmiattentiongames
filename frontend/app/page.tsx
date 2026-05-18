import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarTrigger,
} from "@/components/ui/menubar";
import Link from "next/link";

const HomePage = () => {
  return (
    <div>
      <Menubar>
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
          </MenubarContent>
        </MenubarMenu>
      </Menubar>
    </div>
  );
};

export default HomePage;
