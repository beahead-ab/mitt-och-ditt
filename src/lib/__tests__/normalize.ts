/**
 * Intl grupperar tusental med fast smalt mellanslag och skriver valuta med
 * fast blanksteg. Skillnaden mot vanligt blanksteg syns inte men gör
 * jämförelser i tester opålitliga, så den normaliseras bort.
 */
export function normalizeSpaces(text: string): string {
  return text.replace(/\s/g, " ");
}

/**
 * Minimal CSV-läsare för tester. Att läsa tillbaka exporten med en riktig
 * parser bevisar att citeringen håller – ett naivt split på avgränsaren skulle
 * dela mitt i ett citerat fält och ge falskt godkänt.
 */
export function parseCsv(text: string, delimiter = ";"): string[][] {
  const withoutBom = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < withoutBom.length; i += 1) {
    const character = withoutBom[i];

    if (quoted) {
      if (character === '"') {
        // Dubbelt citattecken inuti ett citerat fält betyder ett citattecken.
        if (withoutBom[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === delimiter) {
      row.push(field);
      field = "";
    } else if (character === "\r") {
      // Radbrytningen är \r\n; \n hanterar radslutet.
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
