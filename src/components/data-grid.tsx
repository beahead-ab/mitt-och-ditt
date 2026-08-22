import { ArrowDown, ArrowUp, Copy, History, Keyboard } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  type GridKey,
  type GridSelection,
  type SortState,
} from "@/lib/grid";
import { fmtDateTime } from "@/lib/format";
import type { CellChange } from "@/lib/revisions";
import { cn } from "@/lib/utils";

export type GridColumn<T> = {
  key: string;
  header: string;
  /** Kolumnbredd i rem. Rutnätet får aldrig krympa en kolumn under detta. */
  width: number;
  align?: "left" | "right";
  /** Det som visas i cellen. Utelämnas den används texten. */
  render?: (row: T) => ReactNode;
  /** Cellens text – används för kopiering, sortering och skärmläsare. */
  text: (row: T) => string;
  /** Värdet som sorteras på, om det skiljer sig från texten. */
  sortValue?: (row: T) => string | number | null;
  /** Talkolumner får tabulära siffror och högerställs som standard. */
  numeric?: boolean;
  /**
   * Kolumner som nästan alltid är tomma. De göms i tätt läge - de åt 30 rem
   * bredd för att visa tankstreck i fem rader av sex, och trängde ut Status
   * och beloppen ur synfältet.
   */
  sällan?: boolean;
  /**
   * Kolumngrupp. Sexton kolumner i rad läses som en enda lång rad; med
   * grupperna framme går det att hoppa till rätt del utan att läsa alla
   * rubriker. Kolumner utan grupp får ingen etikett över sig.
   */
  grupp?: string;
};

type Props<T> = {
  columns: GridColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Enter på en rad. Utelämnas den gör Enter ingenting. */
  onActivate?: (row: T) => void;
  /** Diskret markering av en hel rad, till exempel poster som väntar. */
  rowTone?: (row: T) => "default" | "muted" | "attention";
  caption: string;
  empty: string;
  /**
   * Cellens ändringshistorik. Ges den visas en hörnmarkör på ändrade celler,
   * och högerklick öppnar historiken med värdet före och efter varje ändring.
   */
  cellHistory?: (row: T, columnKey: string) => CellChange[];
  /** Visar vem som gjorde ändringen med namn i stället för ID. */
  personName?: (id: string) => string;
};

/** Radnummerkolumnen till vänster. ID-kolumnen fryses direkt efter den. */
const GUTTER = "2.75rem";
/** Markerar gränsen mellan den frysta kolumnen och det som rullar. */
const FROZEN_EDGE = "1px 0 0 var(--hairline)";

const KEYS: Record<string, GridKey> = {
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
};

/**
 * Ett rutnät med kalkylarkskänsla: fast huvudrad, fast radnummer- och
 * ID-kolumn, en aktiv cell som flyttas med tangentbordet, urval med Skift och
 * kopiering som klistras in direkt i Excel eller Google Sheets.
 *
 * Vyn är läsande. Ekonomiska poster ändras aldrig genom att skriva i en cell,
 * utan genom en korrigeringspost som båda parter godkänner.
 */
export function DataGrid<T>({
  columns,
  rows,
  rowKey,
  onActivate,
  rowTone,
  caption,
  empty,
  cellHistory,
  personName,
}: Props<T>) {
  const [sort, setSort] = useState<SortState>(null);
  const [selection, setSelection] = useState<GridSelection>(() => cellAt(0, 0));
  const [focused, setFocused] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const activeCellRef = useRef<HTMLDivElement | null>(null);

  const sorted = useMemo(
    () =>
      sortRows(rows, sort, (row, key) => {
        const column = columns.find((c) => c.key === key);
        if (!column) return null;
        return column.sortValue ? column.sortValue(row) : column.text(row);
      }),
    [rows, sort, columns],
  );

  const bounds = { rows: sorted.length, cols: columns.length };
  const range = selectionRange(selection);

  // Håll urvalet inom rutnätet när sortering eller filtrering ändrar antalet rader.
  useEffect(() => {
    setSelection((current) => {
      if (current.focus.row < bounds.rows && current.focus.col < bounds.cols) return current;
      return cellAt(
        Math.min(current.focus.row, Math.max(bounds.rows - 1, 0)),
        Math.min(current.focus.col, Math.max(bounds.cols - 1, 0)),
      );
    });
  }, [bounds.rows, bounds.cols]);

  // Rulla den aktiva cellen till synlighet, men bara när rutnätet har fokus –
  // annars skulle sidan hoppa när den laddas.
  useEffect(() => {
    if (!focused) return;
    activeCellRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selection, focused]);

  const copySelection = useCallback(async () => {
    const text = selectionToTsv(selection, (row, col) => columns[col].text(sorted[row]));
    try {
      await navigator.clipboard.writeText(text);
      const cells = (range.bottom - range.top + 1) * (range.right - range.left + 1);
      toast.success(cells === 1 ? "Cellen kopierad" : `${cells} celler kopierade`);
    } catch {
      toast.error("Kunde inte kopiera. Webbläsaren nekade åtkomst till urklipp.");
    }
  }, [selection, columns, sorted, range]);

  const copyCell = useCallback(async () => {
    const row = sorted[selection.focus.row];
    const column = columns[selection.focus.col];
    if (!row || !column) return;
    try {
      await navigator.clipboard.writeText(column.text(row));
      toast.success("Cellen kopierad");
    } catch {
      toast.error("Kunde inte kopiera. Webbläsaren nekade åtkomst till urklipp.");
    }
  }, [sorted, columns, selection]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (bounds.rows === 0) return;
    const jump = event.ctrlKey || event.metaKey;

    if (jump && event.key.toLowerCase() === "c") {
      event.preventDefault();
      void copySelection();
      return;
    }
    if (jump && event.key.toLowerCase() === "a") {
      event.preventDefault();
      setSelection(selectAll(bounds));
      return;
    }
    if (event.key === "Escape") {
      if (!isSingleCell(selection)) {
        event.preventDefault();
        setSelection(collapse(selection));
      }
      return;
    }
    if (event.key === "Enter") {
      if (!onActivate) return;
      event.preventDefault();
      onActivate(sorted[selection.focus.row]);
      return;
    }
    if (event.key === "Tab") {
      const next = moveSelection(selection, event.shiftKey ? "ShiftTab" : "Tab", bounds);
      // Låt fokus lämna rutnätet först när markören står i hörnet, så att
      // tangentbordsanvändare inte fastnar i tabellen.
      if (next.focus.row === selection.focus.row && next.focus.col === selection.focus.col) return;
      event.preventDefault();
      setSelection(next);
      return;
    }

    const key = KEYS[event.key];
    if (!key) return;
    event.preventDefault();
    setSelection(moveSelection(selection, key, bounds, { extend: event.shiftKey, jump }));
  }

  // Fasta kolumnbredder, som i ett kalkylark. Flexibla kolumner skulle sträcka
  // ut varje kolumn till samma bredd och göra rutnätet oläsligt.
  const changedCell = (row: T, columnKey: string) =>
    cellHistory ? cellHistory(row, columnKey).length > 1 : false;

  const gridTemplate = `${GUTTER} ${columns.map((c) => `${c.width}rem`).join(" ")}`;

  // Intilliggande kolumner med samma grupp slås ihop till ett spann. Saknar
  // någon kolumn grupp ritas ingen grupprad alls - halvt grupperade rubriker
  // är svårare att läsa än inga.
  const kolumngrupper = columns.every((c) => c.grupp)
    ? columns.reduce<{ namn: string; antal: number }[]>((grupper, column) => {
        const sista = grupper[grupper.length - 1];
        if (sista && sista.namn === column.grupp) sista.antal += 1;
        else grupper.push({ namn: column.grupp as string, antal: 1 });
        return grupper;
      }, [])
    : [];

  if (rows.length === 0) {
    return (
      <div className="tile-surface p-8 text-center">
        <p className="text-sm text-muted-foreground">{empty}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {sorted.length} rader. Navigera med piltangenterna.
        </p>
        <KeyboardHelp canActivate={Boolean(onActivate)} />
      </div>

      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={bodyRef}
            role="grid"
            aria-label={caption}
            aria-rowcount={sorted.length + 1}
            aria-colcount={columns.length}
            tabIndex={0}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) setFocused(false);
            }}
            className="hairline-card w-full overflow-auto rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{ maxHeight: "min(70vh, 40rem)" }}
          >
            <div className="min-w-max">
              {/* Gruppraden. Ritas bara när kolumnerna faktiskt är grupperade,
                  så ett rutnät med fyra kolumner inte får en tom rad över sig. */}
              {kolumngrupper.length > 0 && (
                <div
                  aria-hidden
                  className="sticky top-0 z-30 grid border-b border-hairline bg-secondary"
                  style={{ gridTemplateColumns: gridTemplate }}
                >
                  <div className="sticky left-0 z-10 border-r border-hairline bg-secondary px-2 py-1" />
                  {kolumngrupper.map((grupp, index) => (
                    <div
                      key={`${grupp.namn}-${index}`}
                      style={{ gridColumn: `span ${grupp.antal}` }}
                      className="truncate border-r border-hairline bg-secondary px-3 py-1 text-[0.7rem] font-medium uppercase tracking-wider text-muted-foreground last:border-r-0"
                    >
                      {grupp.namn}
                    </div>
                  ))}
                </div>
              )}

              {/* Huvudrad */}
              <div
                role="row"
                aria-rowindex={1}
                className="sticky top-0 z-20 grid border-b border-hairline bg-secondary"
                style={{ gridTemplateColumns: gridTemplate }}
              >
                <div
                  role="columnheader"
                  aria-label="Rad"
                  className="sticky left-0 z-10 border-r border-hairline bg-secondary px-2 py-2"
                />
                {columns.map((column, colIndex) => {
                  const isSorted = sort?.key === column.key;
                  const inSelection = colIndex >= range.left && colIndex <= range.right;
                  return (
                    <button
                      key={column.key}
                      role="columnheader"
                      type="button"
                      aria-sort={
                        isSorted ? (sort.direction === "asc" ? "ascending" : "descending") : "none"
                      }
                      aria-colindex={colIndex + 1}
                      tabIndex={-1}
                      onClick={() => setSort((current) => nextSort(current, column.key))}
                      style={colIndex === 0 ? { left: GUTTER, boxShadow: FROZEN_EDGE } : undefined}
                      className={cn(
                        "flex items-center gap-1 border-r border-hairline bg-secondary px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[oklch(0.35_0.02_60)] transition-colors last:border-r-0 hover:text-foreground",
                        column.align === "right" || column.numeric
                          ? "justify-end"
                          : "justify-start",
                        inSelection && focused && "text-foreground",
                        colIndex === 0 && "sticky z-10",
                      )}
                      title={`Sortera på ${column.header}`}
                    >
                      <span className="truncate">{column.header}</span>
                      {isSorted &&
                        (sort.direction === "asc" ? (
                          <ArrowUp className="size-3 shrink-0" />
                        ) : (
                          <ArrowDown className="size-3 shrink-0" />
                        ))}
                    </button>
                  );
                })}
              </div>

              {/* Rader */}
              {sorted.map((row, rowIndex) => {
                const tone = rowTone?.(row) ?? "default";
                const rowInSelection = rowIndex >= range.top && rowIndex <= range.bottom;
                return (
                  <div
                    role="row"
                    aria-rowindex={rowIndex + 2}
                    key={rowKey(row)}
                    className="grid border-b border-hairline last:border-b-0"
                    style={{ gridTemplateColumns: gridTemplate }}
                  >
                    <div
                      role="rowheader"
                      className={cn(
                        "sticky left-0 z-10 border-r border-hairline px-2 py-1.5 text-right text-[0.7rem] tabular text-muted-foreground",
                        rowInSelection && focused ? "bg-secondary text-foreground" : "bg-card",
                      )}
                    >
                      {rowIndex + 1}
                    </div>
                    {columns.map((column, colIndex) => {
                      const isActive =
                        selection.focus.row === rowIndex && selection.focus.col === colIndex;
                      const inRange = isInRange(range, rowIndex, colIndex);
                      return (
                        <div
                          role="gridcell"
                          aria-colindex={colIndex + 1}
                          aria-selected={inRange}
                          key={column.key}
                          ref={isActive ? activeCellRef : undefined}
                          onMouseDown={(event) => {
                            setFocused(true);
                            bodyRef.current?.focus();
                            setSelection((current) =>
                              event.shiftKey
                                ? {
                                    anchor: current.anchor,
                                    focus: { row: rowIndex, col: colIndex },
                                  }
                                : cellAt(rowIndex, colIndex),
                            );
                          }}
                          onContextMenu={() => {
                            setFocused(true);
                            setSelection(cellAt(rowIndex, colIndex));
                          }}
                          onDoubleClick={() => onActivate?.(row)}
                          title={column.text(row) || undefined}
                          style={
                            colIndex === 0 ? { left: GUTTER, boxShadow: FROZEN_EDGE } : undefined
                          }
                          className={cn(
                            "relative min-w-0 cursor-default select-none border-r border-hairline px-3 py-1.5 text-sm last:border-r-0",
                            column.numeric && "tabular",
                            column.align === "right" || column.numeric ? "text-right" : "text-left",
                            tone === "muted" && "text-muted-foreground",
                            // Den frysta kolumnen behöver egen bakgrund, annars
                            // syns raderna igenom när rutnätet rullas i sidled.
                            colIndex === 0 &&
                              (inRange ? "sticky z-[5] bg-secondary" : "sticky z-[5] bg-card"),
                            inRange && !isActive && colIndex !== 0 && "bg-primary/8",
                            isActive &&
                              focused &&
                              "z-10 outline outline-2 -outline-offset-2 outline-primary",
                            isActive && !focused && "bg-secondary",
                          )}
                        >
                          {tone === "attention" && colIndex === 0 && (
                            <span
                              aria-hidden
                              className="absolute inset-y-0 left-0 w-0.5 bg-[color:var(--data-gold)]"
                            />
                          )}
                          {changedCell(row, column.key) && (
                            <span
                              aria-hidden
                              title="Cellen har ändrats. Högerklicka för historiken."
                              className="absolute right-0 top-0 border-l-[5px] border-t-[5px] border-l-transparent border-t-primary"
                            />
                          )}
                          <span className="block truncate">
                            {column.render ? column.render(row) : column.text(row)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-80">
          <CellHistory
            column={columns[selection.focus.col]}
            row={sorted[selection.focus.row]}
            cellHistory={cellHistory}
            personName={personName}
            onCopy={() => void copyCell()}
          />
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}

function CellHistory<T>({
  column,
  row,
  cellHistory,
  personName,
  onCopy,
}: {
  column: GridColumn<T> | undefined;
  row: T | undefined;
  cellHistory?: (row: T, columnKey: string) => CellChange[];
  personName?: (id: string) => string;
  onCopy: () => void;
}) {
  if (!column || !row) return null;
  const changes = cellHistory?.(row, column.key) ?? [];
  const name = (id: string) => personName?.(id) ?? id;

  return (
    <>
      <ContextMenuLabel className="text-xs font-normal text-muted-foreground">
        {column.header}
      </ContextMenuLabel>
      <ContextMenuItem onSelect={onCopy}>
        <Copy className="mr-2 size-3.5" /> Kopiera cellen
      </ContextMenuItem>
      <ContextMenuSeparator />
      <div className="px-2 py-1.5">
        <p className="eyebrow mb-2 flex items-center gap-1.5">
          <History className="size-3" /> Cellens historia
        </p>
        {changes.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Ingen historik finns för den här posten än.
          </p>
        ) : changes.length === 1 ? (
          <p className="text-xs text-muted-foreground">
            Oförändrad sedan posten registrerades{" "}
            {fmtDateTime(changes[0].effectiveAt ?? changes[0].changedAt)} av{" "}
            {name(changes[0].authorId)}.
          </p>
        ) : (
          <ol className="grid gap-2.5">
            {[...changes].reverse().map((change) => (
              <li key={change.version} className="text-xs">
                <p className="flex flex-wrap items-baseline gap-1.5">
                  {change.from === null ? (
                    <span className="text-muted-foreground">Registrerad som</span>
                  ) : (
                    <>
                      <span className="tabular text-muted-foreground line-through">
                        {change.from}
                      </span>
                      <span aria-hidden className="text-muted-foreground">
                        →
                      </span>
                    </>
                  )}
                  <span className="tabular font-medium text-foreground">{change.to}</span>
                </p>
                <p className="mt-0.5 text-muted-foreground">
                  {name(change.authorId)} ·{" "}
                  {change.effectiveAt
                    ? fmtDateTime(change.effectiveAt)
                    : `${fmtDateTime(change.changedAt)} · väntar på godkännande`}
                </p>
                {change.reason && (
                  <p className="mt-0.5 italic text-muted-foreground">{change.reason}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </>
  );
}

function KeyboardHelp({ canActivate }: { canActivate: boolean }) {
  const shortcuts: [string, string][] = [
    ["Pilar", "Flytta markören"],
    ["Skift + pil", "Utöka urvalet"],
    ["Tabb", "Nästa cell, radbryter"],
    ["Home / End", "Radens början och slut"],
    ["Ctrl + Home / End", "Rutnätets hörn"],
    ["PageUp / PageDown", "Tio rader"],
    ["Ctrl + A", "Markera allt"],
    ["Ctrl + C", "Kopiera urvalet"],
    ["Esc", "Dra ihop urvalet"],
  ];
  if (canActivate) shortcuts.splice(1, 0, ["Enter", "Öppna raden"]);

  return (
    <Popover>
      <PopoverTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
        <Keyboard className="size-3.5" />
        Tangentbord
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <p className="eyebrow mb-2">Tangentbord</p>
        <dl className="grid gap-1.5 text-xs">
          {shortcuts.map(([keys, what]) => (
            <div key={keys} className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 font-mono text-[0.7rem] text-foreground">{keys}</dt>
              <dd className="text-right text-muted-foreground">{what}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 border-t border-hairline pt-2 text-xs text-muted-foreground">
          Kopierat urval klistras in direkt i Excel och Google Sheets.
        </p>
      </PopoverContent>
    </Popover>
  );
}
