import { requirePerm } from "@/lib/auth";

// Доступ до розділу лише з правом «products.edit» (див. ролі в src/lib/auth.ts)
export default async function Guard({ children }: { children: React.ReactNode }) {
  await requirePerm("products.edit");
  return <>{children}</>;
}
