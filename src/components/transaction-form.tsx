import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { categoryOptions } from "@/lib/actions";
import { kr, ruleFor, type CostCategoryRule, type PartyPayment } from "@/lib/engine";
import { today } from "@/lib/calculation";
import { saveTransaction } from "@/lib/transactions.functions";

type Party = { partyId: string; name: string };

type PartyFields = {
  gross: string;
  discount: string;
  refund: string;
  insurance: string;
  taxEffect: string;
  taxPreliminary: boolean;
};

const emptyFields = (): PartyFields => ({
  gross: "",
  discount: "",
  refund: "",
  insurance: "",
  taxEffect: "",
  taxPreliminary: false,
});

/** Tomt fält betyder noll. Kronor med decimaler skrivs som i banken. */
function toOre(value: string): number {
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  if (normalized === "") return 0;
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0 ? kr(number) : 0;
}

function toPayment(fields: PartyFields): PartyPayment | null {
  const payment: PartyPayment = {
    gross: toOre(fields.gross),
    discount: toOre(fields.discount),
    refund: toOre(fields.refund),
    insurance: toOre(fields.insurance),
    taxEffect: toOre(fields.taxEffect),
    taxPreliminary: fields.taxPreliminary,
  };
  const touched =
    payment.gross > 0 ||
    (payment.discount ?? 0) > 0 ||
    (payment.refund ?? 0) > 0 ||
    (payment.insurance ?? 0) > 0 ||
    (payment.taxEffect ?? 0) > 0;
  return touched ? payment : null;
}

/**
 * Registrering av en post. Den som registrerar bekräftar posten i samma steg –
 * det är hens godkännande. Motparten tar ställning separat, och först när båda
 * har godkänt påverkar posten andelarna.
 */
export function TransactionForm({
  householdId,
  parties,
  rules,
  correctsReference,
  onDone,
  disabled,
}: {
  householdId: string;
  parties: Party[];
  rules: CostCategoryRule[];
  /** Sätts när formuläret används för att korrigera en befintlig post. */
  correctsReference?: string;
  onDone?: () => void;
  /**
   * Visar formuläret men låter det inte skriva. Används i demoläget, där
   * ytan ska gå att se men ingenting kan sparas.
   */
  disabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const categories = categoryOptions(rules);

  const [paymentDate, setPaymentDate] = useState(today);
  const [category, setCategory] = useState(categories[0] ?? "");
  const [description, setDescription] = useState("");
  const [reason, setReason] = useState("");
  const [fields, setFields] = useState<Record<string, PartyFields>>(() =>
    Object.fromEntries(parties.map((p) => [p.partyId, emptyFields()])),
  );

  const rule = category ? ruleFor(rules, category, paymentDate) : null;

  const save = useMutation({
    mutationFn: (submit: boolean) => {
      const payments: Record<string, PartyPayment> = {};
      for (const party of parties) {
        const payment = toPayment(fields[party.partyId]);
        if (payment) payments[party.partyId] = payment;
      }
      if (Object.keys(payments).length === 0) {
        throw new Error("Fyll i vad som betalades och av vem.");
      }
      return saveTransaction({
        data: {
          householdId,
          paymentDate,
          category,
          description: description || undefined,
          payments,
          submit,
          correctsReference,
          reason: reason || undefined,
        },
      });
    },
    onSuccess: (result, submit) => {
      toast.success(
        submit
          ? `${result.reference} skickad för godkännande`
          : `${result.reference} sparad som utkast`,
      );
      void queryClient.invalidateQueries({ queryKey: ["household"] });
      setFields(Object.fromEntries(parties.map((p) => [p.partyId, emptyFields()])));
      setDescription("");
      setReason("");
      onDone?.();
    },
    onError: (error: Error) => toast.error(error.message || "Kunde inte spara posten."),
  });

  function update(partyId: string, key: keyof PartyFields, value: string | boolean) {
    setFields((current) => ({ ...current, [partyId]: { ...current[partyId], [key]: value } }));
  }

  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(true);
      }}
    >
      <section className="tile-surface grid gap-4 p-5 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="paymentDate">Betalningsdag</Label>
          <Input
            id="paymentDate"
            type="date"
            value={paymentDate}
            onChange={(e) => setPaymentDate(e.target.value)}
            required
          />
          <p className="text-xs text-muted-foreground">
            Dagen betalningen faktiskt belastade kontot.
          </p>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="category">Kostnadsslag</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger id="category">
              <SelectValue placeholder="Välj kostnadsslag" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {rule?.included
              ? "Ingår i enhetsmodellen. En överbetalning omvandlas till andelsenheter."
              : rule
                ? "Ligger utanför enhetsmodellen och delas 50/50 i kronor."
                : "Oklassificerat kostnadsslag hamnar utanför modellen tills båda godkänt det."}
          </p>
        </div>

        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="description">Beskrivning</Label>
          <Input
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Vad avsåg betalningen?"
          />
        </div>

        {correctsReference && (
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="reason">Skäl till korrigeringen</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              placeholder={`Varför ersätts ${correctsReference}?`}
            />
          </div>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {parties.map((party) => (
          <div key={party.partyId} className="tile-surface grid gap-3 p-5">
            <p className="eyebrow">{party.name}</p>
            <Money
              id={`${party.partyId}-gross`}
              label="Betalat brutto"
              value={fields[party.partyId].gross}
              onChange={(v) => update(party.partyId, "gross", v)}
            />
            <Money
              id={`${party.partyId}-discount`}
              label="Rabatt"
              value={fields[party.partyId].discount}
              onChange={(v) => update(party.partyId, "discount", v)}
            />
            <Money
              id={`${party.partyId}-refund`}
              label="Återbetalning"
              value={fields[party.partyId].refund}
              onChange={(v) => update(party.partyId, "refund", v)}
            />
            <Money
              id={`${party.partyId}-insurance`}
              label="Försäkringsersättning"
              value={fields[party.partyId].insurance}
              onChange={(v) => update(party.partyId, "insurance", v)}
            />
            <Money
              id={`${party.partyId}-tax`}
              label="Faktisk skatteeffekt"
              value={fields[party.partyId].taxEffect}
              onChange={(v) => update(party.partyId, "taxEffect", v)}
            />
            <label className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">Skatteeffekten är preliminär</span>
              <Switch
                checked={fields[party.partyId].taxPreliminary}
                onCheckedChange={(checked) =>
                  update(party.partyId, "taxPreliminary", checked === true)
                }
              />
            </label>
          </div>
        ))}
      </section>

      <p className="text-sm text-muted-foreground">
        Avdragen förs på den part som faktiskt fick dem. När du skickar posten räknas det som ditt
        godkännande; motparten tar ställning separat.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={disabled || save.isPending}>
          {save.isPending ? "Sparar …" : "Skicka för godkännande"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={save.isPending}
          onClick={() => save.mutate(false)}
        >
          Spara som utkast
        </Button>
      </div>
    </form>
  );
}

function Money({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={id} className="text-sm font-normal text-muted-foreground">
        {label}
      </Label>
      <div className="flex items-center gap-1.5">
        <Input
          id={id}
          inputMode="decimal"
          className="tabular h-8 w-28 text-right"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0"
        />
        <span className="text-xs text-muted-foreground">kr</span>
      </div>
    </div>
  );
}
