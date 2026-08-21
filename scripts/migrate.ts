/** Kör alla migreringar som inte redan är körda. */
import { closeConnections } from "../src/lib/db/client.server";
import { migrate } from "../src/lib/db/migrate.server";

const applied = await migrate();
console.log(applied.length === 0 ? "Schemat är redan aktuellt." : `Körda: ${applied.join(", ")}`);
await closeConnections();
