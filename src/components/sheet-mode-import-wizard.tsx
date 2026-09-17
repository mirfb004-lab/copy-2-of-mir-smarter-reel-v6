import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type ParsedImportFile = { fileName: string; matrix: string[][] };

type PreviewRow = { caption: string; video_url: string };

function columnLabel(index: number) {
  let label = "";
  let n = index;
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `Column ${label}`;
}

export async function parseImportFile(file: File): Promise<ParsedImportFile> {
  const buffer = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/sheet-mode-import.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ ok: true; fileName: string; matrix: string[][] } | { ok: false; error: string }>) => {
      worker.terminate();
      if (event.data.ok) resolve({ fileName: event.data.fileName, matrix: event.data.matrix });
      else reject(new Error(event.data.error));
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error("Could not parse import file"));
    };
    worker.postMessage({ fileName: file.name, buffer }, [buffer]);
  });
}

export function SheetModeImportWizard({
  parsed,
  onCancel,
  onConfirm,
}: {
  parsed: ParsedImportFile;
  onCancel: () => void;
  onConfirm: (rows: PreviewRow[]) => Promise<unknown>;
}) {
  const [step, setStep] = useState<"headers" | "columns" | "preview">("headers");
  const [hasHeaders, setHasHeaders] = useState<"yes" | "no">("yes");
  const [captionCol, setCaptionCol] = useState<string>("");
  const [urlCol, setUrlCol] = useState<string>("");
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const width = useMemo(
    () => Math.max(0, ...parsed.matrix.map((row) => row.length)),
    [parsed.matrix],
  );
  const columns = useMemo(() => {
    const first = parsed.matrix[0] ?? [];
    return Array.from({ length: width }, (_, index) =>
      hasHeaders === "yes" ? String(first[index] ?? "").trim() || columnLabel(index) : columnLabel(index),
    );
  }, [parsed.matrix, width, hasHeaders]);
  const dataRows = useMemo(
    () => (hasHeaders === "yes" ? parsed.matrix.slice(1) : parsed.matrix),
    [parsed.matrix, hasHeaders],
  );

  const buildPreview = () => {
    const ci = Number(captionCol);
    const ui = Number(urlCol);
    const next = dataRows
      .map((row) => ({ caption: String(row[ci] ?? "").trim(), video_url: String(row[ui] ?? "").trim() }))
      .filter((row) => row.caption || row.video_url);
    if (!next.length) {
      toast.error("No rows found with the selected columns");
      return;
    }
    setRows(next);
    setStep("preview");
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        {step === "headers" && (
          <>
            <DialogHeader>
              <DialogTitle>Does this file have column headers?</DialogTitle>
              <DialogDescription>
                {parsed.fileName} · {parsed.matrix.length} rows detected · {width} columns
              </DialogDescription>
            </DialogHeader>
            <RadioGroup value={hasHeaders} onValueChange={(v) => setHasHeaders(v as "yes" | "no")} className="gap-3">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="yes" id="hdr-yes" />
                <Label htmlFor="hdr-yes">Yes, first row contains column headers</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="no" id="hdr-no" />
                <Label htmlFor="hdr-no">No, first row contains data</Label>
              </div>
            </RadioGroup>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onCancel}>Cancel</Button>
              <Button
                onClick={() => {
                  setCaptionCol("");
                  setUrlCol("");
                  setStep("columns");
                }}
              >
                Next
              </Button>
            </div>
          </>
        )}

        {step === "columns" && (
          <>
            <DialogHeader>
              <DialogTitle>Which columns should be used?</DialogTitle>
              <DialogDescription>Detected columns: {columns.join(", ") || "none"}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Which column contains captions?</Label>
                <Select value={captionCol} onValueChange={setCaptionCol}>
                  <SelectTrigger><SelectValue placeholder="Select column" /></SelectTrigger>
                  <SelectContent>
                    {columns.map((name, index) => (
                      <SelectItem key={index} value={String(index)}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Which column contains video URLs?</Label>
                <Select value={urlCol} onValueChange={setUrlCol}>
                  <SelectTrigger><SelectValue placeholder="Select column" /></SelectTrigger>
                  <SelectContent>
                    {columns.map((name, index) => (
                      <SelectItem key={index} value={String(index)}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onCancel}>Cancel</Button>
              <Button variant="outline" onClick={() => setStep("headers")}>Back</Button>
              <Button disabled={captionCol === "" || urlCol === ""} onClick={buildPreview}>Preview</Button>
            </div>
          </>
        )}

        {step === "preview" && (
          <>
            <DialogHeader>
              <DialogTitle>Import preview</DialogTitle>
              <DialogDescription>
                File: {parsed.fileName} · Rows detected: {rows.length} · Caption column:{" "}
                {columns[Number(captionCol)]} · URL column: {columns[Number(urlCol)]}
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[45vh] overflow-y-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="w-10 px-2 py-2 text-left">#</th>
                    <th className="px-2 py-2 text-left">Caption</th>
                    <th className="px-2 py-2 text-left">Video URL</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={index} className="border-t align-top">
                      <td className="px-2 py-2 text-muted-foreground">{index + 1}</td>
                      <td className="px-2 py-1">
                        <Textarea
                          className="min-h-[38px]"
                          value={row.caption}
                          onChange={(e) =>
                            setRows((current) =>
                              current.map((item, i) => (i === index ? { ...item, caption: e.target.value } : item)),
                            )
                          }
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          value={row.video_url}
                          onChange={(e) =>
                            setRows((current) =>
                              current.map((item, i) => (i === index ? { ...item, video_url: e.target.value } : item)),
                            )
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onCancel} disabled={submitting}>Cancel</Button>
              <Button variant="outline" onClick={() => setStep("columns")} disabled={submitting}>Back</Button>
              <Button
                disabled={submitting}
                onClick={() => {
                  setSubmitting(true);
                  void onConfirm(rows).finally(() => setSubmitting(false));
                }}
              >
                Confirm Import
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
