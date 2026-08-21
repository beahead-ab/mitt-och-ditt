import { describe, expect, it } from "vitest";

import { availableActions, can, type TransactionContext } from "@/lib/actions";

const base: TransactionContext = {
  transaction: { status: "pending", voidsId: null },
  myPartyId: "felicia",
  registeredByPartyId: "caesar",
  iHaveDecided: false,
};

const actions = (overrides: Partial<TransactionContext>) =>
  availableActions({
    ...base,
    ...overrides,
    transaction: { ...base.transaction, ...overrides.transaction },
  });

describe("Tillåtna åtgärder", () => {
  it("motparten kan godkänna eller invända mot en väntande post", () => {
    const list = actions({});
    expect(can(list, "approve")).toBe(true);
    expect(can(list, "object")).toBe(true);
  });

  it("registratorn kan inte godkänna sin egen post", () => {
    const list = actions({ myPartyId: "caesar" });
    expect(can(list, "approve")).toBe(false);
    expect(list.find((a) => a.key === "approve")?.disabledReason).toMatch(/registrerade/);
    // Men hen får dra tillbaka den.
    expect(can(list, "withdraw")).toBe(true);
  });

  it("den som redan tagit ställning kan inte göra det igen", () => {
    const list = actions({ iHaveDecided: true });
    expect(can(list, "approve")).toBe(false);
    expect(can(list, "object")).toBe(false);
  });

  it("en godkänd post kan bara korrigeras eller makuleras", () => {
    const list = actions({ transaction: { status: "approved", voidsId: null } });
    expect(list.map((a) => a.key)).toEqual(["correct", "void"]);
    expect(can(list, "correct")).toBe(true);
    expect(can(list, "void")).toBe(true);
  });

  it("en godkänd post kan aldrig raderas eller ändras direkt", () => {
    const list = actions({ transaction: { status: "approved", voidsId: null } });
    expect(list.some((a) => a.key === "deleteDraft")).toBe(false);
    expect(list.some((a) => a.key === "edit")).toBe(false);
  });

  it("ett eget utkast får ändras, skickas in och raderas", () => {
    const list = actions({ myPartyId: "caesar", transaction: { status: "draft", voidsId: null } });
    expect(can(list, "edit")).toBe(true);
    expect(can(list, "submit")).toBe(true);
    expect(can(list, "deleteDraft")).toBe(true);
  });

  it("motpartens utkast går inte att röra", () => {
    const list = actions({ transaction: { status: "draft", voidsId: null } });
    expect(can(list, "edit")).toBe(false);
    expect(can(list, "deleteDraft")).toBe(false);
  });

  it("en tvistig post löses med korrigering eller makulering", () => {
    const list = actions({ transaction: { status: "disputed", voidsId: null } });
    expect(can(list, "correct")).toBe(true);
    expect(can(list, "void")).toBe(true);
  });

  it("en tillbakadragen post kräver ingen åtgärd", () => {
    const list = actions({ transaction: { status: "withdrawn", voidsId: null } });
    expect(can(list, "correct")).toBe(false);
    expect(can(list, "void")).toBe(false);
  });

  it("en makulerad post kan inte makuleras igen", () => {
    const list = actions({ isVoided: true, transaction: { status: "approved", voidsId: null } });
    expect(can(list, "void")).toBe(false);
    expect(can(list, "correct")).toBe(false);
  });

  it("en ersatt post pekar vidare till korrigeringen", () => {
    const list = actions({
      isSuperseded: true,
      transaction: { status: "approved", voidsId: null },
    });
    expect(list.find((a) => a.key === "correct")?.disabledReason).toMatch(/nyare/);
  });

  it("varje otillgänglig åtgärd har ett skäl", () => {
    for (const status of ["draft", "pending", "disputed", "withdrawn", "approved"] as const) {
      for (const me of ["caesar", "felicia"]) {
        const list = actions({ myPartyId: me, transaction: { status, voidsId: null } });
        for (const item of list) {
          if (!can(list, item.key)) expect(item.disabledReason).toBeTruthy();
        }
      }
    }
  });
});
