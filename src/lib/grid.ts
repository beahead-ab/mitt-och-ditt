/**
 * Ren logik för rutnätet: markörförflyttning, urval, sortering och kopiering.
 * Ingen DOM och ingen React, så beteendet kan testas direkt.
 *
 * Tangentbordet följer Google Sheets så nära det går i en läsvy: pilar flyttar,
 * Skift utökar urvalet, Tabb går i läsordning, Home och End går till radens
 * kanter och Ctrl lägger till hopp till rutnätets hörn.
 */

export type CellPosition = { row: number; col: number };

export type GridSelection = {
  /** Cellen urvalet utgår från. Ligger still när urvalet utökas. */
  anchor: CellPosition;
  /** Den aktiva cellen. Flyttas av tangentbordet. */
  focus: CellPosition;
};

export type GridBounds = { rows: number; cols: number };

export type GridRange = { top: number; left: number; bottom: number; right: number };

export const PAGE_STEP = 10;

export function cellAt(row: number, col: number): GridSelection {
  const position = { row, col };
  return { anchor: position, focus: position };
}

export function clamp(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(Math.max(value, 0), max - 1);
}

/** Urvalet som ett rektangulärt område, oavsett åt vilket håll det dragits. */
export function selectionRange(selection: GridSelection): GridRange {
  return {
    top: Math.min(selection.anchor.row, selection.focus.row),
    bottom: Math.max(selection.anchor.row, selection.focus.row),
    left: Math.min(selection.anchor.col, selection.focus.col),
    right: Math.max(selection.anchor.col, selection.focus.col),
  };
}

export function isInRange(range: GridRange, row: number, col: number): boolean {
  return row >= range.top && row <= range.bottom && col >= range.left && col <= range.right;
}

export function isSingleCell(selection: GridSelection): boolean {
  return (
    selection.anchor.row === selection.focus.row && selection.anchor.col === selection.focus.col
  );
}

export type GridKey =
  | "ArrowUp"
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight"
  | "Home"
  | "End"
  | "PageUp"
  | "PageDown"
  | "Tab"
  | "ShiftTab";

export type MoveOptions = {
  /** Skift utökar urvalet i stället för att flytta det. */
  extend?: boolean;
  /** Ctrl eller Cmd hoppar till rutnätets kant. */
  jump?: boolean;
};

/**
 * Flyttar den aktiva cellen. Tabb och Skift+Tabb radbryter som i ett kalkylark:
 * sista kolumnen leder till nästa rads första kolumn.
 */
export function moveSelection(
  selection: GridSelection,
  key: GridKey,
  bounds: GridBounds,
  options: MoveOptions = {},
): GridSelection {
  if (bounds.rows <= 0 || bounds.cols <= 0) return selection;
  const { row, col } = selection.focus;
  let next: CellPosition;

  switch (key) {
    case "ArrowUp":
      next = { row: options.jump ? 0 : row - 1, col };
      break;
    case "ArrowDown":
      next = { row: options.jump ? bounds.rows - 1 : row + 1, col };
      break;
    case "ArrowLeft":
      next = { row, col: options.jump ? 0 : col - 1 };
      break;
    case "ArrowRight":
      next = { row, col: options.jump ? bounds.cols - 1 : col + 1 };
      break;
    case "Home":
      next = options.jump ? { row: 0, col: 0 } : { row, col: 0 };
      break;
    case "End":
      next = options.jump
        ? { row: bounds.rows - 1, col: bounds.cols - 1 }
        : { row, col: bounds.cols - 1 };
      break;
    case "PageUp":
      next = { row: row - PAGE_STEP, col };
      break;
    case "PageDown":
      next = { row: row + PAGE_STEP, col };
      break;
    case "Tab":
      // Sista cellen på raden leder till nästa rads början. Sista cellen i
      // hela rutnätet står still i stället för att slå runt till början.
      if (col + 1 < bounds.cols) next = { row, col: col + 1 };
      else if (row + 1 < bounds.rows) next = { row: row + 1, col: 0 };
      else next = { row, col };
      break;
    case "ShiftTab":
      if (col - 1 >= 0) next = { row, col: col - 1 };
      else if (row - 1 >= 0) next = { row: row - 1, col: bounds.cols - 1 };
      else next = { row, col };
      break;
  }

  const clamped: CellPosition = {
    row: clamp(next.row, bounds.rows),
    col: clamp(next.col, bounds.cols),
  };
  // Tabb flyttar alltid urvalet; bara pilar och hopp kan utöka det.
  const extend = options.extend && key !== "Tab" && key !== "ShiftTab";
  return { anchor: extend ? selection.anchor : clamped, focus: clamped };
}

export function selectAll(bounds: GridBounds): GridSelection {
  return {
    anchor: { row: 0, col: 0 },
    focus: { row: Math.max(bounds.rows - 1, 0), col: Math.max(bounds.cols - 1, 0) },
  };
}

/** Drar ihop ett utökat urval till den aktiva cellen. */
export function collapse(selection: GridSelection): GridSelection {
  return { anchor: selection.focus, focus: selection.focus };
}

/**
 * Urvalet som text med tabb mellan kolumner och radbrytning mellan rader –
 * exakt det format som klistras in korrekt i Excel, Google Sheets och Numbers.
 */
export function selectionToTsv(
  selection: GridSelection,
  getCellText: (row: number, col: number) => string,
): string {
  const range = selectionRange(selection);
  const lines: string[] = [];
  for (let row = range.top; row <= range.bottom; row += 1) {
    const cells: string[] = [];
    for (let col = range.left; col <= range.right; col += 1) {
      cells.push(sanitizeCell(getCellText(row, col)));
    }
    lines.push(cells.join("\t"));
  }
  return lines.join("\n");
}

/** Tabbar och radbrytningar i en cell skulle spränga formatet. */
function sanitizeCell(value: string): string {
  return value.replace(/[\t\r\n]+/g, " ").trim();
}

export type SortDirection = "asc" | "desc";

export type SortState = { key: string; direction: SortDirection } | null;

/** Klick på samma rubrik går stigande, fallande och därefter tillbaka till osorterat. */
export function nextSort(current: SortState, key: string): SortState {
  if (!current || current.key !== key) return { key, direction: "asc" };
  if (current.direction === "asc") return { key, direction: "desc" };
  return null;
}

/**
 * Sorterar stabilt. Tomma värden hamnar alltid sist, oavsett riktning, så att
 * en kolumn med luckor inte fylls av tomrum högst upp.
 */
export function sortRows<T>(
  rows: T[],
  sort: SortState,
  valueOf: (row: T, key: string) => string | number | null | undefined,
): T[] {
  if (!sort) return rows;
  const factor = sort.direction === "asc" ? 1 : -1;
  return [...rows]
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const left = valueOf(a.row, sort.key);
      const right = valueOf(b.row, sort.key);
      const leftEmpty = left === null || left === undefined || left === "";
      const rightEmpty = right === null || right === undefined || right === "";
      if (leftEmpty && rightEmpty) return a.index - b.index;
      if (leftEmpty) return 1;
      if (rightEmpty) return -1;
      if (typeof left === "number" && typeof right === "number") {
        return left === right ? a.index - b.index : (left - right) * factor;
      }
      const comparison = String(left).localeCompare(String(right), "sv", { numeric: true });
      return comparison === 0 ? a.index - b.index : comparison * factor;
    })
    .map((entry) => entry.row);
}
