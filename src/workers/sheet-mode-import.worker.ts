import * as XLSX from "xlsx";

type ImportRequest = {
  fileName: string;
  buffer: ArrayBuffer;
};

type ImportResponse =
  | { ok: true; fileName: string; matrix: string[][] }
  | { ok: false; error: string };

self.onmessage = (event: MessageEvent<ImportRequest>) => {
  try {
    const workbook = XLSX.read(event.data.buffer, { type: "array" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error("The file does not contain a worksheet");
    const matrix = XLSX.utils
      .sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: "" })
      .map((row) => (row ?? []).map((cell) => String(cell ?? "").trim()));
    const response: ImportResponse = { ok: true, fileName: event.data.fileName, matrix };
    self.postMessage(response);
  } catch (error) {
    const response: ImportResponse = {
      ok: false,
      error: error instanceof Error ? error.message : "Could not parse import file",
    };
    self.postMessage(response);
  }
};
