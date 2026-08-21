import { Download } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type ExportChoice = {
  label: string;
  hint?: string;
  run: () => void | Promise<void>;
};

/**
 * Exportmeny. Varje val säger vad man får och i vilket format, eftersom
 * skillnaden mellan en tabell att räkna vidare på och ett dokument att skriva
 * under spelar roll för mottagaren.
 */
export function ExportMenu({
  label = "Exportera",
  groups,
}: {
  label?: string;
  groups: { title: string; choices: ExportChoice[] }[];
}) {
  async function run(choice: ExportChoice) {
    try {
      await choice.run();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Exporten misslyckades.");
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline">
          <Download className="mr-1.5 size-3.5" />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {groups.map((group, index) => (
          <div key={group.title}>
            {index > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              {group.title}
            </DropdownMenuLabel>
            {group.choices.map((choice) => (
              <DropdownMenuItem
                key={choice.label}
                className="flex-col items-start gap-0.5"
                onSelect={() => void run(choice)}
              >
                <span>{choice.label}</span>
                {choice.hint && (
                  <span className="text-xs text-muted-foreground">{choice.hint}</span>
                )}
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
