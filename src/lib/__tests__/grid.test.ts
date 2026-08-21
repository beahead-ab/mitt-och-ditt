import { describe, expect, it } from "vitest";

import {
  cellAt,
  collapse,
  isInRange,
  isSingleCell,
  moveSelection,
  nextSort,
  selectAll,
  selectionRange,
  selectionToTsv,
  sortRows,
  type GridSelection,
} from "@/lib/grid";

const bounds = { rows: 5, cols: 4 };

describe("Markörförflyttning", () => {
  it("flyttar med pilarna", () => {
    let selection = cellAt(2, 2);
    selection = moveSelection(selection, "ArrowUp", bounds);
    expect(selection.focus).toEqual({ row: 1, col: 2 });
    selection = moveSelection(selection, "ArrowRight", bounds);
    expect(selection.focus).toEqual({ row: 1, col: 3 });
  });

  it("stannar vid kanten i stället för att slå runt", () => {
    expect(moveSelection(cellAt(0, 0), "ArrowUp", bounds).focus).toEqual({ row: 0, col: 0 });
    expect(moveSelection(cellAt(4, 3), "ArrowDown", bounds).focus).toEqual({ row: 4, col: 3 });
    expect(moveSelection(cellAt(0, 0), "ArrowLeft", bounds).focus).toEqual({ row: 0, col: 0 });
    expect(moveSelection(cellAt(4, 3), "ArrowRight", bounds).focus).toEqual({ row: 4, col: 3 });
  });

  it("går till radens kanter med Home och End", () => {
    expect(moveSelection(cellAt(2, 2), "Home", bounds).focus).toEqual({ row: 2, col: 0 });
    expect(moveSelection(cellAt(2, 2), "End", bounds).focus).toEqual({ row: 2, col: 3 });
  });

  it("hoppar till rutnätets hörn med Ctrl", () => {
    expect(moveSelection(cellAt(2, 2), "Home", bounds, { jump: true }).focus).toEqual({
      row: 0,
      col: 0,
    });
    expect(moveSelection(cellAt(2, 2), "End", bounds, { jump: true }).focus).toEqual({
      row: 4,
      col: 3,
    });
    expect(moveSelection(cellAt(2, 2), "ArrowDown", bounds, { jump: true }).focus).toEqual({
      row: 4,
      col: 2,
    });
  });

  it("hoppar tio rader med PageUp och PageDown", () => {
    expect(moveSelection(cellAt(0, 1), "PageDown", bounds).focus).toEqual({ row: 4, col: 1 });
    expect(moveSelection(cellAt(4, 1), "PageUp", bounds).focus).toEqual({ row: 0, col: 1 });
  });

  it("radbryter med Tabb som i ett kalkylark", () => {
    expect(moveSelection(cellAt(1, 3), "Tab", bounds).focus).toEqual({ row: 2, col: 0 });
    expect(moveSelection(cellAt(2, 0), "ShiftTab", bounds).focus).toEqual({ row: 1, col: 3 });
  });

  it("stannar på sista cellen när Tabb når slutet", () => {
    expect(moveSelection(cellAt(4, 3), "Tab", bounds).focus).toEqual({ row: 4, col: 3 });
    expect(moveSelection(cellAt(0, 0), "ShiftTab", bounds).focus).toEqual({ row: 0, col: 0 });
  });

  it("gör ingenting i ett tomt rutnät", () => {
    const empty = { rows: 0, cols: 0 };
    const selection = cellAt(0, 0);
    expect(moveSelection(selection, "ArrowDown", empty)).toBe(selection);
  });
});

describe("Urval", () => {
  it("utökas med Skift och behåller ankaret", () => {
    let selection: GridSelection = cellAt(1, 1);
    selection = moveSelection(selection, "ArrowDown", bounds, { extend: true });
    selection = moveSelection(selection, "ArrowRight", bounds, { extend: true });
    expect(selection.anchor).toEqual({ row: 1, col: 1 });
    expect(selection.focus).toEqual({ row: 2, col: 2 });
    expect(selectionRange(selection)).toEqual({ top: 1, bottom: 2, left: 1, right: 2 });
  });

  it("beskriver ett område likadant oavsett dragriktning", () => {
    const downRight = { anchor: { row: 1, col: 1 }, focus: { row: 3, col: 3 } };
    const upLeft = { anchor: { row: 3, col: 3 }, focus: { row: 1, col: 1 } };
    expect(selectionRange(upLeft)).toEqual(selectionRange(downRight));
  });

  it("utökas aldrig med Tabb", () => {
    const selection = moveSelection(cellAt(1, 1), "Tab", bounds, { extend: true });
    expect(isSingleCell(selection)).toBe(true);
  });

  it("markerar allt och dras ihop igen", () => {
    const all = selectAll(bounds);
    expect(selectionRange(all)).toEqual({ top: 0, bottom: 4, left: 0, right: 3 });
    expect(isInRange(selectionRange(all), 2, 2)).toBe(true);
    expect(isSingleCell(collapse(all))).toBe(true);
    expect(collapse(all).focus).toEqual({ row: 4, col: 3 });
  });
});

describe("Kopiering", () => {
  const text = (row: number, col: number) => `r${row}c${col}`;

  it("ger tabbseparerad text som klistras in rätt i ett kalkylark", () => {
    const selection = { anchor: { row: 0, col: 0 }, focus: { row: 1, col: 1 } };
    expect(selectionToTsv(selection, text)).toBe("r0c0\tr0c1\nr1c0\tr1c1");
  });

  it("kopierar en ensam cell", () => {
    expect(selectionToTsv(cellAt(2, 3), text)).toBe("r2c3");
  });

  it("plattar ut tabbar och radbrytningar i innehållet", () => {
    const messy = () => "  två\trader\nihop  ";
    expect(selectionToTsv(cellAt(0, 0), messy)).toBe("två rader ihop");
  });
});

describe("Sortering", () => {
  type Row = { id: string; belopp: number | null };
  const rows: Row[] = [
    { id: "C", belopp: 30 },
    { id: "A", belopp: 10 },
    { id: "B", belopp: null },
    { id: "D", belopp: 20 },
  ];
  const valueOf = (row: Row, key: string) => (key === "id" ? row.id : row.belopp);

  it("växlar stigande, fallande och osorterat", () => {
    const first = nextSort(null, "id");
    expect(first).toEqual({ key: "id", direction: "asc" });
    const second = nextSort(first, "id");
    expect(second).toEqual({ key: "id", direction: "desc" });
    expect(nextSort(second, "id")).toBeNull();
  });

  it("börjar om stigande på en ny kolumn", () => {
    expect(nextSort({ key: "id", direction: "desc" }, "belopp")).toEqual({
      key: "belopp",
      direction: "asc",
    });
  });

  it("sorterar text på svenska", () => {
    const sorted = sortRows(rows, { key: "id", direction: "asc" }, valueOf);
    expect(sorted.map((r) => r.id)).toEqual(["A", "B", "C", "D"]);
  });

  it("lägger tomma värden sist i båda riktningarna", () => {
    const asc = sortRows(rows, { key: "belopp", direction: "asc" }, valueOf);
    expect(asc.map((r) => r.id)).toEqual(["A", "D", "C", "B"]);
    const desc = sortRows(rows, { key: "belopp", direction: "desc" }, valueOf);
    expect(desc.map((r) => r.id)).toEqual(["C", "D", "A", "B"]);
  });

  it("är stabil och lämnar originalet orört", () => {
    const ties: Row[] = [
      { id: "första", belopp: 5 },
      { id: "andra", belopp: 5 },
      { id: "tredje", belopp: 5 },
    ];
    const sorted = sortRows(ties, { key: "belopp", direction: "asc" }, valueOf);
    expect(sorted.map((r) => r.id)).toEqual(["första", "andra", "tredje"]);
    expect(rows[0].id).toBe("C");
  });

  it("lämnar ordningen orörd utan sortering", () => {
    expect(sortRows(rows, null, valueOf)).toBe(rows);
  });
});
