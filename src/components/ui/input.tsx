import * as React from "react";

import { InputMes } from "./input-mes";
import { InputMoeda } from "./input-moeda";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<"input"> & { currency?: boolean | undefined }
>(({ className, type, currency, ...props }, ref) => {
  const Component = currency ? InputMoeda : type === "month" ? InputMes : "input";
  return (
    <Component
      type={type}
      className={cn(
        "flex h-10 w-full min-w-0 rounded-xl border border-input bg-background px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Input.displayName = "Input";

export { Input };
