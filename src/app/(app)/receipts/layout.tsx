import { requirePerm } from "@/lib/auth";

// Доступ до розділу лише з правом «receipts» (див. ролі в src/lib/auth.ts)
export default async function Guard({ children }: { children: React.ReactNode }) {
  await requirePerm("receipts");
  return <>{children}</>;
}
