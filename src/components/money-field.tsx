import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { skrivBelopp, tolkaBelopp } from "@/lib/belopp";

/**
 * Ett kronbelopp.
 *
 * `<input type="number">` gav "4495000" utan tusenavgränsare, spinnpilar som
 * ingen vill träffa av misstag, och - värre - `Number("")` blir 0. Ett tomt
 * fält fick därför hela prognosen att falla till noll utan att något sa
 * varför. Här är tomt fält `null`, och den som räknar får själv avgöra vad
 * "inget angivet" ska betyda.
 *
 * Formateringen sker vid blur, inte medan man skriver: annars hoppar
 * markören när avgränsarna sätts in mitt i en inmatning.
 */
export function MoneyField({
  id,
  value,
  onChange,
  placeholder = "0",
  className = "",
  suffix = "kr",
  disabled,
}: {
  id?: string;
  value: number | null;
  onChange: (värde: number | null) => void;
  placeholder?: string;
  className?: string;
  suffix?: string | null;
  disabled?: boolean;
}) {
  const [text, setText] = useState(() => skrivBelopp(value));
  const [redigerar, setRedigerar] = useState(false);

  // Följer med när värdet ändras utifrån - men inte medan fältet redigeras,
  // då skulle formateringen skriva över det man håller på att skriva.
  useEffect(() => {
    if (!redigerar) setText(skrivBelopp(value));
  }, [value, redigerar]);

  return (
    <div className="flex items-center gap-1.5">
      <Input
        id={id}
        inputMode="decimal"
        disabled={disabled}
        className={`tabular text-right ${className}`}
        value={text}
        placeholder={placeholder}
        onFocus={() => setRedigerar(true)}
        onChange={(event) => {
          setText(event.target.value);
          onChange(tolkaBelopp(event.target.value));
        }}
        onBlur={() => {
          setRedigerar(false);
          const tal = tolkaBelopp(text);
          setText(skrivBelopp(tal));
          onChange(tal);
        }}
      />
      {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
    </div>
  );
}
