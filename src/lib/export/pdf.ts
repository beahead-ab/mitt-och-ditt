import { jsPDF } from "jspdf";

import { downloadBlob } from "./download";

/**
 * PDF ur den Markdown vi redan genererar, så att pappersversionen och
 * textversionen alltid säger samma sak. En full Markdown-renderare vore
 * överarbetad – dokumenten använder rubriker, tabeller, listor och citat, och
 * det är precis vad som hanteras här.
 *
 * jsPDF:s inbyggda typsnitt är WinAnsi-kodade, vilket täcker å, ä och ö.
 */

const PAGE = { width: 210, height: 297, margin: 18 };
const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;

type Line = { text: string; size: number; style: "normal" | "bold" | "italic"; gap: number };

function parseMarkdown(markdown: string): (Line | { table: string[][] })[] {
  const blocks: (Line | { table: string[][] })[] = [];
  const lines = markdown.split("\n");

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    // Tabell: rubrikrad, skiljerad, därefter data tills raderna tar slut.
    if (line.startsWith("|") && lines[i + 1]?.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        const cells = lines[i]
          .slice(1, -1)
          .split("|")
          .map((cell) => cell.trim());
        // Skiljeraden av bindestreck hör inte till innehållet.
        if (!cells.every((cell) => /^-+$/.test(cell))) rows.push(cells);
        i += 1;
      }
      i -= 1;
      blocks.push({ table: rows });
      continue;
    }

    if (line.startsWith("# ")) {
      blocks.push({ text: line.slice(2), size: 18, style: "bold", gap: 8 });
    } else if (line.startsWith("## ")) {
      blocks.push({ text: line.slice(3), size: 12, style: "bold", gap: 6 });
    } else if (line.startsWith("> ")) {
      blocks.push({ text: line.slice(2), size: 9, style: "italic", gap: 4 });
    } else if (line.startsWith("- ")) {
      blocks.push({ text: `•  ${line.slice(2)}`, size: 10, style: "normal", gap: 3 });
    } else if (line.startsWith("*") && line.endsWith("*") && line.length > 2) {
      blocks.push({ text: line.slice(1, -1), size: 8, style: "italic", gap: 4 });
    } else if (line.trim() === "") {
      blocks.push({ text: "", size: 10, style: "normal", gap: 3 });
    } else {
      blocks.push({ text: stripEmphasis(line), size: 10, style: "normal", gap: 4 });
    }
  }
  return blocks;
}

/** Fetstil i löpande text markeras inte i PDF:en; texten ska ändå vara hel. */
function stripEmphasis(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`(.+?)`/g, "$1");
}

export function markdownToPdf(markdown: string, title: string): Blob {
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  pdf.setProperties({ title, creator: "Mitt & Ditt" });

  let y = PAGE.margin;

  const newPageIfNeeded = (needed: number) => {
    if (y + needed > PAGE.height - PAGE.margin) {
      pdf.addPage();
      y = PAGE.margin;
    }
  };

  for (const block of parseMarkdown(markdown)) {
    if ("table" in block) {
      const rows = block.table;
      if (rows.length === 0) continue;
      const columns = rows[0].length;
      const columnWidth = CONTENT_WIDTH / columns;

      rows.forEach((row, rowIndex) => {
        newPageIfNeeded(7);
        pdf.setFont("helvetica", rowIndex === 0 ? "bold" : "normal");
        pdf.setFontSize(9);
        row.forEach((cell, columnIndex) => {
          const x = PAGE.margin + columnIndex * columnWidth;
          // Tal högerställs, precis som i gränssnittet.
          const numeric = columnIndex > 0 && /\d/.test(cell) && !/[a-zåäö]{4}/i.test(cell);
          const text = pdf.splitTextToSize(cell, columnWidth - 2)[0] ?? "";
          pdf.text(text, numeric ? x + columnWidth - 2 : x, y, {
            align: numeric ? "right" : "left",
          });
        });
        y += 5;
        if (rowIndex === 0) {
          pdf.setDrawColor(200);
          pdf.line(PAGE.margin, y - 3.5, PAGE.width - PAGE.margin, y - 3.5);
        }
      });
      y += 3;
      continue;
    }

    if (block.text === "") {
      y += block.gap;
      continue;
    }

    pdf.setFont("helvetica", block.style === "italic" ? "italic" : block.style);
    pdf.setFontSize(block.size);
    const wrapped = pdf.splitTextToSize(block.text, CONTENT_WIDTH) as string[];
    for (const line of wrapped) {
      newPageIfNeeded(block.size * 0.5);
      pdf.text(line, PAGE.margin, y);
      y += block.size * 0.45 + 1;
    }
    y += block.gap - 2;
  }

  // Sidnumrering sist, när antalet sidor är känt.
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    pdf.setPage(page);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(120);
    pdf.text(`${page} (${pages})`, PAGE.width - PAGE.margin, PAGE.height - 10, { align: "right" });
    pdf.setTextColor(0);
  }

  return pdf.output("blob");
}

export function downloadMarkdownAsPdf(markdown: string, title: string, filename: string): void {
  downloadBlob(markdownToPdf(markdown, title), filename);
}
