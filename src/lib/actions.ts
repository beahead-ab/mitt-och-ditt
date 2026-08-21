import type { Transaction } from "@/lib/engine";

/**
 * Vilka åtgärder en part får göra med en post, och varför. Reglerna följer
 * avtalets punkt 14.2–14.3: en godkänd post rättas med en korrigering och tas
 * ur beräkningen med en makulering, aldrig genom radering eller redigering.
 */
export type ActionKey =
  "edit" | "submit" | "deleteDraft" | "approve" | "object" | "withdraw" | "correct" | "void";

export type ActionState = {
  key: ActionKey;
  label: string;
  /** Kort förklaring när åtgärden inte är tillgänglig. */
  disabledReason?: string;
};

export type TransactionContext = {
  transaction: Pick<Transaction, "status" | "voidsId">;
  /** Den inloggades partsroll. */
  myPartyId: string;
  /** Vem som registrerade posten. */
  registeredByPartyId: string;
  /** Har jag redan tagit ställning till den här versionen? */
  iHaveDecided: boolean;
  /** Är posten redan makulerad av en godkänd makuleringspost? */
  isVoided?: boolean;
  /** Är posten ersatt av en godkänd korrigering? */
  isSuperseded?: boolean;
};

const LABELS: Record<ActionKey, string> = {
  edit: "Ändra",
  submit: "Skicka för godkännande",
  deleteDraft: "Radera utkastet",
  approve: "Godkänn",
  object: "Invänd",
  withdraw: "Dra tillbaka",
  correct: "Korrigera",
  void: "Makulera",
};

function action(key: ActionKey, disabledReason?: string): ActionState {
  return { key, label: LABELS[key], disabledReason };
}

/**
 * Åtgärderna som ska visas för posten. Otillgängliga åtgärder tas inte bort
 * utan får ett skäl, så att det syns *varför* något inte går – det är halva
 * poängen med ett bevisverktyg.
 */
export function availableActions(context: TransactionContext): ActionState[] {
  const { transaction, myPartyId, registeredByPartyId, iHaveDecided } = context;
  const mine = myPartyId === registeredByPartyId;

  if (context.isVoided) {
    return [
      action("correct", "Posten är makulerad."),
      action("void", "Posten är redan makulerad."),
    ];
  }
  if (context.isSuperseded) {
    return [
      action(
        "correct",
        "Posten är ersatt av en korrigering. Korrigera den nyare posten i stället.",
      ),
      action("void", "Posten är ersatt av en korrigering."),
    ];
  }

  switch (transaction.status) {
    case "draft":
      return mine
        ? [action("edit"), action("submit"), action("deleteDraft")]
        : [
            action("edit", "Utkastet tillhör den andra parten."),
            action("deleteDraft", "Utkastet tillhör den andra parten."),
          ];

    case "pending":
      if (mine) {
        return [
          action("withdraw"),
          action("approve", "Du registrerade posten och har därmed redan godkänt den."),
          action("object", "Du registrerade posten. Dra tillbaka den i stället."),
        ];
      }
      return iHaveDecided
        ? [
            action("approve", "Du har redan tagit ställning."),
            action("object", "Du har redan tagit ställning."),
          ]
        : [action("approve"), action("object")];

    case "disputed":
      // En invändning löses genom en korrigering som båda tar ställning till.
      return [action("correct"), action("void")];

    case "withdrawn":
      return [
        action("correct", "Posten är tillbakadragen."),
        action("void", "Posten är tillbakadragen och påverkar ingenting."),
      ];

    case "approved":
      return [action("correct"), action("void")];
  }
}

export function can(actions: ActionState[], key: ActionKey): boolean {
  const found = actions.find((a) => a.key === key);
  return Boolean(found && !found.disabledReason);
}

/** Kostnadsslag som föreslås i registreringen. Fria texter tillåts också. */
export function categoryOptions(rules: { category: string }[]): string[] {
  return [...new Set(rules.map((rule) => rule.category))].sort((a, b) => a.localeCompare(b, "sv"));
}
