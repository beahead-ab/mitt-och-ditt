import net from "node:net";

/**
 * En liten SMTP-server som tar emot och sparar i stället för att skicka
 * vidare.
 *
 * Att härma transporten hade bara bevisat att våra egna anrop går igenom. Den
 * här talar riktigt protokoll, så testet visar att transporten verkligen
 * hälsar, autentiserar, skickar kuvert och avslutar som en mailserver
 * förväntar sig. Den lyssnar bara på loopback och kan inte nå ett riktigt nät.
 */
export type FangatMail = {
  from: string;
  to: string[];
  data: string;
  authenticated: boolean;
};

export type Sink = {
  port: number;
  mail: FangatMail[];
  /** Får servern att avvisa nästa försök, för att pröva felhanteringen. */
  svaraMed?: { kod: number; text: string };
  stop: () => Promise<void>;
};

export async function startSmtpSink(): Promise<Sink> {
  const mail: FangatMail[] = [];
  const sink: Partial<Sink> = { mail };

  const server = net.createServer((socket) => {
    let buffert = "";
    let iData = false;
    let dataRader: string[] = [];
    let from = "";
    let to: string[] = [];
    let authenticated = false;
    let vantarLosenord = false;

    const svara = (rad: string) => socket.write(rad + "\r\n");
    svara("220 sink.test ESMTP");

    socket.on("data", (chunk) => {
      buffert += chunk.toString("utf8");

      for (;;) {
        const brytning = buffert.indexOf("\r\n");
        if (brytning === -1) break;
        const rad = buffert.slice(0, brytning);
        buffert = buffert.slice(brytning + 2);

        if (iData) {
          if (rad === ".") {
            iData = false;
            mail.push({ from, to: [...to], data: dataRader.join("\r\n"), authenticated });
            dataRader = [];
            to = [];
            const avvisa = sink.svaraMed;
            svara(avvisa ? `${avvisa.kod} ${avvisa.text}` : "250 2.0.0 Ok");
          } else {
            // Punkt först på raden är utfyllnad enligt protokollet.
            dataRader.push(rad.startsWith("..") ? rad.slice(1) : rad);
          }
          continue;
        }

        const kommando = rad.split(" ")[0].toUpperCase();

        if (vantarLosenord) {
          vantarLosenord = false;
          authenticated = true;
          svara("235 2.7.0 Authentication successful");
        } else if (kommando === "EHLO") {
          svara("250-sink.test");
          svara("250-AUTH PLAIN LOGIN");
          svara("250 SIZE 26214400");
        } else if (kommando === "HELO") {
          svara("250 sink.test");
        } else if (kommando === "AUTH") {
          const metod = (rad.split(" ")[1] ?? "").toUpperCase();
          if (metod === "LOGIN") {
            vantarLosenord = false;
            svara("334 VXNlcm5hbWU6");
            vantarLosenord = true;
          } else {
            authenticated = true;
            svara("235 2.7.0 Authentication successful");
          }
        } else if (kommando === "MAIL") {
          from = rad.slice(rad.indexOf("<") + 1, rad.lastIndexOf(">"));
          svara("250 2.1.0 Ok");
        } else if (kommando === "RCPT") {
          to.push(rad.slice(rad.indexOf("<") + 1, rad.lastIndexOf(">")));
          svara("250 2.1.5 Ok");
        } else if (kommando === "DATA") {
          const avvisa = sink.svaraMed;
          if (avvisa) {
            svara(`${avvisa.kod} ${avvisa.text}`);
          } else {
            iData = true;
            svara("354 End data with <CR><LF>.<CR><LF>");
          }
        } else if (kommando === "RSET") {
          to = [];
          svara("250 2.0.0 Ok");
        } else if (kommando === "QUIT") {
          svara("221 2.0.0 Bye");
          socket.end();
        } else {
          svara("250 2.0.0 Ok");
        }
      }
    });

    socket.on("error", () => {
      /* Klienten kan stänga hårt; det är inget testfel. */
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as net.AddressInfo;

  sink.port = address.port;
  sink.stop = () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
    });

  return sink as Sink;
}
