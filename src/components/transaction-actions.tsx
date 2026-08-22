import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
import { availableActions, can, type ActionKey } from "@/lib/actions";
import type { Transaction } from "@/lib/engine";
import {
  decideTransaction,
  deleteDraftTransaction,
  submitTransaction,
  voidTransactionFn,
  withdrawTransaction,
} from "@/lib/transactions.functions";

type Props = {
  householdId: string;
  transaction: Transaction;
  myPartyId: string;
  registeredByPartyId: string;
  iHaveDecided: boolean;
  isVoided?: boolean;
  isSuperseded?: boolean;
  onCorrect?: (reference: string) => void;
  /**
   * "kompakt" är raden med små knappar som passar i en lista.
   * "beslut" är beslutsvyn: primärvalet ensamt på egen rad och stort nog att
   * träffa med tummen, de sekundära sida vid sida under. Spärrarnas skäl blir
   * en mening efter knapparna i stället för en grå punktlista under avstängda
   * knappar - listan lästes som fel man gjort, inte som villkor.
   */
  layout?: "kompakt" | "beslut";
};

/**
 * Åtgärderna för en post. Otillgängliga åtgärder döljs inte utan visas med sitt
 * skäl, så att det syns varför något inte går.
 */
export function TransactionActions({
  householdId,
  transaction,
  myPartyId,
  registeredByPartyId,
  iHaveDecided,
  isVoided,
  isSuperseded,
  onCorrect,
  layout = "kompakt",
}: Props) {
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState<"object" | "void" | null>(null);
  const [note, setNote] = useState("");

  const actions = availableActions({
    transaction,
    myPartyId,
    registeredByPartyId,
    iHaveDecided,
    isVoided,
    isSuperseded,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["household"] });

  const run = useMutation({
    mutationFn: async (key: ActionKey) => {
      const data = { householdId, reference: transaction.id };
      switch (key) {
        case "approve":
          return decideTransaction({ data: { ...data, decision: "approved" } });
        case "object":
          return decideTransaction({ data: { ...data, decision: "objected", note } });
        case "withdraw":
          return withdrawTransaction({ data });
        case "submit":
          return submitTransaction({ data });
        case "deleteDraft":
          return deleteDraftTransaction({ data });
        case "void":
          return voidTransactionFn({ data: { ...data, reason: note } });
        default:
          throw new Error("Åtgärden hanteras inte här.");
      }
    },
    onSuccess: (_result, key) => {
      const messages: Partial<Record<ActionKey, string>> = {
        approve: "Posten godkänd",
        object: "Invändningen registrerad",
        withdraw: "Posten tillbakadragen",
        submit: "Posten skickad för godkännande",
        deleteDraft: "Utkastet raderat",
        void: "Makuleringen väntar på motpartens godkännande",
      };
      toast.success(messages[key] ?? "Klart");
      setPrompt(null);
      setNote("");
      void refresh();
    },
    onError: (error: Error) => toast.error(error.message || "Åtgärden kunde inte genomföras."),
  });

  function activate(key: ActionKey) {
    if (key === "correct") {
      onCorrect?.(transaction.id);
      return;
    }
    // Invändning och makulering kräver en motivering.
    if (key === "object" || key === "void") {
      setPrompt(key);
      return;
    }
    run.mutate(key);
  }

  const spärrade = actions.filter((item) => item.disabledReason);

  if (layout === "beslut") {
    const primär = actions.find((item) => item.key === "approve");
    const sekundära = actions.filter((item) => item.key !== "approve");
    return (
      <>
        <div className="grid gap-2">
          {primär && (
            <Button
              className="h-12 w-full sm:h-11"
              disabled={Boolean(primär.disabledReason) || run.isPending}
              onClick={() => activate(primär.key)}
            >
              {primär.label}
            </Button>
          )}
          {sekundära.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {sekundära.map((item) => (
                <Button
                  key={item.key}
                  variant="outline"
                  className="h-12 flex-1 sm:h-11"
                  disabled={Boolean(item.disabledReason) || run.isPending}
                  onClick={() => activate(item.key)}
                >
                  {item.label}
                </Button>
              ))}
            </div>
          )}
        </div>
        {spärrade.length > 0 && (
          <p className="mt-2 text-sm text-muted-foreground">
            {spärrade.map((item) => item.disabledReason).join(" ")}
          </p>
        )}
        <Prompts
          prompt={prompt}
          note={note}
          setNote={setNote}
          setPrompt={setPrompt}
          run={run}
          transaction={transaction}
        />
      </>
    );
  }

  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {actions.map((item) => (
          <Button
            key={item.key}
            size="sm"
            variant={item.key === "approve" ? "default" : "outline"}
            disabled={Boolean(item.disabledReason) || run.isPending}
            title={item.disabledReason}
            onClick={() => activate(item.key)}
          >
            {item.label}
          </Button>
        ))}
      </div>
      {spärrade.length > 0 && (
        <ul className="mt-2 grid gap-0.5">
          {spärrade.map((item) => (
            <li key={item.key} className="text-xs text-muted-foreground">
              {item.label}: {item.disabledReason}
            </li>
          ))}
        </ul>
      )}

      <Prompts
        prompt={prompt}
        note={note}
        setNote={setNote}
        setPrompt={setPrompt}
        run={run}
        transaction={transaction}
      />
    </>
  );
}

/**
 * Motiveringen bakom en invändning eller en makulering.
 *
 * Utbruten eftersom båda knapplägena behöver exakt samma dialog - en kopia
 * skulle förr eller senare säga något annat än den andra.
 */
function Prompts({
  prompt,
  note,
  setNote,
  setPrompt,
  run,
  transaction,
}: {
  prompt: "object" | "void" | null;
  note: string;
  setNote: (value: string) => void;
  setPrompt: (value: "object" | "void" | null) => void;
  run: { isPending: boolean; mutate: (key: ActionKey) => void };
  transaction: Transaction;
}) {
  return (
    <Dialog open={prompt !== null} onOpenChange={(open) => !open && setPrompt(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-serif">
            {prompt === "object" ? "Invänd mot posten" : `Makulera ${transaction.id}`}
          </DialogTitle>
          <DialogDescription className="text-left">
            {prompt === "object"
              ? "Posten står utanför beräkningen tills ni löst frågan med en korrigering."
              : "Posten raderas aldrig. En länkad makuleringspost tar den ur beräkningen när båda parter godkänt den."}
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={prompt === "object" ? "Vad är fel?" : "Varför ska posten makuleras?"}
          autoFocus
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => setPrompt(null)}>
            Avbryt
          </Button>
          <Button
            disabled={note.trim().length < 3 || run.isPending}
            onClick={() => prompt && run.mutate(prompt)}
          >
            {prompt === "object" ? "Invänd" : "Begär makulering"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { can };
