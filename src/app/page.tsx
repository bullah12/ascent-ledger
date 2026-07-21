import Link from "next/link";
import { ArrowRight, Check, Mountain, Route, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="grid min-h-screen bg-background lg:grid-cols-[1.05fr_.95fr]">
      <section className="flex flex-col p-6 sm:p-10 lg:p-14">
        <div className="flex items-center gap-3">
          <span aria-hidden className="size-[18px] rotate-45 rounded-[3px] bg-primary" />
          <span className="text-[18px] leading-[0.95] font-extrabold tracking-[-0.02em]">ASCENT<br /><span className="text-primary">LEDGER</span></span>
        </div>

        <div className="my-auto max-w-2xl py-16">
          <p className="instrument-label mb-5 text-primary">A climber&apos;s record · a guide&apos;s progression</p>
          <h1 className="text-5xl leading-[.98] font-extrabold tracking-[-0.04em] sm:text-6xl xl:text-7xl">Log the climb.<br /><span className="text-primary">Close the gap.</span></h1>
          <p className="mt-7 max-w-xl text-lg leading-8 text-muted-foreground">A focused climbing logbook that turns real days out into clear BMG prerequisite progress and routes worth doing next.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button size="lg" className="h-11 px-5" render={<Link href="/sign-up" />}>Start your logbook <ArrowRight /></Button>
            <Button size="lg" className="h-11 px-5" variant="outline" render={<Link href="/sign-in" />}>Sign in</Button>
          </div>
          <ul className="mt-9 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
            {["Private by default", "Real BMG rules", "Open route data"].map((item) => <li key={item} className="flex items-center gap-2"><Check className="size-4 text-primary" />{item}</li>)}
          </ul>
        </div>

        <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Built for rock · winter · alpine · ski · mountain days</p>
      </section>

      <section className="relative min-h-[46vh] overflow-hidden bg-[#1d3a2b] lg:min-h-screen">
        <div className="absolute inset-0 bg-[url('/og.png')] bg-cover bg-center" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#153224]/80 via-transparent to-transparent" />
        <div className="absolute inset-x-5 bottom-5 grid grid-cols-3 gap-2 sm:inset-x-8 sm:bottom-8 sm:gap-3">
          {[
            { icon: Mountain, label: "Log climbs" },
            { icon: TrendingUp, label: "Track progress" },
            { icon: Route, label: "Find the next" },
          ].map((item) => <div key={item.label} className="rounded-xl border border-white/20 bg-black/25 p-3 text-white backdrop-blur-md sm:p-4"><item.icon className="mb-2 size-4 text-[#9fd3b1]" /><p className="font-mono text-[9px] uppercase tracking-[0.05em] sm:text-[11px]">{item.label}</p></div>)}
        </div>
      </section>
    </main>
  );
}
