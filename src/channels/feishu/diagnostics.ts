export function maskConfigValue(raw: string | undefined): string | undefined {
  const trimmed = (raw || "").trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length <= 6) {
    return "*".repeat(trimmed.length);
  }
  return `${trimmed.slice(0, 3)}***${trimmed.slice(-3)}`;
}
