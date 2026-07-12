import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="space-y-3">
        <h1 className="text-4xl font-bold tracking-tight">Ascent Ledger</h1>
        <p className="max-w-md text-muted-foreground">
          Personal climbing logbook and BMG-standard progress tracker. Log
          climbs, track your progression toward the British Mountain Guide
          prerequisites, and find the routes that close the gap.
        </p>
      </div>
      <div className="flex gap-3">
        <Button render={<Link href="/sign-in" />}>Sign in</Button>
        <Button variant="outline" render={<Link href="/sign-up" />}>
          Sign up
        </Button>
      </div>
    </main>
  );
}
