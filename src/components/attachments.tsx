import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Image as ImageIcon, Paperclip, ShieldOff } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { listAttachmentsFn, redactAttachmentFn } from "@/lib/attachments.functions";
import { fmtDateTime } from "@/lib/format";

/** Bilagor till en post, eller till hushållet när ingen post anges. */
export function Attachments({
  householdId,
  reference,
  canRedact = true,
}: {
  householdId: string;
  reference?: string;
  canRedact?: boolean;
}) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [redacting, setRedacting] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const query = useQuery({
    queryKey: ["attachments", householdId],
    queryFn: () => listAttachmentsFn({ data: { householdId } }),
    enabled: Boolean(householdId),
  });

  const files = (query.data ?? []).filter((file) =>
    reference ? file.transactionReference === reference : true,
  );

  async function upload(file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("householdId", householdId);
      if (reference) form.set("reference", reference);

      const response = await fetch("/api/bilaga", { method: "POST", body: form });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Uppladdningen misslyckades.");
      }
      toast.success("Underlaget sparat");
      await queryClient.invalidateQueries({ queryKey: ["attachments", householdId] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Uppladdningen misslyckades.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const redact = useMutation({
    mutationFn: (attachmentId: string) => redactAttachmentFn({ data: { attachmentId, reason } }),
    onSuccess: () => {
      toast.success("Bilagan maskerad");
      setRedacting(null);
      setReason("");
      void queryClient.invalidateQueries({ queryKey: ["attachments", householdId] });
    },
    onError: (error: Error) => toast.error(error.message || "Kunde inte maskera bilagan."),
  });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="eyebrow mr-auto flex items-center gap-1.5">
          <Paperclip className="size-3.5" /> Underlag
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/heic,image/webp,application/pdf"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? "Laddar upp …" : "Lägg till underlag"}
        </Button>
      </div>

      {files.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Inget underlag ännu. Kvitto eller bankunderlag som bild eller PDF.
        </p>
      ) : (
        <ul className="grid gap-2">
          {files.map((file) => (
            <li key={file.id} className="rounded-md border border-hairline p-3">
              <div className="flex flex-wrap items-center gap-2">
                {file.contentType === "application/pdf" ? (
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ImageIcon className="size-4 shrink-0 text-muted-foreground" />
                )}
                {file.redactedAt ? (
                  <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <ShieldOff className="size-3.5" />
                    {file.filename} · maskerad {fmtDateTime(file.redactedAt)}
                  </span>
                ) : (
                  <a
                    href={`/api/bilaga/${file.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm underline underline-offset-2"
                  >
                    {file.filename}
                  </a>
                )}
                <span className="tabular ml-auto text-xs text-muted-foreground">
                  {Math.max(1, Math.round(file.byteSize / 1024))} kB
                </span>
                {canRedact && !file.redactedAt && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs"
                    onClick={() => setRedacting(file.id)}
                  >
                    Maskera
                  </Button>
                )}
              </div>
              <p className="tabular mt-1 text-xs text-muted-foreground">
                {file.transactionReference ? `${file.transactionReference} · ` : ""}
                {fmtDateTime(file.uploadedAt)} · sha256 {file.sha256.slice(0, 12)}…
              </p>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={redacting !== null} onOpenChange={(open) => !open && setRedacting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-serif">Maskera bilagan</DialogTitle>
            <DialogDescription className="text-left">
              Filen tas bort, men raden ligger kvar med hash, storlek, uppladdare och tidpunkt.
              Aktivitetsloggens kedja förblir obruten och det syns att något har tagits bort.
              Åtgärden går inte att ångra.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Varför ska bilagan tas bort?"
            autoFocus
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRedacting(null)}>
              Avbryt
            </Button>
            <Button
              variant="destructive"
              disabled={reason.trim().length < 3 || redact.isPending}
              onClick={() => redacting && redact.mutate(redacting)}
            >
              Maskera
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
