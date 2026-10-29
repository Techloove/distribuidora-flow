import * as React from "react";

import { TablePreferences } from "./table-preferences";

import { cn } from "@/lib/utils";

const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement> & { columnPreferences?: boolean }
>(({ className, columnPreferences = true, ...props }, ref) => {
  const table = React.useRef<HTMLTableElement>(null);
  React.useEffect(() => {
    const el = table.current;
    if (!el) return;
    const annotate = () => {
      const headers = Array.from(el.tHead?.rows[el.tHead.rows.length - 1]?.cells ?? []);
      if (headers.some((h) => h.colSpan > 1 || h.rowSpan > 1)) return;
      for (const section of Array.from(el.tBodies))
        for (const row of Array.from(section.rows)) {
          if (Array.from(row.cells).some((c) => c.colSpan > 1)) continue;
          Array.from(row.cells).forEach((cell, index) => {
            const label = headers[index]?.textContent?.replace(/\s+/g, " ").trim() ?? "";
            if (!cell.hasAttribute("data-label") && label) cell.setAttribute("data-label", label);
            const number =
              /valor|preço|preco|quantidade|estoque|peso|%|comprado|comissão|limite|^custo/i.test(
                label,
              );
            const name =
              !number &&
              /cliente|fornecedor|produto|descri|razão|fantasia|marca|categoria|grupo|representante|rota|nome|endereço|observa|histórico|responsável|referência/i.test(
                label,
              );
            cell.setAttribute("data-column-kind", name ? "name" : "value");
          });
        }
    };
    annotate();
    const observer = new MutationObserver(annotate);
    observer.observe(el, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);
  return (
    <div className="min-w-0 max-w-full">
      {columnPreferences && <TablePreferences table={table} />}
      <div className="relative w-full min-w-0 max-w-full overflow-auto">
        <table
          ref={(el) => {
            table.current = el;
            if (typeof ref === "function") ref(el);
            else if (ref) ref.current = el;
          }}
          data-readable-table="true"
          className={cn("w-full caption-bottom text-sm", className)}
          {...props}
        />
      </div>
    </div>
  );
});
Table.displayName = "Table";

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />
));
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
));
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", className)}
    {...props}
  />
));
TableFooter.displayName = "TableFooter";

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        "border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-10 px-2 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className,
    )}
    {...props}
  />
));
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      "p-2 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className,
    )}
    {...props}
  />
));
TableCell.displayName = "TableCell";

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />
));
TableCaption.displayName = "TableCaption";

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
