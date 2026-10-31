import { LeashApp } from "@/components/leash-app";
export default function Page() {
  return (
    <LeashApp
      live={process.env.NEAR_LIVE === "1"}
      nebius={Boolean(process.env.NEBIUS_API_KEY?.trim())}
    />
  );
}
// Resolve mode badges at request time, not at build time.
export const dynamic = "force-dynamic";

