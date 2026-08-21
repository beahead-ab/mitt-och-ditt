/**
 * Nedladdning i webbläsaren. Objektadressen släpps direkt efteråt – annars
 * ligger filen kvar i minnet så länge fliken är öppen.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function downloadText(text: string, filename: string, type: string): void {
  downloadBlob(new Blob([text], { type: `${type};charset=utf-8` }), filename);
}
