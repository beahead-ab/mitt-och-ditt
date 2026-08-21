import * as React from "react";
import { Upload } from "lucide-react";

import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FileInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  buttonLabel?: string;
  buttonVariant?: ButtonProps["variant"];
  buttonSize?: ButtonProps["size"];
  hideIcon?: boolean;
}

const FileInput = React.forwardRef<HTMLInputElement, FileInputProps>(
  (
    {
      className,
      buttonLabel = "Välj fil",
      buttonVariant = "outline",
      buttonSize = "default",
      hideIcon = false,
      disabled,
      ...props
    },
    ref,
  ) => {
    const inputRef = React.useRef<HTMLInputElement>(null);
    React.useImperativeHandle(ref, () => inputRef.current!);

    return (
      <div className={cn("inline-flex", className)}>
        <input
          type="file"
          className="sr-only"
          ref={inputRef}
          disabled={disabled}
          {...props}
        />
        <Button
          type="button"
          variant={buttonVariant}
          size={buttonSize}
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          {!hideIcon && <Upload className="size-4" />}
          {buttonLabel}
        </Button>
      </div>
    );
  },
);
FileInput.displayName = "FileInput";

export { FileInput };
