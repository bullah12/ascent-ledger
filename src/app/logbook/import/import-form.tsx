"use client";

import { useActionState } from "react";
import Link from "next/link";
import { importLogbookCsv, type CsvImportState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: CsvImportState = {};

export function ImportForm() {
  const [state, formAction, pending] = useActionState(
    importLogbookCsv,
    initialState
  );
  const result = state.result;

  return (
    <div className="grid gap-6">
      <form action={formAction} className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="file">CSV file</Label>
          <Input id="file" name="file" type="file" accept=".csv,text/csv" required />
          {state.fileError && (
            <p className="text-sm text-destructive" role="alert">
              {state.fileError}
            </p>
          )}
        </div>
        <div className="flex gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Importing…" : "Import"}
          </Button>
          <Button variant="ghost" render={<Link href="/logbook" />}>
            Back to logbook
          </Button>
        </div>
      </form>

      {result && (
        <div className="rounded-lg border p-4">
          <p className="font-medium">
            Imported {result.imported} of {result.totalDataLines} row
            {result.totalDataLines === 1 ? "" : "s"}.
          </p>
          {result.errors.length > 0 ? (
            <div className="mt-3">
              <p className="mb-2 text-sm text-destructive">
                {result.errors.length} row
                {result.errors.length === 1 ? " was" : "s were"} skipped — fix
                and re-import just those lines:
              </p>
              <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
                {result.errors.map((error) => (
                  <li key={error.line}>
                    <span className="font-mono text-muted-foreground">
                      line {error.line}:
                    </span>{" "}
                    {error.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            result.imported > 0 && (
              <p className="mt-1 text-sm text-muted-foreground">
                No errors —{" "}
                <Link href="/logbook" className="underline">
                  view your logbook
                </Link>
                .
              </p>
            )
          )}
        </div>
      )}
    </div>
  );
}
