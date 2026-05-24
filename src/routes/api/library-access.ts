export interface ScopedLibraryRow {
  visibility: string;
  customerId: string | null;
}

export function canReadScopedLibraryRow(
  row: ScopedLibraryRow,
  customerId: string | null,
): boolean {
  if (row.visibility === 'global') return true;
  if (row.visibility !== 'private') return false;
  return row.customerId !== null && customerId !== null && row.customerId === customerId;
}

export function escapeHtmlText(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        throw new Error(`unhandled HTML escape character: ${char}`);
    }
  });
}
